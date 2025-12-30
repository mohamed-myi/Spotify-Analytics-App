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
    },
    $transaction: mockTransaction,
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

        it('fetches all terms sequentially and persists atomically', async () => {
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'valid-token' });

            // Mock successful responses for all terms
            mockGetTopTracks.mockResolvedValue({ items: [] });
            mockGetTopArtists.mockResolvedValue({ items: [] });

            // Mock transaction to execute the callback
            mockTransaction.mockImplementation(async (callback: Function) => {
                const txClient = {
                    spotifyTopTrack: {
                        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                        createMany: jest.fn().mockResolvedValue({ count: 0 }),
                    },
                    spotifyTopArtist: {
                        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                        createMany: jest.fn().mockResolvedValue({ count: 0 }),
                    },
                    user: {
                        update: jest.fn().mockResolvedValue({}),
                    },
                };
                return callback(txClient);
            });

            await processUserTopStats('user-success');

            // Should call API for all 3 terms (tracks + artists = 6 calls total)
            expect(mockGetTopTracks).toHaveBeenCalledTimes(3);
            expect(mockGetTopArtists).toHaveBeenCalledTimes(3);

            // Should execute transaction once
            expect(mockTransaction).toHaveBeenCalledTimes(1);

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
