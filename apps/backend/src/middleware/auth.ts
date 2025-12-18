import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';

// Routes that don't require session-based authentication
const PUBLIC_ROUTES = ['/health', '/auth/login', '/auth/callback', '/auth/logout'];

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

    const sessionUserId = (request.cookies as Record<string, string>).session;

    if (!sessionUserId) {
        reply.status(401).send({ error: 'Not authenticated' });
        return;
    }

    // Validate user exists
    const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { id: true },
    });

    if (!user) {
        reply.clearCookie('session', { path: '/' });
        reply.clearCookie('auth_status', { path: '/' });
        reply.status(401).send({ error: 'User not found' });
        return;
    }

    // Sliding session expiration - refresh cookie on each request
    reply.setCookie('session', sessionUserId, COOKIE_OPTIONS);
    reply.setCookie('auth_status', 'authenticated', {
        ...COOKIE_OPTIONS,
        httpOnly: false,
    });

    // Attach user ID to request for downstream handlers
    request.userId = sessionUserId;
}
