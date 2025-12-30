import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../../.env') });

// Mock Redis
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

// Mock queues
jest.mock('../../src/workers/queues', () => ({
    syncUserQueue: { add: jest.fn() },
    importQueue: { add: jest.fn() },
}));

jest.mock('../../src/workers/top-stats-queue', () => ({
    topStatsQueue: {
        add: jest.fn().mockResolvedValue({}),
    },
}));

// Mock triggerLazyRefreshIfStale
const mockTriggerLazyRefreshIfStale = jest.fn().mockResolvedValue({ queued: false, staleHours: 0 });
const mockIsTopStatsHydrated = jest.fn();

jest.mock('../../src/services/top-stats-service', () => ({
    triggerLazyRefreshIfStale: mockTriggerLazyRefreshIfStale,
    isTopStatsHydrated: mockIsTopStatsHydrated,
}));

// Mock Prisma
const mockPrisma = {
    spotifyTopTrack: {
        findMany: jest.fn(),
    },
    spotifyTopArtist: {
        findMany: jest.fn(),
    },
    userTrackStats: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
    },
    userArtistStats: {
        findMany: jest.fn(),
    },
    listeningEvent: {
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
    },
    userHourStats: {
        findMany: jest.fn(),
    },
    userTimeBucketStats: {
        findMany: jest.fn(),
    },
    track: {
        findUnique: jest.fn(),
    },
};

jest.mock('../../src/lib/prisma', () => ({
    prisma: mockPrisma,
}));

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
import { statsRoutes } from '../../src/routes/stats';
import { authMiddleware } from '../../src/middleware/auth';

describe('Top Stats Race Condition Tests', () => {
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

    describe('New User Race: 202 Processing Response', () => {
        it('returns 202 with status:processing when topStatsRefreshedAt is null and data is empty for short_term tracks', async () => {
            // User has not been hydrated yet
            mockIsTopStatsHydrated.mockResolvedValue(false);
            mockPrisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=4weeks',
                headers: { 'x-test-user-id': 'new-user-1' },
            });

            expect(response.statusCode).toBe(202);
            const body = response.json();
            expect(body.status).toBe('processing');
            expect(body.data).toEqual([]);
            // Cache should NOT be written
            expect(mockRedisSetex).not.toHaveBeenCalled();
        });

        it('returns 202 with status:processing when topStatsRefreshedAt is null and data is empty for medium_term tracks', async () => {
            mockIsTopStatsHydrated.mockResolvedValue(false);
            mockPrisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=6months',
                headers: { 'x-test-user-id': 'new-user-1' },
            });

            expect(response.statusCode).toBe(202);
            expect(response.json().status).toBe('processing');
            expect(mockRedisSetex).not.toHaveBeenCalled();
        });

        it('returns 202 with status:processing when topStatsRefreshedAt is null and data is empty for long_term tracks', async () => {
            mockIsTopStatsHydrated.mockResolvedValue(false);
            mockPrisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=year',
                headers: { 'x-test-user-id': 'new-user-1' },
            });

            expect(response.statusCode).toBe(202);
            expect(response.json().status).toBe('processing');
            expect(mockRedisSetex).not.toHaveBeenCalled();
        });

        it('returns 202 for artists when topStatsRefreshedAt is null', async () => {
            mockIsTopStatsHydrated.mockResolvedValue(false);
            mockPrisma.spotifyTopArtist.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/artists?range=4weeks',
                headers: { 'x-test-user-id': 'new-user-1' },
            });

            expect(response.statusCode).toBe(202);
            expect(response.json().status).toBe('processing');
        });

        it('simulates 3 rapid requests: all return 202 and cache remains empty', async () => {
            mockIsTopStatsHydrated.mockResolvedValue(false);
            mockPrisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            const responses = await Promise.all([
                app.inject({
                    method: 'GET',
                    url: '/me/stats/top/tracks?range=4weeks',
                    headers: { 'x-test-user-id': 'new-user-rapid' },
                }),
                app.inject({
                    method: 'GET',
                    url: '/me/stats/top/tracks?range=6months',
                    headers: { 'x-test-user-id': 'new-user-rapid' },
                }),
                app.inject({
                    method: 'GET',
                    url: '/me/stats/top/tracks?range=year',
                    headers: { 'x-test-user-id': 'new-user-rapid' },
                }),
            ]);

            // All should return 202
            responses.forEach((res, idx) => {
                expect(res.statusCode).toBe(202);
                expect(res.json().status).toBe('processing');
            });

            // Cache should never be written for any of them
            expect(mockRedisSetex).not.toHaveBeenCalled();
        });
    });

    describe('Hydrated User: 200 OK Response', () => {
        it('returns 200 OK with data when topStatsRefreshedAt is set', async () => {
            mockIsTopStatsHydrated.mockResolvedValue(true);
            mockPrisma.spotifyTopTrack.findMany.mockResolvedValue([
                {
                    rank: 1,
                    track: {
                        id: 'track-1',
                        name: 'Track 1',
                        spotifyId: 'sp-1',
                        artists: [{ artist: { name: 'Artist 1', spotifyId: 'ar-1' } }],
                        album: { name: 'Album 1', imageUrl: 'https://img.jpg' },
                    },
                },
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=4weeks',
                headers: { 'x-test-user-id': 'hydrated-user' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body[0].name).toBe('Track 1');
            // Cache should be written
            expect(mockRedisSetex).toHaveBeenCalled();
        });

        it('returns 200 OK with empty array when hydrated but data is legitimately empty', async () => {
            // Hydrated, but user has no long_term data (new Spotify account)
            mockIsTopStatsHydrated.mockResolvedValue(true);
            mockPrisma.spotifyTopTrack.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=year',
                headers: { 'x-test-user-id': 'hydrated-user-empty' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body.length).toBe(0);
            // Cache SHOULD be written for legitimately empty data
            expect(mockRedisSetex).toHaveBeenCalled();
        });
    });

    describe('AllTime Range: No Hydration Check', () => {
        it('returns 200 for alltime range regardless of hydration status', async () => {
            // For alltime, we use userTrackStats, not Spotify top data
            mockIsTopStatsHydrated.mockResolvedValue(false);
            mockPrisma.userTrackStats.findMany.mockResolvedValue([
                {
                    playCount: 50,
                    totalMs: BigInt(1800000),
                    track: {
                        id: 'track-1',
                        name: 'All Time Track',
                        artists: [{ artist: { name: 'Artist' } }],
                        album: { name: 'Album' },
                    },
                },
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=alltime',
                headers: { 'x-test-user-id': 'new-user-alltime' },
            });

            // alltime uses userTrackStats, not Spotify API, so no 202
            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body[0].name).toBe('All Time Track');
        });
    });
});
