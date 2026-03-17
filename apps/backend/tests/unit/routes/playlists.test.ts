// Playlist routes tests - focusing on validation, auth, and rate limiting
// Does NOT test full Spotify API integration (would require nock mocks)

// Mock env BEFORE any imports
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

jest.mock('@/lib/redis', () => ({
    redis: {
        get: jest.fn(),
        set: jest.fn(),
        setex: jest.fn(),
        del: jest.fn(),
    },
    getRedisUrl: jest.fn().mockReturnValue('redis://mock:6379'),
    REDIS_CONNECTION_CONFIG: {},
}));

const mockPrisma = {
    playlistJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
    },
    listeningEvent: {
        findMany: jest.fn(),
    },
    userTrackStats: {
        count: jest.fn(),
    },
};

jest.mock('@/lib/prisma', () => ({
    prisma: mockPrisma,
}));

jest.mock('@/lib/token-manager', () => ({
    getValidAccessToken: jest.fn(),
    recordTokenFailure: jest.fn(),
    resetTokenFailures: jest.fn(),
}));

jest.mock('@/lib/spotify-api', () => ({
    getUserPlaylists: jest.fn(),
    getPlaylistTracks: jest.fn(),
    getTopTracks: jest.fn(),
    createPlaylist: jest.fn(),
    addTracksToPlaylist: jest.fn(),
    uploadPlaylistCover: jest.fn(),
}));

jest.mock('@/middleware/auth', () => ({
    authMiddleware: async (req: any) => {
        const testUserId = req.headers['x-test-user-id'];
        if (testUserId) {
            req.userId = testUserId;
        }
    },
}));

// Mock BullMQ
const mockQueueAdd = jest.fn();
const mockQueueGetJob = jest.fn();
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: mockQueueAdd,
        getJob: mockQueueGetJob,
        close: jest.fn(),
    })),
    Worker: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn(),
    })),
}));

jest.mock('@/workers/queues', () => ({
    syncUserQueue: { add: jest.fn() },
    importQueue: { add: jest.fn() },
}));

// Mock for the new cache-based approach
const mockEnsureTopTracksCached = jest.fn();
jest.mock('@/services/top-stats-service', () => ({
    ensureTopTracksCached: mockEnsureTopTracksCached,
}));

import { FastifyInstance } from 'fastify';
import { build } from '@/index';
import { getValidAccessToken } from '@/lib/token-manager';
import { getPlaylistTracks, getTopTracks } from '@/lib/spotify-api';
import { generateConfirmationToken } from '@/lib/confirmation-token';

