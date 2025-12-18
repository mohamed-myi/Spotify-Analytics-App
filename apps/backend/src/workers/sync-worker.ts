import { Worker, Job } from 'bullmq';
import { redis, waitForRateLimit } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { getValidAccessToken, invalidateUserToken } from '../lib/token-manager';
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

export interface SyncUserJob {
    userId: string;
}

// Minimum time between syncs for the same user 
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

async function processSync(job: Job<SyncUserJob>): Promise<SyncSummary> {
    const { userId } = job.data;

    // Get user with settings for timezone and check sync cooldown
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

    // Get valid access token
    const tokenResult = await getValidAccessToken(userId);
    if (!tokenResult) {
        await invalidateUserToken(userId);
        throw new Error(`No valid token for user ${userId}`);
    }

    // Wait for rate limit clearance
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
            return { added: 0, skipped: 0, updated: 0, errors: 0 };
        }

        // Parse Spotify response into our format
        const events = parseRecentlyPlayed(response);

        // Insert into database and get IDs for aggregation
        const { summary, results } = await insertListeningEventsWithIds(userId, events);
        await job.log(
            `Inserted ${summary.added}, skipped ${summary.skipped}, ` +
            `updated ${summary.updated}, errors ${summary.errors}`
        );

        // Aggregate stats for newly added events only (idempotency)
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

        return summary;
    } catch (error) {
        if (error instanceof SpotifyUnauthenticatedError) {
            await invalidateUserToken(userId);
            throw new Error(`Token revoked for user ${userId}`);
        }
        if (error instanceof SpotifyForbiddenError) {
            await invalidateUserToken(userId);
            throw new Error(`Access forbidden for user ${userId}`);
        }
        if (error instanceof SpotifyRateLimitError) {
            await job.log(`Rate limited, retry after ${error.retryAfterSeconds}s`);
            throw error;
        }
        throw error;
    }
}

// Create and export the worker
export const syncWorker = new Worker<SyncUserJob, SyncSummary>(
    'sync-user',
    processSync,
    {
        connection: redis,
        concurrency: 5, // Process 5 users concurrently
    }
);

syncWorker.on('completed', (job, result) => {
    console.log(
        JSON.stringify({
            event: 'sync_completed',
            userId: job.data.userId,
            ...result,
            timestamp: new Date().toISOString(),
        })
    );
});

syncWorker.on('failed', (job, error) => {
    console.error(
        JSON.stringify({
            event: 'sync_failed',
            userId: job?.data.userId,
            error: error.message,
            timestamp: new Date().toISOString(),
        })
    );
});

// Close the worker
export async function closeSyncWorker(): Promise<void> {
    await syncWorker.close();
}
