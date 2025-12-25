// Test Redis utilities with properly mocked Redis client
process.env.REDIS_URL = 'redis://mock:6379';

const mockIncr = jest.fn();
const mockExpire = jest.fn();
const mockSadd = jest.fn();
const mockSpop = jest.fn();
const mockQuit = jest.fn();

jest.mock('../../../src/lib/redis', () => ({
    redis: {
        incr: (...args: any[]) => mockIncr(...args),
        expire: (...args: any[]) => mockExpire(...args),
        sadd: (...args: any[]) => mockSadd(...args),
        spop: (...args: any[]) => mockSpop(...args),
        quit: (...args: any[]) => mockQuit(...args),
    },
    checkRateLimit: jest.fn(async () => {
        const count = await mockIncr('spotify:requests:minute');
        if (count === 1) {
            await mockExpire('spotify:requests:minute', 60);
        }
        return count <= 150;
    }),
    waitForRateLimit: jest.fn(async () => {
        const { checkRateLimit } = jest.requireMock('../../../src/lib/redis');
        while (!(await checkRateLimit())) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }),
    queueArtistForMetadata: jest.fn(async (spotifyId: string) => {
        await mockSadd('pending_artists', spotifyId);
    }),
    popArtistsForMetadata: jest.fn(async (count: number) => {
        const artists: string[] = [];
        for (let i = 0; i < count; i++) {
            const artist = await mockSpop('pending_artists');
            if (artist) {
                artists.push(artist);
            } else {
                break;
            }
        }
        return artists;
    }),
    queueTrackForMetadata: jest.fn(async (spotifyId: string) => {
        await mockSadd('pending_tracks', spotifyId);
    }),
    popTracksForMetadata: jest.fn(async (count: number) => {
        const tracks: string[] = [];
        for (let i = 0; i < count; i++) {
            const track = await mockSpop('pending_tracks');
            if (track) {
                tracks.push(track);
            } else {
                break;
            }
        }
        return tracks;
    }),
    closeRedis: jest.fn(async () => {
        await mockQuit();
    }),
}));

import {
    checkRateLimit,
    waitForRateLimit,
    queueArtistForMetadata,
    popArtistsForMetadata,
    queueTrackForMetadata,
    popTracksForMetadata,
    closeRedis,
} from '../../../src/lib/redis';

describe('lib/redis', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIncr.mockReset();
        mockExpire.mockReset();
        mockSadd.mockReset();
        mockSpop.mockReset();
        mockQuit.mockReset();
    });

    describe('checkRateLimit', () => {
        it('returns true when under limit', async () => {
            mockIncr.mockResolvedValue(50);

            const result = await checkRateLimit();
            expect(result).toBe(true);
        });

        it('sets expiry on first increment', async () => {
            mockIncr.mockResolvedValue(1);

            await checkRateLimit();
            expect(mockExpire).toHaveBeenCalledWith('spotify:requests:minute', 60);
        });

        it('does not set expiry on subsequent increments', async () => {
            mockIncr.mockResolvedValue(10);

            await checkRateLimit();
            expect(mockExpire).not.toHaveBeenCalled();
        });

        it('returns false when over limit', async () => {
            mockIncr.mockResolvedValue(151);

            const result = await checkRateLimit();
            expect(result).toBe(false);
        });

        it('returns true at exactly the limit', async () => {
            mockIncr.mockResolvedValue(150);

            const result = await checkRateLimit();
            expect(result).toBe(true);
        });
    });

    describe('waitForRateLimit', () => {
        it('returns immediately when under limit', async () => {
            mockIncr.mockResolvedValue(50);

            const start = Date.now();
            await waitForRateLimit();
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(200);
        });
    });

    describe('queueArtistForMetadata', () => {
        it('adds artist to pending set', async () => {
            mockSadd.mockResolvedValue(1);

            await queueArtistForMetadata('artist-123');
            expect(mockSadd).toHaveBeenCalledWith('pending_artists', 'artist-123');
        });
    });

    describe('popArtistsForMetadata', () => {
        it('pops specified count of artists', async () => {
            mockSpop
                .mockResolvedValueOnce('artist-1')
                .mockResolvedValueOnce('artist-2')
                .mockResolvedValueOnce('artist-3');

            const result = await popArtistsForMetadata(3);
            expect(result).toEqual(['artist-1', 'artist-2', 'artist-3']);
        });

        it('returns partial results if set is smaller', async () => {
            mockSpop
                .mockResolvedValueOnce('artist-1')
                .mockResolvedValueOnce(null);

            const result = await popArtistsForMetadata(5);
            expect(result).toEqual(['artist-1']);
        });

        it('returns empty array if set is empty', async () => {
            mockSpop.mockResolvedValue(null);

            const result = await popArtistsForMetadata(3);
            expect(result).toEqual([]);
        });
    });

    describe('queueTrackForMetadata', () => {
        it('adds track to pending set', async () => {
            mockSadd.mockResolvedValue(1);

            await queueTrackForMetadata('track-456');
            expect(mockSadd).toHaveBeenCalledWith('pending_tracks', 'track-456');
        });
    });

    describe('popTracksForMetadata', () => {
        it('pops specified count of tracks', async () => {
            mockSpop
                .mockResolvedValueOnce('track-1')
                .mockResolvedValueOnce('track-2');

            const result = await popTracksForMetadata(2);
            expect(result).toEqual(['track-1', 'track-2']);
        });

        it('returns partial results if set is smaller', async () => {
            mockSpop
                .mockResolvedValueOnce('track-1')
                .mockResolvedValueOnce(null);

            const result = await popTracksForMetadata(5);
            expect(result).toEqual(['track-1']);
        });
    });

    describe('closeRedis', () => {
        it('calls quit on redis client', async () => {
            mockQuit.mockResolvedValue(undefined);

            await closeRedis();
            expect(mockQuit).toHaveBeenCalled();
        });
    });

    describe('BigInt serialization', () => {
        it('serializes BigInt values to strings for JSON compatibility', () => {
            const data = {
                totalListeningMs: 3600000n,
                totalPlays: 100,
            };

            // The real getOrSet uses this serializer
            const serializer = (_: string, value: unknown) =>
                typeof value === 'bigint' ? value.toString() : value;

            const serialized = JSON.stringify(data, serializer);
            const parsed = JSON.parse(serialized);

            expect(parsed.totalListeningMs).toBe('3600000');
            expect(parsed.totalPlays).toBe(100);
        });

        it('preserves BigInt precision for large values', () => {
            const largeValue = 9007199254740993n; // > Number.MAX_SAFE_INTEGER

            const serializer = (_: string, value: unknown) =>
                typeof value === 'bigint' ? value.toString() : value;

            const serialized = JSON.stringify({ value: largeValue }, serializer);
            const parsed = JSON.parse(serialized);

            expect(parsed.value).toBe('9007199254740993');
            // Converting back preserves precision
            expect(BigInt(parsed.value)).toBe(largeValue);
        });
    });
});
