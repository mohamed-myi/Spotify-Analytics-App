// Mock env module BEFORE any imports to prevent process.exit(1)
jest.mock('@/env', () => ({
    env: {
        NODE_ENV: 'test',
        PORT: 3001,
        DATABASE_URL: 'postgresql://mock:5432/db',
        REDIS_URL: 'redis://mock:6379',
        FRONTEND_URL: 'http://localhost:3000',
        SPOTIFY_CLIENT_ID: 'mock-client-id',
        SPOTIFY_CLIENT_SECRET: 'mock-client-secret',
        ENCRYPTION_KEY: '0'.repeat(64),
    },
}));

import { FastifyInstance } from 'fastify';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { build } from '@/index';
import request from 'supertest';
import { createServer } from 'http';


jest.mock('@/lib/prisma', () => ({
    prisma: {
        userTrackStats: { aggregate: jest.fn(), findMany: jest.fn() },
        userArtistStats: { findFirst: jest.fn(), findMany: jest.fn() },
        listeningEvent: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
        user: { findUnique: jest.fn() }, // For auth
        track: { findMany: jest.fn() },
        spotifyTopTrack: { findMany: jest.fn() },
        spotifyTopArtist: { findMany: jest.fn() },
        $queryRaw: jest.fn(),
    },
}));

jest.mock('@/lib/redis', () => {
    const mockRedis = {
        get: jest.fn(),
        setex: jest.fn(),
        quit: jest.fn(),
    };
    return {
        redis: mockRedis,
        getOrSet: jest.fn(async (key, ttl, fetcher) => {
            const cached = await mockRedis.get(key);
            if (cached) {
                return JSON.parse(cached);
            }
            const data = await fetcher();
            if (data !== null && data !== undefined) {
                await mockRedis.setex(key, ttl, JSON.stringify(data));
            }
            return data;
        }),
        closeRedis: jest.fn(),
    };
});

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn(),
    })),
    Worker: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn(),
    })),
}));

// Mock auth middleware to bypass real cookie checks and inject userId
jest.mock('@/middleware/auth', () => ({
    authMiddleware: async (req: any, reply: any) => {
        req.userId = 'user-1'; // Authenticated
    },
}));

