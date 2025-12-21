// Test services/ingestion.ts with actual imports and mocked dependencies
process.env.REDIS_URL = 'redis://mock:6379';

// Mock Redis before importing
jest.mock('../../../src/lib/redis', () => ({
    redis: {},
    queueArtistForMetadata: jest.fn(),
    queueTrackForFeatures: jest.fn(),
}));

// Mock Prisma with all needed operations
const mockPrisma = {
    album: {
        findUnique: jest.fn(),
        create: jest.fn(),
    },
    artist: {
        findUnique: jest.fn(),
        create: jest.fn(),
    },
    track: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    trackArtist: {
        upsert: jest.fn(),
    },
    listeningEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
};

jest.mock('../../../src/lib/prisma', () => ({
    prisma: mockPrisma,
}));

import {
    insertListeningEvent,
    insertListeningEventWithIds,
    insertListeningEvents,
    insertListeningEventsWithIds,
} from '../../../src/services/ingestion';
import { queueArtistForMetadata } from '../../../src/lib/redis';
import type { ParsedListeningEvent } from '../../../src/types/ingestion';

describe('services/ingestion', () => {
    const createTestEvent = (overrides: Partial<ParsedListeningEvent> = {}): ParsedListeningEvent => ({
        spotifyTrackId: 'spotify:track:test123',
        playedAt: new Date('2025-01-01T12:00:00Z'),
        msPlayed: 180000,
        isEstimated: true,
        source: 'api',
        track: {
            spotifyId: 'test123',
            name: 'Test Track',
            durationMs: 180000,
            previewUrl: null,
            album: {
                spotifyId: 'album123',
                name: 'Test Album',
                imageUrl: 'https://example.com/album.jpg',
                releaseDate: '2025-01-01',
            },
            artists: [
                { spotifyId: 'artist123', name: 'Test Artist' },
            ],
        },
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Default successful mocks
        mockPrisma.album.findUnique.mockResolvedValue(null);
        mockPrisma.album.create.mockResolvedValue({ id: 'album-uuid' });
        mockPrisma.artist.findUnique.mockResolvedValue(null);
        mockPrisma.artist.create.mockResolvedValue({ id: 'artist-uuid' });
        mockPrisma.track.findUnique.mockResolvedValue(null);
        mockPrisma.track.create.mockResolvedValue({ id: 'track-uuid' });
        mockPrisma.listeningEvent.findUnique.mockResolvedValue(null);
        mockPrisma.listeningEvent.create.mockResolvedValue({ id: 'event-uuid' });
    });

    describe('insertListeningEventWithIds', () => {
        it('inserts new event and returns added status', async () => {
            const event = createTestEvent();
            const result = await insertListeningEventWithIds('user-123', event);

            expect(result.status).toBe('added');
            expect(result.trackId).toBe('track-uuid');
            expect(result.artistIds).toEqual(['artist-uuid']);
            expect(mockPrisma.listeningEvent.create).toHaveBeenCalled();
        });

        it('skips duplicate API event', async () => {
            mockPrisma.listeningEvent.findUnique.mockResolvedValue({
                isEstimated: true,
                source: 'api',
            });

            const event = createTestEvent({ source: 'api' });
            const result = await insertListeningEventWithIds('user-123', event);

            expect(result.status).toBe('skipped');
            expect(mockPrisma.listeningEvent.create).not.toHaveBeenCalled();
        });

        it('updates estimated event with import data', async () => {
            mockPrisma.listeningEvent.findUnique.mockResolvedValue({
                isEstimated: true,
                source: 'api',
            });
            mockPrisma.listeningEvent.update.mockResolvedValue({});

            const event = createTestEvent({
                source: 'import',
                isEstimated: false,
            });
            const result = await insertListeningEventWithIds('user-123', event);

            expect(result.status).toBe('updated');
            expect(mockPrisma.listeningEvent.update).toHaveBeenCalled();
        });

        it('skips when existing event is not estimated', async () => {
            mockPrisma.listeningEvent.findUnique.mockResolvedValue({
                isEstimated: false,
                source: 'import',
            });

            const event = createTestEvent({ source: 'import' });
            const result = await insertListeningEventWithIds('user-123', event);

            expect(result.status).toBe('skipped');
        });

        it('upserts existing artist with missing metadata', async () => {
            mockPrisma.artist.findUnique.mockResolvedValue({
                id: 'existing-artist',
                imageUrl: null,
            });

            const event = createTestEvent();
            await insertListeningEventWithIds('user-123', event);

            expect(queueArtistForMetadata).toHaveBeenCalledWith('artist123');
        });

        it('does not queue artist with existing metadata', async () => {
            mockPrisma.artist.findUnique.mockResolvedValue({
                id: 'existing-artist',
                imageUrl: 'https://example.com/artist.jpg',
            });

            const event = createTestEvent();
            await insertListeningEventWithIds('user-123', event);

            expect(queueArtistForMetadata).not.toHaveBeenCalled();
        });

        it('updates existing track name and preview', async () => {
            mockPrisma.track.findUnique.mockResolvedValue({ id: 'existing-track' });
            mockPrisma.track.update.mockResolvedValue({ id: 'existing-track' });

            const event = createTestEvent();
            const result = await insertListeningEventWithIds('user-123', event);

            expect(mockPrisma.track.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'existing-track' },
                })
            );
            expect(result.trackId).toBe('existing-track');
        });
    });

    describe('insertListeningEvent', () => {
        it('returns status string only', async () => {
            const event = createTestEvent();
            const result = await insertListeningEvent('user-123', event);

            expect(result).toBe('added');
        });
    });

    describe('insertListeningEvents', () => {
        it('processes multiple events and returns summary', async () => {
            const events = [
                createTestEvent({ playedAt: new Date('2025-01-01T12:00:00Z') }),
                createTestEvent({ playedAt: new Date('2025-01-01T13:00:00Z') }),
            ];

            const summary = await insertListeningEvents('user-123', events);

            expect(summary.added).toBe(2);
            expect(summary.skipped).toBe(0);
            expect(summary.errors).toBe(0);
        });

        it('counts errors when insert fails', async () => {
            mockPrisma.album.findUnique.mockRejectedValueOnce(new Error('DB error'));

            const events = [createTestEvent()];
            const summary = await insertListeningEvents('user-123', events);

            expect(summary.errors).toBe(1);
            expect(summary.added).toBe(0);
        });
    });

    describe('insertListeningEventsWithIds', () => {
        it('returns both summary and results array', async () => {
            const events = [createTestEvent()];

            const { summary, results } = await insertListeningEventsWithIds('user-123', events);

            expect(summary.added).toBe(1);
            expect(results).toHaveLength(1);
            expect(results[0].status).toBe('added');
        });

        it('handles mixed success and failure', async () => {
            // First call succeeds, second fails
            mockPrisma.album.findUnique
                .mockResolvedValueOnce(null)
                .mockRejectedValueOnce(new Error('DB error'));
            mockPrisma.album.create.mockResolvedValueOnce({ id: 'album-1' });

            const events = [
                createTestEvent({ playedAt: new Date('2025-01-01T12:00:00Z') }),
                createTestEvent({ playedAt: new Date('2025-01-01T13:00:00Z') }),
            ];

            const { summary, results } = await insertListeningEventsWithIds('user-123', events);

            expect(summary.added).toBe(1);
            expect(summary.errors).toBe(1);
            expect(results).toHaveLength(1);
        });
    });
});
