import { prisma } from '../lib/prisma';
import { startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Input for aggregation - one per listening event
export interface AggregationInput {
    trackId: string;
    artistIds: string[];
    playedAt: Date;
    msPlayed: number;
}

// Update all stat tables for a batch of newly added events
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

// Increment UserTrackStats for each unique track
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

// Increment UserArtistStats for each artist (tracks can have multiple artists)
async function updateArtistStats(
    userId: string,
    events: AggregationInput[]
): Promise<void> {
    const artistMap = new Map<string, { count: number; ms: number }>();

    for (const event of events) {
        for (const artistId of event.artistIds) {
            const existing = artistMap.get(artistId);
            if (existing) {
                existing.count++;
                existing.ms += event.msPlayed;
            } else {
                artistMap.set(artistId, { count: 1, ms: event.msPlayed });
            }
        }
    }

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

// Get start of local day for a UTC timestamp
function getLocalDayBucket(playedAtUtc: Date, userTimezone: string): Date {
    const localTime = toZonedTime(playedAtUtc, userTimezone);
    return startOfDay(localTime);
}

// Update time bucket stats (DAY only - WEEK/MONTH computed via SQL SUM)
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
                    bucketType: 'DAY',
                    bucketDate: new Date(dayKey),
                },
            },
            create: {
                userId,
                bucketType: 'DAY',
                bucketDate: new Date(dayKey),
                playCount: stats.count,
                totalMs: BigInt(stats.ms),
                uniqueTracks: 0, // Deferred - may add HyperLogLog later
            },
            update: {
                playCount: { increment: stats.count },
                totalMs: { increment: BigInt(stats.ms) },
            },
        })
    );

    await Promise.all(upserts);
}

// Update hour-of-day histogram (UTC hours)
async function updateHourStats(
    userId: string,
    events: AggregationInput[]
): Promise<void> {
    const hourMap = new Map<number, { count: number; ms: number }>();

    for (const event of events) {
        const hour = event.playedAt.getUTCHours();
        const existing = hourMap.get(hour);
        if (existing) {
            existing.count++;
            existing.ms += event.msPlayed;
        } else {
            hourMap.set(hour, { count: 1, ms: event.msPlayed });
        }
    }

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

// Export helper for testing
export { getLocalDayBucket };
