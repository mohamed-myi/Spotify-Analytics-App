import { prisma } from '../lib/prisma';
import { Term, Prisma } from '@prisma/client';
import { getValidAccessToken, resetTokenFailures } from '../lib/token-manager';
import { getTopTracks, getTopArtists, TimeRange } from '../lib/spotify-api';
import { workerLoggers } from '../lib/logger';
import { topStatsQueue } from '../workers/top-stats-queue';

const log = workerLoggers.topStats;

const TIER_1_HOURS = 48;
const TIER_2_DAYS = 7;
const ACTIVE_REFRESH_HOURS = 24;
const CASUAL_REFRESH_HOURS = 72;

const TERMS: Term[] = [Term.SHORT_TERM, Term.MEDIUM_TERM, Term.LONG_TERM];

// Transaction timeout: 30 seconds 
const TRANSACTION_TIMEOUT_MS = 30000;

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

interface RawSpotifyTrack {
    spotifyId: string;
    name: string;
    durationMs: number;
    previewUrl: string | null;
    album: {
        spotifyId: string;
        name: string;
        imageUrl: string | null;
        releaseDate: string | null;
    };
    artists: Array<{ spotifyId: string; name: string }>;
}

interface RawSpotifyArtist {
    spotifyId: string;
    name: string;
    imageUrl: string | null;
    genres: string[];
}

interface RawTermData {
    term: Term;
    tracks: Array<{ rank: number; track: RawSpotifyTrack }>;
    artists: Array<{ rank: number; artist: RawSpotifyArtist }>;
}

async function fetchTermDataRaw(
    accessToken: string,
    term: Term
): Promise<RawTermData> {
    const spotifyTerm = toSpotifyTimeRange(term);

    // Fetch tracks and artists in parallel within the term
    const [topTracksRes, topArtistsRes] = await Promise.all([
        getTopTracks(accessToken, spotifyTerm, 50),
        getTopArtists(accessToken, spotifyTerm, 50),
    ]);

    const tracks = topTracksRes.items.map((spotifyTrack, index) => ({
        rank: index + 1,
        track: {
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
        },
    }));

    const artists = topArtistsRes.items.map((spotifyArtist, index) => ({
        rank: index + 1,
        artist: {
            spotifyId: spotifyArtist.id,
            name: spotifyArtist.name,
            imageUrl: spotifyArtist.images[0]?.url || null,
            genres: spotifyArtist.genres || [],
        },
    }));

    return { term, tracks, artists };
}

async function fetchAllTermsParallel(
    userId: string,
    accessToken: string
): Promise<RawTermData[]> {
    log.info({ userId }, 'Starting parallel fetch for all terms');

    const results = await Promise.allSettled([
        fetchTermDataRaw(accessToken, Term.SHORT_TERM),
        fetchTermDataRaw(accessToken, Term.MEDIUM_TERM),
        fetchTermDataRaw(accessToken, Term.LONG_TERM),
    ]);

    const successfulResults: RawTermData[] = [];
    const errors: Array<{ term: Term; error: unknown }> = [];

    results.forEach((result, index) => {
        const term = TERMS[index];
        if (result.status === 'fulfilled') {
            successfulResults.push(result.value);
            log.info({
                userId,
                term,
                tracks: result.value.tracks.length,
                artists: result.value.artists.length
            }, 'Term data fetched successfully');
        } else {
            errors.push({ term, error: result.reason });
            log.error({ userId, term, error: result.reason }, 'Failed to fetch term data');
        }
    });

    // If any term failed, throw an error with details
    if (errors.length > 0) {
        const failedTerms = errors.map(e => e.term).join(', ');
        throw new Error(`Failed to fetch terms: ${failedTerms}. First error: ${errors[0].error}`);
    }

    return successfulResults;
}

interface BulkCatalogResult {
    artistIdMap: Map<string, string>;
    albumIdMap: Map<string, string>;
    trackIdMap: Map<string, string>;
}

