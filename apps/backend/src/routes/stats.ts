import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { toJSON } from '../lib/serialization';

const CACHE_TTL = 300;

// JSON Schema for range parameter validation
const rangeSchema = {
    querystring: {
        type: 'object',
        properties: {
            range: {
                type: 'string',
                enum: ['4weeks', '6months', 'all', 'year'],
                default: '4weeks'
            }
        }
    }
};

// JSON Schema for history pagination
const historySchema = {
    querystring: {
        type: 'object',
        properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }
        }
    }
};

export async function statsRoutes(fastify: FastifyInstance) {

    // GET /me/stats/overview
    fastify.get('/me/stats/overview', async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const cacheKey = `stats:overview:${userId}`;
        const cached = await redis.get(cacheKey);

        if (cached) {
            return JSON.parse(cached);
        }

        const [trackStats, topArtist] = await Promise.all([
            prisma.userTrackStats.aggregate({
                where: { userId },
                _sum: { totalMs: true },
                _count: { trackId: true },
            }),
            prisma.userArtistStats.findFirst({
                where: { userId },
                orderBy: { playCount: 'desc' },
                include: { artist: true },
            }),
        ]);

        const data = {
            totalPlayTimeMs: trackStats._sum.totalMs || 0n,
            totalTracks: trackStats._count.trackId || 0,
            topArtist: topArtist ? topArtist.artist.name : null,
            topArtistImage: topArtist?.artist.imageUrl || null,
        };

        const response = toJSON(data);
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));

        return response;
    });

    // GET /me/stats/activity
    fastify.get('/me/stats/activity', async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const cacheKey = `stats:activity:${userId}`;
        const cached = await redis.get(cacheKey);

        if (cached) return JSON.parse(cached);

        const [hourly, daily] = await Promise.all([
            prisma.userHourStats.findMany({
                where: { userId },
                orderBy: { hour: 'asc' },
            }),
            prisma.userTimeBucketStats.findMany({
                where: { userId, bucketType: 'DAY' },
                orderBy: { bucketDate: 'desc' },
                take: 30, // Last 30 days
            }),
        ]);

        const response = toJSON({
            hourly: hourly.map(h => ({ hour: h.hour, playCount: h.playCount })),
            daily: daily.map(d => ({ date: d.bucketDate, playCount: d.playCount })),
        });

        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));
        return response;
    });

    // GET /me/stats/top/tracks
    // Uses Spotify's personalized Top Tracks from SpotifyTopTrack table
    fastify.get<{ Querystring: { range?: string } }>('/me/stats/top/tracks', { schema: rangeSchema }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const range = request.query.range || '4weeks';

        // Map frontend ranges to Spotify's time_range terms
        const termMap: Record<string, string> = {
            '4weeks': 'short_term',      // ~4 weeks
            '6months': 'medium_term',    // ~6 months  
            'all': 'long_term',          // Several years
            'year': 'long_term',         // Fallback
        };
        const term = termMap[range] || 'short_term';

        const cacheKey = `stats:tracks:${userId}:${term}`;
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);

        // Query Spotify's actual Top Tracks stored by top-stats-worker
        const topTracks = await prisma.spotifyTopTrack.findMany({
            where: { userId, term },
            orderBy: { rank: 'asc' },
            include: {
                track: {
                    include: {
                        artists: { include: { artist: true } },
                        album: true
                    }
                }
            },
        });

        const data = topTracks.map((t: any) => ({
            ...t.track,
            rank: t.rank,
        }));

        const serialized = toJSON(data);
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(serialized));

        return serialized;
    });

    // GET /me/stats/top/artists
    // Uses Spotify's personalized Top Artists
    fastify.get<{ Querystring: { range?: string } }>('/me/stats/top/artists', { schema: rangeSchema }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const range = request.query.range || '4weeks';

        // Map frontend ranges to Spotify's time_range terms
        const termMap: Record<string, string> = {
            '4weeks': 'short_term',      // 4 weeks
            '6months': 'medium_term',    // 6 months  
            'all': 'long_term',          // 1 year
            'year': 'long_term',         // Fallback
        };
        const term = termMap[range] || 'short_term';

        const cacheKey = `stats:artists:${userId}:${term}`;
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);

        // Query Spotify's actual Top Artists
        const topArtists = await prisma.spotifyTopArtist.findMany({
            where: { userId, term },
            orderBy: { rank: 'asc' },
            include: { artist: true },
        });

        const data = topArtists.map((a: { artist: any; rank: number }) => ({
            ...a.artist,
            rank: a.rank,
        }));

        const serialized = toJSON(data);
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(serialized));

        return serialized;
    });

    // GET /me/history
    fastify.get<{ Querystring: { page?: number; limit?: number } }>('/me/history', { schema: historySchema }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 50;
        const skip = (page - 1) * limit;

        const [events, total] = await Promise.all([
            prisma.listeningEvent.findMany({
                where: { userId },
                orderBy: { playedAt: 'desc' },
                take: limit,
                skip,
                include: { track: { include: { artists: { include: { artist: true } }, album: true } } },
            }),
            prisma.listeningEvent.count({ where: { userId } }),
        ]);

        return toJSON({ events, total, page, limit });
    });
}
