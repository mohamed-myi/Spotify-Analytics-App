jest.mock('../../src/lib/redis', () => ({
    redis: { quit: jest.fn() },
    closeRedis: jest.fn(),
}));

jest.mock('../../src/workers/queues', () => ({
    syncUserQueue: { add: jest.fn() },
    importQueue: { add: jest.fn() },
}));

jest.mock('../../src/workers/top-stats-queue', () => ({
    topStatsQueue: { add: jest.fn() },
}));

jest.mock('../../src/lib/prisma', () => {
    const { createMockPrisma } = jest.requireActual('../mocks/prisma.mock');
    return {
        prisma: createMockPrisma(),
    };
});

jest.mock('../../src/middleware/auth', () => ({
    authMiddleware: async (req: any) => {
        const testUserId = req.headers['x-test-user-id'];
        if (testUserId) {
            req.userId = testUserId;
        }
    },
}));

import Fastify, { FastifyInstance } from 'fastify';
import { settingsRoutes } from '../../src/routes/settings';
import { authMiddleware } from '../../src/middleware/auth';
import { prisma } from '../../src/lib/prisma';

describe('Settings Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        app.addHook('preHandler', authMiddleware);
        await app.register(settingsRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /me/settings', () => {
        it('returns 401 when not authenticated', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/me/settings',
            });

            expect(response.statusCode).toBe(401);
        });

        it('returns existing settings for authenticated user', async () => {
            prisma.userSettings.findUnique.mockResolvedValue({
                isPublicProfile: true,
                shareTopTracks: true,
                shareTopArtists: true,
                shareListeningTime: true,
                emailNotifications: false,
                timezone: 'America/New_York',
            });

            const response = await app.inject({
                method: 'GET',
                url: '/me/settings',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.isPublicProfile).toBe(true);
            expect(body.timezone).toBe('America/New_York');
        });

        it('creates default settings if none exist', async () => {
            prisma.userSettings.findUnique.mockResolvedValue(null);
            prisma.userSettings.create.mockResolvedValue({
                isPublicProfile: false,
                shareTopTracks: true,
                shareTopArtists: true,
                shareListeningTime: true,
                emailNotifications: true,
                timezone: 'UTC',
            });

            const response = await app.inject({
                method: 'GET',
                url: '/me/settings',
                headers: { 'x-test-user-id': 'user-new' },
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.userSettings.create).toHaveBeenCalled();
        });
    });

    describe('PATCH /me/settings', () => {
        it('updates isPublicProfile setting', async () => {
            prisma.userSettings.upsert.mockResolvedValue({
                isPublicProfile: false,
                shareTopTracks: true,
                shareTopArtists: true,
                shareListeningTime: true,
                emailNotifications: true,
                timezone: 'UTC',
            });

            const response = await app.inject({
                method: 'PATCH',
                url: '/me/settings',
                headers: { 'x-test-user-id': 'user-123' },
                payload: { isPublicProfile: false },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json().isPublicProfile).toBe(false);
        });

        it('updates timezone setting with valid timezone', async () => {
            prisma.userSettings.upsert.mockResolvedValue({
                isPublicProfile: true,
                shareTopTracks: true,
                shareTopArtists: true,
                shareListeningTime: true,
                emailNotifications: true,
                timezone: 'Europe/London',
            });

            const response = await app.inject({
                method: 'PATCH',
                url: '/me/settings',
                headers: { 'x-test-user-id': 'user-123' },
                payload: { timezone: 'Europe/London' },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json().timezone).toBe('Europe/London');
        });

        it('rejects invalid timezone', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/me/settings',
                headers: { 'x-test-user-id': 'user-123' },
                payload: { timezone: 'Invalid/Timezone' },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error).toBe('Invalid timezone');
        });

        it('persists emailNotifications preference', async () => {
            prisma.userSettings.upsert.mockResolvedValue({
                isPublicProfile: true,
                shareTopTracks: true,
                shareTopArtists: true,
                shareListeningTime: true,
                emailNotifications: false,
                timezone: 'UTC',
            });

            const response = await app.inject({
                method: 'PATCH',
                url: '/me/settings',
                headers: { 'x-test-user-id': 'user-123' },
                payload: { emailNotifications: false },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json().emailNotifications).toBe(false);
        });
    });

    describe('GET /me/settings/timezones', () => {
        it('returns list of available timezones', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/me/settings/timezones',
            });

            expect(response.statusCode).toBe(200);
            const timezones = response.json();
            expect(Array.isArray(timezones)).toBe(true);
            expect(timezones).toContain('UTC');
            expect(timezones).toContain('America/New_York');
        });
    });
});
