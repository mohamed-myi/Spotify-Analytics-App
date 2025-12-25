process.env.REDIS_URL = 'redis://mock:6379';

jest.mock('../../../src/lib/redis', () => ({
    redis: {},
    queueArtistForMetadata: jest.fn(),
    queueTrackForFeatures: jest.fn(),
}));

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
        createMany: jest.fn(),
    },
    listeningEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    user: {
        update: jest.fn(),
    },
    $transaction: jest.fn((queries: Promise<any>[]) => Promise.all(queries)),
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
import { Source } from '@prisma/client';
import type { ParsedListeningEvent } from '../../../src/types/ingestion';

describe('services/ingestion', () => {
    const createTestEvent = (overrides: Partial<ParsedListeningEvent> = {}): ParsedListeningEvent => ({
        spotifyTrackId: 'spotify:track:test123',
        playedAt: new Date('2025-01-01T12:00:00Z'),
        msPlayed: 180000,
        isEstimated: true,
        source: Source.API,
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
                source: Source.API,
            });

            const event = createTestEvent({ source: Source.API });
            const result = await insertListeningEventWithIds('user-123', event);

            expect(result.status).toBe('skipped');
            expect(mockPrisma.listeningEvent.create).not.toHaveBeenCalled();
        });

        it('updates estimated event with import data', async () => {
            mockPrisma.listeningEvent.findUnique.mockResolvedValue({
                isEstimated: true,
                source: Source.API,
            });
            mockPrisma.listeningEvent.update.mockResolvedValue({});

            const event = createTestEvent({
                source: Source.IMPORT,
                isEstimated: false,
            });
            const result = await insertListeningEventWithIds('user-123', event);

            expect(result.status).toBe('updated');
            expect(mockPrisma.listeningEvent.update).toHaveBeenCalled();
        });

        it('skips when existing event is not estimated', async () => {
            mockPrisma.listeningEvent.findUnique.mockResolvedValue({
                isEstimated: false,
                source: Source.IMPORT,
            });

            const event = createTestEvent({ source: Source.IMPORT });
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

        it('creates track_artists join records for new track', async () => {
            const event = createTestEvent({
                track: {
                    spotifyId: 'new-track-123',
                    name: 'New Track',
                    durationMs: 200000,
                    previewUrl: null,
                    album: {
                        spotifyId: 'album123',
                        name: 'Test Album',
                        imageUrl: null,
                        releaseDate: null,
                    },
                    artists: [
                        { spotifyId: 'artist1', name: 'Artist One' },
                        { spotifyId: 'artist2', name: 'Artist Two' },
                    ],
                },
            });

            mockPrisma.artist.create
                .mockResolvedValueOnce({ id: 'artist-uuid-1' })
                .mockResolvedValueOnce({ id: 'artist-uuid-2' });

            await insertListeningEventWithIds('user-123', event);

            expect(mockPrisma.track.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        artists: {
                            create: [
                                { artistId: 'artist-uuid-1' },
                                { artistId: 'artist-uuid-2' },
                            ],
                        },
                    }),
                })
            );
        });

        it('creates track_artists join records for existing track with createMany', async () => {
            mockPrisma.track.findUnique.mockResolvedValue({ id: 'existing-track' });
            mockPrisma.track.update.mockResolvedValue({ id: 'existing-track' });
            mockPrisma.trackArtist.createMany.mockResolvedValue({ count: 2 });

            const event = createTestEvent({
                track: {
                    spotifyId: 'existing-track-123',
                    name: 'Existing Track',
                    durationMs: 200000,
                    previewUrl: null,
                    album: {
                        spotifyId: 'album123',
                        name: 'Test Album',
                        imageUrl: null,
                        releaseDate: null,
                    },
                    artists: [
                        { spotifyId: 'artist1', name: 'Artist One' },
                        { spotifyId: 'artist2', name: 'Artist Two' },
                    ],
                },
            });

            mockPrisma.artist.create
                .mockResolvedValueOnce({ id: 'artist-uuid-1' })
                .mockResolvedValueOnce({ id: 'artist-uuid-2' });

            await insertListeningEventWithIds('user-123', event);

            expect(mockPrisma.trackArtist.createMany).toHaveBeenCalledWith({
                data: [
                    { trackId: 'existing-track', artistId: 'artist-uuid-1' },
                    { trackId: 'existing-track', artistId: 'artist-uuid-2' },
                ],
                skipDuplicates: true,
            });
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

        it('performs batch user stats update after processing all events', async () => {
            const events = [
                createTestEvent({ playedAt: new Date('2025-01-01T12:00:00Z'), msPlayed: 180000 }),
                createTestEvent({ playedAt: new Date('2025-01-01T13:00:00Z'), msPlayed: 240000 }),
            ];

            await insertListeningEventsWithIds('user-123', events);

            expect(mockPrisma.user.update).toHaveBeenCalledWith({
                where: { id: 'user-123' },
                data: {
                    totalPlayCount: { increment: 2 },
                    totalListeningMs: { increment: 420000 },
                },
            });

            expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
        });

        it('does not call user.update when no events are added', async () => {
            mockPrisma.listeningEvent.findUnique.mockResolvedValue({
                isEstimated: false,
                source: Source.IMPORT,
            });

            const events = [createTestEvent()];

            await insertListeningEventsWithIds('user-123', events);

            expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });
    });

    describe('atomic transaction for single insert', () => {
        it('uses $transaction for event creation and user stats update', async () => {
            const event = createTestEvent();

            await insertListeningEventWithIds('user-123', event);

            expect(mockPrisma.$transaction).toHaveBeenCalled();

            const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
            expect(Array.isArray(transactionArg)).toBe(true);
            expect(transactionArg.length).toBe(2);
        });

        it('includes user stats increment in transaction', async () => {
            const event = createTestEvent({ msPlayed: 200000 });

            await insertListeningEventWithIds('user-123', event);

            expect(mockPrisma.user.update).toHaveBeenCalledWith({
                where: { id: 'user-123' },
                data: {
                    totalPlayCount: { increment: 1 },
                    totalListeningMs: { increment: 200000 },
                },
            });
        });
    });
});
