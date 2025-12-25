import { prisma } from '../lib/prisma';
import { BucketType, Term } from '@prisma/client';

const TERM_MAP: Record<string, Term> = {
    '4weeks': Term.SHORT_TERM,
    '6months': Term.MEDIUM_TERM,
    'year': Term.LONG_TERM,
};

export interface SummaryStats {
    totalPlays: number;
    totalListeningMs: bigint;
    uniqueTracks: number;
    uniqueArtists: number;
    memberSince: Date | null;
}

export interface OverviewStats {
    totalPlayTimeMs: bigint;
    totalTracks: number;
    topArtist: string | null;
    topArtistImage: string | null;
}

export interface ActivityStats {
    hourly: Array<{ hour: number; playCount: number }>;
    daily: Array<{ date: Date; playCount: number }>;
}

export async function getSummaryStats(userId: string): Promise<SummaryStats> {
    const [user, trackStats, artistCount] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                createdAt: true,
                totalPlayCount: true,
                totalListeningMs: true
            }
        }),
        prisma.userTrackStats.aggregate({
            where: { userId },
            _count: { trackId: true }
        }),
        prisma.userArtistStats.count({ where: { userId } })
    ]);

    return {
        totalPlays: user?.totalPlayCount ?? 0,
        totalListeningMs: user?.totalListeningMs ?? 0n,
        uniqueTracks: trackStats._count.trackId || 0,
        uniqueArtists: artistCount,
        memberSince: user?.createdAt ?? null
    };
}

export async function getOverviewStats(userId: string): Promise<OverviewStats> {
    const [user, topArtist] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: { totalListeningMs: true, totalPlayCount: true }
        }),
        prisma.userArtistStats.findFirst({
            where: { userId },
            orderBy: { playCount: 'desc' },
            include: { artist: true }
        })
    ]);

    return {
        totalPlayTimeMs: user?.totalListeningMs ?? 0n,
        totalTracks: user?.totalPlayCount ?? 0,
        topArtist: topArtist?.artist.name ?? null,
        topArtistImage: topArtist?.artist.imageUrl ?? null
    };
}

export async function getActivityStats(userId: string): Promise<ActivityStats> {
    const [hourly, daily] = await Promise.all([
        prisma.userHourStats.findMany({
            where: { userId },
            orderBy: { hour: 'asc' }
        }),
        prisma.userTimeBucketStats.findMany({
            where: { userId, bucketType: BucketType.DAY },
            orderBy: { bucketDate: 'desc' },
            take: 30
        })
    ]);

    return {
        hourly: hourly.map(h => ({ hour: h.hour, playCount: h.playCount })),
        daily: daily.map(d => ({ date: d.bucketDate, playCount: d.playCount }))
    };
}

export function rangeToTerm(range: string): Term | undefined {
    return TERM_MAP[range];
}

export async function getTopTracks(
    userId: string,
    options: { range: string; sortBy: 'rank' | 'time' }
) {
    const term = rangeToTerm(options.range);
    const isAllTime = options.range === 'alltime' || !term;

    if (isAllTime || options.sortBy === 'time') {
        const topStats = await prisma.userTrackStats.findMany({
            where: { userId },
            orderBy: options.sortBy === 'time' ? { totalMs: 'desc' } : { playCount: 'desc' },
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

        return topStats.map((stat, index) => ({
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
            }
        });

        return topTracks.map(t => ({
            ...t.track,
            rank: t.rank
        }));
    }
}

export async function getTopArtists(userId: string, range: string) {
    const term = rangeToTerm(range);
    const isAllTime = range === 'alltime' || !term;

    if (isAllTime) {
        const topStats = await prisma.userArtistStats.findMany({
            where: { userId },
            orderBy: { playCount: 'desc' },
            take: 50,
            include: { artist: true }
        });

        return topStats.map((stat, index) => ({
            ...stat.artist,
            rank: index + 1,
            playCount: stat.playCount
        }));
    } else {
        const topArtists = await prisma.spotifyTopArtist.findMany({
            where: { userId, term },
            orderBy: { rank: 'asc' },
            include: { artist: true }
        });

        return topArtists.map(a => ({
            ...a.artist,
            rank: a.rank
        }));
    }
}
