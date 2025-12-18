import { prisma } from '../../src/lib/prisma';
import { insertListeningEvent } from '../../src/services/ingestion';
import type { ParsedListeningEvent } from '../../src/types/ingestion';

// Test user and track IDs; created fresh each test
let testUserId: string;
let testTrackData: ParsedListeningEvent['track'];

const createTestEvent = (overrides: Partial<ParsedListeningEvent> = {}): ParsedListeningEvent => ({
    spotifyTrackId: testTrackData.spotifyId,
    playedAt: new Date('2025-01-01T12:00:00Z'),
    msPlayed: 180000,
    isEstimated: true,
    source: 'api',
    track: testTrackData,
    ...overrides,
});

describe('Idempotency', () => {
    beforeAll(async () => {
        // Create test user
        const user = await prisma.user.create({
            data: {
                spotifyId: `test-spotify-${Date.now()}`,
                displayName: 'Test User',
            },
        });
        testUserId = user.id;

        // Create test album
        const album = await prisma.album.create({
            data: {
                spotifyId: `test-album-${Date.now()}`,
                name: 'Test Album',
            },
        });

        // Create test artist
        const artist = await prisma.artist.create({
            data: {
                spotifyId: `test-artist-${Date.now()}`,
                name: 'Test Artist',
            },
        });

        // Set up track data for tests
        testTrackData = {
            spotifyId: `test-track-${Date.now()}`,
            name: 'Test Track',
            durationMs: 180000,
            previewUrl: null,
            album: {
                spotifyId: album.spotifyId,
                name: album.name,
                imageUrl: null,
                releaseDate: null,
            },
            artists: [
                {
                    spotifyId: artist.spotifyId,
                    name: artist.name,
                },
            ],
        };
    });

    afterAll(async () => {
        // Clean up test data
        await prisma.listeningEvent.deleteMany({
            where: { userId: testUserId },
        });
        await prisma.user.delete({ where: { id: testUserId } });
        await prisma.$disconnect();
    });

    beforeEach(async () => {
        // Clear listening events before each test
        await prisma.listeningEvent.deleteMany({
            where: { userId: testUserId },
        });
    });

    test('inserts new record', async () => {
        const event = createTestEvent();
        const result = await insertListeningEvent(testUserId, event);
        expect(result).toBe('added');

        const count = await prisma.listeningEvent.count({
            where: { userId: testUserId },
        });
        expect(count).toBe(1);
    });

    test('skips duplicate API record', async () => {
        const event = createTestEvent();

        // First insert
        const first = await insertListeningEvent(testUserId, event);
        expect(first).toBe('added');

        // Second insert (same event)
        const second = await insertListeningEvent(testUserId, event);
        expect(second).toBe('skipped');

        const count = await prisma.listeningEvent.count({
            where: { userId: testUserId },
        });
        expect(count).toBe(1);
    });

    test('import claims estimated record', async () => {
        // First: API inserts estimated record
        const apiEvent = createTestEvent({
            isEstimated: true,
            source: 'api',
            msPlayed: 180000,
        });
        await insertListeningEvent(testUserId, apiEvent);

        // Then: Import with real ms_played
        const importEvent = createTestEvent({
            isEstimated: false,
            source: 'import',
            msPlayed: 45000, // Actual listen time
        });
        const result = await insertListeningEvent(testUserId, importEvent);
        expect(result).toBe('updated');

        // Verify update
        const record = await prisma.listeningEvent.findFirst({
            where: { userId: testUserId },
        });
        expect(record?.msPlayed).toBe(45000);
        expect(record?.isEstimated).toBe(false);
        expect(record?.source).toBe('import');
    });

    test('import does not overwrite ground truth', async () => {
        // Insert with ground truth
        const truthEvent = createTestEvent({
            isEstimated: false,
            source: 'import',
            msPlayed: 45000,
        });
        await insertListeningEvent(testUserId, truthEvent);

        // Try to overwrite with different ms_played
        const secondImport = createTestEvent({
            isEstimated: false,
            source: 'import',
            msPlayed: 99999,
        });
        const result = await insertListeningEvent(testUserId, secondImport);
        expect(result).toBe('skipped');

        // Verify original value preserved
        const record = await prisma.listeningEvent.findFirst({
            where: { userId: testUserId },
        });
        expect(record?.msPlayed).toBe(45000);
    });

    test('different playedAt creates new record', async () => {
        const event1 = createTestEvent({
            playedAt: new Date('2025-01-01T12:00:00Z'),
        });
        const event2 = createTestEvent({
            playedAt: new Date('2025-01-01T13:00:00Z'),
        });

        await insertListeningEvent(testUserId, event1);
        await insertListeningEvent(testUserId, event2);

        const count = await prisma.listeningEvent.count({
            where: { userId: testUserId },
        });
        expect(count).toBe(2);
    });
});
