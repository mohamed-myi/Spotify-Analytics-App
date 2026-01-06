import { Readable } from 'stream';
import { Source, JobStatus } from '@prisma/client';
import { redis, queueTrackForMetadata } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { updateStatsForEvents } from './aggregation';
import { ensurePartitionsForDates } from '../lib/partitions';
import { getValidAccessToken } from '../lib/token-manager';
import { searchTracks } from '../lib/spotify-api';
import { SpotifyRateLimitError } from '../lib/spotify-errors';
import { getImportRateLimiter } from '../lib/rate-limiter';
import { findBestMatch, buildSearchQuery, generateCacheKey } from './track-matcher';
import {
    extractUniqueTracksFromStream,
    generateNormalizedKey,
    type ParsedBasicEvent,
    type UniqueTrack,
} from '../lib/basic-import-parser';
import type { ImportProgress, UnresolvedTrack } from '../types/import';
import type { InsertResultWithIds } from '../types/ingestion';
import { logger } from '../lib/logger';

const BATCH_SIZE = 100;
const PROGRESS_TTL_SECONDS = 86400;
const UNRESOLVED_KEY = (jobId: string) => `import_unresolved:${jobId}`;
const PROGRESS_KEY = (jobId: string) => `import_progress:${jobId}`;

interface TrackResolution {
    normalizedKey: string;
    spotifyTrackId: string | null;
    trackName: string;
    artistName: string;
}

