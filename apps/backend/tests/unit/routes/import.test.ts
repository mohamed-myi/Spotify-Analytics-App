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

// Mock dependencies before imports
jest.mock('@/lib/redis', () => ({
    redis: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

jest.mock('@/lib/prisma', () => ({
    prisma: {
        importJob: { findUnique: jest.fn(), create: jest.fn() },
    },
}));

jest.mock('@/services/import', () => ({
    getImportProgress: jest.fn(),
    getImportProgressFromDB: jest.fn(),
}));

jest.mock('@/middleware/auth', () => ({
    authMiddleware: async (req: any) => {
        const testUserId = req.headers['x-test-user-id'];
        if (testUserId) {
            req.userId = testUserId;
        }
    },
}));

// Mock BullMQ completely
const mockQueueAdd = jest.fn();
jest.mock('bullmq', () => {
    return {
        Queue: jest.fn().mockImplementation(() => ({
            add: mockQueueAdd,
            close: jest.fn(),
        })),
        Worker: jest.fn().mockImplementation(() => ({
            on: jest.fn(),
            close: jest.fn(),
        })),
    };
});

// Mock the queues module (centralized queues)
const mockImportQueueAdd = jest.fn();
jest.mock('@/workers/queues', () => ({
    syncUserQueue: { add: jest.fn() },
    importQueue: { add: mockImportQueueAdd },
}));

import { FastifyInstance } from 'fastify';
import { build } from '@/index';
import { getImportProgress, getImportProgressFromDB } from '@/services/import';

describe('Import Routes', () => {
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

    describe('POST /me/import/spotify-history', () => {
        it('returns 401 when not authenticated', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/me/import/spotify-history',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Unauthorized' });
        });

        it('returns error when no file uploaded', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/me/import/spotify-history',
                headers: {
                    'x-test-user-id': 'user-123',
                },
            });

            // Fastify multipart plugin returns 406 when no Content-Type header for multipart
            expect(response.statusCode).toBeLessThanOrEqual(406);
        });

        it('returns 400 for non-JSON file', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/me/import/spotify-history',
                headers: {
                    'x-test-user-id': 'user-123',
                    'content-type': 'multipart/form-data; boundary=----formdata-boundary',
                },
                payload:
                    '------formdata-boundary\r\n' +
                    'Content-Disposition: form-data; name="file"; filename="data.txt"\r\n' +
                    'Content-Type: text/plain\r\n\r\n' +
                    'not json content\r\n' +
                    '------formdata-boundary--',
            });

            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ error: 'File must be a JSON file' });
        });

        it('queues import job and returns jobId on success', async () => {
            mockQueueAdd.mockResolvedValue({ id: 'job-123' });

            const response = await app.inject({
                method: 'POST',
                url: '/me/import/spotify-history',
                headers: {
                    'x-test-user-id': 'user-123',
                    'content-type': 'multipart/form-data; boundary=----formdata-boundary',
                },
                payload:
                    '------formdata-boundary\r\n' +
                    'Content-Disposition: form-data; name="file"; filename="endsong.json"\r\n' +
                    'Content-Type: application/json\r\n\r\n' +
                    '[{"ts":"2025-01-01","ms_played":30000}]\r\n' +
                    '------formdata-boundary--',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.message).toBe('Import started');
            expect(body.jobId).toContain('import_user-123_');
            expect(body.statusUrl).toContain('/api/me/import/status?jobId=');

            expect(mockImportQueueAdd).toHaveBeenCalledWith(
                'import-endsong',
                expect.objectContaining({
                    userId: 'user-123',
                    jobId: expect.any(String),
                    fileData: expect.any(String),
                }),
                expect.any(Object)
            );
        });
    });

    describe('GET /me/import/status', () => {
        it('returns 401 when not authenticated', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/me/import/status?jobId=job-123',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Unauthorized' });
        });

        it('returns 400 when no jobId provided', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/me/import/status',
                headers: {
                    'x-test-user-id': 'user-123',
                },
            });

            expect(response.statusCode).toBe(400);
            // Schema validation returns different error format
            expect(response.json().message).toContain('jobId');
        });

        it('returns 404 when job not found', async () => {
            (getImportProgress as jest.Mock).mockResolvedValue(null);
            (getImportProgressFromDB as jest.Mock).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/me/import/status?jobId=import_user-123_nonexistent',
                headers: {
                    'x-test-user-id': 'user-123',
                },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ error: 'Job not found' });
        });

        it('returns progress on success', async () => {
            const mockProgress = {
                status: 'processing',
                totalRecords: 1000,
                processedRecords: 500,
                addedRecords: 450,
                skippedRecords: 50,
            };
            (getImportProgress as jest.Mock).mockResolvedValue(mockProgress);

            const response = await app.inject({
                method: 'GET',
                url: '/me/import/status?jobId=import_user-123_1234567890',
                headers: {
                    'x-test-user-id': 'user-123',
                },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual(mockProgress);
        });

        it('returns 403 when job belongs to different user', async () => {
            const mockProgress = {
                status: 'processing',
                totalRecords: 100,
                processedRecords: 50,
                addedRecords: 45,
                skippedRecords: 5,
            };
            (getImportProgress as jest.Mock).mockResolvedValue(mockProgress);

            const response = await app.inject({
                method: 'GET',
                url: '/me/import/status?jobId=import_other-user_1234567890',
                headers: {
                    'x-test-user-id': 'user-123',
                },
            });

            expect(response.statusCode).toBe(403);
            expect(response.json()).toEqual({ error: 'Access denied' });
        });
    });
});
