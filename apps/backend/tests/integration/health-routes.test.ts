const mockCheckDatabaseHealth = jest.fn();
const mockPingRedis = jest.fn();
const mockIsSyncWorkerRunning = jest.fn();
const mockIsMetadataWorkerRunning = jest.fn();
const mockIsTopStatsWorkerRunning = jest.fn();
const mockIsPlaylistWorkerRunning = jest.fn();

jest.mock('../../src/lib/db', () => ({
    checkDatabaseHealth: mockCheckDatabaseHealth,
}));

jest.mock('../../src/lib/redis', () => ({
    pingRedis: mockPingRedis,
    redis: { quit: jest.fn() },
    closeRedis: jest.fn(),
}));

jest.mock('../../src/workers/worker-status', () => ({
    isSyncWorkerRunning: mockIsSyncWorkerRunning,
    isMetadataWorkerRunning: mockIsMetadataWorkerRunning,
    isTopStatsWorkerRunning: mockIsTopStatsWorkerRunning,
    isPlaylistWorkerRunning: mockIsPlaylistWorkerRunning,
}));

import Fastify, { FastifyInstance } from 'fastify';
import { healthRoutes } from '../../src/routes/health';

describe('Health Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        await app.register(healthRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /health', () => {
        it('returns ok status', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/health',
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: 'ok' });
        });
    });

    describe('GET /health/detailed', () => {
        it('returns healthy when all checks pass', async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ ok: true });
            mockPingRedis.mockResolvedValue(true);
            mockIsSyncWorkerRunning.mockReturnValue(true);
            mockIsMetadataWorkerRunning.mockReturnValue(true);
            mockIsTopStatsWorkerRunning.mockReturnValue(true);
            mockIsPlaylistWorkerRunning.mockReturnValue(true);

            const response = await app.inject({
                method: 'GET',
                url: '/health/detailed',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.status).toBe('healthy');
            expect(body.checks.database.status).toBe('up');
            expect(body.checks.redis.status).toBe('up');
            expect(body.checks.workers.sync).toBe('running');
            expect(body.checks.workers.playlist).toBe('running');
        });

        it('returns unhealthy when database is down', async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ ok: false });
            mockPingRedis.mockResolvedValue(true);
            mockIsSyncWorkerRunning.mockReturnValue(true);
            mockIsMetadataWorkerRunning.mockReturnValue(true);
            mockIsTopStatsWorkerRunning.mockReturnValue(true);
            mockIsPlaylistWorkerRunning.mockReturnValue(true);

            const response = await app.inject({
                method: 'GET',
                url: '/health/detailed',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.status).toBe('unhealthy');
            expect(body.checks.database.status).toBe('down');
        });

        it('returns unhealthy when Redis is unreachable', async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ ok: true });
            mockPingRedis.mockResolvedValue(false);
            mockIsSyncWorkerRunning.mockReturnValue(true);
            mockIsMetadataWorkerRunning.mockReturnValue(true);
            mockIsTopStatsWorkerRunning.mockReturnValue(true);
            mockIsPlaylistWorkerRunning.mockReturnValue(true);

            const response = await app.inject({
                method: 'GET',
                url: '/health/detailed',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.status).toBe('unhealthy');
            expect(body.checks.redis.status).toBe('down');
        });

        it('returns degraded when workers are stopped', async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ ok: true });
            mockPingRedis.mockResolvedValue(true);
            mockIsSyncWorkerRunning.mockReturnValue(true);
            mockIsMetadataWorkerRunning.mockReturnValue(false);
            mockIsTopStatsWorkerRunning.mockReturnValue(true);
            mockIsPlaylistWorkerRunning.mockReturnValue(true);

            const response = await app.inject({
                method: 'GET',
                url: '/health/detailed',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.status).toBe('degraded');
            expect(body.checks.workers.metadata).toBe('stopped');
        });

        it('includes latency measurements', async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ ok: true });
            mockPingRedis.mockResolvedValue(true);
            mockIsSyncWorkerRunning.mockReturnValue(true);
            mockIsMetadataWorkerRunning.mockReturnValue(true);
            mockIsTopStatsWorkerRunning.mockReturnValue(true);

            const response = await app.inject({
                method: 'GET',
                url: '/health/detailed',
            });

            const body = response.json();
            expect(typeof body.checks.database.latencyMs).toBe('number');
            expect(typeof body.checks.redis.latencyMs).toBe('number');
        });

        it('includes timestamp in ISO format', async () => {
            mockCheckDatabaseHealth.mockResolvedValue({ ok: true });
            mockPingRedis.mockResolvedValue(true);
            mockIsSyncWorkerRunning.mockReturnValue(true);
            mockIsMetadataWorkerRunning.mockReturnValue(true);
            mockIsTopStatsWorkerRunning.mockReturnValue(true);

            const response = await app.inject({
                method: 'GET',
                url: '/health/detailed',
            });

            const body = response.json();
            expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });
});
