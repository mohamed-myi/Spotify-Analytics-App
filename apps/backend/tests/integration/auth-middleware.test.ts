import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '../../../../.env') });

import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { authMiddleware } from '../../src/middleware/auth';
import { prisma } from '../../src/lib/prisma';
import { createMockPrisma } from '../mocks/prisma.mock';

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
                session: 'invalid-user-id',
            },
        });

        expect(response.statusCode).toBe(401);
    });

    test('allows access with valid session cookie (user exists)', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: testUserId,
            isDemo: false
        });

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

    test('allows access with valid JWT Bearer token', async () => {
        const { generateAccessToken } = await import('../../src/lib/jwt.js');
        const token = generateAccessToken(testUserId, 'USER');

        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: testUserId,
            isDemo: false,
            role: 'USER',
        });

        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ userId: testUserId });
    });

    test('returns 401 for invalid JWT token', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: {
                authorization: 'Bearer invalid-token-here',
            },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'Invalid or expired token' });
    });

    test('returns 401 for expired JWT token', async () => {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.SESSION_SECRET || 'test-secret';
        const expiredToken = jwt.sign(
            { userId: testUserId, role: 'USER', type: 'access' },
            JWT_SECRET,
            { expiresIn: '0s' }
        );

        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: {
                authorization: `Bearer ${expiredToken}`,
            },
        });

        expect(response.statusCode).toBe(401);
    });

    test('JWT token takes priority over session cookie when both present', async () => {
        const { generateAccessToken } = await import('../../src/lib/jwt.js');
        const jwtUserId = 'jwt-user-123';
        const token = generateAccessToken(jwtUserId, 'ADMIN');

        const response = await app.inject({
            method: 'GET',
            url: '/protected',
            headers: {
                authorization: `Bearer ${token}`,
            },
            cookies: {
                session: 'different-user-456', // Should be ignored
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ userId: jwtUserId });
    });

    test('attaches userRole from JWT payload', async () => {
        const { generateAccessToken } = await import('../../src/lib/jwt.js');
        const token = generateAccessToken(testUserId, 'ADMIN');

        app.get('/role-test', async (request) => {
            return { role: request.userRole };
        });

        const response = await app.inject({
            method: 'GET',
            url: '/role-test',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ role: 'ADMIN' });
    });
});
