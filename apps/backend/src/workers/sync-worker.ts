import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { redis, waitForRateLimit, getRedisUrl, REDIS_CONNECTION_CONFIG } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { getValidAccessToken, recordTokenFailure, resetTokenFailures } from '../lib/token-manager';
import { getRecentlyPlayed } from '../lib/spotify-api';
import { insertListeningEventsWithIds } from '../services/ingestion';
import { updateStatsForEvents } from '../services/aggregation';
import { parseRecentlyPlayed } from '../lib/spotify-parser';
import { ensurePartitionsForDates } from '../lib/partitions';
import {
    SpotifyUnauthenticatedError,
    SpotifyForbiddenError,
    SpotifyRateLimitError,
} from '../lib/spotify-errors';
import type { SyncSummary } from '../types/ingestion';
import { createSyncContext } from '../types/ingestion';
import { workerLoggers } from '../lib/logger';
import { setSyncWorkerRunning } from './worker-status';
import { DEFAULT_JOB_OPTIONS } from './worker-config';

const log = workerLoggers.sync;

export interface SyncUserJob {
    userId: string;
    skipCooldown?: boolean;
}

const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_BACKWARD_ITERATIONS = 10;  // Max backward pages per sync

async function processSync(job: Job<SyncUserJob>): Promise<SyncSummary> {
    const { userId, skipCooldown } = job.data;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { settings: true },
    });

    const userTimezone = user?.settings?.timezone ?? 'UTC';
    const lastSyncTimestamp = user?.lastIngestedAt?.getTime() ?? 0;

    if (!skipCooldown && user?.lastIngestedAt) {
        const msSinceLastSync = Date.now() - user.lastIngestedAt.getTime();
        if (msSinceLastSync < SYNC_COOLDOWN_MS) {
            await job.log(`Skipping - synced ${Math.round(msSinceLastSync / 1000)}s ago`);
            return { added: 0, skipped: 0, updated: 0, errors: 0 };
        }
    }

    const tokenResult = await getValidAccessToken(userId);
    if (!tokenResult) {
        throw new Error(`No valid token for user ${userId}`);
    }

    try {
        // Backward pagination - get most recent first, walk backward until overlap
        let beforeCursor: number | undefined = undefined;
        let newestObservedTime: Date | null = null;
        let iterationCount = 0;
        const totalSummary: SyncSummary = { added: 0, skipped: 0, updated: 0, errors: 0 };
        const allAddedEvents: Array<{ trackId: string; artistIds: string[]; playedAt: Date; msPlayed: number }> = [];

        while (iterationCount < MAX_BACKWARD_ITERATIONS) {
            await waitForRateLimit();

            const response = await getRecentlyPlayed(tokenResult.accessToken, {
                limit: 50,
                before: beforeCursor,
            });

            if (response.items.length === 0) {
                if (iterationCount === 0) {
                    await job.log('No new plays found');
                }
                break;
            }

            const batchEvents = parseRecentlyPlayed(response);

            // Capture the newestObservedTime from the first item of the first batch
            if (iterationCount === 0 && batchEvents.length > 0) {
                newestObservedTime = batchEvents[0].playedAt;
            }

            // Filter out events we've already ingested (playedAt <= lastSyncTimestamp)
            const newEvents = batchEvents.filter(e => e.playedAt.getTime() > lastSyncTimestamp);

            if (newEvents.length > 0) {
                // Ensure partitions exist before inserting
                await ensurePartitionsForDates(newEvents.map(e => e.playedAt));

                const ctx = createSyncContext();
                const { summary, results } = await insertListeningEventsWithIds(userId, newEvents, ctx);

                totalSummary.added += summary.added;
                totalSummary.skipped += summary.skipped;
                totalSummary.updated += summary.updated;
                totalSummary.errors += summary.errors;

                const addedInBatch = results.filter(r => r.status === 'added');
                allAddedEvents.push(...addedInBatch.map(r => ({
                    trackId: r.trackId,
                    artistIds: r.artistIds,
                    playedAt: r.playedAt,
                    msPlayed: r.msPlayed,
                })));

                await job.log(
                    `Batch ${iterationCount + 1}: added ${summary.added}, skipped ${summary.skipped}`
                );
            }

            // Check termination conditions
            const oldestInBatch = batchEvents[batchEvents.length - 1]?.playedAt;
            const foundOverlap = oldestInBatch && oldestInBatch.getTime() <= lastSyncTimestamp;
            const isPartialBatch = response.items.length < 50;

            if (foundOverlap || isPartialBatch) {
                break;
            }

            // Move cursor backward for next iteration
            beforeCursor = oldestInBatch.getTime();
            iterationCount++;
        }

        if (iterationCount >= MAX_BACKWARD_ITERATIONS) {
            await job.log(`Max backward iterations (${MAX_BACKWARD_ITERATIONS}) reached`);
        }

        // Aggregate stats for all added events
        if (allAddedEvents.length > 0) {
            await updateStatsForEvents(userId, allAddedEvents, userTimezone);
            await job.log(`Aggregated stats for ${allAddedEvents.length} total events`);
        }

        // Update lastIngestedAt to the newest observed time
        if (newestObservedTime) {
            await prisma.user.update({
                where: { id: userId },
                data: { lastIngestedAt: newestObservedTime },
            });
        }

        await resetTokenFailures(userId);

        await job.log(
            `Sync complete: ${totalSummary.added} added, ${totalSummary.skipped} skipped, ` +
            `${totalSummary.updated} updated, ${totalSummary.errors} errors`
        );

        return totalSummary;
    } catch (error) {
        if (error instanceof SpotifyUnauthenticatedError) {
            const invalidated = await recordTokenFailure(userId, 'spotify_401_unauthenticated');
            if (invalidated) {
                throw new Error(`Token invalidated for user ${userId} after repeated 401 errors`);
            }
            throw error;
        }
        if (error instanceof SpotifyForbiddenError) {
            const invalidated = await recordTokenFailure(userId, 'spotify_403_forbidden');
            if (invalidated) {
                throw new Error(`Token invalidated for user ${userId} after repeated 403 errors`);
            }
            throw error;
        }
        if (error instanceof SpotifyRateLimitError) {
            await job.log(`Rate limited, retry after ${error.retryAfterSeconds}s`);
            throw error;
        }
        throw error;
    }
}

// Create a dedicated Redis connection for the worker to avoid blocking the shared instance
const workerConnection = new Redis(getRedisUrl(), REDIS_CONNECTION_CONFIG);

export const syncWorker = new Worker<SyncUserJob, SyncSummary>(
    'sync-user',
    processSync,
    {
        connection: workerConnection,
        concurrency: 5,
    }
);

syncWorker.on('completed', (job, result) => {
    log.info({ event: 'sync_completed', userId: job.data.userId, ...result }, 'Sync completed');
});

syncWorker.on('failed', (job, error) => {
    const isExhausted = job && job.attemptsMade >= (DEFAULT_JOB_OPTIONS.attempts || 5);
    if (isExhausted) {
        log.error(
            { event: 'sync_exhausted', userId: job?.data.userId, attempts: job?.attemptsMade },
            'Sync job exhausted all retries'
        );
    } else {
        log.warn(
            { event: 'sync_retry', userId: job?.data.userId, attempt: job?.attemptsMade, error: error.message },
            'Sync failed, will retry'
        );
    }
});

setSyncWorkerRunning(true);
log.info('Sync worker initialized with dedicated Redis connection');

export async function closeSyncWorker(): Promise<void> {
    await syncWorker.close();
}