export async function processBasicImportStream(
    userId: string,
    jobId: string,
    fileName: string,
    fileStream: NodeJS.ReadableStream
): Promise<void> {
    const log = logger.child({ jobId, userId });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { settings: { select: { timezone: true } } },
    });
    const userTimezone = user?.settings?.timezone ?? 'UTC';

    await prisma.importJob.upsert({
        where: { id: jobId },
        create: {
            id: jobId,
            userId,
            fileName,
            status: JobStatus.PROCESSING,
            startedAt: new Date(),
        },
        update: {
            status: JobStatus.PROCESSING,
            startedAt: new Date(),
        },
    });

    const unresolvedTracks: UnresolvedTrack[] = [];
    let totalRecords = 0;
    let processedRecords = 0;
    let addedRecords = 0;
    let skippedRecords = 0;

    const updateProgress = async (
        phase: 'resolving' | 'creating',
        totalUniqueTracks: number = 0,
        resolvedTracks: number = 0,
        status: JobStatus = JobStatus.PROCESSING,
        error?: string
    ) => {
        const progress: ImportProgress = {
            status,
            phase,
            totalUniqueTracks,
            resolvedTracks,
            totalRecords,
            processedRecords,
            addedRecords,
            skippedRecords,
            unresolvedTracks: unresolvedTracks.length > 0 ? unresolvedTracks : undefined,
            errorMessage: error,
        };
        await redis.set(PROGRESS_KEY(jobId), JSON.stringify(progress), 'EX', PROGRESS_TTL_SECONDS);
    };

    try {
        log.info('Starting Phase 1: Track Resolution');
        await updateProgress('resolving');

        const chunks: Buffer[] = [];
        for await (const chunk of fileStream) {
            chunks.push(Buffer.from(chunk));
        }
        const fileBuffer = Buffer.concat(chunks);

        const { uniqueTracks, events, totalRecords: total, skippedRecords: skipped } =
            await extractUniqueTracksFromStream(
                Readable.from(fileBuffer),
                userTimezone,
                () => { }
            );

        totalRecords = total;
        skippedRecords = skipped;

        log.info({
            totalRecords,
            uniqueTracks: uniqueTracks.size,
            eventsToProcess: events.length
        }, 'File parsed, starting track resolution');

        await updateProgress('resolving', uniqueTracks.size, 0);

        const resolutions = new Map<string, TrackResolution>();
        const tracksToResolve = Array.from(uniqueTracks.values());
        let resolvedCount = 0;

        const cachedResolutions = await prisma.trackResolutionCache.findMany({
            where: {
                normalizedKey: { in: tracksToResolve.map(t => t.normalizedKey) },
            },
        });

        const cachedMap = new Map(cachedResolutions.map((r: { normalizedKey: string; spotifyTrackId: string | null; trackName: string; artistName: string }) => [r.normalizedKey, r]));
        log.info({ cacheHits: cachedResolutions.length }, 'Cache lookup complete');

        for (const cached of cachedResolutions) {
            resolutions.set(cached.normalizedKey, {
                normalizedKey: cached.normalizedKey,
                spotifyTrackId: cached.spotifyTrackId,
                trackName: cached.trackName,
                artistName: cached.artistName,
            });
            resolvedCount++;
        }

        await updateProgress('resolving', uniqueTracks.size, resolvedCount);

        const uncachedTracks = tracksToResolve.filter(t => !cachedMap.has(t.normalizedKey));

        if (uncachedTracks.length > 0) {
            log.info({ tracksToSearch: uncachedTracks.length }, 'Starting Spotify API search');

            const rateLimiter = getImportRateLimiter();
            const newCacheEntries: Array<{
                trackName: string;
                artistName: string;
                normalizedKey: string;
                spotifyTrackId: string | null;
            }> = [];

            for (const track of uncachedTracks) {
                try {
                    await rateLimiter.acquire();

                    const tokenResult = await getValidAccessToken(userId);
                    if (!tokenResult) {
                        log.error('No valid access token for user');
                        throw new Error('Authentication required: Please re-login to continue import');
                    }

                    const query = buildSearchQuery(track.trackName, track.artistName);
                    const searchResults = await searchTracks(tokenResult.accessToken, query, 5);

                    rateLimiter.recordSuccess();

                    const matchResult = findBestMatch(searchResults, {
                        trackName: track.trackName,
                        artistName: track.artistName,
                        msPlayed: track.totalMsPlayed / track.occurrences,
                    });

                    const resolution: TrackResolution = {
                        normalizedKey: track.normalizedKey,
                        spotifyTrackId: matchResult.spotifyTrackId,
                        trackName: track.trackName,
                        artistName: track.artistName,
                    };

                    resolutions.set(track.normalizedKey, resolution);
                    newCacheEntries.push({
                        trackName: track.trackName,
                        artistName: track.artistName,
                        normalizedKey: track.normalizedKey,
                        spotifyTrackId: matchResult.spotifyTrackId,
                    });

                    if (!matchResult.spotifyTrackId) {
                        unresolvedTracks.push({
                            trackName: track.trackName,
                            artistName: track.artistName,
                            occurrences: track.occurrences,
                        });
                    }

                    resolvedCount++;

                    if (resolvedCount % 10 === 0) {
                        await updateProgress('resolving', uniqueTracks.size, resolvedCount);
                    }
                } catch (error) {
                    if (error instanceof SpotifyRateLimitError) {
                        rateLimiter.handleRateLimit(error.retryAfterSeconds);
                        uncachedTracks.push(track);
                        continue;
                    }
                    throw error;
                }
            }

            if (newCacheEntries.length > 0) {
                await prisma.trackResolutionCache.createMany({
                    data: newCacheEntries,
                    skipDuplicates: true,
                });
                log.info({ newCacheEntries: newCacheEntries.length }, 'Cache entries created');
            }
        }

        if (unresolvedTracks.length > 0) {
            await redis.set(
                UNRESOLVED_KEY(jobId),
                JSON.stringify(unresolvedTracks),
                'EX',
                PROGRESS_TTL_SECONDS
            );
        }

        log.info({
            resolved: resolvedCount,
            unresolved: unresolvedTracks.length
        }, 'Phase 1 complete');

        log.info('Starting Phase 2: Event Creation');
        await updateProgress('creating', uniqueTracks.size, resolvedCount);

        const resolvedEvents = events.filter(e => {
            const key = generateNormalizedKey(e.trackName, e.artistName);
            const resolution = resolutions.get(key);
            return resolution?.spotifyTrackId;
        });

        const resolvedSpotifyIds = new Set<string>();
        for (const e of resolvedEvents) {
            const key = generateNormalizedKey(e.trackName, e.artistName);
            const resolution = resolutions.get(key);
            if (resolution?.spotifyTrackId) {
                resolvedSpotifyIds.add(resolution.spotifyTrackId);
            }
        }

        const trackIdMap = await ensureTracksExist(Array.from(resolvedSpotifyIds), resolutions);

        for (let i = 0; i < resolvedEvents.length; i += BATCH_SIZE) {
            const batch = resolvedEvents.slice(i, i + BATCH_SIZE);
            const results = await insertBasicEventBatch(
                userId,
                batch,
                resolutions,
                trackIdMap,
                userTimezone
            );

            addedRecords += results.added;
            skippedRecords += results.skipped;
            processedRecords += batch.length;

            await updateProgress('creating', uniqueTracks.size, resolvedCount);
        }

        skippedRecords += events.length - resolvedEvents.length;

        // Check if import actually processed any records meaningfully
        if (addedRecords === 0 && totalRecords > 0) {
            let errorMessage: string;

            if (uniqueTracks.size === 0) {
                errorMessage =
                    `Import failed: No valid tracks found in file (${totalRecords} records, all skipped). ` +
                    'Records may have been filtered due to play time being less than 5 seconds.';
            } else if (unresolvedTracks.length === uniqueTracks.size) {
                errorMessage =
                    `Import failed: Could not resolve any tracks via Spotify search (${uniqueTracks.size} unique tracks, all unresolved). ` +
                    'This may indicate an issue with your Spotify authentication or the track names in the file.';
            } else {
                errorMessage =
                    `Import completed but no new records were added (${totalRecords} total, ${skippedRecords} skipped). ` +
                    'All tracks may have already been imported previously.';
            }

            log.warn({ totalRecords, skippedRecords, addedRecords, uniqueTracks: uniqueTracks.size, unresolvedTracks: unresolvedTracks.length }, errorMessage);

            await updateProgress('creating', uniqueTracks.size, resolvedCount, JobStatus.FAILED, errorMessage);

            await prisma.importJob.update({
                where: { id: jobId },
                data: {
                    status: JobStatus.FAILED,
                    errorMessage,
                    totalEvents: totalRecords,
                    processedEvents: processedRecords,
                    completedAt: new Date(),
                },
            });
            return;
        }

        await updateProgress('creating', uniqueTracks.size, resolvedCount, JobStatus.COMPLETED);

        await prisma.importJob.update({
            where: { id: jobId },
            data: {
                status: JobStatus.COMPLETED,
                totalEvents: totalRecords,
                processedEvents: processedRecords,
                completedAt: new Date(),
            },
        });

        log.info({
            totalRecords,
            processedRecords,
            addedRecords,
            skippedRecords,
            unresolvedTracks: unresolvedTracks.length,
        }, 'Basic import completed');

    } catch (error) {
        log.error({ error }, 'Basic import failed');
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await updateProgress('resolving', 0, 0, JobStatus.FAILED, errorMessage);

        await prisma.importJob.update({
            where: { id: jobId },
            data: {
                status: JobStatus.FAILED,
                errorMessage,
                completedAt: new Date(),
            },
        });

        throw error;
    }
}

