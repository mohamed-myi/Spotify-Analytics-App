import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { syncUserQueue } from '../workers/queues';
import { topStatsQueue } from '../workers/top-stats-queue';
import { hoursAgo, daysAgo } from '../services/top-stats-service';

export async function cronRoutes(fastify: FastifyInstance): Promise<void> {
    // POST /cron/seed-sync: Add active users to sync queue
    fastify.post('/cron/seed-sync', async (request, reply) => {
        // Verify cron secret (prevent unauthorized calls)
        const cronSecret = request.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        // Find active users (logged in within 7 days, valid token)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const activeUsers = await prisma.user.findMany({
            where: {
                auth: { isValid: true },
                lastIngestedAt: { gte: sevenDaysAgo },
            },
            select: { id: true },
        });

        // Also include users who never synced but have valid tokens
        const newUsers = await prisma.user.findMany({
            where: {
                auth: { isValid: true },
                lastIngestedAt: null,
            },
            select: { id: true },
        });

        const allUsers = [...activeUsers, ...newUsers];

        // Add jobs to queue; each cron run creates new jobs
        // The sync worker has its own 5-minute cooldown to prevent over-syncing
        const jobs = allUsers.map((user) => ({
            name: `sync-${user.id}`,
            data: { userId: user.id },
        }));

        await syncUserQueue.addBulk(jobs);

        return {
            success: true,
            queued: allUsers.length,
            activeUsers: activeUsers.length,
            newUsers: newUsers.length,
        };
    });

    // POST /cron/seed-top-stats: Daily warm-cache sweep for top stats
    // Recommended to run at 3:00 AM server time
    fastify.post('/cron/seed-top-stats', async (request, reply) => {
        const cronSecret = request.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        // Tier 1: Active users (logged in within 48h, not refreshed in 24h)
        const tier1Users = await prisma.user.findMany({
            where: {
                auth: { isValid: true },
                lastLoginAt: { gte: hoursAgo(48) },
                OR: [
                    { topStatsRefreshedAt: null },
                    { topStatsRefreshedAt: { lt: hoursAgo(24) } }
                ]
            },
            select: { id: true }
        });

        // Tier 2: Logged in 3-7 days ago, haven't refreshed in 72h
        const tier2Users = await prisma.user.findMany({
            where: {
                auth: { isValid: true },
                lastLoginAt: { gte: daysAgo(7), lt: daysAgo(3) },
                OR: [
                    { topStatsRefreshedAt: null },
                    { topStatsRefreshedAt: { lt: hoursAgo(72) } }
                ]
            },
            select: { id: true }
        });

        // Queue with jitter spread over 4 hours
        const JITTER_RANGE_MS = 4 * 60 * 60 * 1000;

        const tier1Jobs = tier1Users.map((user) => ({
            name: `sweep-t1-${user.id}`,
            data: { userId: user.id, priority: 'low' as const },
            opts: {
                delay: Math.floor(Math.random() * JITTER_RANGE_MS),
                priority: 10  // Low priority (higher number = lower priority)
            }
        }));

        const tier2Jobs = tier2Users.map((user) => ({
            name: `sweep-t2-${user.id}`,
            data: { userId: user.id, priority: 'low' as const },
            opts: {
                delay: Math.floor(Math.random() * JITTER_RANGE_MS),
                priority: 20  // Even lower priority than Tier 1
            }
        }));

        await topStatsQueue.addBulk([...tier1Jobs, ...tier2Jobs]);

        return {
            success: true,
            queued: tier1Users.length + tier2Users.length,
            tier1: tier1Users.length,
            tier2: tier2Users.length,
        };
    });

    // GET /cron/queue-status: Check queue health
    fastify.get('/cron/queue-status', async (request, reply) => {
        const cronSecret = request.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const [syncWaiting, syncActive, syncCompleted, syncFailed] = await Promise.all([
            syncUserQueue.getWaitingCount(),
            syncUserQueue.getActiveCount(),
            syncUserQueue.getCompletedCount(),
            syncUserQueue.getFailedCount(),
        ]);

        const [topStatsWaiting, topStatsActive, topStatsCompleted, topStatsFailed] = await Promise.all([
            topStatsQueue.getWaitingCount(),
            topStatsQueue.getActiveCount(),
            topStatsQueue.getCompletedCount(),
            topStatsQueue.getFailedCount(),
        ]);

        return {
            syncUser: {
                waiting: syncWaiting,
                active: syncActive,
                completed: syncCompleted,
                failed: syncFailed,
            },
            topStats: {
                waiting: topStatsWaiting,
                active: topStatsActive,
                completed: topStatsCompleted,
                failed: topStatsFailed,
            },
        };
    });
}

