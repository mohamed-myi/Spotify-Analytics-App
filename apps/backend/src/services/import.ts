import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { Source, JobStatus } from '@prisma/client';
import { redis, queueTrackForMetadata } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { parseEndsongRecord } from '../lib/import-parser';
import { updateStatsForEvents } from './aggregation';
import type { ParsedImportEvent, ImportProgress } from '../types/import';
import type { InsertResultWithIds } from '../types/ingestion';
import { ensurePartitionsForDates } from '../lib/partitions';

const BATCH_SIZE = 100;
const DB_UPDATE_INTERVAL = 1000;
const PROGRESS_TTL_SECONDS = 86400;
const PROGRESS_KEY = (jobId: string) => `import_progress:${jobId}`;

export async function processImportStream(
    userId: string,
    jobId: string,
    fileName: string,
    fileStream: NodeJS.ReadableStream
): Promise<void> {
    let batch: ParsedImportEvent[] = [];
    let totalRecords = 0;
    let processedRecords = 0;
    let addedRecords = 0;
    let skippedRecords = 0;

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

    const updateProgress = async (status: ImportProgress['status'], error?: string) => {
        await redis.set(PROGRESS_KEY(jobId), JSON.stringify({
            status,
            totalRecords,
            processedRecords,
            addedRecords,
            skippedRecords,
            errorMessage: error,
        }), 'EX', PROGRESS_TTL_SECONDS);
    };

    const updateProgressDB = async () => {
        await prisma.importJob.update({
            where: { id: jobId },
            data: {
                totalEvents: totalRecords,
                processedEvents: processedRecords,
            },
        });
    };

    await updateProgress(JobStatus.PROCESSING);

    try {
        const jsonStream = fileStream
            .pipe(parser())
            .pipe(streamArray());

        for await (const { value } of jsonStream) {
            totalRecords++;
            const parsed = parseEndsongRecord(value);

            if (parsed) {
                batch.push(parsed);
            } else {
                skippedRecords++;
            }

            if (batch.length >= BATCH_SIZE) {
                const results = await insertImportBatch(userId, batch, userTimezone);
                addedRecords += results.added;
                skippedRecords += results.skipped;
                processedRecords += batch.length;
                batch = [];
                await updateProgress(JobStatus.PROCESSING);

                if (processedRecords % DB_UPDATE_INTERVAL === 0) {
                    await updateProgressDB();
                }
            }
        }

        if (batch.length > 0) {
            const results = await insertImportBatch(userId, batch, userTimezone);
            addedRecords += results.added;
            skippedRecords += results.skipped;
            processedRecords += batch.length;
        }

        // Check if import actually processed any records
        // If all records were skipped, this likely indicates wrong format detection
        if (addedRecords === 0 && totalRecords > 0) {
            const errorMessage =
                `Import completed but no records were added (${totalRecords} total, ${skippedRecords} skipped). ` +
                'This may indicate the file is in Basic Streaming History format (StreamingHistory_music.json) ' +
                'which requires track resolution. Please verify you uploaded the correct file type.';

            console.warn('Import validation failed:', { totalRecords, skippedRecords, addedRecords });
            await updateProgress(JobStatus.FAILED, errorMessage);

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

        await updateProgress(JobStatus.COMPLETED);

        await prisma.importJob.update({
            where: { id: jobId },
            data: {
                status: JobStatus.COMPLETED,
                totalEvents: totalRecords,
                processedEvents: processedRecords,
                completedAt: new Date(),
            },
        });
    } catch (error) {
        console.error('Import failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await updateProgress(JobStatus.FAILED, errorMessage);

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

async function insertImportBatch(
    userId: string,
    events: ParsedImportEvent[],
    userTimezone: string
): Promise<{ added: number; skipped: number }> {
    // Ensure partitions exist for all event dates before inserting
    await ensurePartitionsForDates(events.map(e => e.playedAt));

    const trackIdMap = await batchUpsertTracks(events);

    const eventKeys = events.map(e => ({
        trackId: trackIdMap.get(e.trackSpotifyId)!,
        playedAt: e.playedAt,
    }));

    const existingEvents = await prisma.listeningEvent.findMany({
        where: {
            userId,
            OR: eventKeys.map(k => ({
                trackId: k.trackId,
                playedAt: k.playedAt,
            })),
        },
        select: { trackId: true, playedAt: true, isEstimated: true, source: true },
    });

    const existingMap = new Map(
        existingEvents.map(e => [`${e.trackId}:${e.playedAt.getTime()}`, e])
    );

    const toCreate: Array<{
        userId: string;
        trackId: string;
        playedAt: Date;
        msPlayed: number;
        isEstimated: boolean;
        source: Source;
        isSkip: boolean;
    }> = [];
    const toUpdate: Array<{ trackId: string; playedAt: Date; msPlayed: number; isSkip: boolean }> = [];
    const aggregationEvents: InsertResultWithIds[] = [];

    for (const event of events) {
        const trackId = trackIdMap.get(event.trackSpotifyId)!;
        const key = `${trackId}:${event.playedAt.getTime()}`;
        const existing = existingMap.get(key);

        if (!existing) {
            toCreate.push({
                userId,
                trackId,
                playedAt: event.playedAt,
                msPlayed: event.msPlayed,
                isEstimated: false,
                source: Source.IMPORT,
                isSkip: event.isSkip,
            });
            aggregationEvents.push({
                status: 'added',
                trackId,
                artistIds: [],
                playedAt: event.playedAt,
                msPlayed: event.msPlayed,
            });
        } else if (existing.isEstimated && existing.source !== Source.IMPORT) {
            toUpdate.push({
                trackId,
                playedAt: event.playedAt,
                msPlayed: event.msPlayed,
                isSkip: event.isSkip,
            });
        }
    }

    if (toCreate.length > 0) {
        await prisma.listeningEvent.createMany({
            data: toCreate,
            skipDuplicates: true,
        });
    }

    for (const update of toUpdate) {
        await prisma.listeningEvent.update({
            where: {
                userId_trackId_playedAt: {
                    userId,
                    trackId: update.trackId,
                    playedAt: update.playedAt,
                },
            },
            data: {
                msPlayed: update.msPlayed,
                isEstimated: false,
                source: Source.IMPORT,
                isSkip: update.isSkip,
            },
        });
    }

    if (aggregationEvents.length > 0) {
        const trackIds = [...new Set(aggregationEvents.map(e => e.trackId))];
        const tracks = await prisma.track.findMany({
            where: { id: { in: trackIds } },
            select: { id: true, artists: { select: { artistId: true } } },
        });

        const trackArtistMap = new Map(tracks.map(t => [t.id, t.artists.map(a => a.artistId)]));

        const inputs = aggregationEvents.map(e => ({
            trackId: e.trackId,
            artistIds: trackArtistMap.get(e.trackId) || [],
            playedAt: e.playedAt,
            msPlayed: e.msPlayed,
        }));

        await updateStatsForEvents(userId, inputs, userTimezone);
    }

    return { added: toCreate.length, skipped: events.length - toCreate.length };
}

async function batchUpsertTracks(
    events: ParsedImportEvent[]
): Promise<Map<string, string>> {
    const spotifyIds = [...new Set(events.map(e => e.trackSpotifyId))];

    const existing = await prisma.track.findMany({
        where: { spotifyId: { in: spotifyIds } },
        select: { id: true, spotifyId: true },
    });
    const trackMap = new Map(existing.map(t => [t.spotifyId, t.id]));

    const missingSpotifyIds = spotifyIds.filter(id => !trackMap.has(id));
    const uniqueMissing = missingSpotifyIds.map(spotifyId => {
        const event = events.find(e => e.trackSpotifyId === spotifyId)!;
        return {
            spotifyId: event.trackSpotifyId,
            name: event.trackName,
            durationMs: event.msPlayed,
        };
    });

    if (uniqueMissing.length > 0) {
        await prisma.track.createMany({
            data: uniqueMissing,
            skipDuplicates: true,
        });

        const newTracks = await prisma.track.findMany({
            where: { spotifyId: { in: missingSpotifyIds } },
            select: { id: true, spotifyId: true },
        });
        newTracks.forEach(t => trackMap.set(t.spotifyId, t.id));

        await Promise.all(missingSpotifyIds.map(id => queueTrackForMetadata(id)));
    }

    return trackMap;
}

export async function getImportProgress(
    jobId: string
): Promise<ImportProgress | null> {
    const data = await redis.get(PROGRESS_KEY(jobId));
    return data ? JSON.parse(data) : null;
}

export async function getImportProgressFromDB(
    jobId: string,
    userId: string
): Promise<ImportProgress | null> {
    const job = await prisma.importJob.findFirst({
        where: { id: jobId, userId },
    });

    if (!job) return null;

    return {
        status: job.status as ImportProgress['status'],
        totalRecords: job.totalEvents,
        processedRecords: job.processedEvents,
        addedRecords: job.processedEvents,
        skippedRecords: 0,
        errorMessage: job.errorMessage ?? undefined,
    };
}
