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

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
};

export async function authRoutes(fastify: FastifyInstance) {
    // GET /auth/login - Redirect to Spotify auth
    fastify.get('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = generateState();

        // Store PKCE verifier and state in cookies for callback validation
        reply.setCookie('pkce_verifier', codeVerifier, {
            ...COOKIE_OPTIONS,
            maxAge: 600,
        });
        reply.setCookie('oauth_state', state, {
            ...COOKIE_OPTIONS,
            maxAge: 600,
        });

        const authUrl = buildAuthUrl(codeChallenge, state);
        return reply.redirect(authUrl);
    });

    // GET /auth/callback - Handle Spotify OAuth callback
    fastify.get('/auth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
        const { code, state, error } = request.query as {
            code?: string;
            state?: string;
            error?: string;
        };

        // Handle user rejection
        if (error) {
            fastify.log.warn(`OAuth error: ${error}`);
            return reply.redirect(`${FRONTEND_URL}?error=access_denied`);
        }

        // Validate state
        const storedState = (request.cookies as Record<string, string>).oauth_state;
        if (!state || state !== storedState) {
            fastify.log.warn('State mismatch in OAuth callback');
            return reply.redirect(`${FRONTEND_URL}?error=invalid_state`);
        }

        // Get PKCE verifier
        const codeVerifier = (request.cookies as Record<string, string>).pkce_verifier;
        if (!codeVerifier) {
            fastify.log.warn('Missing PKCE verifier');
            return reply.redirect(`${FRONTEND_URL}?error=missing_verifier`);
        }

        if (!code) {
            return reply.redirect(`${FRONTEND_URL}?error=missing_code`);
        }

        try {
            // Exchange code for tokens
            const tokens = await exchangeCodeForTokens(code, codeVerifier);

            // Get user profile
            const profile = await getUserProfile(tokens.access_token);

            // Encrypt refresh token
            const encryptedRefreshToken = encrypt(tokens.refresh_token!);

            // Create or update user in database
            const user = await prisma.user.upsert({
                where: { spotifyId: profile.id },
                create: {
                    spotifyId: profile.id,
                    displayName: profile.display_name,
                    email: profile.email,
                    imageUrl: profile.images?.[0]?.url || null,
                    country: profile.country,
                    auth: {
                        create: {
                            refreshToken: encryptedRefreshToken,
                            scopes: tokens.scope,
                        },
                    },
                    settings: {
                        create: {}, // Use defaults
                    },
                },
                update: {
                    displayName: profile.display_name,
                    email: profile.email,
                    imageUrl: profile.images?.[0]?.url || null,
                    country: profile.country,
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

            // Ensure user settings exist 
            await prisma.userSettings.upsert({
                where: { userId: user.id },
                create: { userId: user.id },
                update: {},
            });

            // Set session cookie
            reply.setCookie('session', user.id, {
                ...COOKIE_OPTIONS,
                maxAge: 60 * 60 * 24 * 30, // 30 days
            });

            // Set auth status cookie for frontend
            reply.setCookie('auth_status', 'authenticated', {
                ...COOKIE_OPTIONS,
                httpOnly: false,
                maxAge: 60 * 60 * 24 * 30,
            });

            // Clear PKCE cookies
            reply.clearCookie('pkce_verifier', { path: '/' });
            reply.clearCookie('oauth_state', { path: '/' });

            // todo - Trigger first poll of recent tracks 
            fastify.log.info(`User ${user.id} logged in, first poll pending Phase 3`);

            return reply.redirect(FRONTEND_URL);
        } catch (err) {
            fastify.log.error(err, 'OAuth callback error');
            return reply.redirect(`${FRONTEND_URL}?error=auth_failed`);
        }
    });

    // POST /auth/logout - Clear session
    fastify.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
        reply.clearCookie('session', { path: '/' });
        reply.clearCookie('auth_status', { path: '/' });
        return { success: true };
    });

    // GET /auth/me - Get current user
    fastify.get('/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
        const sessionUserId = (request.cookies as Record<string, string>).session;

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
            },
        });

        if (!user) {
            reply.clearCookie('session', { path: '/' });
            return reply.status(401).send({ error: 'User not found' });
        }

        return user;
    });
}
