import { FastifyRequest, FastifyReply } from 'fastify';
import { Permission, hasPermission } from '../lib/rbac';
import { prisma } from '../lib/prisma';

/**
 * Middleware that requires a specific permission to access a route.
 * Returns 403 if user lacks the required permission.
 */
export function requirePermission(permission: Permission) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.userId) {
            return reply.status(401).send({ error: 'Not authenticated' });
        }

        const user = await prisma.user.findUnique({
            where: { id: request.userId },
            select: { role: true },
        });

        if (!user || !hasPermission(user.role, permission)) {
            return reply.status(403).send({
                error: 'Insufficient permissions',
                required: permission,
                userRole: user?.role,
            });
        }
    };
}
