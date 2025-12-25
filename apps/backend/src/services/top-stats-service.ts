import { prisma } from '../lib/prisma';
import { Term } from '@prisma/client';
import { getValidAccessToken, resetTokenFailures } from '../lib/token-manager';
import { getTopTracks, getTopArtists, TimeRange } from '../lib/spotify-api';
import { upsertTrack } from './ingestion';
import { redis, waitForRateLimit } from '../lib/redis';
import { workerLoggers } from '../lib/logger';
import { topStatsQueue } from '../workers/top-stats-queue';
import { SpotifyRateLimitError } from '../lib/spotify-errors';

const log = workerLoggers.topStats;

const TIER_1_HOURS = 48;
const TIER_2_DAYS = 7;
const ACTIVE_REFRESH_HOURS = 24;
const CASUAL_REFRESH_HOURS = 72;

const TERMS: Term[] = [Term.SHORT_TERM, Term.MEDIUM_TERM, Term.LONG_TERM];
const PROGRESS_TTL_SECONDS = 2 * 60 * 60;

function toSpotifyTimeRange(term: Term): TimeRange {
    switch (term) {
        case Term.SHORT_TERM: return 'short_term';
        case Term.MEDIUM_TERM: return 'medium_term';
        case Term.LONG_TERM: return 'long_term';
        default: throw new Error(`Unknown term: ${term}`);
    }
}

function hoursSince(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

export function getUserTier(lastLoginAt: Date | null): 1 | 2 | 3 {
    if (!lastLoginAt) return 3;

    const hoursSinceLogin = hoursSince(lastLoginAt);

    if (hoursSinceLogin <= TIER_1_HOURS) return 1;
    if (hoursSinceLogin <= TIER_2_DAYS * 24) return 2;
    return 3;
}

export function shouldRefresh(user: { lastLoginAt: Date | null; topStatsRefreshedAt: Date | null }): boolean {
    if (!user.topStatsRefreshedAt) return true;

    const tier = getUserTier(user.lastLoginAt);
    const hoursSinceRefresh = hoursSince(user.topStatsRefreshedAt);

    switch (tier) {
        case 1:
            return hoursSinceRefresh >= ACTIVE_REFRESH_HOURS;
        case 2:
            return hoursSinceRefresh >= CASUAL_REFRESH_HOURS;
        case 3:
            return hoursSinceRefresh >= ACTIVE_REFRESH_HOURS;
    }
}

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
        : 999;

    if (shouldRefresh(user)) {
        await topStatsQueue.add(
            `lazy-${userId}`,
            { userId, priority: 'high' },
            { priority: 1, jobId: `lazy-${userId}` }
        );
        log.info({ userId, staleHours }, 'Queued lazy top stats refresh');
        return { queued: true, staleHours };
    }

    return { queued: false, staleHours };
}

function progressKey(userId: string, jobId: string): string {
    return `top-stats:progress:${userId}:${jobId}`;
}

async function getCompletedTerms(userId: string, jobId: string): Promise<Set<Term>> {
    const members = await redis.smembers(progressKey(userId, jobId));
    return new Set(members as Term[]);
}

async function markTermComplete(userId: string, jobId: string, term: Term): Promise<void> {
    const key = progressKey(userId, jobId);
    await redis.sadd(key, term);
    await redis.expire(key, PROGRESS_TTL_SECONDS);
}

async function clearProgress(userId: string, jobId: string): Promise<void> {
    await redis.del(progressKey(userId, jobId));
}

async function processTermTracks(
    userId: string,
    accessToken: string,
    term: Term
): Promise<void> {
    const spotifyTerm = toSpotifyTimeRange(term);
    const topTracksRes = await getTopTracks(accessToken, spotifyTerm, 50);

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

    if (topTracksRes.items.length < 50) {
        await prisma.spotifyTopTrack.deleteMany({
            where: { userId, term, rank: { gt: topTracksRes.items.length } },
        });
    }
}

async function processTermArtists(
    userId: string,
    accessToken: string,
    term: Term
): Promise<void> {
    const spotifyTerm = toSpotifyTimeRange(term);
    const topArtistsRes = await getTopArtists(accessToken, spotifyTerm, 50);

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
}

export async function processUserTopStats(userId: string, jobId?: string): Promise<void> {
    const tokenResult = await getValidAccessToken(userId);
    if (!tokenResult) {
        log.info({ userId }, 'Skipping top stats: No valid token');
        return;
    }
    const accessToken = tokenResult.accessToken;

    const effectiveJobId = jobId || `manual-${Date.now()}`;
    const completedTerms = await getCompletedTerms(userId, effectiveJobId);

    for (const term of TERMS) {
        if (completedTerms.has(term)) {
            log.info({ userId, term }, 'Skipping already-completed term');
            continue;
        }

        await waitForRateLimit();

        await processTermTracks(userId, accessToken, term);

        await waitForRateLimit();

        await processTermArtists(userId, accessToken, term);

        await markTermComplete(userId, effectiveJobId, term);
        log.info({ userId, term }, 'Term completed');
    }

    await clearProgress(userId, effectiveJobId);
    await resetTokenFailures(userId);
}

export function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export { TERMS, getCompletedTerms, markTermComplete, clearProgress };