async function ensureTracksExist(
    spotifyIds: string[],
    resolutions: Map<string, TrackResolution>
): Promise<Map<string, string>> {
    const existing = await prisma.track.findMany({
        where: { spotifyId: { in: spotifyIds } },
        select: { id: true, spotifyId: true },
    });

    const trackMap = new Map(existing.map(t => [t.spotifyId, t.id]));
    const missingIds = spotifyIds.filter(id => !trackMap.has(id));

    if (missingIds.length > 0) {
        const newTracks = missingIds.map(spotifyId => {
            let trackName = 'Unknown';
            for (const res of resolutions.values()) {
                if (res.spotifyTrackId === spotifyId) {
                    trackName = res.trackName;
                    break;
                }
            }
            return {
                spotifyId,
                name: trackName,
                durationMs: 0,
            };
        });

        await prisma.track.createMany({
            data: newTracks,
            skipDuplicates: true,
        });

        const created = await prisma.track.findMany({
            where: { spotifyId: { in: missingIds } },
            select: { id: true, spotifyId: true },
        });
        created.forEach(t => trackMap.set(t.spotifyId, t.id));

        await Promise.all(missingIds.map(id => queueTrackForMetadata(id)));
    }

    return trackMap;
}

async function insertBasicEventBatch(
    userId: string,
    events: ParsedBasicEvent[],
    resolutions: Map<string, TrackResolution>,
    trackIdMap: Map<string, string>,
    userTimezone: string
): Promise<{ added: number; skipped: number }> {
    await ensurePartitionsForDates(events.map(e => e.playedAt));

    const eventData: Array<{
        userId: string;
        trackId: string;
        playedAt: Date;
        msPlayed: number;
        isEstimated: boolean;
        source: Source;
        isSkip: boolean;
    }> = [];

    const aggregationInputs: InsertResultWithIds[] = [];

    for (const event of events) {
        const key = generateNormalizedKey(event.trackName, event.artistName);
        const resolution = resolutions.get(key);

        if (!resolution?.spotifyTrackId) continue;

        const trackId = trackIdMap.get(resolution.spotifyTrackId);
        if (!trackId) continue;

        const isSkip = event.msPlayed < 30000;

        eventData.push({
            userId,
            trackId,
            playedAt: event.playedAt,
            msPlayed: event.msPlayed,
            isEstimated: false,
            source: Source.IMPORT,
            isSkip,
        });

        aggregationInputs.push({
            status: 'added',
            trackId,
            artistIds: [],
            playedAt: event.playedAt,
            msPlayed: event.msPlayed,
        });
    }

    if (eventData.length === 0) {
        return { added: 0, skipped: events.length };
    }

    const existingEvents = await prisma.listeningEvent.findMany({
        where: {
            userId,
            OR: eventData.map(e => ({
                trackId: e.trackId,
                playedAt: e.playedAt,
            })),
        },
        select: { trackId: true, playedAt: true },
    });

    const existingSet = new Set(
        existingEvents.map(e => `${e.trackId}:${e.playedAt.getTime()}`)
    );

    const toCreate = eventData.filter(
        e => !existingSet.has(`${e.trackId}:${e.playedAt.getTime()}`)
    );

    if (toCreate.length > 0) {
        await prisma.listeningEvent.createMany({
            data: toCreate,
            skipDuplicates: true,
        });

        const trackIds = [...new Set(toCreate.map(e => e.trackId))];
        const tracks = await prisma.track.findMany({
            where: { id: { in: trackIds } },
            select: { id: true, artists: { select: { artistId: true } } },
        });

        const trackArtistMap = new Map(
            tracks.map(t => [t.id, t.artists.map(a => a.artistId)])
        );

        const inputs = toCreate.map(e => ({
            trackId: e.trackId,
            artistIds: trackArtistMap.get(e.trackId) || [],
            playedAt: e.playedAt,
            msPlayed: e.msPlayed,
        }));

        await updateStatsForEvents(userId, inputs, userTimezone);
    }

    return {
        added: toCreate.length,
        skipped: events.length - toCreate.length,
    };
}

export async function getUnresolvedTracks(jobId: string): Promise<UnresolvedTrack[]> {
    const data = await redis.get(UNRESOLVED_KEY(jobId));
    return data ? JSON.parse(data) : [];
}