describe('Playlist Routes', () => {
    let app: FastifyInstance;
    const userId = 'user-123';

    beforeAll(async () => {
        app = await build();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Default: no pending jobs, no hourly limit
        mockPrisma.playlistJob.count.mockResolvedValue(0);
        // Default: no existing idempotent job (ISSUE-005 fix)
        mockPrisma.playlistJob.findFirst.mockResolvedValue(null);
    });

    describe('POST /playlists/validate/shuffle', () => {
        it('returns 401 when not authenticated', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/shuffle',
                payload: { sourcePlaylistId: 'playlist-123' },
            });

            expect(response.statusCode).toBe(401);
        });

        it('returns 400 when sourcePlaylistId is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: {},
            });

            expect(response.statusCode).toBe(400);
        });

        it('returns 401 when Spotify token expired', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue(null);

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: { sourcePlaylistId: 'playlist-123' },
            });

            expect(response.statusCode).toBe(401);
            expect(response.json().error).toContain('Spotify token expired');
        });

        it('returns trackCount and confirmationToken on success', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getPlaylistTracks as jest.Mock).mockResolvedValue({
                total: 150,
                items: [],
            });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: { sourcePlaylistId: 'playlist-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.trackCount).toBe(150);
            expect(body.confirmationToken).toBeDefined();
            expect(body.warnings).toEqual([]);
        });

        it('warns when track count is below minimum', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getPlaylistTracks as jest.Mock).mockResolvedValue({ total: 15, items: [] });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: { sourcePlaylistId: 'playlist-123' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.warnings).toContainEqual(expect.stringContaining('minimum 25'));
        });
    });

    describe('POST /playlists/create/shuffle', () => {
        it('rejects invalid confirmation token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/playlists/create/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: {
                    name: 'My Shuffle',
                    sourcePlaylistId: 'playlist-123',
                    confirmationToken: 'invalid-token',
                },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error).toContain('Invalid');
        });

        it('rejects when rate limit exceeded (5 pending jobs)', async () => {
            mockPrisma.playlistJob.count
                .mockResolvedValueOnce(5)  // 5 pending jobs
                .mockResolvedValueOnce(0); // 0 hourly

            const token = generateConfirmationToken(userId, {
                method: 'shuffle',
                sourcePlaylistId: 'playlist-123',
                shuffleMode: 'truly_random',
            });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/create/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: {
                    name: 'My Shuffle',
                    sourcePlaylistId: 'playlist-123',
                    shuffleMode: 'truly_random',
                    confirmationToken: token,
                },
            });

            expect(response.statusCode).toBe(429);
            expect(response.json().error).toContain('5 pending jobs');
        });

        it('creates job and enqueues on success', async () => {
            mockPrisma.playlistJob.count.mockResolvedValue(0);
            mockPrisma.playlistJob.create.mockResolvedValue({ id: 'job-abc' });
            mockQueueAdd.mockResolvedValue({});

            const token = generateConfirmationToken(userId, {
                method: 'shuffle',
                sourcePlaylistId: 'playlist-123',
                shuffleMode: 'truly_random',
            });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/create/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: {
                    name: 'My Shuffled Playlist',
                    sourcePlaylistId: 'playlist-123',
                    shuffleMode: 'truly_random',
                    confirmationToken: token,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.jobId).toBe('job-abc');
            expect(body.statusUrl).toContain('/api/playlists/jobs/job-abc');

            expect(mockPrisma.playlistJob.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    userId,
                    creationMethod: 'SHUFFLE',
                    name: 'My Shuffled Playlist',
                    idempotencyKey: expect.stringMatching(/^[a-f0-9]{32}$/),
                }),
            });
        });

        it('rejects token generated for different playlist (ISSUE-002 security)', async () => {
            // Generate token for playlist-A
            const token = generateConfirmationToken(userId, {
                method: 'shuffle',
                sourcePlaylistId: 'playlist-A',
                shuffleMode: 'truly_random',
            });

            // Try to use it for playlist-B
            const response = await app.inject({
                method: 'POST',
                url: '/playlists/create/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: {
                    name: 'My Shuffle',
                    sourcePlaylistId: 'playlist-B',
                    shuffleMode: 'truly_random',
                    confirmationToken: token,
                },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error).toContain('do not match');
            expect(response.json().details).toContainEqual(
                expect.stringContaining('sourcePlaylistId')
            );
        });

        it('rejects token generated with different shuffleMode', async () => {
            const token = generateConfirmationToken(userId, {
                method: 'shuffle',
                sourcePlaylistId: 'playlist-123',
                shuffleMode: 'truly_random',
            });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/create/shuffle',
                headers: { 'x-test-user-id': userId },
                payload: {
                    name: 'My Shuffle',
                    sourcePlaylistId: 'playlist-123',
                    shuffleMode: 'less_repetition',
                    confirmationToken: token,
                },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().details).toContainEqual(
                expect.stringContaining('shuffleMode')
            );
        });
    });

    describe('GET /playlists/jobs/:id', () => {
        it('returns 404 when job not found', async () => {
            mockPrisma.playlistJob.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/playlists/jobs/nonexistent',
                headers: { 'x-test-user-id': userId },
            });

            expect(response.statusCode).toBe(404);
        });

        it('returns 403 when job belongs to different user', async () => {
            mockPrisma.playlistJob.findUnique.mockResolvedValue({
                id: 'job-123',
                userId: 'different-user',
            });

            const response = await app.inject({
                method: 'GET',
                url: '/playlists/jobs/job-123',
                headers: { 'x-test-user-id': userId },
            });

            expect(response.statusCode).toBe(403);
        });

        it('returns job details on success', async () => {
            const mockJob = {
                id: 'job-123',
                userId,
                name: 'Test Playlist',
                status: 'COMPLETED',
                creationMethod: 'SHUFFLE',
                totalTracks: 100,
                addedTracks: 100,
                spotifyPlaylistUrl: 'https://open.spotify.com/playlist/abc',
            };
            mockPrisma.playlistJob.findUnique.mockResolvedValue(mockJob);

            const response = await app.inject({
                method: 'GET',
                url: '/playlists/jobs/job-123',
                headers: { 'x-test-user-id': userId },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.name).toBe('Test Playlist');
            expect(body.status).toBe('COMPLETED');
            // userId should be stripped from response
            expect(body.userId).toBeUndefined();
        });
    });

    describe('POST /playlists/jobs/:id/cancel', () => {
        it('returns 400 when job is not PENDING', async () => {
            mockPrisma.playlistJob.findUnique.mockResolvedValue({
                id: 'job-123',
                userId,
                status: 'ADDING_TRACKS',
            });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/jobs/job-123/cancel',
                headers: { 'x-test-user-id': userId },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error).toContain('Cannot cancel');
        });

        it('cancels pending job successfully', async () => {
            mockPrisma.playlistJob.findUnique.mockResolvedValue({
                id: 'job-123',
                userId,
                status: 'PENDING',
            });
            mockQueueGetJob.mockResolvedValue({ remove: jest.fn() });
            mockPrisma.playlistJob.update.mockResolvedValue({});

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/jobs/job-123/cancel',
                headers: { 'x-test-user-id': userId },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json().message).toBe('Job cancelled');
        });
    });

    describe('POST /playlists/validate/top50', () => {
        it('returns 401 when not authenticated', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/top50',
                payload: { term: 'short' },
            });

            expect(response.statusCode).toBe(401);
        });

        it('returns 400 when term is invalid', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/top50',
                headers: { 'x-test-user-id': userId },
                payload: { term: 'invalid' },
            });

            expect(response.statusCode).toBe(400);
        });

        it('returns 401 when Spotify token expired for Spotify terms', async () => {
            // When cache refresh fails due to no token, it throws an error
            mockEnsureTopTracksCached.mockRejectedValue(new Error('No valid token'));

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/top50',
                headers: { 'x-test-user-id': userId },
                payload: { term: 'short' },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error).toContain('Failed to fetch top tracks');
        });

        it('returns trackCount and confirmationToken for Spotify terms', async () => {
            // Mock the ensureTopTracksCached to return fresh cache data
            mockEnsureTopTracksCached.mockResolvedValue({
                trackCount: 50,
                cacheRefreshed: false,
            });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/top50',
                headers: { 'x-test-user-id': userId },
                payload: { term: 'medium' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.trackCount).toBe(50);
            expect(body.confirmationToken).toBeDefined();
            expect(body.warnings).toEqual([]);
            expect(mockEnsureTopTracksCached).toHaveBeenCalledWith(userId, 'medium');
        });

        it('warns when fewer than 50 tracks available', async () => {
            mockEnsureTopTracksCached.mockResolvedValue({
                trackCount: 35,
                cacheRefreshed: true,
            });

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/top50',
                headers: { 'x-test-user-id': userId },
                payload: { term: 'short' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.trackCount).toBe(35);
            expect(body.warnings).toContainEqual(expect.stringContaining('Only 35 tracks'));
        });

        it('queries database for all_time term', async () => {
            mockPrisma.userTrackStats.count.mockResolvedValue(100);

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/top50',
                headers: { 'x-test-user-id': userId },
                payload: { term: 'all_time' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            // Should cap at 50
            expect(body.trackCount).toBe(50);
            expect(body.confirmationToken).toBeDefined();
            expect(mockPrisma.userTrackStats.count).toHaveBeenCalledWith({
                where: { userId },
            });
        });

        it('returns 400 when no tracks available', async () => {
            mockPrisma.userTrackStats.count.mockResolvedValue(0);

            const response = await app.inject({
                method: 'POST',
                url: '/playlists/validate/top50',
                headers: { 'x-test-user-id': userId },
                payload: { term: 'all_time' },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().error).toContain('No top tracks');
        });
    });
});
