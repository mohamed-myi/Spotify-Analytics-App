import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { toJSON } from '../lib/serialization';

export async function userRoutes(fastify: FastifyInstance) {

    // GET /users/:username
    // Currently using spotifyId as the username/identifier in the URL for simplicity
    fastify.get<{ Params: { username: string } }>('/users/:username', async (request, reply) => {
        const { username } = request.params; // username here is spotifyId

        const user = await prisma.user.findUnique({
            where: { spotifyId: username },
            select: {
                spotifyId: true,
                displayName: true,
                imageUrl: true,
                settings: { select: { isPublicProfile: true } },
                createdAt: true,
            }
        });

        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        if (!user.settings?.isPublicProfile) {
            return reply.status(403).send({ error: 'This profile is private' });
        }

        return toJSON(user);
    });

    // GET /users/:username/top
    fastify.get<{ Params: { username: string } }>('/users/:username/top', async (request, reply) => {
        const { username } = request.params;

        const user = await prisma.user.findUnique({
            where: { spotifyId: username },
            include: { settings: true }
        });

        if (!user) {
            return reply.status(404).send({ error: 'User not found' });
        }

        if (!user.settings?.isPublicProfile) {
            return reply.status(403).send({ error: 'This profile is private' });
        }

        const [topTracks, topArtists] = await Promise.all([
            prisma.userTrackStats.findMany({
                where: { userId: user.id },
                orderBy: { playCount: 'desc' },
                take: 10,
                include: { track: { include: { artists: { include: { artist: true } }, album: true } } },
            }),
            prisma.userArtistStats.findMany({
                where: { userId: user.id },
                orderBy: { playCount: 'desc' },
                take: 10,
                include: { artist: true },
            }),
        ]);

        // Transform for cleaner public API response
        return toJSON({
            tracks: topTracks.map(t => ({
                ...t.track,
                playCount: t.playCount
            })),
            artists: topArtists.map(a => ({
                ...a.artist,
                playCount: a.playCount
            }))
        });
    });
}
