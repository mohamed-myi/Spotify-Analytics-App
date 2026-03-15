import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../../.env') });

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

import Fastify, { FastifyInstance } from 'fastify';
import { userRoutes } from '../../src/routes/users';
import { prisma } from '../../src/lib/prisma';

describe('Users Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        await app.register(userRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /users/:username', () => {
        it('returns 404 for non-existent user', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/users/nonexistent',
            });

            expect(response.statusCode).toBe(404);
            expect(response.json().error).toBe('User not found');
        });

        it('returns 403 for private profile', async () => {
            prisma.user.findUnique.mockResolvedValue({
                spotifyId: 'private_user',
                displayName: 'Private User',
                imageUrl: null,
                settings: { isPublicProfile: false },
                createdAt: new Date('2024-01-01'),
            });

            const response = await app.inject({
                method: 'GET',
                url: '/users/private_user',
            });

            expect(response.statusCode).toBe(403);
            expect(response.json().error).toBe('This profile is private');
        });

        it('returns public user profile', async () => {
            prisma.user.findUnique.mockResolvedValue({
                spotifyId: 'spotify123',
                displayName: 'Test User',
                imageUrl: 'https://image.jpg',
                settings: { isPublicProfile: true },
                createdAt: new Date('2024-01-01'),
            });

            const response = await app.inject({
                method: 'GET',
                url: '/users/spotify123',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.spotifyId).toBe('spotify123');
            expect(body.displayName).toBe('Test User');
        });
    });

    describe('GET /users/:username/top', () => {
        it('returns 404 for non-existent user', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/users/nonexistent/top',
            });

            expect(response.statusCode).toBe(404);
            expect(response.json().error).toBe('User not found');
        });

        it('returns 403 for private profile', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-id',
                spotifyId: 'private_user',
                settings: { isPublicProfile: false },
            });

            const response = await app.inject({
                method: 'GET',
                url: '/users/private_user/top',
            });

            expect(response.statusCode).toBe(403);
            expect(response.json().error).toBe('This profile is private');
        });

        it('returns top tracks and artists for public profile', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'user-id',
                spotifyId: 'public_user',
                settings: { isPublicProfile: true },
            });
            prisma.userTrackStats.findMany.mockResolvedValue([
                {
                    track: {
                        id: 't1',
                        name: 'Top Track',
                        artists: [{ artist: { name: 'Artist' } }],
                        album: { name: 'Album' },
                    },
                    playCount: 100,
                },
            ]);
            prisma.userArtistStats.findMany.mockResolvedValue([
                {
                    artist: { id: 'a1', name: 'Top Artist' },
                    playCount: 50,
                },
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/users/public_user/top',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.tracks).toHaveLength(1);
            expect(body.artists).toHaveLength(1);
            expect(body.tracks[0].name).toBe('Top Track');
        });

        it('enforces privacy - stats unreachable when isPublicProfile is false', async () => {

            prisma.user.findUnique.mockResolvedValue({
                id: 'user-id',
                spotifyId: 'changing_user',
                settings: { isPublicProfile: true },
            });
            prisma.userTrackStats.findMany.mockResolvedValue([]);
            prisma.userArtistStats.findMany.mockResolvedValue([]);

            const publicResponse = await app.inject({
                method: 'GET',
                url: '/users/changing_user/top',
            });
            expect(publicResponse.statusCode).toBe(200);

            prisma.user.findUnique.mockResolvedValue({
                id: 'user-id',
                spotifyId: 'changing_user',
                settings: { isPublicProfile: false },
            });

            const privateResponse = await app.inject({
                method: 'GET',
                url: '/users/changing_user/top',
            });
            expect(privateResponse.statusCode).toBe(403);
        });
    });
});
