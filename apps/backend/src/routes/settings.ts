import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

const TIMEZONES = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    'Australia/Sydney', 'Pacific/Auckland'
];

export async function settingsRoutes(fastify: FastifyInstance) {
    // GET /me/settings - Get current user settings
    fastify.get('/me/settings', {
        schema: {
            description: 'Get current user settings',
            tags: ['Settings'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        isPublicProfile: { type: 'boolean' },
                        shareTopTracks: { type: 'boolean' },
                        shareTopArtists: { type: 'boolean' },
                        shareListeningTime: { type: 'boolean' },
                        emailNotifications: { type: 'boolean' },
                        timezone: { type: 'string' },
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const settings = await prisma.userSettings.findUnique({
            where: { userId },
            select: {
                isPublicProfile: true,
                shareTopTracks: true,
                shareTopArtists: true,
                shareListeningTime: true,
                emailNotifications: true,
                timezone: true,
            }
        });

        if (!settings) {
            // Create default settings if not exists
            const created = await prisma.userSettings.create({
                data: { userId },
                select: {
                    isPublicProfile: true,
                    shareTopTracks: true,
                    shareTopArtists: true,
                    shareListeningTime: true,
                    emailNotifications: true,
                    timezone: true,
                }
            });
            return created;
        }

        return settings;
    });

    // PATCH /me/settings - Update user settings
    fastify.patch('/me/settings', {
        schema: {
            description: 'Update user settings',
            tags: ['Settings'],
            body: {
                type: 'object',
                properties: {
                    isPublicProfile: { type: 'boolean' },
                    shareTopTracks: { type: 'boolean' },
                    shareTopArtists: { type: 'boolean' },
                    shareListeningTime: { type: 'boolean' },
                    emailNotifications: { type: 'boolean' },
                    timezone: { type: 'string' },
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        isPublicProfile: { type: 'boolean' },
                        shareTopTracks: { type: 'boolean' },
                        shareTopArtists: { type: 'boolean' },
                        shareListeningTime: { type: 'boolean' },
                        emailNotifications: { type: 'boolean' },
                        timezone: { type: 'string' },
                    }
                },
                400: { type: 'object', properties: { error: { type: 'string' } } },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const body = request.body as {
            isPublicProfile?: boolean;
            shareTopTracks?: boolean;
            shareTopArtists?: boolean;
            shareListeningTime?: boolean;
            emailNotifications?: boolean;
            timezone?: string;
        };

        // Validate timezone if provided
        if (body.timezone && !TIMEZONES.includes(body.timezone)) {
            return reply.status(400).send({ error: 'Invalid timezone' });
        }

        const updated = await prisma.userSettings.upsert({
            where: { userId },
            create: {
                userId,
                ...body,
            },
            update: body,
            select: {
                isPublicProfile: true,
                shareTopTracks: true,
                shareTopArtists: true,
                shareListeningTime: true,
                emailNotifications: true,
                timezone: true,
            }
        });

        return updated;
    });

    // GET /me/settings/timezones - Get available timezones
    fastify.get('/me/settings/timezones', {
        schema: {
            description: 'Get list of supported timezones',
            tags: ['Settings'],
            response: {
                200: {
                    type: 'array',
                    items: { type: 'string' }
                }
            }
        }
    }, async () => {
        return TIMEZONES;
    });
}
