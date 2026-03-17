
jest.mock('@/env', () => ({
    getEnv: () => ({
        NODE_ENV: 'test',
        PORT: 3001,
        DATABASE_URL: 'postgresql://mock:5432/db',
        REDIS_URL: 'redis://mock:6379',
        FRONTEND_URL: 'http://localhost:3000',
        SPOTIFY_CLIENT_ID: 'mock-client-id',
        SPOTIFY_CLIENT_SECRET: 'mock-client-secret',
        ENCRYPTION_KEY: '0'.repeat(64),
        SESSION_SECRET: 'test_session_secret_at_least_32_chars_long',
        JWT_SECRET: 'test_jwt_secret_value_at_least_32_chars_long',
        CRON_SECRET: 'test_cron_secret_16ch',
        SPOTIFY_CB_THRESHOLD: 5,
        SPOTIFY_CB_RESET_TIMEOUT: 30000,
        SPOTIFY_CB_WINDOW_DURATION: 60000,
    }),
}));

jest.mock('@/workers/import-worker', () => ({
    importWorker: { name: 'import-history', on: jest.fn(), close: jest.fn() },
    closeImportWorker: jest.fn(),
}));

import { FastifyInstance } from 'fastify';
import { prisma } from '../../../src/lib/prisma';
import { redis } from '../../../src/lib/redis';
import { build } from '../../../src/index';
import { Term } from '@prisma/client';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        userTrackStats: { findFirst: jest.fn() },
        spotifyTopTrack: { findFirst: jest.fn() },
        listeningEvent: { groupBy: jest.fn() },
        user: { findUnique: jest.fn() },
        track: { findUnique: jest.fn() },
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
            if (cached) return JSON.parse(cached);
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
    Queue: jest.fn(),
    Worker: jest.fn(),
}));

jest.mock('@/middleware/auth', () => ({
    authMiddleware: async (req: any, reply: any) => {
        req.userId = 'user-1';
    },
}));

// Mock services to avoid side effects
jest.mock('@/services/stats-service', () => ({}));
jest.mock('@/services/top-stats-service', () => ({}));

describe('Score of the Day (SOTD) Logic', () => {
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
        (redis.get as jest.Mock).mockResolvedValue(null); // Default to cache miss
    });

    const mockTrack = (id: string, name: string) => ({
        id,
        spotifyId: `spotify-${id}`,
        name,
        artists: [{ artist: { name: 'Artist ' + name, spotifyId: 'artist-' + id } }],
        album: { imageUrl: 'http://img.com/' + id }
    });

    it('Scenario 1: Returns most played track from last 24h (Primary)', async () => {
        // Mock recent plays exists
        (prisma.listeningEvent.groupBy as jest.Mock).mockResolvedValue([
            { trackId: 'track-24h', _count: { trackId: 10 } }
        ]);
        (prisma.track.findUnique as jest.Mock).mockResolvedValue(mockTrack('track-24h', 'Recent Hit'));

        const response = await app.inject({
            method: 'GET',
            url: '/me/stats/song-of-the-day',
        });

        const body = response.json();
        expect(response.statusCode).toBe(200);
        expect(body.name).toBe('Recent Hit');
        expect(body.context).toBe('Most Played (Last 24h)');
        expect(body.isFallback).toBe(false);
    });

    it('Scenario 2: Fallback to Last 4 Weeks (Short Term)', async () => {
        // No recent plays
        (prisma.listeningEvent.groupBy as jest.Mock).mockResolvedValue([]);

        // Mock 4 weeks top track
        (prisma.spotifyTopTrack.findFirst as jest.Mock).mockImplementation(({ where }) => {
            if (where.term === Term.SHORT_TERM) {
                return { trackId: 'track-4w', track: mockTrack('track-4w', 'Short Term Hit') };
            }
            return null;
        });
        (prisma.track.findUnique as jest.Mock).mockResolvedValue(mockTrack('track-4w', 'Short Term Hit'));

        const response = await app.inject({
            method: 'GET',
            url: '/me/stats/song-of-the-day',
        });

        const body = response.json();
        expect(body.name).toBe('Short Term Hit');
        expect(body.context).toBe('Most Played (Last 4 Weeks)');
        expect(body.isFallback).toBe(true);
    });

    it('Scenario 3: Fallback to Last 6 Months (Medium Term)', async () => {
        (prisma.listeningEvent.groupBy as jest.Mock).mockResolvedValue([]);

        (prisma.spotifyTopTrack.findFirst as jest.Mock).mockImplementation(({ where }) => {
            if (where.term === Term.MEDIUM_TERM) {
                return { trackId: 'track-6m', track: mockTrack('track-6m', 'Medium Term Hit') };
            }
            return null;
        });
        (prisma.track.findUnique as jest.Mock).mockResolvedValue(mockTrack('track-6m', 'Medium Term Hit'));

        const response = await app.inject({
            method: 'GET',
            url: '/me/stats/song-of-the-day',
        });

        const body = response.json();
        expect(body.name).toBe('Medium Term Hit');
        expect(body.context).toBe('Most Played (Last 6 Months)');
        expect(body.isFallback).toBe(true);
    });

    it('Scenario 4: Fallback to Last Year (Long Term)', async () => {
        (prisma.listeningEvent.groupBy as jest.Mock).mockResolvedValue([]);

        (prisma.spotifyTopTrack.findFirst as jest.Mock).mockImplementation(({ where }) => {
            if (where.term === Term.LONG_TERM) {
                return { trackId: 'track-1y', track: mockTrack('track-1y', 'Long Term Hit') };
            }
            return null;
        });
        (prisma.track.findUnique as jest.Mock).mockResolvedValue(mockTrack('track-1y', 'Long Term Hit'));

        const response = await app.inject({
            method: 'GET',
            url: '/me/stats/song-of-the-day',
        });

        const body = response.json();
        expect(body.name).toBe('Long Term Hit');
        expect(body.context).toBe('Most Played (Last Year)');
        expect(body.isFallback).toBe(true);
    });

    it('Scenario 5: Fallback to All Time (Imported Stats)', async () => {
        (prisma.listeningEvent.groupBy as jest.Mock).mockResolvedValue([]);
        (prisma.spotifyTopTrack.findFirst as jest.Mock).mockResolvedValue(null);

        // Mock All Time stats
        (prisma.userTrackStats.findFirst as jest.Mock).mockResolvedValue({
            trackId: 'track-alltime',
            playCount: 500
        });
        (prisma.track.findUnique as jest.Mock).mockResolvedValue(mockTrack('track-alltime', 'All Time Hit'));

        const response = await app.inject({
            method: 'GET',
            url: '/me/stats/song-of-the-day',
        });

        const body = response.json();
        expect(body.name).toBe('All Time Hit');
        expect(body.context).toBe('Most Played (All Time)');
        expect(body.isFallback).toBe(true);
    });

    it('Scenario 6: Absolute Fallback (No Tracks)', async () => {
        (prisma.listeningEvent.groupBy as jest.Mock).mockResolvedValue([]);
        (prisma.spotifyTopTrack.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.userTrackStats.findFirst as jest.Mock).mockResolvedValue(null);

        const response = await app.inject({
            method: 'GET',
            url: '/me/stats/song-of-the-day',
        });

        const body = response.json();
        expect(body.name).toBe('No tracks played yet');
        expect(body.context).toBe('Song of the Day');
        expect(body.isFallback).toBe(true);
    });
});
