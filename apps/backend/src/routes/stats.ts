import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { redis, getOrSet } from '../lib/redis';
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
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }
        }
    }
};

export async function statsRoutes(fastify: FastifyInstance) {

    // GET /me/stats/overview
    fastify.get('/me/stats/overview', {
        schema: {
            description: 'Get overview statistics for the current user',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        totalPlayTimeMs: { type: 'string' },
                        totalTracks: { type: 'number' },
                        topArtist: { type: 'string', nullable: true },
                        topArtistImage: { type: 'string', nullable: true }
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
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const cacheKey = `stats:overview:${userId}`;
        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
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

            return toJSON(data);
        });

        return response;
    });

    // GET /me/stats/activity
    fastify.get('/me/stats/activity', {
        schema: {
            description: 'Get listening activity activity (hourly and daily)',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        hourly: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    hour: { type: 'number' },
                                    playCount: { type: 'number' }
                                }
                            }
                        },
                        daily: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    date: { type: 'string', format: 'date-time' },
                                    playCount: { type: 'number' }
                                }
                            }
                        }
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
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const cacheKey = `stats:activity:${userId}`;
        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
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

            return toJSON({
                hourly: hourly.map(h => ({ hour: h.hour, playCount: h.playCount })),
                daily: daily.map(d => ({ date: d.bucketDate, playCount: d.playCount })),
            });
        });
        return response;
    });

    // GET /me/stats/top/tracks
    // Uses Spotify's personalized Top Tracks from SpotifyTopTrack table
    fastify.get<{ Querystring: { range?: string; sortBy?: string } }>('/me/stats/top/tracks', {
        schema: {
            ...rangeSchema,
            querystring: {
                ...rangeSchema.querystring,
                properties: {
                    ...rangeSchema.querystring.properties,
                    sortBy: { type: 'string', enum: ['rank', 'time'], default: 'rank' }
                }
            },
            description: 'Get top tracks for the current user',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            artists: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' }
                                    }
                                }
                            },
                            album: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    imageUrl: { type: 'string' }
                                }
                            },
                            rank: { type: 'number' },
                            totalMs: { type: 'string' },
                            playCount: { type: 'number' }
                        }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const range = request.query.range || '4weeks';
        const sortBy = request.query.sortBy || 'rank';

        // Map frontend ranges to Spotify's time_range terms
        const termMap: Record<string, string> = {
            '4weeks': 'short_term',
            '6months': 'medium_term',
            'all': 'long_term',
            'year': 'long_term',
        };
        const term = termMap[range] || 'short_term';

        const cacheKey = `stats:tracks:${userId}:${term}:${sortBy}`;

        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
            if (sortBy === 'time') {
                // Query UserTrackStats for "Real Deal" stats (based on totalMs)
                // Note: 'range' here acts as a filter on 'lastPlayedAt' roughly, 
                // but UserTrackStats is global. For global "On Repeat", we use all time.
                // Ideally we'd use time buckets for ranges, but for MVP "On Repeat" usually implies recent or all-time heaviest.
                // Let's stick to ALL TIME for sortBy=time for now, or maybe filter by ListeningEvents? 
                // For now, let's return All-Time heavy hitters from UserTrackStats.

                const topStats = await prisma.userTrackStats.findMany({
                    where: { userId },
                    orderBy: { totalMs: 'desc' },
                    take: 50,
                    include: {
                        track: {
                            include: {
                                artists: { include: { artist: true } },
                                album: true
                            }
                        }
                    }
                });

                const data = topStats.map((stat: any, index: number) => ({
                    ...stat.track,
                    rank: index + 1,
                    totalMs: stat.totalMs.toString(),
                    playCount: stat.playCount
                }));

                return toJSON(data);

            } else {
                // Default: Query Spotify's actual Top Tracks
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
                    // We don't have totalMs here easily unless we join, but let's leave it null/undefined or fetch it? 
                    // For now, let's leave it as is.
                }));

                return toJSON(data);
            }
        });

        return response;
    });

    // GET /me/stats/top/artists
    // Uses Spotify's personalized Top Artists
    fastify.get<{ Querystring: { range?: string } }>('/me/stats/top/artists', {
        schema: {
            ...rangeSchema,
            description: 'Get top artists for the current user',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            imageUrl: { type: 'string', nullable: true },
                            genres: { type: 'array', items: { type: 'string' } },
                            rank: { type: 'number' }
                        }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
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

        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
            // Query Spotify's actual Top Artists
            const topArtists = await prisma.spotifyTopArtist.findMany({
                where: { userId, term },
                orderBy: { rank: 'asc' },
                include: { artist: true },
            });

            const data = topArtists.map((a: any) => ({
                ...a.artist,
                rank: a.rank,
            }));

            return toJSON(data);
        });

        return response;
    });

    // GET /me/stats/mood
    fastify.get('/me/stats/mood', {
        schema: {
            description: 'Get mood statistics (valence, energy) over the last 30 days',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            date: { type: 'string', format: 'date-time' },
                            valence: { type: 'number' },
                            energy: { type: 'number' },
                            count: { type: 'number' }
                        }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const cacheKey = `stats:mood:${userId}`;
        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
            // Fetch last 30 days of listening history
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const events = await prisma.listeningEvent.findMany({
                where: {
                    userId,
                    playedAt: { gte: thirtyDaysAgo }
                },
                select: {
                    playedAt: true,
                    track: {
                        select: {
                            audioFeatures: {
                                select: {
                                    valence: true,
                                    energy: true
                                }
                            }
                        }
                    }
                }
            });

            // Group by day and average
            const dailyStats = new Map<string, { valence: number; energy: number; count: number }>();

            for (const event of events) {
                if (!event.track.audioFeatures) continue;

                const day = event.playedAt.toISOString().split('T')[0]; // YYYY-MM-DD
                const current = dailyStats.get(day) || { valence: 0, energy: 0, count: 0 };

                current.valence += event.track.audioFeatures.valence;
                current.energy += event.track.audioFeatures.energy;
                current.count += 1;

                dailyStats.set(day, current);
            }

            const result = Array.from(dailyStats.entries()).map(([date, stats]) => ({
                date,
                valence: parseFloat((stats.valence / stats.count).toFixed(2)),
                energy: parseFloat((stats.energy / stats.count).toFixed(2)),
                count: stats.count
            })).sort((a, b) => a.date.localeCompare(b.date));

            return toJSON(result);
        });

        return response;
    });

    // GET /me/history
    fastify.get<{ Querystring: { page?: number; limit?: number } }>('/me/history', {
        schema: {
            ...historySchema,
            description: 'Get listening history for the current user',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        events: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    playedAt: { type: 'string', format: 'date-time' },
                                    track: {
                                        type: 'object',
                                        properties: {
                                            spotifyId: { type: 'string' },
                                            name: { type: 'string' },
                                            artists: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    properties: {
                                                        artist: {
                                                            type: 'object',
                                                            properties: {
                                                                name: { type: 'string' },
                                                                spotifyId: { type: 'string' }
                                                            }
                                                        }
                                                    }
                                                }
                                            },
                                            album: {
                                                type: 'object',
                                                nullable: true,
                                                properties: {
                                                    name: { type: 'string' },
                                                    imageUrl: { type: 'string', nullable: true }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        total: { type: 'number' },
                        page: { type: 'number' },
                        limit: { type: 'number' }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
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
