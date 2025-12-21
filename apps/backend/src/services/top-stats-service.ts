import { prisma } from '../lib/prisma';
import { getValidAccessToken, recordTokenFailure, resetTokenFailures } from '../lib/token-manager';
import { getTopTracks, getTopArtists, TimeRange } from '../lib/spotify-api';
import { upsertTrack } from './ingestion';
import { waitForRateLimit } from '../lib/redis';
import { workerLoggers } from '../lib/logger';
import { topStatsQueue } from '../workers/top-stats-queue';

const log = workerLoggers.topStats;

// Tier thresholds (in hours/days)
const TIER_1_HOURS = 48;      // Logged in within 48h
const TIER_2_DAYS = 7;        // Logged in within 7 days
const ACTIVE_REFRESH_HOURS = 24;   // Tier 1 refresh threshold
const CASUAL_REFRESH_HOURS = 72;   // Tier 2 refresh threshold

const TERMS: TimeRange[] = ['short_term', 'medium_term', 'long_term'];

// Get user's activity tier based on last login time.
export function getUserTier(lastLoginAt: Date | null): 1 | 2 | 3 {
    if (!lastLoginAt) return 3;  // Never logged in

    const hoursSinceLogin = (Date.now() - lastLoginAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLogin <= TIER_1_HOURS) return 1;
    if (hoursSinceLogin <= TIER_2_DAYS * 24) return 2;
    return 3;
}

// Determine if a user's top stats should be refreshed based on tier and staleness.
export function shouldRefresh(user: { lastLoginAt: Date | null; topStatsRefreshedAt: Date | null }): boolean {
    // Never refreshed = always refresh
    if (!user.topStatsRefreshedAt) return true;

    const tier = getUserTier(user.lastLoginAt);
    const hoursSinceRefresh = (Date.now() - user.topStatsRefreshedAt.getTime()) / (1000 * 60 * 60);

    switch (tier) {
        case 1:
            return hoursSinceRefresh >= ACTIVE_REFRESH_HOURS;
        case 2:
            return hoursSinceRefresh >= CASUAL_REFRESH_HOURS;
        case 3:
            // Tier 3 (inactive) gets refreshed on-demand only
            // Still refresh if stale for more than 24h when they do return
            return hoursSinceRefresh >= ACTIVE_REFRESH_HOURS;
    }
}

// Trigger a lazy refresh if the user's top stats are stale.
// Returns immediately - the actual refresh happens in the background.
export async function triggerLazyRefreshIfStale(userId: string): Promise<{ queued: boolean; staleHours: number }> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { lastLoginAt: true, topStatsRefreshedAt: true }
    });

    if (!user) {
        return { queued: false, staleHours: 0 };
    }

    const staleHours = user.topStatsRefreshedAt
        ? Math.floor((Date.now() - user.topStatsRefreshedAt.getTime()) / (1000 * 60 * 60))
        : 999;  // Never refreshed

    if (shouldRefresh(user)) {
        // Queue high-priority job
        await topStatsQueue.add(
            `lazy-${userId}`,
            { userId, priority: 'high' },
            { priority: 1, jobId: `lazy-${userId}` }  // Lower number = higher priority
        );
        log.info({ userId, staleHours }, 'Queued lazy top stats refresh');
        return { queued: true, staleHours };
    }

    return { queued: false, staleHours };
}

// Process top stats for a single user (fetches from Spotify and stores in DB).
export async function processUserTopStats(userId: string): Promise<void> {
    const tokenResult = await getValidAccessToken(userId);
    if (!tokenResult) {
        log.info({ userId }, 'Skipping top stats: No valid token');
        return;
    }
    const accessToken = tokenResult.accessToken;

    for (const term of TERMS) {
        await waitForRateLimit();

        // Top Tracks
        try {
            const topTracksRes = await getTopTracks(accessToken, term, 50);

            for (let i = 0; i < topTracksRes.items.length; i++) {
                const spotifyTrack = topTracksRes.items[i];
                const rank = i + 1;

                const trackForIngest = {
                    spotifyId: spotifyTrack.id,
                    name: spotifyTrack.name,
                    durationMs: spotifyTrack.duration_ms,
                    previewUrl: spotifyTrack.preview_url,
                    album: {
                        spotifyId: spotifyTrack.album.id,
                        name: spotifyTrack.album.name,
                        imageUrl: spotifyTrack.album.images[0]?.url || null,
                        releaseDate: spotifyTrack.album.release_date,
                    },
                    artists: spotifyTrack.artists.map(a => ({ spotifyId: a.id, name: a.name })),
                };

                const { trackId } = await upsertTrack(trackForIngest);

                await prisma.spotifyTopTrack.upsert({
                    where: { userId_term_rank: { userId, term, rank } },
                    create: { userId, term, rank, trackId },
                    update: { trackId },
                });
            }

            // Clean up excess ranks if fewer than 50 returned
            if (topTracksRes.items.length < 50) {
                await prisma.spotifyTopTrack.deleteMany({
                    where: { userId, term, rank: { gt: topTracksRes.items.length } },
                });
            }
        } catch (err) {
            log.error({ term, userId, error: err }, 'Error fetching top tracks');
        }

        await waitForRateLimit();

        // Top Artists
        try {
            const topArtistsRes = await getTopArtists(accessToken, term, 50);

            for (let i = 0; i < topArtistsRes.items.length; i++) {
                const spotifyArtist = topArtistsRes.items[i];
                const rank = i + 1;

                const artistData = {
                    spotifyId: spotifyArtist.id,
                    name: spotifyArtist.name,
                    imageUrl: spotifyArtist.images[0]?.url,
                    genres: spotifyArtist.genres,
                };

                const artistId = (await prisma.artist.upsert({
                    where: { spotifyId: artistData.spotifyId },
                    create: artistData,
                    update: { imageUrl: artistData.imageUrl, genres: artistData.genres },
                    select: { id: true },
                })).id;

                await prisma.spotifyTopArtist.upsert({
                    where: { userId_term_rank: { userId, term, rank } },
                    create: { userId, term, rank, artistId },
                    update: { artistId },
                });
            }

            if (topArtistsRes.items.length < 50) {
                await prisma.spotifyTopArtist.deleteMany({
                    where: { userId, term, rank: { gt: topArtistsRes.items.length } },
                });
            }
        } catch (err) {
            log.error({ term, userId, error: err }, 'Error fetching top artists');
        }
    }

    // Reset any consecutive failures on success
    await resetTokenFailures(userId);
}

// Helper: get hours ago timestamp
export function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// Helper: get days ago timestamp
export function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
