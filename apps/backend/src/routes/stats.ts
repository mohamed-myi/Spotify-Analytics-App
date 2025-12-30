import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { Term, BucketType } from '@prisma/client';
import { getOrSet } from '../lib/redis';
import { triggerLazyRefreshIfStale, isTopStatsHydrated } from '../services/top-stats-service';
import { topStatsQueue } from '../workers/top-stats-queue';
import { getSummaryStats, getOverviewStats, getActivityStats } from '../services/stats-service';

const CACHE_TTL = 300;

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

const historySchema = {
    querystring: {
        type: 'object',
        properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }
        }
    }
};

const TERM_MAP: Record<string, Term> = {
    '4weeks': Term.SHORT_TERM,
    '6months': Term.MEDIUM_TERM,
    'year': Term.LONG_TERM,
};

export async function statsRoutes(fastify: FastifyInstance) {

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
            return getSummaryStats(userId);
        });

        return response;
    });

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
            return getOverviewStats(userId);
        });

        return response;
    });

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
                    where: { userId, bucketType: BucketType.DAY },
                    orderBy: { bucketDate: 'desc' },
                    take: 30,
                }),
            ]);

            return {
                hourly: hourly.map(h => ({ hour: h.hour, playCount: h.playCount })),
                daily: daily.map(d => ({ date: d.bucketDate, playCount: d.playCount })),
            };
        });
        return response;
    });

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

        await triggerLazyRefreshIfStale(userId);

        const range = request.query.range || '4weeks';
        const sortBy = request.query.sortBy || 'rank';

        const term = TERM_MAP[range];
        const isAllTime = range === 'alltime';
        const isSpotifyTermBased = !isAllTime && sortBy === 'rank';

        // Fetch data directly first to check if hydration is complete
        let data: any[];

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

            data = topStats.map((stat: any, index: number) => ({
                ...stat.track,
                rank: index + 1,
                totalMs: stat.totalMs,
                playCount: stat.playCount
            }));
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

            data = topTracks.map((t: any) => ({
                ...t.track,
                rank: t.rank,
            }));
        }

        // If empty and using Spotify term data, check if hydration is complete
        if (data.length === 0 && isSpotifyTermBased) {
            const hydrated = await isTopStatsHydrated(userId);
            if (!hydrated) {
                // Do NOT cache; return 202 processing status
                return reply.status(202).send({ status: 'processing', data: [] });
            }
        }

        // Cache only when data is present or hydration is complete
        const cacheKey = `stats:tracks:${userId}:${range}:${sortBy}`;
        await getOrSet(cacheKey, CACHE_TTL, async () => data);

        return data;
    });

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

        const term = TERM_MAP[range];
        const isAllTime = range === 'alltime';
        const isSpotifyTermBased = !isAllTime;

        // Fetch data directly first to check if hydration is complete
        let data: any[];

        if (isAllTime) {
            const topStats = await prisma.userArtistStats.findMany({
                where: { userId },
                orderBy: { playCount: 'desc' },
                take: 50,
                include: { artist: true }
            });

            data = topStats.map((stat: any, index: number) => ({
                ...stat.artist,
                rank: index + 1,
                playCount: stat.playCount
            }));
        } else {
            const topArtists = await prisma.spotifyTopArtist.findMany({
                where: { userId, term },
                orderBy: { rank: 'asc' },
                include: { artist: true },
            });

            data = topArtists.map((a: any) => ({
                ...a.artist,
                rank: a.rank,
            }));
        }

        // If empty and using Spotify term data, check if hydration is complete
        if (data.length === 0 && isSpotifyTermBased) {
            const hydrated = await isTopStatsHydrated(userId);
            if (!hydrated) {
                // Do NOT cache; return 202 processing status
                return reply.status(202).send({ status: 'processing', data: [] });
            }
        }

        // Cache only when data is present or hydration is complete
        const cacheKey = `stats:artists:${userId}:${range}`;
        await getOrSet(cacheKey, CACHE_TTL, async () => data);

        return data;
    });

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
                return {
                    id: null,
                    spotifyId: null,
                    name: 'No tracks played yet',
                    artist: 'Play some music!',
                    artistSpotifyId: null,
                    image: null,
                    playCount: 0,
                    isFallback: true
                };
            }

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
                return {
                    id: null,
                    spotifyId: null,
                    name: 'Track not found',
                    artist: 'Unknown',
                    artistSpotifyId: null,
                    image: null,
                    playCount: 0,
                    isFallback: true
                };
            }

            const primaryArtist = track.artists[0]?.artist;

            return {
                id: track.id,
                spotifyId: track.spotifyId,
                name: track.name,
                artist: primaryArtist?.name || 'Unknown Artist',
                artistSpotifyId: primaryArtist?.spotifyId || null,
                image: track.album?.imageUrl || null,
                playCount,
                isFallback
            };
        });

        return response;
    });

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

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [events, total] = await Promise.all([
            prisma.listeningEvent.findMany({
                where: { userId, playedAt: { gte: thirtyDaysAgo } },
                orderBy: { playedAt: 'desc' },
                take: limit,
                skip,
                include: { track: { include: { artists: { include: { artist: true } }, album: true } } },
            }),
            prisma.listeningEvent.count({ where: { userId, playedAt: { gte: thirtyDaysAgo } } }),
        ]);

        return { events, total, page, limit };
    });

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

        await topStatsQueue.add(
            `manual-${userId}`,
            { userId, priority: 'high' },
            { priority: 1, jobId: `manual-${userId}-${Date.now()}` }
        );

        return { success: true, message: 'Refresh queued' };
    });
}
