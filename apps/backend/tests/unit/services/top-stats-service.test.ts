process.env.REDIS_URL = 'redis://mock:6379';

// Mock dependencies
jest.mock('../../../src/lib/redis', () => ({
    waitForRateLimit: jest.fn().mockResolvedValue(undefined),
    redis: {
        smembers: jest.fn().mockResolvedValue([]),
        sadd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        del: jest.fn().mockResolvedValue(1),
    },
}));

const mockTransaction = jest.fn();
const mockPrisma = {
    user: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    spotifyTopTrack: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    spotifyTopArtist: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    artist: {
        upsert: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
    },
    album: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
    },
    track: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
    },
    trackArtist: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: mockTransaction,
    $executeRaw: jest.fn(),
};

jest.mock('../../../src/lib/prisma', () => ({
    prisma: mockPrisma,
}));

jest.mock('../../../src/lib/token-manager', () => ({
    getValidAccessToken: jest.fn(),
    resetTokenFailures: jest.fn(),
}));

const mockGetTopTracks = jest.fn();
const mockGetTopArtists = jest.fn();

jest.mock('../../../src/lib/spotify-api', () => ({
    getTopTracks: mockGetTopTracks,
    getTopArtists: mockGetTopArtists,
}));

jest.mock('../../../src/services/ingestion', () => ({
    upsertTrack: jest.fn().mockResolvedValue({ trackId: 'mock-track-id' }),
}));

jest.mock('../../../src/workers/top-stats-queue', () => ({
    topStatsQueue: {
        add: jest.fn().mockResolvedValue({}),
    },
}));

jest.mock('../../../src/lib/logger', () => ({
    workerLoggers: {
        topStats: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        },
    },
}));

import { getValidAccessToken, resetTokenFailures } from '../../../src/lib/token-manager';
import { processUserTopStats, isTopStatsHydrated } from '../../../src/services/top-stats-service';

describe('Top Stats Service - Atomic Transaction Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('processUserTopStats', () => {
        it('skips processing when user has no valid token', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue(null);

            await processUserTopStats('user-no-token');

            expect(mockGetTopTracks).not.toHaveBeenCalled();
            expect(mockGetTopArtists).not.toHaveBeenCalled();
            expect(mockTransaction).not.toHaveBeenCalled();
        });

        it('fetches all terms in parallel and persists using bulk operations', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'valid-token' });

            // Mock successful responses with data to trigger ingestion
            const mockTrack = {
                id: 't1', name: 'T1', duration_ms: 1000, preview_url: null,
                album: { id: 'a1', name: 'A1', images: [], release_date: '2024' },
                artists: [{ id: 'ar1', name: 'Ar1' }]
            };
            const mockArtist = { id: 'ar1', name: 'Ar1', images: [], genres: [] };

            mockGetTopTracks.mockResolvedValue({ items: [mockTrack] });
            mockGetTopArtists.mockResolvedValue({ items: [mockArtist] });

            // Mock DB findings for ID resolution
            mockPrisma.artist.findMany.mockResolvedValue([{ id: 'uuid-ar1', spotifyId: 'ar1' }]);
            mockPrisma.album.findMany.mockResolvedValue([{ id: 'uuid-a1', spotifyId: 'a1' }]);
            mockPrisma.track.findMany.mockResolvedValue([{ id: 'uuid-t1', spotifyId: 't1' }]);

            // Mock transaction to execute the callback and track internal calls
            const mockTxCreateMany = jest.fn().mockResolvedValue({ count: 1 });
            const mockTxDeleteMany = jest.fn().mockResolvedValue({ count: 1 });

            mockTransaction.mockImplementation(async (callback: Function) => {
                const txClient = {
                    spotifyTopTrack: { deleteMany: mockTxDeleteMany, createMany: mockTxCreateMany },
                    spotifyTopArtist: { deleteMany: mockTxDeleteMany, createMany: mockTxCreateMany },
                    user: { update: jest.fn().mockResolvedValue({}) },
                    $executeRaw: jest.fn(),
                };
                return callback(txClient);
            });

            await processUserTopStats('user-success');

            // Verify Parallel Fetch
            expect(mockGetTopTracks).toHaveBeenCalledTimes(3);
            expect(mockGetTopArtists).toHaveBeenCalledTimes(3);

            // Verify Bulk Catalog Ingestion (Phase 2) - Should use createMany, not upsert
            expect(mockPrisma.artist.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
            expect(mockPrisma.album.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
            expect(mockPrisma.track.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
            expect(mockPrisma.trackArtist.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));

            // Verify NO individual upserts
            expect(mockPrisma.artist.upsert).not.toHaveBeenCalled();

            // Verify Atomic Transaction (Phase 3)
            expect(mockTransaction).toHaveBeenCalledTimes(1);
            expect(mockTxCreateMany).toHaveBeenCalledTimes(2); // Tracks and Artists

            // Should reset token failures after success
            expect(resetTokenFailures).toHaveBeenCalledWith('user-success');
        });

        it('rolls back transaction on API failure during long_term fetch', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'valid-token' });

            // Mock: short_term and medium_term succeed, long_term fails
            let callCount = 0;
            mockGetTopTracks.mockImplementation(async () => {
                callCount++;
                if (callCount === 3) {
                    // Third call (long_term) fails
                    throw new Error('Spotify API 500 error for long_term');
                }
                return { items: [] };
            });
            mockGetTopArtists.mockResolvedValue({ items: [] });

            await expect(processUserTopStats('user-fail')).rejects.toThrow('Spotify API 500 error for long_term');

            // Transaction should NOT be called because we fail before reaching it
            expect(mockTransaction).not.toHaveBeenCalled();

            // Token failures should NOT be reset
            expect(resetTokenFailures).not.toHaveBeenCalled();
        });

        it('does not update topStatsRefreshedAt if transaction fails', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'valid-token' });
            mockGetTopTracks.mockResolvedValue({ items: [] });
            mockGetTopArtists.mockResolvedValue({ items: [] });

            // Mock transaction to throw an error
            mockTransaction.mockRejectedValue(new Error('Transaction failed'));

            await expect(processUserTopStats('user-tx-fail')).rejects.toThrow('Transaction failed');

            // resetTokenFailures should NOT be called because the function threw
            expect(resetTokenFailures).not.toHaveBeenCalled();
        });
    });

    describe('isTopStatsHydrated', () => {
        it('returns true when topStatsRefreshedAt is set', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                topStatsRefreshedAt: new Date(),
            });

            const result = await isTopStatsHydrated('hydrated-user');

            expect(result).toBe(true);
        });

        it('returns false when topStatsRefreshedAt is null', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                topStatsRefreshedAt: null,
            });

            const result = await isTopStatsHydrated('unhydrated-user');

            expect(result).toBe(false);
        });

        it('returns false when user is not found', async () => {
            mockPrisma.user.findUnique.mockResolvedValue(null);

            const result = await isTopStatsHydrated('nonexistent-user');

            expect(result).toBe(false);
        });
    });
});
