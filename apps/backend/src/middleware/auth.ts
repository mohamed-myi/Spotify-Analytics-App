import { FastifyRequest, FastifyReply } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Routes that don't require session-based authentication
const PUBLIC_ROUTES = ['/health', '/health/detailed', '/auth/login', '/auth/callback', '/auth/logout'];

const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
};

// Extend FastifyRequest to include user
declare module 'fastify' {
    interface FastifyRequest {
        userId?: string;
        userRole?: Role;
        isDemo?: boolean;
    }
}

export async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    // Skip auth for public routes and cron routes
    const path = request.url.split('?')[0]; // Remove query params
    if (PUBLIC_ROUTES.some((route) => path === route || path.startsWith('/auth/') || path.startsWith('/cron/'))) {
        return;
    }

    // STRATEGY 1: Check for JWT in Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { verifyToken } = await import('../lib/jwt.js');
        const payload = verifyToken(token);

        if (payload && payload.type === 'access') {
            // JWT auth successful - attach user info to request
            request.userId = payload.userId;
            request.userRole = payload.role;
            // Note: isDemo is inferred from role for JWT users
            request.isDemo = payload.role === 'DEMO';
            return;
        }

        // JWT invalid - reject immediately (don't fall back to cookies for explicit Bearer auth)
        reply.status(401).send({ error: 'Invalid or expired token' });
        return;
    }

    // STRATEGY 2: Check for session cookie (existing behavior)
    const sessionUserId = (request.cookies as Record<string, string>).session;

    if (!sessionUserId) {
        reply.status(401).send({ error: 'Not authenticated' });
        return;
    }

    // Validate user exists
    const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { id: true, isDemo: true, role: true },
    });

    if (!user) {
        reply.clearCookie('session', { path: '/' });
        reply.clearCookie('auth_status', { path: '/' });
        reply.status(401).send({ error: 'User not found' });
        return;
    }

    // Sliding session expiration; refresh cookie on each request (skip for demo users)
    // Demo users have session-only cookies (no maxAge) that clear on browser close
    if (!user.isDemo) {
        reply.setCookie('session', sessionUserId, COOKIE_OPTIONS);
        reply.setCookie('auth_status', 'authenticated', {
            ...COOKIE_OPTIONS,
            httpOnly: false,
        });
    }

    // Attach user ID, role, and demo status to request for downstream handlers
    request.userId = sessionUserId;
    request.userRole = user.role;
    request.isDemo = user.isDemo;
}
