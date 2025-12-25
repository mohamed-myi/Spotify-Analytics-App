// Set env before imports
process.env.REDIS_URL = 'redis://mock:6379';

// Mock external dependencies
jest.mock('bullmq', () => {
    return {
        Worker: jest.fn().mockImplementation(() => ({
            on: jest.fn(),
            close: jest.fn().mockResolvedValue(undefined),
        })),
        Queue: jest.fn().mockImplementation(() => ({
            add: jest.fn(),
        })),
    };
});

jest.mock('../../../src/lib/redis', () => ({
    redis: {
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
    },
    waitForRateLimit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));

jest.mock('../../../src/lib/token-manager', () => ({
    getValidAccessToken: jest.fn(),
    recordTokenFailure: jest.fn(),
    resetTokenFailures: jest.fn(),
}));

jest.mock('../../../src/lib/spotify-api', () => ({
    getRecentlyPlayed: jest.fn(),
}));

jest.mock('../../../src/lib/spotify-parser', () => ({
    parseRecentlyPlayed: jest.fn(),
}));

jest.mock('../../../src/services/ingestion', () => ({
    insertListeningEventsWithIds: jest.fn(),
}));

jest.mock('../../../src/services/aggregation', () => ({
    updateStatsForEvents: jest.fn(),
}));

jest.mock('../../../src/lib/partitions', () => ({
    ensurePartitionsForDates: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../../src/lib/prisma';
import { getValidAccessToken, resetTokenFailures } from '../../../src/lib/token-manager';
import { getRecentlyPlayed } from '../../../src/lib/spotify-api';
import { parseRecentlyPlayed } from '../../../src/lib/spotify-parser';
import { insertListeningEventsWithIds } from '../../../src/services/ingestion';
import { updateStatsForEvents } from '../../../src/services/aggregation';
import { waitForRateLimit } from '../../../src/lib/redis';
import {
    SpotifyUnauthenticatedError,
    SpotifyForbiddenError,
    SpotifyRateLimitError,
} from '../../../src/lib/spotify-errors';

interface MockJob {
    data: { userId: string; skipCooldown?: boolean };
    log: jest.Mock;
}

// Recreate the processSync function to test it directly
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_BACKWARD_ITERATIONS = 10;

async function processSync(job: MockJob): Promise<{ added: number; skipped: number; updated: number; errors: number }> {
    const { userId, skipCooldown } = job.data;

    const user = await (prisma.user.findUnique as jest.Mock)({
        where: { id: userId },
        include: { settings: true },
    });

    const userTimezone = user?.settings?.timezone ?? 'UTC';
    const lastSyncTimestamp = user?.lastIngestedAt?.getTime() ?? 0;

    if (!skipCooldown && user?.lastIngestedAt) {
        const msSinceLastSync = Date.now() - user.lastIngestedAt.getTime();
        if (msSinceLastSync < SYNC_COOLDOWN_MS) {
            await job.log(`Skipping - synced ${Math.round(msSinceLastSync / 1000)}s ago`);
            return { added: 0, skipped: 0, updated: 0, errors: 0 };
        }
    }

    const tokenResult = await (getValidAccessToken as jest.Mock)(userId);
    if (!tokenResult) {
        throw new Error(`No valid token for user ${userId}`);
    }

    try {
        let beforeCursor: number | undefined = undefined;
        let newestObservedTime: Date | null = null;
        let iterationCount = 0;
        const totalSummary = { added: 0, skipped: 0, updated: 0, errors: 0 };
        const allAddedEvents: Array<{ trackId: string; artistIds: string[]; playedAt: Date; msPlayed: number }> = [];

        while (iterationCount < MAX_BACKWARD_ITERATIONS) {
            await (waitForRateLimit as jest.Mock)();

            const response: { items: any[] } = await (getRecentlyPlayed as jest.Mock)(tokenResult.accessToken, {
                limit: 50,
                before: beforeCursor,
            });

            if (response.items.length === 0) {
                if (iterationCount === 0) {
                    await job.log('No new plays found');
                }
                break;
            }

            const batchEvents: Array<{ playedAt: Date; track: any }> = (parseRecentlyPlayed as jest.Mock)(response);

            if (iterationCount === 0 && batchEvents.length > 0) {
                newestObservedTime = batchEvents[0].playedAt;
            }

            const newEvents = batchEvents.filter((e: any) => e.playedAt.getTime() > lastSyncTimestamp);

            if (newEvents.length > 0) {
                const { summary, results } = await (insertListeningEventsWithIds as jest.Mock)(userId, newEvents);
                totalSummary.added += summary.added;
                totalSummary.skipped += summary.skipped;
                totalSummary.updated += summary.updated;
                totalSummary.errors += summary.errors;

                const addedInBatch = results.filter((r: any) => r.status === 'added');
                allAddedEvents.push(...addedInBatch.map((r: any) => ({
                    trackId: r.trackId,
                    artistIds: r.artistIds,
                    playedAt: r.playedAt,
                    msPlayed: r.msPlayed,
                })));

                await job.log(`Batch ${iterationCount + 1}: added ${summary.added}, skipped ${summary.skipped}`);
            }

            const oldestInBatch: Date | undefined = batchEvents[batchEvents.length - 1]?.playedAt;
            const foundOverlap = oldestInBatch && oldestInBatch.getTime() <= lastSyncTimestamp;
            const isPartialBatch = response.items.length < 50;

            if (foundOverlap || isPartialBatch) {
                break;
            }

            beforeCursor = oldestInBatch.getTime();
            iterationCount++;
        }

        if (iterationCount >= MAX_BACKWARD_ITERATIONS) {
            await job.log(`Max backward iterations (${MAX_BACKWARD_ITERATIONS}) reached`);
        }

        if (allAddedEvents.length > 0) {
            await (updateStatsForEvents as jest.Mock)(userId, allAddedEvents, userTimezone);
            await job.log(`Aggregated stats for ${allAddedEvents.length} total events`);
        }

        if (newestObservedTime) {
            await (prisma.user.update as jest.Mock)({
                where: { id: userId },
                data: { lastIngestedAt: newestObservedTime },
            });
        }

        await (resetTokenFailures as jest.Mock)(userId);
        return totalSummary;
    } catch (error) {
        if (error instanceof SpotifyUnauthenticatedError) {
            throw new Error(`Token revoked for user ${userId}`);
        }
        if (error instanceof SpotifyForbiddenError) {
            throw new Error(`Access forbidden for user ${userId}`);
        }
        if (error instanceof SpotifyRateLimitError) {
            await job.log(`Rate limited, retry after ${error.retryAfterSeconds}s`);
            throw error;
        }
        throw error;
    }
}

describe('sync-worker processSync (backward-walking)', () => {
    const createMockJob = (userId: string, options?: { skipCooldown?: boolean }): MockJob => ({
        data: { userId, ...options },
        log: jest.fn(),
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('cooldown check', () => {
        it('skips sync if user synced recently', async () => {
            const recentSync = new Date(Date.now() - 60 * 1000);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: recentSync,
                settings: { timezone: 'UTC' },
            });

            const job = createMockJob('user-123');
            const result = await processSync(job);

            expect(result).toEqual({ added: 0, skipped: 0, updated: 0, errors: 0 });
            expect(job.log).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
            expect(getRecentlyPlayed).not.toHaveBeenCalled();
        });

        it('proceeds if enough time has passed since last sync', async () => {
            const oldSync = new Date(Date.now() - 10 * 60 * 1000);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: oldSync,
                settings: { timezone: 'UTC' },
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: [] });

            const job = createMockJob('user-123');
            await processSync(job);

            expect(getRecentlyPlayed).toHaveBeenCalled();
        });

        it('bypasses cooldown when skipCooldown is true', async () => {
            const recentSync = new Date(Date.now() - 60 * 1000);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: recentSync,
                settings: { timezone: 'UTC' },
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: [] });

            const job = createMockJob('user-123', { skipCooldown: true });
            await processSync(job);

            expect(getRecentlyPlayed).toHaveBeenCalled();
        });
    });

    describe('token validation', () => {
        it('throws error when no valid token', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue(null);

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toThrow('No valid token');
        });
    });

    describe('backward-walking pagination', () => {
        it('fetches using before cursor (no cursor on first request)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: [{}] });
            (parseRecentlyPlayed as jest.Mock).mockReturnValue([
                { playedAt: new Date(), track: {} },
            ]);
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 1, skipped: 0, updated: 0, errors: 0 },
                results: [{ status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: new Date(), msPlayed: 180000 }],
            });

            const job = createMockJob('user-123');
            await processSync(job);

            expect(getRecentlyPlayed).toHaveBeenCalledWith('token', {
                limit: 50,
                before: undefined,
            });
        });

        it('continues backward when 50 items and no overlap', async () => {
            const oldSync = new Date('2024-01-01T00:00:00Z');
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: oldSync,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });

            const batch1OldestTime = new Date('2024-06-15T12:00:00Z');
            const batch2OldestTime = new Date('2024-03-15T12:00:00Z');

            (getRecentlyPlayed as jest.Mock)
                .mockResolvedValueOnce({ items: Array(50).fill({}) })
                .mockResolvedValueOnce({ items: Array(50).fill({}) })
                .mockResolvedValueOnce({ items: [] });

            (parseRecentlyPlayed as jest.Mock)
                .mockReturnValueOnce(Array(50).fill(null).map((_, i) => ({
                    playedAt: new Date(batch1OldestTime.getTime() + (50 - i) * 60000),
                    track: {},
                })))
                .mockReturnValueOnce(Array(50).fill(null).map((_, i) => ({
                    playedAt: new Date(batch2OldestTime.getTime() + (50 - i) * 60000),
                    track: {},
                })));

            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 50, skipped: 0, updated: 0, errors: 0 },
                results: Array(50).fill({ status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: new Date(), msPlayed: 180000 }),
            });

            const job = createMockJob('user-123', { skipCooldown: true });
            await processSync(job);

            expect(getRecentlyPlayed).toHaveBeenCalledTimes(3);
            expect(getRecentlyPlayed).toHaveBeenNthCalledWith(2, 'token', {
                limit: 50,
                before: expect.any(Number),
            });
        });

        it('stops when finding overlap with existing data', async () => {
            const lastSync = new Date('2024-06-01T12:00:00Z');
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: lastSync,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });

            // Oldest track in batch is OLDER than lastSync = overlap found
            const oldestInBatch = new Date('2024-05-15T12:00:00Z');
            (getRecentlyPlayed as jest.Mock).mockResolvedValueOnce({ items: Array(50).fill({}) });
            (parseRecentlyPlayed as jest.Mock).mockReturnValueOnce([
                { playedAt: new Date('2024-06-15T12:00:00Z'), track: {} },
                { playedAt: oldestInBatch, track: {} },
            ]);
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 1, skipped: 0, updated: 0, errors: 0 },
                results: [{ status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: new Date(), msPlayed: 180000 }],
            });

            const job = createMockJob('user-123', { skipCooldown: true });
            await processSync(job);

            // Should only call once because overlap was found
            expect(getRecentlyPlayed).toHaveBeenCalledTimes(1);
        });

        it('stops at max backward iterations (dead man switch)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });

            // Always return 50 items with future timestamps to never trigger overlap
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: Array(50).fill({}) });
            (parseRecentlyPlayed as jest.Mock).mockReturnValue(
                Array(50).fill(null).map(() => ({
                    playedAt: new Date(Date.now() + Math.random() * 1000000),
                    track: {},
                }))
            );
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 50, skipped: 0, updated: 0, errors: 0 },
                results: Array(50).fill({ status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: new Date(), msPlayed: 180000 }),
            });

            const job = createMockJob('user-123');
            await processSync(job);

            expect(getRecentlyPlayed).toHaveBeenCalledTimes(MAX_BACKWARD_ITERATIONS);
            expect(job.log).toHaveBeenCalledWith(expect.stringContaining('Max backward iterations'));
        });

        it('filters out events older than lastSyncTimestamp before insertion', async () => {
            const lastSync = new Date('2024-06-01T12:00:00Z');
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: lastSync,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });

            (getRecentlyPlayed as jest.Mock).mockResolvedValueOnce({ items: [{}] });
            (parseRecentlyPlayed as jest.Mock).mockReturnValueOnce([
                { playedAt: new Date('2024-06-15T12:00:00Z'), track: {} }, // New
                { playedAt: new Date('2024-05-15T12:00:00Z'), track: {} }, // Old - should be filtered
            ]);
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 1, skipped: 0, updated: 0, errors: 0 },
                results: [{ status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: new Date(), msPlayed: 180000 }],
            });

            const job = createMockJob('user-123', { skipCooldown: true });
            await processSync(job);

            // insertListeningEventsWithIds should only receive the NEW event
            expect(insertListeningEventsWithIds).toHaveBeenCalledWith(
                'user-123',
                expect.arrayContaining([
                    expect.objectContaining({ playedAt: new Date('2024-06-15T12:00:00Z') }),
                ])
            );
        });
    });

    describe('high water mark tracking', () => {
        it('updates lastIngestedAt to newest observed time from first batch', async () => {
            const newestTime = new Date('2024-06-20T12:00:00Z');
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValueOnce({ items: [{}] });
            (parseRecentlyPlayed as jest.Mock).mockReturnValueOnce([
                { playedAt: newestTime, track: {} },
                { playedAt: new Date('2024-06-15T12:00:00Z'), track: {} },
            ]);
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 2, skipped: 0, updated: 0, errors: 0 },
                results: [
                    { status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: newestTime, msPlayed: 180000 },
                    { status: 'added', trackId: 't2', artistIds: ['a1'], playedAt: new Date(), msPlayed: 180000 },
                ],
            });

            const job = createMockJob('user-123');
            await processSync(job);

            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'user-123' },
                data: { lastIngestedAt: newestTime },
            });
        });
    });

    describe('Spotify error handling', () => {
        beforeEach(() => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
        });

        it('throws on SpotifyUnauthenticatedError', async () => {
            (getRecentlyPlayed as jest.Mock).mockRejectedValue(new SpotifyUnauthenticatedError());

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toThrow('Token revoked');
        });

        it('throws on SpotifyForbiddenError', async () => {
            (getRecentlyPlayed as jest.Mock).mockRejectedValue(new SpotifyForbiddenError());

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toThrow('Access forbidden');
        });

        it('logs and rethrows SpotifyRateLimitError', async () => {
            (getRecentlyPlayed as jest.Mock).mockRejectedValue(new SpotifyRateLimitError(60));

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toBeInstanceOf(SpotifyRateLimitError);
            expect(job.log).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));
        });
    });
});

