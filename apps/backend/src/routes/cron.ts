import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { syncUserQueue } from '../workers/queues';

export async function cronRoutes(fastify: FastifyInstance): Promise<void> {
    // POST /cron/seed-sync - Add active users to sync queue
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

        // Add jobs to queue (using userId as jobId prevents duplicates)
        const jobs = allUsers.map((user) => ({
            name: `sync-${user.id}`,
            data: { userId: user.id },
            opts: { jobId: user.id },
        }));

        await syncUserQueue.addBulk(jobs);

        return {
            success: true,
            queued: allUsers.length,
            activeUsers: activeUsers.length,
            newUsers: newUsers.length,
        };
    });

    // GET /cron/queue-status - Check queue health 
    fastify.get('/cron/queue-status', async (request, reply) => {
        const cronSecret = request.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const [waiting, active, completed, failed] = await Promise.all([
            syncUserQueue.getWaitingCount(),
            syncUserQueue.getActiveCount(),
            syncUserQueue.getCompletedCount(),
            syncUserQueue.getFailedCount(),
        ]);

        return {
            queue: 'sync-user',
            waiting,
            active,
            completed,
            failed,
        };
    });
}