describe('Stats API', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = await build();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /me/stats/overview', () => {
        it('should return stats from DB on cache miss', async () => {
            (redis.get as jest.Mock).mockResolvedValue(null);

            // Mock Prisma response
            (prisma.userTrackStats.aggregate as jest.Mock).mockResolvedValue({
                _sum: { totalMs: BigInt(5000) },
                _count: { trackId: 10 },
            });
            (prisma.userArtistStats.findFirst as jest.Mock).mockResolvedValue({
                artist: { name: 'Top Artist' },
            });

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/overview',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();

            // Verify BigInt serialization
            expect(body.totalPlayTimeMs).toBe('5000');
            expect(body.totalTracks).toBe(10);
            expect(body.topArtist).toBe('Top Artist');

            // Verify Cache Set
            expect(redis.setex).toHaveBeenCalledWith(
                'stats:overview:user-1',
                300,
                expect.any(String)
            );
        });

        it('should return stats from Redis on cache hit', async () => {
            const cachedData = JSON.stringify({
                totalPlayTimeMs: '9999',
                totalTracks: 50,
                topArtist: 'Cached Artist',
            });
            (redis.get as jest.Mock).mockResolvedValue(cachedData);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/overview',
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual(JSON.parse(cachedData));
            expect(prisma.userTrackStats.aggregate).not.toHaveBeenCalled();
        });
    });

    describe('GET /me/stats/top/tracks', () => {
        it('should return top tracks list', async () => {
            (redis.get as jest.Mock).mockResolvedValue(null);
            (prisma.spotifyTopTrack.findMany as jest.Mock).mockResolvedValue([
                {
                    rank: 1,
                    track: {
                        spotifyId: 'track-1',
                        name: 'Song 1',
                        artists: [],
                        album: { imageUrl: 'https://example.com/album.jpg' }
                    }
                }
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=year',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveLength(1);
            expect(body[0].name).toBe('Song 1');
            expect(body[0].rank).toBe(1);
        });

        it('should return cached tracks on cache hit', async () => {
            const cachedData = JSON.stringify([
                { playCount: 5, totalMs: '15000', name: 'Cached Song' }
            ]);
            (redis.get as jest.Mock).mockResolvedValue(cachedData);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=year',
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.userTrackStats.findMany).not.toHaveBeenCalled();
        });

        it('should handle different range parameter', async () => {
            (redis.get as jest.Mock).mockResolvedValue(null);
            (prisma.spotifyTopTrack.findMany as jest.Mock).mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?range=6months',
            });

            expect(response.statusCode).toBe(200);
            expect(redis.setex).toHaveBeenCalledWith(
                'stats:tracks:user-1:6months:rank',
                300,
                expect.any(String)
            );
        });

        it('should handle sortBy=time parameter', async () => {
            (redis.get as jest.Mock).mockResolvedValue(null);
            (prisma.userTrackStats.findMany as jest.Mock).mockResolvedValue([
                {
                    track: { name: 'Long Song', artists: [], album: null },
                    totalMs: BigInt(600000), // 10 mins
                    playCount: 2
                }
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/tracks?sortBy=time',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveLength(1);
            expect(body[0].name).toBe('Long Song');
            expect(body[0].totalMs).toBe('600000'); // BigInt serialized

            expect(prisma.userTrackStats.findMany).toHaveBeenCalled();
            expect(redis.setex).toHaveBeenCalledWith(
                'stats:tracks:user-1:4weeks:time',
                300,
                expect.any(String)
            );
        });
    });

    describe('GET /me/stats/top/artists', () => {
        it('should return top artists on cache miss', async () => {
            (redis.get as jest.Mock).mockResolvedValue(null);
            (prisma.spotifyTopArtist.findMany as jest.Mock).mockResolvedValue([
                {
                    rank: 1,
                    artist: {
                        spotifyId: 'artist-1',
                        name: 'Top Artist',
                        imageUrl: 'https://example.com/img.jpg'
                    }
                }
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/artists?range=year',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveLength(1);
            expect(body[0].name).toBe('Top Artist');
            expect(body[0].rank).toBe(1);
        });

        it('should return cached artists on cache hit', async () => {
            const cachedData = JSON.stringify([
                { playCount: 10, name: 'Cached Artist' }
            ]);
            (redis.get as jest.Mock).mockResolvedValue(cachedData);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/top/artists',
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.userArtistStats.findMany).not.toHaveBeenCalled();
        });

        it('should cache with correct key for range', async () => {
            (redis.get as jest.Mock).mockResolvedValue(null);
            (prisma.spotifyTopArtist.findMany as jest.Mock).mockResolvedValue([]);

            await app.inject({
                method: 'GET',
                url: '/me/stats/top/artists?range=4weeks',
            });

            expect(redis.setex).toHaveBeenCalledWith(
                'stats:artists:user-1:4weeks',
                300,
                expect.any(String)
            );
        });
    });

    describe('GET /me/history', () => {
        it('should return paginated history', async () => {
            (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 'event-1',
                    playedAt: new Date('2025-01-01T12:00:00Z'),
                    track: { name: 'Recent Track', artists: [], album: null }
                }
            ]);
            (prisma.listeningEvent.count as jest.Mock).mockResolvedValue(100);

            const response = await app.inject({
                method: 'GET',
                url: '/me/history?page=1&limit=50',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.events).toHaveLength(1);
            expect(body.total).toBe(100);
            // Query params come through as strings from the route
            expect(Number(body.page)).toBe(1);
            expect(Number(body.limit)).toBe(50);
        });

        it('should use default pagination values', async () => {
            (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.listeningEvent.count as jest.Mock).mockResolvedValue(0);

            const response = await app.inject({
                method: 'GET',
                url: '/me/history',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(Number(body.page)).toBe(1);
            expect(Number(body.limit)).toBe(50);
        });

        it('should handle second page correctly', async () => {
            (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.listeningEvent.count as jest.Mock).mockResolvedValue(200);

            await app.inject({
                method: 'GET',
                url: '/me/history?page=2&limit=25',
            });

            // Verify prisma was called with correct skip
            expect(prisma.listeningEvent.findMany).toHaveBeenCalled();
            const callArgs = (prisma.listeningEvent.findMany as jest.Mock).mock.calls[0][0];
            expect(callArgs.skip).toBe(25);
        });
    });

    describe('GET /me/stats/mood', () => {
        it('should return aggregated mood stats', async () => {
            (redis.get as jest.Mock).mockResolvedValue(null);
            (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([
                {
                    playedAt: new Date('2025-01-01T12:00:00Z'),
                    track: { audioFeatures: { valence: 0.8, energy: 0.6 } }
                },
                {
                    playedAt: new Date('2025-01-01T13:00:00Z'),
                    track: { audioFeatures: { valence: 0.4, energy: 0.8 } }
                }
            ]);

            const response = await app.inject({
                method: 'GET',
                url: '/me/stats/mood',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();

            expect(body).toHaveLength(1); // One day
            expect(body[0].date).toBe('2025-01-01');
            expect(body[0].valence).toBe(0.6); // (0.8 + 0.4) / 2
            expect(body[0].energy).toBe(0.7);  // (0.6 + 0.8) / 2
            expect(body[0].count).toBe(2);

            expect(redis.setex).toHaveBeenCalledWith(
                'stats:mood:user-1',
                300,
                expect.any(String)
            );
        });
    });
});

