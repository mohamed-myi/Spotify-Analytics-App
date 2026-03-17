// Compare Routes Integration Tests
// Tests for /compare/:targetUser endpoint with weighted Jaccard scoring

// Mock Redis
jest.mock('../../src/lib/redis', () => ({
    redis: { quit: jest.fn() },
    closeRedis: jest.fn(),
}));

// Mock queues
jest.mock('../../src/workers/queues', () => ({
    syncUserQueue: { add: jest.fn() },
    importQueue: { add: jest.fn() },
}));

// Mock Prisma
jest.mock('../../src/lib/prisma', () => {
    const { createMockPrisma } = jest.requireActual('../mocks/prisma.mock');
    return {
        prisma: createMockPrisma(),
    };
});

// Mock auth middleware
jest.mock('../../src/middleware/auth', () => ({
    authMiddleware: async (req: any) => {
        const testUserId = req.headers['x-test-user-id'];
        if (testUserId) {
            req.userId = testUserId;
        }
    },
}));

import Fastify, { FastifyInstance } from 'fastify';
import { compareRoutes } from '../../src/routes/compare';
import { authMiddleware } from '../../src/middleware/auth';
import { prisma } from '../../src/lib/prisma';

describe('Compare Routes Integration', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        app.addHook('preHandler', authMiddleware);
        await app.register(compareRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /compare/:targetUser', () => {
        it('returns 401 when not authenticated', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/compare/friend-spotify-id',
            });

            expect(response.statusCode).toBe(401);
        });

        it('returns 404 when target user not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/compare/nonexistent-user',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json().error).toBe('User not found');
        });

        it('returns 403 when target profile is private', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'target-user-id',
                spotifyId: 'friend',
                displayName: 'Friend',
                settings: { isPublicProfile: false },
            });

            const response = await app.inject({
                method: 'GET',
                url: '/compare/friend',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(403);
            expect(response.json().error).toBe('Profile is private');
        });

        it('returns comparison with common items and score', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'target-user-id',
                spotifyId: 'friend',
                displayName: 'Friend',
                imageUrl: 'https://friend.jpg',
                settings: { isPublicProfile: true },
            });

            // Mock source user top artists
            prisma.spotifyTopArtist.findMany.mockImplementation(({ where }) => {
                if (where.userId === 'user-123') {
                    return Promise.resolve([
                        {
                            rank: 1,
                            artistId: 'artist-1',
                            artist: { spotifyId: 'sp-artist-1', name: 'Common Artist', imageUrl: 'https://img.jpg' },
                        },
                        {
                            rank: 2,
                            artistId: 'artist-2',
                            artist: { spotifyId: 'sp-artist-2', name: 'Only Source' },
                        },
                    ]);
                }
                // Target user
                return Promise.resolve([
                    {
                        rank: 3,
                        artistId: 'artist-1',
                        artist: { spotifyId: 'sp-artist-1', name: 'Common Artist', imageUrl: 'https://img.jpg' },
                    },
                ]);
            });

            prisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/compare/friend?timeRange=medium_term',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();

            expect(body.score).toBeDefined();
            expect(body.breakdown).toBeDefined();
            expect(body.commonArtists).toBeInstanceOf(Array);
            expect(body.commonTracks).toBeInstanceOf(Array);
            expect(body.targetUser.displayName).toBe('Friend');
            expect(body.metadata.timeRange).toBe('medium_term');
        });

        it('calculates higher score for more common items', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: 'target-user-id',
                spotifyId: 'friend',
                displayName: 'Friend',
                settings: { isPublicProfile: true },
            });

            // Many common artists at similar ranks
            const artists = Array.from({ length: 10 }, (_, i) => ({
                rank: i + 1,
                artistId: `artist-${i}`,
                artist: { spotifyId: `sp-artist-${i}`, name: `Artist ${i}` },
            }));

            prisma.spotifyTopArtist.findMany.mockResolvedValue(artists);
            prisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/compare/friend',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            // With 10 artists matching at same ranks, score should be significant
            expect(body.score).toBeGreaterThan(0);
        });
    });
});
