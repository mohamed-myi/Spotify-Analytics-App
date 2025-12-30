import { Worker, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';
import { redis, getRedisUrl, REDIS_CONNECTION_CONFIG } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { workerLoggers } from '../lib/logger';
import { setTopStatsWorkerRunning } from './worker-status';
import { topStatsQueue, TopStatsJobData } from './top-stats-queue';
import { processUserTopStats } from '../services/top-stats-service';
import { recordTokenFailure } from '../lib/token-manager';
import {
    SpotifyRateLimitError,
    SpotifyUnauthenticatedError,
    SpotifyForbiddenError,
    isRetryableError,
} from '../lib/spotify-errors';

const log = workerLoggers.topStats;

const JOB_TIMEOUT_MS = 60000;
// Create a dedicated Redis connection for the worker to avoid blocking the shared instance
let workerConnection: Redis | null = null;
export let topStatsWorker: Worker<TopStatsJobData> | null = null;

export function setupTopStatsWorker() {
    if (topStatsWorker) return topStatsWorker;

    workerConnection = new Redis(getRedisUrl(), REDIS_CONNECTION_CONFIG);

    topStatsWorker = new Worker<TopStatsJobData>(
        'top-stats',
        async (job) => {
            const { userId, priority } = job.data;
            const jobId = job.id || `unknown-${Date.now()}`;
            log.info({ userId, priority, jobId }, 'Processing top stats job');

            const startTime = Date.now();

            try {
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('Job timeout')), JOB_TIMEOUT_MS);
                });

                await Promise.race([
                    processUserTopStats(userId, jobId),
                    timeoutPromise
                ]);


                const elapsed = Date.now() - startTime;
                log.info({ userId, elapsedMs: elapsed }, 'Top stats refresh completed');

            } catch (error) {
                if (error instanceof SpotifyUnauthenticatedError) {
                    log.warn({ userId }, 'Token expired during top stats, recording failure');
                    const invalidated = await recordTokenFailure(userId, 'spotify_401_top_stats');
                    if (invalidated) {
                        throw new UnrecoverableError(`Token invalidated for user ${userId}, needs re-auth`);
                    }
                    throw error;
                }

                if (error instanceof SpotifyForbiddenError) {
                    log.error({ userId }, 'Forbidden error - user may have revoked access');
                    await recordTokenFailure(userId, 'spotify_403_forbidden');
                    throw new UnrecoverableError('User revoked access or scope missing');
                }

                if (error instanceof SpotifyRateLimitError) {
                    const delayMs = (error.retryAfterSeconds * 1000) + Math.floor(Math.random() * 5000);
                    log.warn({ userId, retryAfter: error.retryAfterSeconds, delayMs }, 'Rate limited, pausing queue');

                    await topStatsQueue.pause();
                    setTimeout(async () => {
                        await topStatsQueue.resume();
                        log.info('Queue resumed after rate limit');
                    }, error.retryAfterSeconds * 1000);

                    await job.moveToDelayed(Date.now() + delayMs, job.token);
                    return;
                }

                log.error({ userId, error }, 'Top stats job failed');
                throw error;
            }
        },
        {
            connection: workerConnection,
            concurrency: 3,
        }
    );

    topStatsWorker.on('completed', (job) => {
        log.debug({ jobId: job.id, userId: job.data.userId }, 'Top stats job completed');
    });

    topStatsWorker.on('failed', async (job, error) => {
        if (!job) return;

        const { userId, priority } = job.data;
        const isRetryable = isRetryableError(error);

        log.warn({
            userId,
            priority,
            error: error.message,
            attempts: job.attemptsMade,
            isRetryable,
        }, 'Top stats job failed');
    });

    topStatsWorker.on('error', (error) => {
        log.error({ error }, 'Top stats worker error');
    });

    setTopStatsWorkerRunning(true);

    return topStatsWorker;
}

export async function closeTopStatsWorker(): Promise<void> {
    setTopStatsWorkerRunning(false);
    if (topStatsWorker) {
        await topStatsWorker.close();
        topStatsWorker = null;
    }
    if (workerConnection) {
        await workerConnection.quit();
        workerConnection = null;
    }
}

