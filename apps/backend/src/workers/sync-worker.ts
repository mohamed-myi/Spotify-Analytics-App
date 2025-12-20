import { Worker, Job } from 'bullmq';
import { redis, waitForRateLimit } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { getValidAccessToken, recordTokenFailure, resetTokenFailures } from '../lib/token-manager';
import { getRecentlyPlayed } from '../lib/spotify-api';
import { insertListeningEventsWithIds } from '../services/ingestion';
import { updateStatsForEvents } from '../services/aggregation';
import { parseRecentlyPlayed } from '../lib/spotify-parser';
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
}

const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

async function processSync(job: Job<SyncUserJob>): Promise<SyncSummary> {
    const { userId } = job.data;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { settings: true },
    });

    const userTimezone = user?.settings?.timezone ?? 'UTC';

    if (user?.lastIngestedAt) {
        const msSinceLastSync = Date.now() - user.lastIngestedAt.getTime();
        if (msSinceLastSync < SYNC_COOLDOWN_MS) {
            await job.log(`Skipping - synced ${Math.round(msSinceLastSync / 1000)}s ago`);
            return { added: 0, skipped: 0, updated: 0, errors: 0 };
        }
    }

    const tokenResult = await getValidAccessToken(userId);
    if (!tokenResult) {
        // Token already invalid or refresh failed
        throw new Error(`No valid token for user ${userId}`);
    }

    await waitForRateLimit();

    const afterTimestamp = user?.lastIngestedAt
        ? user.lastIngestedAt.getTime()
        : undefined;

    try {
        const response = await getRecentlyPlayed(tokenResult.accessToken, {
            limit: 50,
            after: afterTimestamp,
        });

        if (response.items.length === 0) {
            await job.log('No new plays found');
            // Reset failures on any successful API call
            await resetTokenFailures(userId);
            return { added: 0, skipped: 0, updated: 0, errors: 0 };
        }

        const events = parseRecentlyPlayed(response);

        // Create per-job cache context to reduce duplicate DB lookups
        const ctx = createSyncContext();
        const { summary, results } = await insertListeningEventsWithIds(userId, events, ctx);
        await job.log(
            `Inserted ${summary.added}, skipped ${summary.skipped}, ` +
            `updated ${summary.updated}, errors ${summary.errors}`
        );

        const addedEvents = results.filter(r => r.status === 'added');
        if (addedEvents.length > 0) {
            const aggregationInputs = addedEvents.map(r => ({
                trackId: r.trackId,
                artistIds: r.artistIds,
                playedAt: r.playedAt,
                msPlayed: r.msPlayed,
            }));
            await updateStatsForEvents(userId, aggregationInputs, userTimezone);
            await job.log(`Aggregated stats for ${addedEvents.length} events`);
        }

        const latestPlay = events[0]?.playedAt;
        if (latestPlay) {
            await prisma.user.update({
                where: { id: userId },
                data: { lastIngestedAt: latestPlay },
            });
        }

        // Reset failure count on successful sync
        await resetTokenFailures(userId);

        return summary;
    } catch (error) {
        if (error instanceof SpotifyUnauthenticatedError) {
            // Record failure instead of immediate invalidation
            const invalidated = await recordTokenFailure(userId, 'spotify_401_unauthenticated');
            if (invalidated) {
                throw new Error(`Token invalidated for user ${userId} after repeated 401 errors`);
            }
            // Will retry via BullMQ
            throw error;
        }
        if (error instanceof SpotifyForbiddenError) {
            // Record failure instead of immediate invalidation
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

export const syncWorker = new Worker<SyncUserJob, SyncSummary>(
    'sync-user',
    processSync,
    {
        connection: redis,
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

// Track worker status for health checks
setSyncWorkerRunning(true);

export async function closeSyncWorker(): Promise<void> {
    await syncWorker.close();
}