async function bulkUpsertCatalog(
    allTermsData: RawTermData[],
    signal?: AbortSignal
): Promise<BulkCatalogResult> {
    // Collect unique entities across all terms
    const uniqueArtists = new Map<string, { spotifyId: string; name: string; imageUrl: string | null; genres: string[] }>();
    const uniqueAlbums = new Map<string, { spotifyId: string; name: string; imageUrl: string | null; releaseDate: string | null }>();
    const uniqueTracks = new Map<string, RawSpotifyTrack>();

    for (const termData of allTermsData) {
        // Collect artists from top artists
        for (const { artist } of termData.artists) {
            if (!uniqueArtists.has(artist.spotifyId)) {
                uniqueArtists.set(artist.spotifyId, artist);
            }
        }

        // Collect albums, tracks, and track artists
        for (const { track } of termData.tracks) {
            if (!uniqueAlbums.has(track.album.spotifyId)) {
                uniqueAlbums.set(track.album.spotifyId, track.album);
            }
            if (!uniqueTracks.has(track.spotifyId)) {
                uniqueTracks.set(track.spotifyId, track);
            }
            // Collect artists from tracks
            for (const artist of track.artists) {
                if (!uniqueArtists.has(artist.spotifyId)) {
                    uniqueArtists.set(artist.spotifyId, {
                        spotifyId: artist.spotifyId,
                        name: artist.name,
                        imageUrl: null,
                        genres: []
                    });
                }
            }
        }
    }

    // Check abort signal before heavy DB operations
    if (signal?.aborted) {
        throw new Error('Operation aborted before catalog write');
    }

    // Bulk create artists
    const artistsToCreate = Array.from(uniqueArtists.values()).map(a => ({
        spotifyId: a.spotifyId,
        name: a.name,
        imageUrl: a.imageUrl,
        genres: a.genres,
    }));

    if (artistsToCreate.length > 0) {
        await prisma.artist.createMany({
            data: artistsToCreate,
            skipDuplicates: true,
        });
    }

    // Fetch artist IDs
    const artistSpotifyIds = Array.from(uniqueArtists.keys());
    const artistRecords = await prisma.artist.findMany({
        where: { spotifyId: { in: artistSpotifyIds } },
        select: { id: true, spotifyId: true },
    });
    const artistIdMap = new Map(artistRecords.map(a => [a.spotifyId, a.id]));

    // Bulk create albums
    const albumsToCreate = Array.from(uniqueAlbums.values()).map(a => ({
        spotifyId: a.spotifyId,
        name: a.name,
        imageUrl: a.imageUrl,
        releaseDate: a.releaseDate,
    }));

    if (albumsToCreate.length > 0) {
        await prisma.album.createMany({
            data: albumsToCreate,
            skipDuplicates: true,
        });
    }

    // Fetch album IDs
    const albumSpotifyIds = Array.from(uniqueAlbums.keys());
    const albumRecords = await prisma.album.findMany({
        where: { spotifyId: { in: albumSpotifyIds } },
        select: { id: true, spotifyId: true },
    });
    const albumIdMap = new Map(albumRecords.map(a => [a.spotifyId, a.id]));

    // Check abort signal again
    if (signal?.aborted) {
        throw new Error('Operation aborted before track write');
    }

    // Bulk create tracks
    const tracksToCreate = Array.from(uniqueTracks.values()).map(t => ({
        spotifyId: t.spotifyId,
        name: t.name,
        durationMs: t.durationMs,
        previewUrl: t.previewUrl,
        albumId: albumIdMap.get(t.album.spotifyId) || null,
    }));

    if (tracksToCreate.length > 0) {
        await prisma.track.createMany({
            data: tracksToCreate,
            skipDuplicates: true,
        });
    }

    // Fetch track IDs
    const trackSpotifyIds = Array.from(uniqueTracks.keys());
    const trackRecords = await prisma.track.findMany({
        where: { spotifyId: { in: trackSpotifyIds } },
        select: { id: true, spotifyId: true },
    });
    const trackIdMap = new Map(trackRecords.map(t => [t.spotifyId, t.id]));

    // Bulk create track-artist relationships
    const trackArtistPairs: Array<{ trackId: string; artistId: string }> = [];
    for (const track of uniqueTracks.values()) {
        const trackId = trackIdMap.get(track.spotifyId);
        if (!trackId) continue;

        for (const artist of track.artists) {
            const artistId = artistIdMap.get(artist.spotifyId);
            if (artistId) {
                trackArtistPairs.push({ trackId, artistId });
            }
        }
    }

    if (trackArtistPairs.length > 0) {
        await prisma.trackArtist.createMany({
            data: trackArtistPairs,
            skipDuplicates: true,
        });
    }

    // Memory cleanup: clear intermediate collections
    uniqueArtists.clear();
    uniqueAlbums.clear();
    uniqueTracks.clear();

    return { artistIdMap, albumIdMap, trackIdMap };
}

