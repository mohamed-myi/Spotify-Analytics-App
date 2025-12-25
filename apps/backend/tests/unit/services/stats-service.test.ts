const mockPrisma = {
    user: {
        findUnique: jest.fn(),
    },
    userTrackStats: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
    },
    userArtistStats: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
    },
    userHourStats: {
        findMany: jest.fn(),
    },
    userTimeBucketStats: {
        findMany: jest.fn(),
    },
    spotifyTopTrack: {
        findMany: jest.fn(),
    },
    spotifyTopArtist: {
        findMany: jest.fn(),
    },
};

jest.mock('../../../src/lib/prisma', () => ({
    prisma: mockPrisma,
}));

import {
    getSummaryStats,
    getOverviewStats,
    getActivityStats,
    getTopTracks,
    getTopArtists,
    rangeToTerm,
} from '../../../src/services/stats-service';
import { Term } from '@prisma/client';

describe('StatsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getSummaryStats', () => {
        it('retrieves totalPlayCount from User model', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                createdAt: new Date('2024-01-01'),
                totalPlayCount: 1500,
                totalListeningMs: 3600000n,
            });
            mockPrisma.userTrackStats.aggregate.mockResolvedValue({
                _count: { trackId: 50 },
            });
            mockPrisma.userArtistStats.count.mockResolvedValue(25);

            const result = await getSummaryStats('user-123');

            expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
                where: { id: 'user-123' },
                select: {
                    createdAt: true,
                    totalPlayCount: true,
                    totalListeningMs: true,
                },
            });

            expect(result.totalPlays).toBe(1500);
            expect(result.totalListeningMs).toBe(3600000n);
            expect(result.uniqueTracks).toBe(50);
            expect(result.uniqueArtists).toBe(25);
            expect(result.memberSince).toEqual(new Date('2024-01-01'));
        });

        it('returns defaults when user not found', async () => {
            mockPrisma.user.findUnique.mockResolvedValue(null);
            mockPrisma.userTrackStats.aggregate.mockResolvedValue({
                _count: { trackId: 0 },
            });
            mockPrisma.userArtistStats.count.mockResolvedValue(0);

            const result = await getSummaryStats('unknown-user');

            expect(result.totalPlays).toBe(0);
            expect(result.totalListeningMs).toBe(0n);
            expect(result.memberSince).toBeNull();
        });

        it('NEVER calls listeningEvent.count', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                createdAt: new Date(),
                totalPlayCount: 100,
                totalListeningMs: 1000000n,
            });
            mockPrisma.userTrackStats.aggregate.mockResolvedValue({
                _count: { trackId: 10 },
            });
            mockPrisma.userArtistStats.count.mockResolvedValue(5);

            await getSummaryStats('user-123');

            expect((mockPrisma as any).listeningEvent?.count).toBeUndefined();
        });
    });

    describe('getOverviewStats', () => {
        it('retrieves totalListeningMs from User model', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                totalListeningMs: 7200000n,
                totalPlayCount: 200,
            });
            mockPrisma.userArtistStats.findFirst.mockResolvedValue({
                artist: { name: 'Top Artist', imageUrl: 'https://image.jpg' },
            });

            const result = await getOverviewStats('user-123');

            expect(result.totalPlayTimeMs).toBe(7200000n);
            expect(result.totalTracks).toBe(200);
            expect(result.topArtist).toBe('Top Artist');
            expect(result.topArtistImage).toBe('https://image.jpg');
        });

        it('handles missing top artist', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                totalListeningMs: 0n,
                totalPlayCount: 0,
            });
            mockPrisma.userArtistStats.findFirst.mockResolvedValue(null);

            const result = await getOverviewStats('user-123');

            expect(result.topArtist).toBeNull();
            expect(result.topArtistImage).toBeNull();
        });
    });

    describe('getActivityStats', () => {
        it('returns hourly and daily activity patterns', async () => {
            mockPrisma.userHourStats.findMany.mockResolvedValue([
                { hour: 8, playCount: 10 },
                { hour: 20, playCount: 25 },
            ]);
            mockPrisma.userTimeBucketStats.findMany.mockResolvedValue([
                { bucketDate: new Date('2024-12-24'), playCount: 15 },
                { bucketDate: new Date('2024-12-23'), playCount: 12 },
            ]);

            const result = await getActivityStats('user-123');

            expect(result.hourly).toHaveLength(2);
            expect(result.hourly[0]).toEqual({ hour: 8, playCount: 10 });
            expect(result.daily).toHaveLength(2);
            expect(result.daily[0].playCount).toBe(15);
        });
    });

    describe('rangeToTerm', () => {
        it('maps frontend ranges to Prisma Terms', () => {
            expect(rangeToTerm('4weeks')).toBe(Term.SHORT_TERM);
            expect(rangeToTerm('6months')).toBe(Term.MEDIUM_TERM);
            expect(rangeToTerm('year')).toBe(Term.LONG_TERM);
            expect(rangeToTerm('alltime')).toBeUndefined();
            expect(rangeToTerm('invalid')).toBeUndefined();
        });
    });

    describe('getTopTracks', () => {
        it('uses UserTrackStats for alltime range', async () => {
            mockPrisma.userTrackStats.findMany.mockResolvedValue([
                {
                    track: { id: 't1', name: 'Track 1', artists: [], album: {} },
                    totalMs: 180000n,
                    playCount: 10,
                },
            ]);

            const result = await getTopTracks('user-123', { range: 'alltime', sortBy: 'rank' });

            expect(mockPrisma.userTrackStats.findMany).toHaveBeenCalled();
            expect(result[0].rank).toBe(1);
        });

        it('uses SpotifyTopTrack for term-based ranges', async () => {
            mockPrisma.spotifyTopTrack.findMany.mockResolvedValue([
                { track: { id: 't1', name: 'Track 1', artists: [], album: {} }, rank: 1 },
            ]);

            const result = await getTopTracks('user-123', { range: '4weeks', sortBy: 'rank' });

            expect(mockPrisma.spotifyTopTrack.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userId: 'user-123', term: Term.SHORT_TERM },
                })
            );
        });
    });

    describe('getTopArtists', () => {
        it('uses UserArtistStats for alltime range', async () => {
            mockPrisma.userArtistStats.findMany.mockResolvedValue([
                { artist: { id: 'a1', name: 'Artist 1' }, playCount: 50 },
            ]);

            const result = await getTopArtists('user-123', 'alltime');

            expect(mockPrisma.userArtistStats.findMany).toHaveBeenCalled();
            expect(result[0].rank).toBe(1);
            expect((result[0] as unknown as { playCount: number }).playCount).toBe(50);
        });

        it('uses SpotifyTopArtist for term-based ranges', async () => {
            mockPrisma.spotifyTopArtist.findMany.mockResolvedValue([
                { artist: { id: 'a1', name: 'Artist 1' }, rank: 1 },
            ]);

            const result = await getTopArtists('user-123', '6months');

            expect(mockPrisma.spotifyTopArtist.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userId: 'user-123', term: Term.MEDIUM_TERM },
                })
            );
        });
    });
});
