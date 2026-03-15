import { prisma } from '../../src/lib/prisma';
import { insertListeningEvents } from '../../src/services/ingestion';
import { Source } from '@prisma/client';
import type { ParsedListeningEvent } from '../../src/types/ingestion';

jest.mock('../../src/lib/redis', () => ({
    redis: {},
    closeRedis: jest.fn(),
    queueArtistForMetadata: jest.fn(),
    queueTrackForFeatures: jest.fn(),
}));

const TEST_DATE_1 = new Date('2025-01-01T12:00:00Z');

const createTestEvent = (overrides: Partial<ParsedListeningEvent> = {}): ParsedListeningEvent => ({
    spotifyTrackId: 'test-track-id',
    playedAt: TEST_DATE_1,
    msPlayed: 180000,
    isEstimated: true,
    source: Source.API,
    track: {
        spotifyId: 'test-track-id',
        name: 'Test Track',
        durationMs: 180000,
        previewUrl: null,
        album: {
            spotifyId: 'album-id',
            name: 'Test Album',
            imageUrl: null,
            releaseDate: null,
        },
        artists: [
            {
                spotifyId: 'artist-id',
                name: 'Test Artist',
            },
        ],
    },
    ...overrides,
});

/** Set up catalog mocks so bulkUpsertCatalog resolves track IDs correctly */
function setupCatalogMocks() {
    (prisma.album.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.album.findMany as jest.Mock).mockResolvedValue([{ id: 'db-album-id', spotifyId: 'album-id' }]);
    (prisma.artist.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.artist.findMany as jest.Mock).mockResolvedValue([{ id: 'db-artist-id', spotifyId: 'artist-id', imageUrl: null }]);
    (prisma.track.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.track.findMany as jest.Mock).mockResolvedValue([{ id: 'db-track-id', spotifyId: 'test-track-id' }]);
    (prisma.trackArtist.createMany as jest.Mock).mockResolvedValue({ count: 0 });

    // The batch API uses interactive transactions: $transaction(async (tx) => { ... })
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') return arg(prisma);
        return Promise.all(arg);
    });
}

describe('Ingestion Service', () => {
    beforeEach(() => {
        setupCatalogMocks();
    });

    test('inserts new record when not existing', async () => {
        // No existing events
        (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.listeningEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });

        const event = createTestEvent();
        const summary = await insertListeningEvents('user-id', [event]);

        expect(summary.added).toBe(1);
        expect(summary.skipped).toBe(0);
        expect(prisma.listeningEvent.createMany).toHaveBeenCalled();
    });

    test('skips duplicate API record if exists', async () => {
        (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([
            { trackId: 'db-track-id', playedAt: TEST_DATE_1, isEstimated: true, source: Source.API },
        ]);

        const event = createTestEvent({ source: Source.API });
        const summary = await insertListeningEvents('user-id', [event]);

        expect(summary.skipped).toBe(1);
        expect(summary.added).toBe(0);
    });

    test('import claims estimated record (update)', async () => {
        (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([
            { trackId: 'db-track-id', playedAt: TEST_DATE_1, isEstimated: true, source: Source.API },
        ]);

        const importEvent = createTestEvent({
            isEstimated: false,
            source: Source.IMPORT,
            msPlayed: 45000,
        });
        const summary = await insertListeningEvents('user-id', [importEvent]);

        expect(summary.updated).toBe(1);
        expect(prisma.listeningEvent.update).toHaveBeenCalled();
    });

    test('import does not overwrite ground truth (existing import)', async () => {
        (prisma.listeningEvent.findMany as jest.Mock).mockResolvedValue([
            { trackId: 'db-track-id', playedAt: TEST_DATE_1, isEstimated: false, source: Source.IMPORT },
        ]);

        const secondImport = createTestEvent({ source: Source.IMPORT });
        const summary = await insertListeningEvents('user-id', [secondImport]);

        expect(summary.skipped).toBe(1);
        expect(prisma.listeningEvent.update).not.toHaveBeenCalled();
    });
});
