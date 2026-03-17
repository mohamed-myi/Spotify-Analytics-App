


const mockRedisGet = jest.fn();
const mockRedisSetex = jest.fn();

jest.mock('../../src/lib/redis', () => ({
    redis: {
        get: mockRedisGet,
        setex: mockRedisSetex,
        quit: jest.fn(),
    },
    getOrSet: jest.fn(async (key: string, ttl: number, fetcher: () => Promise<any>) => {
        const cached = await mockRedisGet(key);
        if (cached) {
            return JSON.parse(cached);
        }
        const data = await fetcher();
        if (data !== null && data !== undefined) {

            const serialized = JSON.stringify(data, (_, value) =>
                typeof value === 'bigint' ? value.toString() : value
            );
            await mockRedisSetex(key, ttl, serialized);
        }
        return data;
    }),
    closeRedis: jest.fn(),
}));


jest.mock('../../src/workers/queues', () => ({
    syncUserQueue: { add: jest.fn() },
    importQueue: { add: jest.fn() },
}));


jest.mock('../../src/workers/top-stats-queue', () => ({
    topStatsQueue: {
        add: jest.fn().mockResolvedValue({}),
    },
}));


jest.mock('../../src/services/top-stats-service', () => ({
    triggerLazyRefreshIfStale: jest.fn().mockResolvedValue({ queued: false, staleHours: 0 }),
    isTopStatsHydrated: jest.fn().mockResolvedValue(true),
}));


const mockGetSummaryStats = jest.fn();
const mockGetOverviewStats = jest.fn();
const mockGetActivityStats = jest.fn();

jest.mock('../../src/services/stats-service', () => ({
    getSummaryStats: mockGetSummaryStats,
    getOverviewStats: mockGetOverviewStats,
    getActivityStats: mockGetActivityStats,
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
import { statsRoutes } from '../../src/routes/stats';
import { authMiddleware } from '../../src/middleware/auth';
import { prisma } from '../../src/lib/prisma';

describe('Stats Routes Integration', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        app.addHook('preHandler', authMiddleware);
        await app.register(statsRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisGet.mockResolvedValue(null);
    });

    describe('GET /me/stats/overview', () => {
        it('returns 401 when not authenticated', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/overview',
            });

            expect(response.statusCode).toBe(401);
        });

        it('returns overview stats for authenticated user', async () => {
            mockGetOverviewStats.mockResolvedValue({
                totalPlayTimeMs: 1800000n,
                totalTracks: 10,
                topArtist: 'Top Artist',
                topArtistImage: 'https://artist.jpg',
            });

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/overview',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.totalPlayTimeMs).toBeDefined();
            expect(body.totalTracks).toBe(10);
            expect(body.topArtist).toBe('Top Artist');
        });

        it('returns cached data when available', async () => {
            const cachedData = {
                totalPlayTimeMs: '123456',
                totalTracks: 5,
                topArtist: 'Cached Artist',
                topArtistImage: null
            };
            mockRedisGet.mockResolvedValue(JSON.stringify(cachedData));

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/overview',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json().totalTracks).toBe(5);
            expect(response.json().topArtist).toBe('Cached Artist');
            expect(prisma.userTrackStats.aggregate).not.toHaveBeenCalled();
        });
    });

    describe('GET /me/stats/top/tracks', () => {
        it('returns top tracks with default range', async () => {
            prisma.spotifyTopTrack.findMany.mockResolvedValue([
                {
                    rank: 1,
                    track: {
                        id: 'track-1',
                        name: 'Track 1',
                        spotifyId: 'spotify-1',
                        artists: [{ artist: { name: 'Artist 1' } }],
                        album: { name: 'Album 1' },
                    },
                },
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body[0].rank).toBe(1);
        });

        it('respects range query parameter', async () => {
            prisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=6months',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(prisma.spotifyTopTrack.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userId: 'user-123', term: 'MEDIUM_TERM' },
                })
            );
        });
    });

    describe('GET /me/stats/top/artists', () => {
        it('returns top artists', async () => {
            prisma.spotifyTopArtist.findMany.mockResolvedValue([
                {
                    rank: 1,
                    artist: {
                        id: 'artist-1',
                        name: 'Artist 1',
                        imageUrl: 'https://artist.jpg',
                    },
                },
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/artists',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body[0].name).toBe('Artist 1');
            expect(body[0].rank).toBe(1);
        });
    });

    describe('GET /me/history', () => {
        it('returns paginated listening history', async () => {
            prisma.listeningEvent.findMany.mockResolvedValue([
                {
                    id: 'event-1',
                    playedAt: new Date(),
                    track: { name: 'Track 1' },
                },
            ]);
            prisma.listeningEvent.count.mockResolvedValue(100);

            const response = await app.inject({
                method: 'GET',
                url: '/me/history?page=1&limit=10',
                headers: { 'x-test-user-id': 'user-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.events).toHaveLength(1);
            expect(body.total).toBe(100);
            expect(body.page).toBe(1);
            expect(body.limit).toBe(10);
        });
    });
});
