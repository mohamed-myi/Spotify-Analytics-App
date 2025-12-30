import { prisma } from '../lib/prisma';
import { Term, Prisma } from '@prisma/client';
import { getValidAccessToken, resetTokenFailures } from '../lib/token-manager';
import { getTopTracks, getTopArtists, TimeRange } from '../lib/spotify-api';
import { upsertTrack } from './ingestion';
import { redis, waitForRateLimit } from '../lib/redis';
import { workerLoggers } from '../lib/logger';
import { topStatsQueue } from '../workers/top-stats-queue';

const log = workerLoggers.topStats;

const TIER_1_HOURS = 48;
const TIER_2_DAYS = 7;
const ACTIVE_REFRESH_HOURS = 24;
const CASUAL_REFRESH_HOURS = 72;

const TERMS: Term[] = [Term.SHORT_TERM, Term.MEDIUM_TERM, Term.LONG_TERM];

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

export async function isTopStatsHydrated(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { topStatsRefreshedAt: true }
    });
    return user !== null && user.topStatsRefreshedAt !== null;
}

// Types for in-memory aggregation before atomic write
interface FetchedTrack {
    term: Term;
    rank: number;
    trackId: string;
}

interface FetchedArtist {
    term: Term;
    rank: number;
    artistId: string;
}

interface FetchedTermData {
    tracks: FetchedTrack[];
    artists: FetchedArtist[];
    trackCount: number;
    artistCount: number;
}

// Fetch data from Spotify API for a single term; returns in-memory data
async function fetchTermData(
    userId: string,
    accessToken: string,
    term: Term
): Promise<FetchedTermData> {
    const spotifyTerm = toSpotifyTimeRange(term);
    const tracks: FetchedTrack[] = [];
    const artists: FetchedArtist[] = [];

    // Fetch tracks
    await waitForRateLimit();
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

        // Upsert track/album/artist entities outside transaction; these are idempotent
        const { trackId } = await upsertTrack(trackForIngest);
        tracks.push({ term, rank, trackId });
    }

    // Fetch artists
    await waitForRateLimit();
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

        // Upsert artist entity outside transaction; idempotent
        const artistRecord = await prisma.artist.upsert({
            where: { spotifyId: artistData.spotifyId },
            create: artistData,
            update: { imageUrl: artistData.imageUrl, genres: artistData.genres },
            select: { id: true },
        });

        artists.push({ term, rank, artistId: artistRecord.id });
    }

    return {
        tracks,
        artists,
        trackCount: topTracksRes.items.length,
        artistCount: topArtistsRes.items.length,
    };
}

// Fetch all terms sequentially; respects rate limits; aggregates in memory
async function fetchAllTermsData(
    userId: string,
    accessToken: string
): Promise<Map<Term, FetchedTermData>> {
    const allData = new Map<Term, FetchedTermData>();

    for (const term of TERMS) {
        log.info({ userId, term }, 'Fetching term data from Spotify');
        const termData = await fetchTermData(userId, accessToken, term);
        allData.set(term, termData);
        log.info({ userId, term, tracks: termData.trackCount, artists: termData.artistCount }, 'Term data fetched');
    }

    return allData;
}

// Persist all data atomically using a Prisma transaction
async function persistAllTermsData(
    userId: string,
    allData: Map<Term, FetchedTermData>
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        // Delete existing top tracks/artists for this user to replace with fresh data
        await tx.spotifyTopTrack.deleteMany({ where: { userId } });
        await tx.spotifyTopArtist.deleteMany({ where: { userId } });

        // Prepare batch inserts
        const trackInserts: Prisma.SpotifyTopTrackCreateManyInput[] = [];
        const artistInserts: Prisma.SpotifyTopArtistCreateManyInput[] = [];

        for (const [, termData] of allData) {
            for (const track of termData.tracks) {
                trackInserts.push({
                    userId,
                    term: track.term,
                    rank: track.rank,
                    trackId: track.trackId,
                });
            }
            for (const artist of termData.artists) {
                artistInserts.push({
                    userId,
                    term: artist.term,
                    rank: artist.rank,
                    artistId: artist.artistId,
                });
            }
        }

        // Batch insert all tracks and artists
        if (trackInserts.length > 0) {
            await tx.spotifyTopTrack.createMany({ data: trackInserts });
        }
        if (artistInserts.length > 0) {
            await tx.spotifyTopArtist.createMany({ data: artistInserts });
        }

        // Update topStatsRefreshedAt inside transaction; atomic with data
        await tx.user.update({
            where: { id: userId },
            data: { topStatsRefreshedAt: new Date() },
        });

        log.info({ userId, tracks: trackInserts.length, artists: artistInserts.length }, 'Atomic write completed');
    });
}

export async function processUserTopStats(userId: string, _jobId?: string): Promise<void> {
    const tokenResult = await getValidAccessToken(userId);
    if (!tokenResult) {
        log.info({ userId }, 'Skipping top stats: No valid token');
        return;
    }
    const accessToken = tokenResult.accessToken;

    // Fetch all data from Spotify; sequential API calls with rate limiting
    const allData = await fetchAllTermsData(userId, accessToken);

    // Persist all data atomically; all-or-nothing write
    await persistAllTermsData(userId, allData);

    await resetTokenFailures(userId);
    log.info({ userId }, 'Top stats refresh completed');
}

export function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export { TERMS };
