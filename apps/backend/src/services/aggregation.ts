import { BucketType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export interface AggregationInput {
    trackId: string;
    artistIds: string[];
    playedAt: Date;
    msPlayed: number;
}

interface StatsAccumulator {
    count: number;
    ms: number;
}

type AggregationMap<K> = Map<K, StatsAccumulator>;

function aggregateByKey<K>(
    events: AggregationInput[],
    getKeys: (event: AggregationInput) => K[],
    onMatch?: (existing: StatsAccumulator, event: AggregationInput) => void
): AggregationMap<K> {
    const map = new Map<K, StatsAccumulator>();
    for (const event of events) {
        for (const key of getKeys(event)) {
            const existing = map.get(key);
            if (existing) {
                existing.count++;
                existing.ms += event.msPlayed;
                if (onMatch) onMatch(existing, event);
            } else {
                map.set(key, { count: 1, ms: event.msPlayed });
            }
        }
    }
    return map;
}

export async function updateStatsForEvents(
    userId: string,
    events: AggregationInput[],
    userTimezone: string = 'UTC'
): Promise<void> {
    if (events.length === 0) return;

    await Promise.all([
        updateTrackStats(userId, events),
        updateArtistStats(userId, events),
        updateTimeBucketStats(userId, events, userTimezone),
        updateHourStats(userId, events),
    ]);
}

async function updateTrackStats(
    userId: string,
    events: AggregationInput[]
): Promise<void> {
    const trackMap = new Map<string, { count: number; ms: number; lastPlayed: Date }>();

    for (const event of events) {
        const existing = trackMap.get(event.trackId);
        if (existing) {
            existing.count++;
            existing.ms += event.msPlayed;
            if (event.playedAt > existing.lastPlayed) {
                existing.lastPlayed = event.playedAt;
            }
        } else {
            trackMap.set(event.trackId, {
                count: 1,
                ms: event.msPlayed,
                lastPlayed: event.playedAt,
            });
        }
    }

    const upserts = Array.from(trackMap.entries()).map(([trackId, stats]) =>
        prisma.userTrackStats.upsert({
            where: { userId_trackId: { userId, trackId } },
            create: {
                userId,
                trackId,
                playCount: stats.count,
                totalMs: BigInt(stats.ms),
                lastPlayedAt: stats.lastPlayed,
            },
            update: {
                playCount: { increment: stats.count },
                totalMs: { increment: BigInt(stats.ms) },
                lastPlayedAt: stats.lastPlayed,
            },
        })
    );

    await Promise.all(upserts);
}

async function updateArtistStats(
    userId: string,
    events: AggregationInput[]
): Promise<void> {
    const artistMap = aggregateByKey(events, (e) => e.artistIds);

    const upserts = Array.from(artistMap.entries()).map(([artistId, stats]) =>
        prisma.userArtistStats.upsert({
            where: { userId_artistId: { userId, artistId } },
            create: {
                userId,
                artistId,
                playCount: stats.count,
                totalMs: BigInt(stats.ms),
            },
            update: {
                playCount: { increment: stats.count },
                totalMs: { increment: BigInt(stats.ms) },
            },
        })
    );

    await Promise.all(upserts);
}

function getLocalDayBucket(playedAtUtc: Date, userTimezone: string): Date {
    const localTime = toZonedTime(playedAtUtc, userTimezone);
    return startOfDay(localTime);
}

async function updateTimeBucketStats(
    userId: string,
    events: AggregationInput[],
    userTimezone: string
): Promise<void> {
    const dayMap = new Map<string, { count: number; ms: number }>();

    for (const event of events) {
        const dayStart = getLocalDayBucket(event.playedAt, userTimezone);
        const dayKey = dayStart.toISOString();

        const existing = dayMap.get(dayKey);
        if (existing) {
            existing.count++;
            existing.ms += event.msPlayed;
        } else {
            dayMap.set(dayKey, { count: 1, ms: event.msPlayed });
        }
    }

    const upserts = Array.from(dayMap.entries()).map(([dayKey, stats]) =>
        prisma.userTimeBucketStats.upsert({
            where: {
                userId_bucketType_bucketDate: {
                    userId,
                    bucketType: BucketType.DAY,
                    bucketDate: new Date(dayKey),
                },
            },
            create: {
                userId,
                bucketType: BucketType.DAY,
                bucketDate: new Date(dayKey),
                playCount: stats.count,
                totalMs: BigInt(stats.ms),
                uniqueTracks: 0,
            },
            update: {
                playCount: { increment: stats.count },
                totalMs: { increment: BigInt(stats.ms) },
            },
        })
    );

    await Promise.all(upserts);
}

async function updateHourStats(
    userId: string,
    events: AggregationInput[]
): Promise<void> {
    const hourMap = aggregateByKey(events, (e) => [e.playedAt.getUTCHours()]);

    const upserts = Array.from(hourMap.entries()).map(([hour, stats]) =>
        prisma.userHourStats.upsert({
            where: { userId_hour: { userId, hour } },
            create: {
                userId,
                hour,
                playCount: stats.count,
                totalMs: BigInt(stats.ms),
            },
            update: {
                playCount: { increment: stats.count },
                totalMs: { increment: BigInt(stats.ms) },
            },
        })
    );

    await Promise.all(upserts);
}

export { getLocalDayBucket };
