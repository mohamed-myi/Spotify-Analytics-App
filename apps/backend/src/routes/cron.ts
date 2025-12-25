import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { syncUserQueue } from '../workers/queues';
import { topStatsQueue } from '../workers/top-stats-queue';
import { hoursAgo, daysAgo } from '../services/top-stats-service';
import { ensurePartitionForDate, enforcePartitionIndexes } from '../lib/partitions';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'CronRoutes' });


const SYNC_LOCK_KEY = 'cron:sync:lock';
const SYNC_LOCK_TTL_SECONDS = 240;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function cronRoutes(fastify: FastifyInstance): Promise<void> {
    // POST /cron/seed-sync, requires X-Cron-Secret, uses Redis lock for idempotency
    fastify.post('/cron/seed-sync', {
        schema: {
            description: 'Seed the sync queue with eligible users (cron-triggered)',
            tags: ['Cron'],
            headers: {
                type: 'object',
                properties: {
                    'x-cron-secret': { type: 'string' }
                },
                required: ['x-cron-secret']
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        queued: { type: 'number' },
                        skipped: { type: 'boolean' },
                        message: { type: 'string' }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {

        const cronSecret = request.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET) {
            log.warn({ event: 'cron_unauthorized' }, 'Unauthorized cron request');
            return reply.status(401).send({ error: 'Unauthorized' });
        }


        const lockAcquired = await redis.set(
            SYNC_LOCK_KEY,
            Date.now().toString(),
            'EX',
            SYNC_LOCK_TTL_SECONDS,
            'NX'
        );

        if (!lockAcquired) {
            log.info({ event: 'cron_sync_skipped' }, 'Sync already in progress, skipping');
            return {
                success: true,
                queued: 0,
                skipped: true,
                message: 'Sync already in progress'
            };
        }

        try {
            const fiveMinutesAgo = new Date(Date.now() - SYNC_COOLDOWN_MS);
            const sevenDaysAgo = new Date(Date.now() - ACTIVE_WINDOW_MS);

            const eligibleUsers = await prisma.user.findMany({
                where: {
                    auth: { isValid: true },
                    OR: [

                        { lastIngestedAt: null },

                        {
                            lastIngestedAt: { lt: fiveMinutesAgo },
                            lastLoginAt: { gte: sevenDaysAgo }
                        }
                    ]
                },
                select: { id: true }
            });

            if (eligibleUsers.length === 0) {
                log.info({ event: 'cron_sync_empty' }, 'No eligible users for sync');
                return {
                    success: true,
                    queued: 0,
                    skipped: false,
                    message: 'No eligible users'
                };
            }


            const jobs = eligibleUsers.map((user) => ({
                name: `sync-${user.id}`,
                data: { userId: user.id },
                opts: {

                    jobId: `sync-${user.id}`,
                    removeOnComplete: 100,
                    removeOnFail: 50,
                }
            }));

            await syncUserQueue.addBulk(jobs);

            log.info(
                { event: 'cron_sync_seeded', count: eligibleUsers.length },
                `Seeded ${eligibleUsers.length} users for sync`
            );

            return {
                success: true,
                queued: eligibleUsers.length,
                skipped: false,
                message: `Queued ${eligibleUsers.length} users`
            };
        } finally {
            await redis.del(SYNC_LOCK_KEY);
        }
    });

    // POST /cron/seed-top-stats, daily warm-cache sweep
    fastify.post('/cron/seed-top-stats', async (request, reply) => {
        const cronSecret = request.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }


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


        const JITTER_RANGE_MS = 4 * 60 * 60 * 1000;

        const tier1Jobs = tier1Users.map((user) => ({
            name: `sweep-t1-${user.id}`,
            data: { userId: user.id, priority: 'low' as const },
            opts: {
                delay: Math.floor(Math.random() * JITTER_RANGE_MS),
                priority: 10
            }
        }));

        const tier2Jobs = tier2Users.map((user) => ({
            name: `sweep-t2-${user.id}`,
            data: { userId: user.id, priority: 'low' as const },
            opts: {
                delay: Math.floor(Math.random() * JITTER_RANGE_MS),
                priority: 20
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

    // GET /cron/queue-status
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

    // POST /cron/manage-partitions
    fastify.post('/cron/manage-partitions', async (request, reply) => {
        const cronSecret = request.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const now = new Date();


        const partitionDates = Array.from({ length: 4 }, (_, i) =>
            new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
        );

        const results = await Promise.allSettled(
            partitionDates.map(async (date) => {
                const result = await ensurePartitionForDate(date);
                const indexes = await enforcePartitionIndexes(result.partitionName);
                return {
                    partition: result.partitionName,
                    status: result.created ? 'created' : 'exists',
                    indexes
                };
            })
        );

        const formatted = results.map((result, i) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                const year = partitionDates[i].getUTCFullYear();
                const month = partitionDates[i].getUTCMonth() + 1;
                const partitionName = `listening_events_y${year}m${String(month).padStart(2, '0')}`;
                return { partition: partitionName, status: 'error', error: result.reason?.message };
            }
        });

        return { success: true, partitions: formatted };
    });
}
