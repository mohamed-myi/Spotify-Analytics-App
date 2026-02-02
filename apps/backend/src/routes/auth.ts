import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { encrypt, decrypt } from '../lib/encryption';
import {
    generateCodeVerifier,
    generateCodeChallenge,
    generateState,
    buildAuthUrl,
    exchangeCodeForTokens,
    getUserProfile,
} from '../lib/spotify';
import { syncUserQueue } from '../workers/queues';
import { topStatsQueue } from '../workers/top-stats-queue';
import { cacheAccessToken } from '../lib/token-manager';
import { AUTH_RATE_LIMIT } from '../middleware/rate-limit';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../lib/jwt';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const DEMO_USER_ID = 'demo_user_fixed_id';
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
    path: '/',
};

export async function authRoutes(fastify: FastifyInstance) {
    fastify.get('/auth/login', {
        config: { rateLimit: AUTH_RATE_LIMIT },
        schema: {
            description: 'Initiate Spotify OAuth login flow',
            tags: ['Auth'],
            response: {
                302: { description: 'Redirects to Spotify authorization page' }
            }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = generateState();

        reply.setCookie('pkce_verifier', codeVerifier, {
            ...COOKIE_OPTIONS,
            maxAge: 600,
        });
        reply.setCookie('oauth_state', state, {
            ...COOKIE_OPTIONS,
            maxAge: 600,
        });

        const authUrl = buildAuthUrl(codeChallenge, state, true);
        return reply.redirect(authUrl);
    });

    fastify.get('/auth/callback', {
        config: { rateLimit: AUTH_RATE_LIMIT },
        schema: {
            description: 'Handle Spotify OAuth callback',
            tags: ['Auth'],
            querystring: {
                type: 'object',
                properties: {
                    code: { type: 'string' },
                    state: { type: 'string' },
                    error: { type: 'string' }
                }
            },
            response: {
                302: { description: 'Redirects to frontend application' }
            }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { code, state, error } = request.query as {
            code?: string;
            state?: string;
            error?: string;
        };

        if (error) {
            fastify.log.warn(`OAuth error: ${error} `);
            return reply.redirect(`${FRONTEND_URL}?error=access_denied`);
        }

        const storedState = (request.cookies as Record<string, string>).oauth_state;

        if (!state || state !== storedState) {
            fastify.log.warn(`State mismatch: received '${state}' vs stored '${storedState}'`);
            return reply.redirect(`${FRONTEND_URL}?error=invalid_state`);
        }

        const codeVerifier = (request.cookies as Record<string, string>).pkce_verifier;
        if (!codeVerifier) {
            fastify.log.warn('Missing PKCE verifier');
            return reply.redirect(`${FRONTEND_URL}?error=missing_verifier`);
        }

        if (!code) {
            return reply.redirect(`${FRONTEND_URL}?error=missing_code`);
        }

        try {
            const tokens = await exchangeCodeForTokens(code, codeVerifier);

            const profile = await getUserProfile(tokens.access_token);

            const encryptedRefreshToken = encrypt(tokens.refresh_token!);

            const user = await prisma.user.upsert({
                where: { spotifyId: profile.id },
                create: {
                    spotifyId: profile.id,
                    displayName: profile.display_name,
                    email: profile.email,
                    imageUrl: profile.images?.[0]?.url || null,
                    country: profile.country,
                    lastLoginAt: new Date(),
                    auth: {
                        create: {
                            refreshToken: encryptedRefreshToken,
                            scopes: tokens.scope,
                            lastRefreshAt: new Date(),
                        },
                    },
                    settings: {
                        create: {},
                    },
                },
                update: {
                    displayName: profile.display_name,
                    email: profile.email,
                    imageUrl: profile.images?.[0]?.url || null,
                    country: profile.country,
                    lastLoginAt: new Date(),
                    auth: {
                        upsert: {
                            create: {
                                refreshToken: encryptedRefreshToken,
                                scopes: tokens.scope,
                            },
                            update: {
                                refreshToken: encryptedRefreshToken,
                                scopes: tokens.scope,
                                lastRefreshAt: new Date(),
                                isValid: true,
                            },
                        },
                    },
                },
            });

            await prisma.userSettings.upsert({
                where: { userId: user.id },
                create: { userId: user.id },
                update: {},
            });

            // Set session cookies for traditional web app auth
            reply.setCookie('session', user.id, {
                ...COOKIE_OPTIONS,
                maxAge: 60 * 60 * 24 * 30,
            });

            reply.setCookie('auth_status', 'authenticated', {
                ...COOKIE_OPTIONS,
                httpOnly: false,
                maxAge: 60 * 60 * 24 * 30,
            });

            reply.clearCookie('pkce_verifier', { path: '/' });
            reply.clearCookie('oauth_state', { path: '/' });

            await cacheAccessToken(user.id, {
                accessToken: tokens.access_token,
                expiresIn: tokens.expires_in,
            });

            // Generate JWT tokens for API clients            // Generate JWT tokens
            const accessToken = generateAccessToken(user.id, user.role);
            const refreshToken = generateRefreshToken(user.id, user.role);

            fastify.log.info(`User ${user.id} logged in, triggering initial sync`);

            // Trigger sync and top stats refresh in parallel
            await Promise.all([
                syncUserQueue.add(`sync - ${user.id} `, { userId: user.id }, { delay: 5000 }),
                topStatsQueue.add(
                    `login - ${user.id} `,
                    { userId: user.id, priority: 'high' },
                    { priority: 1, jobId: `login - ${user.id} ` }
                ),
            ]);

            // Check if this is a programmatic auth (Accept: application/json header)
            // If so, return JSON with tokens instead of redirecting
            const acceptHeader = request.headers.accept;
            if (acceptHeader?.includes('application/json')) {
                return reply.send({
                    user: {
                        id: user.id,
                        displayName: user.displayName,
                        email: user.email,
                        imageUrl: user.imageUrl,
                        role: user.role,
                    },
                    tokens: {
                        accessToken: accessToken,
                        refreshToken: refreshToken,
                        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
                    },
                });
            }

            // Default: redirect to dashboard (traditional web app flow)
            return reply.redirect(`${FRONTEND_URL}/dashboard`);
        } catch (err) {
            fastify.log.error(err, 'OAuth callback error');
            return reply.redirect(`${FRONTEND_URL}?error=auth_failed`);
        }
    });

    fastify.post('/auth/logout', {
        schema: {
            description: 'Logout current user',
            tags: ['Auth'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' }
                    }
                }
            }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        reply.clearCookie('session', { ...COOKIE_OPTIONS, maxAge: 0 });
        reply.clearCookie('auth_status', { ...COOKIE_OPTIONS, httpOnly: false, maxAge: 0 });
        return { success: true };
    });

    // JWT token refresh endpoint
    fastify.post('/auth/refresh', {
        schema: {
            description: 'Refresh JWT access token using refresh token',
            tags: ['Auth'],
            body: {
                type: 'object',
                required: ['refreshToken'],
                properties: {
                    refreshToken: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        accessToken: { type: 'string' },
                        refreshToken: { type: 'string' },
                        expiresIn: { type: 'string' }
                    }
                },
                401: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' }
                    }
                }
            }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { refreshToken: token } = request.body as { refreshToken: string };

        if (!token) {
            return reply.status(400).send({ error: 'Refresh token required' });
        }

        // Verify the refresh token
        const payload = verifyToken(token);

        if (!payload || payload.type !== 'refresh') {
            return reply.status(401).send({ error: 'Invalid refresh token' });
        }

        // Verify user still exists and get current role
        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: { id: true, role: true },
        });

        if (!user) {
            return reply.status(401).send({ error: 'User not found' });
        }

        // Generate new tokens with current role (in case it changed)
        const newAccessToken = generateAccessToken(user.id, user.role);
        const newRefreshToken = generateRefreshToken(user.id, user.role);

        return reply.send({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        });
    });

    // Demo mode session - no OAuth required
    fastify.get('/auth/demo', {
        config: { rateLimit: AUTH_RATE_LIMIT },
        schema: {
            description: 'Create demo session without Spotify authentication',
            tags: ['Auth'],
            response: {
                302: { description: 'Redirects to dashboard with demo session' },
                503: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' },
                        message: { type: 'string' }
                    }
                }
            }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        // Verify demo user exists
        const demoUser = await prisma.user.findFirst({
            where: { id: DEMO_USER_ID, isDemo: true }
        });

        if (!demoUser) {
            return reply.status(503).send({
                error: 'Demo mode unavailable',
                message: 'Demo data has not been configured'
            });
        }

        // Set session cookies (session-only for demo, no maxAge)
        reply.setCookie('session', DEMO_USER_ID, {
            ...COOKIE_OPTIONS,
            // No maxAge means session cookie (clears on browser close)
        });
        reply.setCookie('auth_status', 'authenticated', {
            ...COOKIE_OPTIONS,
            httpOnly: false,
            // No maxAge for demo
        });

        return reply.redirect(`${FRONTEND_URL}/dashboard`);
    });

    fastify.get('/auth/me', {
        schema: {
            description: 'Get current authenticated user profile',
            tags: ['Auth'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        spotifyId: { type: 'string' },
                        displayName: { type: 'string' },
                        email: { type: 'string' },
                        imageUrl: { type: 'string', nullable: true },
                        country: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                        hasImportedHistory: { type: 'boolean' }
                    }
                },
                401: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' }
                    }
                }
            }
        }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const cookies = request.cookies as Record<string, string>;
        const sessionUserId = cookies.session;

        if (!sessionUserId) {
            return reply.status(401).send({ error: 'Not authenticated' });
        }

        const user = await prisma.user.findUnique({
            where: { id: sessionUserId },
            select: {
                id: true,
                spotifyId: true,
                displayName: true,
                email: true,
                imageUrl: true,
                country: true,
                createdAt: true,
                isDemo: true,
            },
        });

        if (!user) {
            reply.clearCookie('session', { path: '/' });
            return reply.status(401).send({ error: 'User not found' });
        }

        const hasImportedHistory = await prisma.importJob.findFirst({
            where: { userId: user.id, status: 'COMPLETED' },
            select: { id: true }
        }) !== null;

        return { ...user, hasImportedHistory };
    });
}
