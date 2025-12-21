import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '../../../../.env') });

// Mock Redis and queues before importing any app code
jest.mock('../../src/lib/redis', () => ({
    redis: {
        quit: jest.fn().mockResolvedValue(undefined),
    },
    checkRateLimit: jest.fn().mockResolvedValue(true),
    waitForRateLimit: jest.fn().mockResolvedValue(undefined),
    queueArtistForMetadata: jest.fn().mockResolvedValue(undefined),
    popArtistsForMetadata: jest.fn().mockResolvedValue([]),
    closeRedis: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/workers/queues', () => ({
    syncUserQueue: {
        addBulk: jest.fn().mockResolvedValue([]),
        getWaitingCount: jest.fn().mockResolvedValue(0),
        getActiveCount: jest.fn().mockResolvedValue(0),
        getCompletedCount: jest.fn().mockResolvedValue(10),
        getFailedCount: jest.fn().mockResolvedValue(1),
    },
    artistMetadataQueue: {
        addBulk: jest.fn().mockResolvedValue([]),
    },
}));

jest.mock('../../src/workers/top-stats-queue', () => ({
    topStatsQueue: {
        addBulk: jest.fn().mockResolvedValue([]),
        getWaitingCount: jest.fn().mockResolvedValue(2),
        getActiveCount: jest.fn().mockResolvedValue(1),
        getCompletedCount: jest.fn().mockResolvedValue(50),
        getFailedCount: jest.fn().mockResolvedValue(0),
    },
}));

jest.mock('../../src/services/top-stats-service', () => ({
    hoursAgo: jest.fn((h: number) => new Date(Date.now() - h * 60 * 60 * 1000)),
    daysAgo: jest.fn((d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000)),
}));

// Mock Prisma to avoid hitting real database
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        spotifyAuth: {
            findMany: jest.fn().mockResolvedValue([
                { userId: 'test-user-1' },
                { userId: 'test-user-2' },
            ]),
        },
        user: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    },
}));

import Fastify, { FastifyInstance } from 'fastify';
import { cronRoutes } from '../../src/routes/cron';

describe('cron routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        await app.register(cronRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('POST /cron/seed-sync', () => {
        test('returns 401 without x-cron-secret header', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/cron/seed-sync',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Unauthorized' });
        });

        test('returns 401 with invalid x-cron-secret', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/cron/seed-sync',
                headers: {
                    'x-cron-secret': 'wrong-secret',
                },
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Unauthorized' });
        });

        test('returns success with valid x-cron-secret', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/cron/seed-sync',
                headers: {
                    'x-cron-secret': process.env.CRON_SECRET,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(true);
            expect(typeof body.queued).toBe('number');
        });
    });

    describe('GET /cron/queue-status', () => {
        test('returns 401 without x-cron-secret header', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/cron/queue-status',
            });

            expect(response.statusCode).toBe(401);
        });

        test('returns queue stats with valid secret', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/cron/queue-status',
                headers: {
                    'x-cron-secret': process.env.CRON_SECRET,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            // New response structure with syncUser and topStats queues
            expect(typeof body.syncUser.waiting).toBe('number');
            expect(typeof body.syncUser.active).toBe('number');
            expect(typeof body.syncUser.completed).toBe('number');
            expect(typeof body.syncUser.failed).toBe('number');
            expect(typeof body.topStats.waiting).toBe('number');
            expect(typeof body.topStats.active).toBe('number');
        });
    });
});
