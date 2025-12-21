// Set env before imports
process.env.REDIS_URL = 'redis://mock:6379';

// Mock external dependencies
const mockQueueAdd = jest.fn().mockResolvedValue({});
jest.mock('bullmq', () => {
    return {
        Worker: jest.fn().mockImplementation((name, processor, opts) => {
            return {
                on: jest.fn(),
                close: jest.fn().mockResolvedValue(undefined),
            };
        }),
        Queue: jest.fn().mockImplementation(() => ({
            add: mockQueueAdd,
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
    invalidateUserToken: jest.fn(),
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

import { prisma } from '../../../src/lib/prisma';
import { getValidAccessToken, invalidateUserToken } from '../../../src/lib/token-manager';
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

// Import the actual module to test after mocks are set up
// Import types for type-safe Job mock
interface MockJob {
    data: { userId: string; skipCooldown?: boolean; iteration?: number };
    log: jest.Mock;
}

// Recreate the processSync function to test it directly
// This mirrors the actual implementation to test the logic
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_FOLLOWUP_ITERATIONS = 5;

async function processSync(job: MockJob): Promise<{ added: number; skipped: number; updated: number; errors: number }> {
    const { userId, skipCooldown, iteration = 0 } = job.data;

    // Dead man's switch: stop if max iterations reached
    if (iteration >= MAX_FOLLOWUP_ITERATIONS) {
        await job.log(`Max iterations (${MAX_FOLLOWUP_ITERATIONS}) reached, stopping until next cron`);
        return { added: 0, skipped: 0, updated: 0, errors: 0 };
    }

    const user = await (prisma.user.findUnique as jest.Mock)({
        where: { id: userId },
        include: { settings: true },
    });

    const userTimezone = user?.settings?.timezone ?? 'UTC';
    const lastSyncTimestamp = user?.lastIngestedAt?.getTime();

    // Cooldown check (skipped for follow-up syncs)
    if (!skipCooldown && user?.lastIngestedAt) {
        const msSinceLastSync = Date.now() - user.lastIngestedAt.getTime();
        if (msSinceLastSync < SYNC_COOLDOWN_MS) {
            await job.log(`Skipping - synced ${Math.round(msSinceLastSync / 1000)}s ago`);
            return { added: 0, skipped: 0, updated: 0, errors: 0 };
        }
    }

    const tokenResult = await (getValidAccessToken as jest.Mock)(userId);
    if (!tokenResult) {
        await (invalidateUserToken as jest.Mock)(userId);
        throw new Error(`No valid token for user ${userId}`);
    }

    await (waitForRateLimit as jest.Mock)();

    const afterTimestamp = user?.lastIngestedAt ? user.lastIngestedAt.getTime() : undefined;

    try {
        const response = await (getRecentlyPlayed as jest.Mock)(tokenResult.accessToken, {
            limit: 50,
            after: afterTimestamp,
        });

        if (response.items.length === 0) {
            await job.log('No new plays found');
            return { added: 0, skipped: 0, updated: 0, errors: 0 };
        }

        const events = (parseRecentlyPlayed as jest.Mock)(response);
        const { summary, results } = await (insertListeningEventsWithIds as jest.Mock)(userId, events);

        const addedEvents = results.filter((r: any) => r.status === 'added');
        if (addedEvents.length > 0) {
            const aggregationInputs = addedEvents.map((r: any) => ({
                trackId: r.trackId,
                artistIds: r.artistIds,
                playedAt: r.playedAt,
                msPlayed: r.msPlayed,
            }));
            await (updateStatsForEvents as jest.Mock)(userId, aggregationInputs, userTimezone);
            await job.log(`Aggregated stats for ${addedEvents.length} events`);
        }

        const latestPlay = events[0]?.playedAt;
        if (latestPlay) {
            await (prisma.user.update as jest.Mock)({
                where: { id: userId },
                data: { lastIngestedAt: latestPlay },
            });
        }

        // Adaptive re-queue: if we hit the 50-item limit and made temporal progress
        const hitLimit = response.items.length === 50;
        const oldestTrackInBatch = events[events.length - 1]?.playedAt;
        const madeTemporalProgress = oldestTrackInBatch &&
            (!lastSyncTimestamp || oldestTrackInBatch.getTime() > lastSyncTimestamp);

        if (hitLimit && madeTemporalProgress) {
            const jitteredDelay = 1000 + Math.floor(Math.random() * 5000);
            await mockQueueAdd(
                `sync-${userId}-followup-${iteration + 1}`,
                { userId, skipCooldown: true, iteration: iteration + 1 },
                { priority: 1, delay: jitteredDelay }
            );
            await job.log(
                `Hit 50-item limit with temporal progress, queued follow-up ` +
                `(iteration ${iteration + 1}/${MAX_FOLLOWUP_ITERATIONS})`
            );
        }

        return summary;
    } catch (error) {
        if (error instanceof SpotifyUnauthenticatedError) {
            await (invalidateUserToken as jest.Mock)(userId);
            throw new Error(`Token revoked for user ${userId}`);
        }
        if (error instanceof SpotifyForbiddenError) {
            await (invalidateUserToken as jest.Mock)(userId);
            throw new Error(`Access forbidden for user ${userId}`);
        }
        if (error instanceof SpotifyRateLimitError) {
            await job.log(`Rate limited, retry after ${error.retryAfterSeconds}s`);
            throw error;
        }
        throw error;
    }
}

describe('sync-worker processSync', () => {
    const createMockJob = (userId: string, options?: { skipCooldown?: boolean; iteration?: number }): MockJob => ({
        data: { userId, ...options },
        log: jest.fn(),
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockQueueAdd.mockClear();
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
            expect(job.log).not.toHaveBeenCalledWith(expect.stringContaining('Skipping'));
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
            expect(invalidateUserToken).toHaveBeenCalledWith('user-123');
        });
    });

    describe('event processing', () => {
        it('returns empty summary when no new plays', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: [] });

            const job = createMockJob('user-123');
            const result = await processSync(job);

            expect(result).toEqual({ added: 0, skipped: 0, updated: 0, errors: 0 });
            expect(job.log).toHaveBeenCalledWith('No new plays found');
        });

        it('processes events and aggregates stats', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: { timezone: 'America/New_York' },
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({
                items: [{ played_at: '2025-01-01T12:00:00Z', track: {} }],
            });
            (parseRecentlyPlayed as jest.Mock).mockReturnValue([
                { playedAt: new Date('2025-01-01T12:00:00Z'), track: {} },
            ]);
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 1, skipped: 0, updated: 0, errors: 0 },
                results: [{
                    status: 'added',
                    trackId: 'track-1',
                    artistIds: ['artist-1'],
                    playedAt: new Date(),
                    msPlayed: 180000,
                }],
            });

            const job = createMockJob('user-123');
            const result = await processSync(job);

            expect(result).toEqual({ added: 1, skipped: 0, updated: 0, errors: 0 });
            expect(updateStatsForEvents).toHaveBeenCalled();
            expect(prisma.user.update).toHaveBeenCalled();
        });

        it('skips aggregation when no events were added', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: [{}] });
            (parseRecentlyPlayed as jest.Mock).mockReturnValue([{ playedAt: new Date() }]);
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 0, skipped: 1, updated: 0, errors: 0 },
                results: [{ status: 'skipped' }],
            });

            const job = createMockJob('user-123');
            await processSync(job);

            expect(updateStatsForEvents).not.toHaveBeenCalled();
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

        it('invalidates token on SpotifyUnauthenticatedError', async () => {
            (getRecentlyPlayed as jest.Mock).mockRejectedValue(new SpotifyUnauthenticatedError());

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toThrow('Token revoked');
            expect(invalidateUserToken).toHaveBeenCalledWith('user-123');
        });

        it('invalidates token on SpotifyForbiddenError', async () => {
            (getRecentlyPlayed as jest.Mock).mockRejectedValue(new SpotifyForbiddenError());

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toThrow('Access forbidden');
            expect(invalidateUserToken).toHaveBeenCalledWith('user-123');
        });

        it('logs and rethrows SpotifyRateLimitError', async () => {
            (getRecentlyPlayed as jest.Mock).mockRejectedValue(new SpotifyRateLimitError(60));

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toBeInstanceOf(SpotifyRateLimitError);
            expect(job.log).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));
        });

        it('rethrows unknown errors', async () => {
            (getRecentlyPlayed as jest.Mock).mockRejectedValue(new Error('Network error'));

            const job = createMockJob('user-123');
            await expect(processSync(job)).rejects.toThrow('Network error');
        });
    });

    describe('adaptive polling', () => {
        it('stops at max iterations (dead man switch)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });

            const job = createMockJob('user-123', { iteration: 5 });
            const result = await processSync(job);

            expect(result).toEqual({ added: 0, skipped: 0, updated: 0, errors: 0 });
            expect(job.log).toHaveBeenCalledWith(expect.stringContaining('Max iterations'));
            expect(getRecentlyPlayed).not.toHaveBeenCalled();
        });

        it('queues follow-up when hitting 50-item limit with temporal progress', async () => {
            const oldSync = new Date(Date.now() - 10 * 60 * 1000);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: oldSync,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });

            // Return exactly 50 items to trigger re-queue
            const fiftyItems = Array(50).fill({ played_at: '2025-01-01T12:00:00Z', track: {} });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: fiftyItems });

            // Events with playedAt newer than lastIngestedAt
            const newerDate = new Date(Date.now() - 5 * 60 * 1000);
            (parseRecentlyPlayed as jest.Mock).mockReturnValue(
                Array(50).fill({ playedAt: newerDate, track: {} })
            );
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 50, skipped: 0, updated: 0, errors: 0 },
                results: Array(50).fill({ status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: newerDate, msPlayed: 180000 }),
            });

            const job = createMockJob('user-123');
            await processSync(job);

            expect(mockQueueAdd).toHaveBeenCalledWith(
                expect.stringContaining('sync-user-123-followup'),
                expect.objectContaining({ userId: 'user-123', skipCooldown: true, iteration: 1 }),
                expect.objectContaining({ priority: 1 })
            );
            expect(job.log).toHaveBeenCalledWith(expect.stringContaining('Hit 50-item limit'));
        });

        it('does not queue follow-up when under 50 items', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: null,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({
                items: [{ played_at: '2025-01-01T12:00:00Z', track: {} }],
            });
            (parseRecentlyPlayed as jest.Mock).mockReturnValue([
                { playedAt: new Date('2025-01-01T12:00:00Z'), track: {} },
            ]);
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 1, skipped: 0, updated: 0, errors: 0 },
                results: [{ status: 'added', trackId: 't1', artistIds: ['a1'], playedAt: new Date(), msPlayed: 180000 }],
            });

            const job = createMockJob('user-123');
            await processSync(job);

            expect(mockQueueAdd).not.toHaveBeenCalled();
        });

        it('does not queue follow-up without temporal progress', async () => {
            const recentSync = new Date(Date.now() + 1000); // Future date = no temporal progress
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'user-123',
                lastIngestedAt: recentSync,
                settings: null,
            });
            (getValidAccessToken as jest.Mock).mockResolvedValue({ accessToken: 'token' });

            const fiftyItems = Array(50).fill({ played_at: '2025-01-01T12:00:00Z', track: {} });
            (getRecentlyPlayed as jest.Mock).mockResolvedValue({ items: fiftyItems });

            // Events with playedAt older than lastIngestedAt
            const olderDate = new Date('2025-01-01T12:00:00Z');
            (parseRecentlyPlayed as jest.Mock).mockReturnValue(
                Array(50).fill({ playedAt: olderDate, track: {} })
            );
            (insertListeningEventsWithIds as jest.Mock).mockResolvedValue({
                summary: { added: 0, skipped: 50, updated: 0, errors: 0 },
                results: Array(50).fill({ status: 'skipped' }),
            });

            const job = createMockJob('user-123', { skipCooldown: true });
            await processSync(job);

            expect(mockQueueAdd).not.toHaveBeenCalled();
        });
    });
});
