import { prisma } from '../../src/lib/prisma';
import { insertListeningEvent } from '../../src/services/ingestion';
import { Source } from '@prisma/client';
import type { ParsedListeningEvent } from '../../src/types/ingestion';
import { ensurePartitionForDate } from '../setup';

let testUserId: string;
let testTrackData: ParsedListeningEvent['track'];

const TEST_DATE_1 = new Date('2025-01-01T12:00:00Z');
const TEST_DATE_2 = new Date('2025-01-01T13:00:00Z');

const createTestEvent = (overrides: Partial<ParsedListeningEvent> = {}): ParsedListeningEvent => ({
    spotifyTrackId: testTrackData.spotifyId,
    playedAt: TEST_DATE_1,
    msPlayed: 180000,
    isEstimated: true,
    source: Source.API,
    track: testTrackData,
    ...overrides,
});

describe('Idempotency', () => {
    beforeAll(async () => {
        await ensurePartitionForDate(TEST_DATE_1);
        await ensurePartitionForDate(TEST_DATE_2);

        const user = await prisma.user.create({
            data: {
                spotifyId: `test-spotify-${Date.now()}`,
                displayName: 'Test User',
            },
        });
        testUserId = user.id;

        const album = await prisma.album.create({
            data: {
                spotifyId: `test-album-${Date.now()}`,
                name: 'Test Album',
            },
        });

        const artist = await prisma.artist.create({
            data: {
                spotifyId: `test-artist-${Date.now()}`,
                name: 'Test Artist',
            },
        });

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
        await prisma.listeningEvent.deleteMany({
            where: { userId: testUserId },
        });
        await prisma.user.delete({ where: { id: testUserId } });
        await prisma.$disconnect();
    });

    beforeEach(async () => {
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

        const first = await insertListeningEvent(testUserId, event);
        expect(first).toBe('added');

        const second = await insertListeningEvent(testUserId, event);
        expect(second).toBe('skipped');

        const count = await prisma.listeningEvent.count({
            where: { userId: testUserId },
        });
        expect(count).toBe(1);
    });

    test('import claims estimated record', async () => {
        const apiEvent = createTestEvent({
            isEstimated: true,
            source: Source.API,
            msPlayed: 180000,
        });
        await insertListeningEvent(testUserId, apiEvent);

        const importEvent = createTestEvent({
            isEstimated: false,
            source: Source.IMPORT,
            msPlayed: 45000,
        });
        const result = await insertListeningEvent(testUserId, importEvent);
        expect(result).toBe('updated');

        const record = await prisma.listeningEvent.findFirst({
            where: { userId: testUserId },
        });
        expect(record?.msPlayed).toBe(45000);
        expect(record?.isEstimated).toBe(false);
        expect(record?.source).toBe(Source.IMPORT);
    });

    test('import does not overwrite ground truth', async () => {
        const truthEvent = createTestEvent({
            isEstimated: false,
            source: Source.IMPORT,
            msPlayed: 45000,
        });
        await insertListeningEvent(testUserId, truthEvent);

        const secondImport = createTestEvent({
            isEstimated: false,
            source: Source.IMPORT,
            msPlayed: 99999,
        });
        const result = await insertListeningEvent(testUserId, secondImport);
        expect(result).toBe('skipped');

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
