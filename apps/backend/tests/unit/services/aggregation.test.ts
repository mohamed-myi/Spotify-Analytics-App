import { updateStatsForEvents, getLocalDayBucket } from '@/services/aggregation';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        userTrackStats: { upsert: jest.fn() },
        userArtistStats: { upsert: jest.fn() },
        userTimeBucketStats: { upsert: jest.fn() },
        userHourStats: { upsert: jest.fn() },
    },
}));

describe('Aggregation Service', () => {
    const userId = 'user-1';
    const playedAt = new Date('2023-10-27T14:30:00Z');

    const events = [
        {
            trackId: 'track-1',
            artistIds: ['artist-1', 'artist-2'],
            playedAt,
            msPlayed: 1000,
        },
        {
            trackId: 'track-1',
            artistIds: ['artist-1', 'artist-2'],
            playedAt: new Date('2023-10-27T15:00:00Z'),
            msPlayed: 2000,
        }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('updateStatsForEvents', () => {
        it('should update all 4 stat tables', async () => {
            await updateStatsForEvents(userId, events);

            expect(prisma.userTrackStats.upsert).toHaveBeenCalled();
            expect(prisma.userArtistStats.upsert).toHaveBeenCalled();
            expect(prisma.userTimeBucketStats.upsert).toHaveBeenCalled();
            expect(prisma.userHourStats.upsert).toHaveBeenCalled();
        });

        it('should aggregate track stats correctly', async () => {
            await updateStatsForEvents(userId, events);

            expect(prisma.userTrackStats.upsert).toHaveBeenCalledWith({
                where: { userId_trackId: { userId, trackId: 'track-1' } },
                create: expect.objectContaining({
                    playCount: 2,
                    totalMs: BigInt(3000),
                }),
                update: expect.objectContaining({
                    playCount: { increment: 2 },
                    totalMs: { increment: BigInt(3000) },
                }),
            });
        });
    });

    describe('Timezone Handling', () => {
        it('should shift UTC time to user local time for DAY buckets', () => {
            const timeA = new Date('2023-10-27T20:00:00Z');
            const timeB = new Date('2023-10-28T01:00:00Z');
            const timezone = 'America/New_York';

            const dayA = getLocalDayBucket(timeA, timezone);
            const dayB = getLocalDayBucket(timeB, timezone);

            expect(dayA.toISOString()).toEqual(dayB.toISOString());
        });
    });
});
