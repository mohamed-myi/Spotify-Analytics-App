import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '../../../../.env') });

import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { authMiddleware } from '../../src/middleware/auth';
import { prisma } from '../../src/lib/prisma';

describe('auth middleware', () => {
    let app: FastifyInstance;
    let testUserId: string;

    beforeAll(async () => {
        // Create test user
        const user = await prisma.user.create({
            data: {
                spotifyId: `test-middleware-${Date.now()}`,
                displayName: 'Middleware Test User',
            },
        });
        testUserId = user.id;

        app = Fastify();
        await app.register(cookie);
        app.addHook('preHandler', authMiddleware);

        // Public route (added before ready)
        app.get('/health', async () => ({ status: 'ok' }));

        // Protected test route
        app.get('/protected', async (request, reply) => {
            return { userId: request.userId };
        });

        await app.ready();
    });

    afterAll(async () => {
        await prisma.user.delete({ where: { id: testUserId } });
        await app.close();
    });

    test('allows access to /health without auth', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        expect(response.statusCode).toBe(200);
    });

    test('returns 401 for protected route without session cookie', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/protected',
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'Not authenticated' });
    });

    test('returns 401 for invalid session cookie', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: {
                session: 'invalid-user-id',
            },
        });

        expect(response.statusCode).toBe(401);
    });

    test('allows access with valid session cookie (user exists)', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: {
                session: testUserId,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ userId: testUserId });
    });
});