async function persistTopStatsAtomic(
    userId: string,
    allTermsData: RawTermData[],
    catalogResult: BulkCatalogResult,
    signal?: AbortSignal
): Promise<void> {
    // Check abort signal before starting transaction
    if (signal?.aborted) {
        throw new Error('Operation aborted before transaction');
    }

    await prisma.$transaction(async (tx) => {
        // Lock the user row first to prevent concurrent transactions
        await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;

        // Delete existing top tracks/artists for this user
        await tx.spotifyTopTrack.deleteMany({ where: { userId } });
        await tx.spotifyTopArtist.deleteMany({ where: { userId } });

        // Prepare batch inserts
        const trackInserts: Prisma.SpotifyTopTrackCreateManyInput[] = [];
        const artistInserts: Prisma.SpotifyTopArtistCreateManyInput[] = [];

        for (const termData of allTermsData) {
            for (const { rank, track } of termData.tracks) {
                const trackId = catalogResult.trackIdMap.get(track.spotifyId);
                if (trackId) {
                    trackInserts.push({
                        userId,
                        term: termData.term,
                        rank,
                        trackId,
                    });
                }
            }
            for (const { rank, artist } of termData.artists) {
                const artistId = catalogResult.artistIdMap.get(artist.spotifyId);
                if (artistId) {
                    artistInserts.push({
                        userId,
                        term: termData.term,
                        rank,
                        artistId,
                    });
                }
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
    }, { timeout: TRANSACTION_TIMEOUT_MS });
}


export async function processUserTopStats(
    userId: string,
    _jobId?: string,
    signal?: AbortSignal
): Promise<void> {
    // Token acquisition
    console.time('token_refresh');
    const tokenResult = await getValidAccessToken(userId);
    console.timeEnd('token_refresh');

    if (!tokenResult) {
        log.info({ userId }, 'Skipping top stats: No valid token');
        return;
    }
    const accessToken = tokenResult.accessToken;

    // Check abort signal
    if (signal?.aborted) {
        log.info({ userId }, 'Operation aborted before fetch');
        return;
    }

    // Parallel Spotify fetch
    console.time('spotify_fetch');
    let allTermsData: RawTermData[];
    try {
        allTermsData = await fetchAllTermsParallel(userId, accessToken);
    } catch (error) {
        console.timeEnd('spotify_fetch');
        throw error;
    }
    console.timeEnd('spotify_fetch');

    // Check abort signal
    if (signal?.aborted) {
        log.info({ userId }, 'Operation aborted before catalog write');
        return;
    }

    // Bulk catalog upserts (artists, albums, tracks)
    console.time('bulk_catalog_write');
    let catalogResult: BulkCatalogResult;
    try {
        catalogResult = await bulkUpsertCatalog(allTermsData, signal);
    } catch (error) {
        console.timeEnd('bulk_catalog_write');
        throw error;
    }
    console.timeEnd('bulk_catalog_write');

    // Check abort signal
    if (signal?.aborted) {
        log.info({ userId }, 'Operation aborted before transaction');
        // Memory cleanup
        catalogResult.artistIdMap.clear();
        catalogResult.albumIdMap.clear();
        catalogResult.trackIdMap.clear();
        return;
    }

    // Atomic stats transaction
    console.time('stats_transaction');
    try {
        await persistTopStatsAtomic(userId, allTermsData, catalogResult, signal);
    } catch (error) {
        console.timeEnd('stats_transaction');
        // Memory cleanup on error
        catalogResult.artistIdMap.clear();
        catalogResult.albumIdMap.clear();
        catalogResult.trackIdMap.clear();
        throw error;
    }
    console.timeEnd('stats_transaction');

    // Memory cleanup: clear ID maps
    catalogResult.artistIdMap.clear();
    catalogResult.albumIdMap.clear();
    catalogResult.trackIdMap.clear();

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
