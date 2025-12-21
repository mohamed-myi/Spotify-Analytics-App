import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { redis, getOrSet } from '../lib/redis';
import { toJSON } from '../lib/serialization';
import { triggerLazyRefreshIfStale } from '../services/top-stats-service';
import { topStatsQueue } from '../workers/top-stats-queue';

const CACHE_TTL = 300;

// JSON Schema for range parameter validation
const rangeSchema = {
    querystring: {
        type: 'object',
        properties: {
            range: {
                type: 'string',
                enum: ['4weeks', '6months', 'year', 'alltime'],
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

const TERM_MAP: Record<string, string> = {
    '4weeks': 'short_term',
    '6months': 'medium_term',
    'year': 'long_term',
};

export async function statsRoutes(fastify: FastifyInstance) {

    // GET /me/stats/summary: Profile stats summary
    fastify.get('/me/stats/summary', {
        schema: {
            description: 'Get summary statistics for user profile',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        totalPlays: { type: 'number' },
                        totalListeningMs: { type: 'string' },
                        uniqueTracks: { type: 'number' },
                        uniqueArtists: { type: 'number' },
                        memberSince: { type: 'string', format: 'date-time' }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const cacheKey = `stats:summary:${userId}`;
        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
            const [user, trackStats, artistCount, listeningEvents] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: userId },
                    select: { createdAt: true }
                }),
                prisma.userTrackStats.aggregate({
                    where: { userId },
                    _sum: { playCount: true, totalMs: true },
                    _count: { trackId: true }
                }),
                prisma.userArtistStats.count({
                    where: { userId }
                }),
                prisma.listeningEvent.count({
                    where: { userId }
                })
            ]);

            return toJSON({
                totalPlays: listeningEvents,
                totalListeningMs: trackStats._sum.totalMs || 0n,
                uniqueTracks: trackStats._count.trackId || 0,
                uniqueArtists: artistCount,
                memberSince: user?.createdAt
            });
        });

        return response;
    });

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
                    take: 30,
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

        // Lazy trigger: queue background refresh if stale (non-blocking)
        const refreshStatus = await triggerLazyRefreshIfStale(userId);

        const range = request.query.range || '4weeks';
        const sortBy = request.query.sortBy || 'rank';

        const term = TERM_MAP[range];
        const isAllTime = range === 'alltime';

        const cacheKey = `stats:tracks:${userId}:${range}:${sortBy}`;

        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
            // All Time: use UserTrackStats (computed from imports + syncs)
            if (isAllTime || sortBy === 'time') {
                const topStats = await prisma.userTrackStats.findMany({
                    where: { userId },
                    orderBy: sortBy === 'time' ? { totalMs: 'desc' } : { playCount: 'desc' },
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

                return toJSON(data);
            }
        });

        return response;
    });

    // GET /me/stats/top/artists
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

        await triggerLazyRefreshIfStale(userId);

        const range = request.query.range || '4weeks';

        // Map frontend ranges to Spotify's time_range terms
        const term = TERM_MAP[range];
        const isAllTime = range === 'alltime';

        const cacheKey = `stats:artists:${userId}:${range}`;

        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
            // All Time: use UserArtistStats (computed from imports + syncs)
            if (isAllTime) {
                const topStats = await prisma.userArtistStats.findMany({
                    where: { userId },
                    orderBy: { playCount: 'desc' },
                    take: 50,
                    include: { artist: true }
                });

                const data = topStats.map((stat: any, index: number) => ({
                    ...stat.artist,
                    rank: index + 1,
                    playCount: stat.playCount
                }));

                return toJSON(data);
            } else {
                // Spotify API ranges: query SpotifyTopArtist
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
            }
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

    // GET /me/stats/song-of-the-day: Most played track in last 24 hours
    fastify.get('/me/stats/song-of-the-day', {
        schema: {
            description: 'Get the most played track in the last 24 hours (Song of the Day)',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        spotifyId: { type: 'string' },
                        name: { type: 'string' },
                        artist: { type: 'string' },
                        artistSpotifyId: { type: 'string' },
                        image: { type: 'string', nullable: true },
                        playCount: { type: 'number' },
                        isFallback: { type: 'boolean' }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } }
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        const cacheKey = `stats:song-of-day:${userId}`;
        const response = await getOrSet(cacheKey, CACHE_TTL, async () => {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Group listening events by track in last 24h
            const recentPlays = await prisma.listeningEvent.groupBy({
                by: ['trackId'],
                where: {
                    userId,
                    playedAt: { gte: twentyFourHoursAgo }
                },
                _count: { trackId: true },
                orderBy: { _count: { trackId: 'desc' } },
                take: 1
            });

            let trackId: string | null = recentPlays[0]?.trackId || null;
            let playCount = recentPlays[0]?._count?.trackId || 0;
            let isFallback = false;

            // Fallback: get all-time most played track
            if (!trackId) {
                const allTimeMostPlayed = await prisma.userTrackStats.findFirst({
                    where: { userId },
                    orderBy: { playCount: 'desc' },
                    select: { trackId: true, playCount: true }
                });
                trackId = allTimeMostPlayed?.trackId || null;
                playCount = allTimeMostPlayed?.playCount || 0;
                isFallback = true;
            }

            if (!trackId) {
                return toJSON({
                    id: null,
                    spotifyId: null,
                    name: 'No tracks played yet',
                    artist: 'Play some music!',
                    artistSpotifyId: null,
                    image: null,
                    playCount: 0,
                    isFallback: true
                });
            }

            // Fetch track details
            const track = await prisma.track.findUnique({
                where: { id: trackId },
                include: {
                    album: true,
                    artists: {
                        include: { artist: true },
                        take: 1
                    }
                }
            });

            if (!track) {
                return toJSON({
                    id: null,
                    spotifyId: null,
                    name: 'Track not found',
                    artist: 'Unknown',
                    artistSpotifyId: null,
                    image: null,
                    playCount: 0,
                    isFallback: true
                });
            }

            const primaryArtist = track.artists[0]?.artist;

            return toJSON({
                id: track.id,
                spotifyId: track.spotifyId,
                name: track.name,
                artist: primaryArtist?.name || 'Unknown Artist',
                artistSpotifyId: primaryArtist?.spotifyId || null,
                image: track.album?.imageUrl || null,
                playCount,
                isFallback
            });
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

    // POST /me/stats/top/refresh: Manual refresh trigger (rate-limited: 1 per 10 min)
    fastify.post('/me/stats/top/refresh', {
        schema: {
            description: 'Manually trigger a refresh of top stats (rate-limited)',
            tags: ['Stats'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' }
                    }
                },
                401: { type: 'object', properties: { error: { type: 'string' } } },
                429: { type: 'object', properties: { error: { type: 'string' } } }
            }
        },
        config: {
            rateLimit: {
                max: 1,
                timeWindow: '10 minutes',
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

        // Queue high-priority job
        await topStatsQueue.add(
            `manual-${userId}`,
            { userId, priority: 'high' },
            { priority: 1, jobId: `manual-${userId}-${Date.now()}` }
        );

        return { success: true, message: 'Refresh queued' };
    });
}
