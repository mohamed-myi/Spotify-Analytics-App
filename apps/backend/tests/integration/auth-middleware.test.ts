import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '../../../../.env') });

import Fastify, { FastifyInstance } from 'fastify';
import cookie, { Signer } from '@fastify/cookie';
import { authMiddleware } from '../../src/middleware/auth';
import { prisma } from '../../src/lib/prisma';
import { createMockPrisma } from '../mocks/prisma.mock';

const TEST_SECRET = 'test_session_secret_at_least_32_chars_long';
const signer = new Signer(TEST_SECRET);

jest.mock('../../src/lib/prisma', () => {
    const { createMockPrisma } = jest.requireActual('../mocks/prisma.mock');
    return {
        prisma: createMockPrisma(),
    };
});

describe('auth middleware', () => {
    let app: FastifyInstance;
    let testUserId: string;

    beforeAll(async () => {
        testUserId = 'test-mock-user-id';

        app = Fastify();
        await app.register(cookie, { secret: TEST_SECRET });
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
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: {
                session: signer.sign('invalid-user-id'),
            },
        });

        expect(response.statusCode).toBe(401);
    });

    test('returns 401 for unsigned/tampered session cookie', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: {
                session: 'raw-unsigned-value',
            },
        });

        expect(response.statusCode).toBe(401);
    });

    test('allows access with valid session cookie (user exists)', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: testUserId,
            isDemo: false,
            role: 'USER',
        });

        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            cookies: {
                session: signer.sign(testUserId),
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ userId: testUserId });
    });

});
