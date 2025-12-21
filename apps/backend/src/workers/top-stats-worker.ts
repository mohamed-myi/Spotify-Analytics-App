import { Worker } from 'bullmq';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { workerLoggers } from '../lib/logger';
import { setTopStatsWorkerRunning } from './worker-status';
import { topStatsQueue, TopStatsJobData } from './top-stats-queue';
import { processUserTopStats } from '../services/top-stats-service';

const log = workerLoggers.topStats;

// Job timeout: 30 seconds per user
const JOB_TIMEOUT_MS = 30000;

/**
 * Extract Retry-After from error message (if 429 response)
 */
function extractRetryAfter(error: Error): number | null {
    const match = error.message.match(/retry.?after[:\s]*(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

// BullMQ worker for processing top-stats jobs.
export const topStatsWorker = new Worker<TopStatsJobData>(
    'top-stats',
    async (job) => {
        const { userId, priority } = job.data;
        log.info({ userId, priority, jobId: job.id }, 'Processing top stats job');

        const startTime = Date.now();

        try {
            // Set up timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Job timeout')), JOB_TIMEOUT_MS);
            });

            // Race between processing and timeout
            await Promise.race([
                processUserTopStats(userId),
                timeoutPromise
            ]);

            // Update refresh timestamp on success
            await prisma.user.update({
                where: { id: userId },
                data: { topStatsRefreshedAt: new Date() }
            });

            const elapsed = Date.now() - startTime;
            log.info({ userId, elapsedMs: elapsed }, 'Top stats refresh completed');

        } catch (error) {
            log.error({ userId, error }, 'Top stats job failed');
            throw error;  // Let BullMQ handle retries
        }
    },
    {
        connection: redis,
        concurrency: 3,  // Process 3 users at a time
    }
);

// Handle worker events
topStatsWorker.on('completed', (job) => {
    log.debug({ jobId: job.id, userId: job.data.userId }, 'Top stats job completed');
});

topStatsWorker.on('failed', async (job, error) => {
    if (!job) return;

    const { userId, priority } = job.data;
    log.warn({ userId, priority, error: error.message, attempts: job.attemptsMade }, 'Top stats job failed');

    // Handle 429 rate limit: pause entire queue
    if (error.message.includes('429') || error.message.includes('rate limit')) {
        const retryAfter = extractRetryAfter(error) || 60;
        log.warn({ retryAfter }, 'Rate limited, pausing queue');

        await topStatsQueue.pause();
        setTimeout(async () => {
            await topStatsQueue.resume();
            log.info('Queue resumed after rate limit');
        }, retryAfter * 1000);
    }
});

topStatsWorker.on('error', (error) => {
    log.error({ error }, 'Top stats worker error');
});

// Track worker status for health checks
setTopStatsWorkerRunning(true);

export async function closeTopStatsWorker(): Promise<void> {
    setTopStatsWorkerRunning(false);
    await topStatsWorker.close();
}
