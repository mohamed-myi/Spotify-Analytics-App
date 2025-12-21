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
        setex: jest.fn(),
    },
}));

jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: { upsert: jest.fn(), findUnique: jest.fn() },
        userSettings: { upsert: jest.fn() },
        importJob: { findFirst: jest.fn() },
    },
}));

jest.mock('@/lib/encryption', () => ({
    encrypt: jest.fn((val: string) => `encrypted_${val}`),
    decrypt: jest.fn((val: string) => val.replace('encrypted_', '')),
}));

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn(),
    })),
    Worker: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn(),
    })),
}));

jest.mock('@/lib/spotify', () => ({
    generateCodeVerifier: jest.fn(() => 'test-verifier'),
    generateCodeChallenge: jest.fn(() => 'test-challenge'),
    generateState: jest.fn(() => 'test-state'),
    buildAuthUrl: jest.fn(() => 'https://accounts.spotify.com/authorize?mock=true'),
    exchangeCodeForTokens: jest.fn(),
    getUserProfile: jest.fn(),
}));

jest.mock('@/workers/queues', () => ({
    syncUserQueue: { add: jest.fn() },
}));

import { FastifyInstance } from 'fastify';
import { build } from '@/index';
import { prisma } from '@/lib/prisma';
import { exchangeCodeForTokens, getUserProfile } from '@/lib/spotify';
import { syncUserQueue } from '@/workers/queues';

describe('Auth Routes', () => {
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

    describe('GET /auth/login', () => {
        it('sets PKCE cookies and redirects to Spotify', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/login',
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain('accounts.spotify.com');

            const cookies = response.cookies;
            expect(cookies.find(c => c.name === 'pkce_verifier')).toBeDefined();
            expect(cookies.find(c => c.name === 'oauth_state')).toBeDefined();
        });
    });

    describe('GET /auth/callback', () => {
        it('redirects with error when error param present', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/callback?error=access_denied',
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain('error=access_denied');
        });

        it('redirects with error on state mismatch', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/callback?code=test-code&state=wrong-state',
                cookies: {
                    oauth_state: 'correct-state',
                    pkce_verifier: 'test-verifier',
                },
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain('error=invalid_state');
        });

        it('redirects with error when missing PKCE verifier', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/callback?code=test-code&state=test-state',
                cookies: {
                    oauth_state: 'test-state',
                },
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain('error=missing_verifier');
        });

        it('redirects with error when missing code', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/callback?state=test-state',
                cookies: {
                    oauth_state: 'test-state',
                    pkce_verifier: 'test-verifier',
                },
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain('error=missing_code');
        });

        it('creates new user on successful auth', async () => {
            (exchangeCodeForTokens as jest.Mock).mockResolvedValue({
                access_token: 'access-token',
                refresh_token: 'refresh-token',
                scope: 'user-read-recently-played',
            });
            (getUserProfile as jest.Mock).mockResolvedValue({
                id: 'spotify-user-123',
                display_name: 'Test User',
                email: 'test@example.com',
                country: 'US',
                images: [{ url: 'https://example.com/avatar.jpg' }],
            });
            (prisma.user.upsert as jest.Mock).mockResolvedValue({
                id: 'user-uuid-123',
                spotifyId: 'spotify-user-123',
            });
            (prisma.userSettings.upsert as jest.Mock).mockResolvedValue({});
            (syncUserQueue.add as jest.Mock).mockResolvedValue({});

            const response = await app.inject({
                method: 'GET',
                url: '/auth/callback?code=valid-code&state=test-state',
                cookies: {
                    oauth_state: 'test-state',
                    pkce_verifier: 'test-verifier',
                },
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).not.toContain('error=');

            // Verify user was upserted
            expect(prisma.user.upsert).toHaveBeenCalled();

            // Verify sync was queued
            expect(syncUserQueue.add).toHaveBeenCalled();

            // Verify session cookie was set
            const sessionCookie = response.cookies.find(c => c.name === 'session');
            expect(sessionCookie).toBeDefined();
        });

        it('handles token exchange failure', async () => {
            (exchangeCodeForTokens as jest.Mock).mockRejectedValue(
                new Error('Token exchange failed')
            );

            const response = await app.inject({
                method: 'GET',
                url: '/auth/callback?code=bad-code&state=test-state',
                cookies: {
                    oauth_state: 'test-state',
                    pkce_verifier: 'test-verifier',
                },
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain('error=auth_failed');
        });
    });

    describe('POST /auth/logout', () => {
        it('clears session cookies', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/auth/logout',
                cookies: {
                    session: 'user-123',
                    auth_status: 'authenticated',
                },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ success: true });

            // Verify cookies are cleared
            const sessionCookie = response.cookies.find(c => c.name === 'session');
            expect(sessionCookie?.value).toBe('');
        });
    });

    describe('GET /auth/me', () => {
        it('returns 401 when no session cookie', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Not authenticated' });
        });

        it('returns user data when authenticated', async () => {
            const mockUser = {
                id: 'user-123',
                spotifyId: 'spotify-123',
                displayName: 'Test User',
                email: 'test@example.com',
                imageUrl: 'https://example.com/avatar.jpg',
                country: 'US',
                createdAt: new Date('2025-01-01'),
            };
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
                cookies: {
                    session: 'user-123',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.id).toBe('user-123');
            expect(body.displayName).toBe('Test User');
        });

        it('clears cookie and returns 401 when user not found', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
                cookies: {
                    session: 'deleted-user',
                },
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'User not found' });
        });
    });
});
