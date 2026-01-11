import { config } from 'dotenv';
import { resolve } from 'path';

// Load env vars before importing anything else
config({ path: resolve(__dirname, '../../../../.env') });

// Mock Redis before importing app
jest.mock('../../src/lib/redis', () => ({
    redis: {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        on: jest.fn(),
        quit: jest.fn(),
    },
    closeRedis: jest.fn(),
}));

import { build } from '../../src/index';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../src/lib/prisma';

// Mock getValidAccessToken to return a token so we pass auth check
jest.mock('../../src/lib/token-manager', () => ({
    getValidAccessToken: jest.fn().mockResolvedValue({ accessToken: 'fake-token' }),
}));

// Mock Prisma
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
        },
        // Add other used models if necessary, e.g. for ensureTopTracksCached
        spotifyTopTrack: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        userTrackStats: {
            count: jest.fn().mockResolvedValue(100),
        },
        listeningEvent: {
            findMany: jest.fn().mockResolvedValue([]),
        }
    },
}));

describe('Demo Mode Restrictions', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = await build();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Setup default demo user
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'demo-user-id',
            isDemo: true
        });
    });

    // Test Validate Shuffle
    it('GET /playlists/validate/shuffle should return 403 in demo mode', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/playlists/validate/shuffle',
            cookies: { session: 'demo-user-id' },
            payload: {
                sourcePlaylistId: 'some-playlist',
                shuffleMode: 'truly_random'
            }
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.code).toBe('DEMO_MODE_RESTRICTED');
        expect(body.error).toBe('Demo Mode');
    });

    // Test Validate Top 50
    it('GET /playlists/validate/top50 should return 403 in demo mode', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/playlists/validate/top50',
            cookies: { session: 'demo-user-id' },
            payload: {
                term: 'short'
            }
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.code).toBe('DEMO_MODE_RESTRICTED');
        expect(body.error).toBe('Demo Mode');
    });

    // Test Validate Recent
    it('GET /playlists/validate/recent should return 403 in demo mode', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/playlists/validate/recent',
            cookies: { session: 'demo-user-id' },
            payload: {
                kValue: 50
            }
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.code).toBe('DEMO_MODE_RESTRICTED');
        expect(body.error).toBe('Demo Mode');
    });
});
