import { Readable } from 'stream';
import {
    detectFormat,
    parseBasicTimestamp,
    parseBasicRecord,
    generateNormalizedKey,
    isBasicFormat,
    isExtendedFormat,
    extractUniqueTracksFromStream,
} from '../../src/lib/basic-import-parser';

describe('detectFormat', () => {
    it('should detect basic format from endTime field', () => {
        const record = {
            endTime: '2024-12-22 00:00',
            artistName: 'Artist',
            trackName: 'Track',
            msPlayed: 60000,
        };
        expect(detectFormat(record)).toBe('basic');
    });

    it('should detect extended format from spotify_track_uri field', () => {
        const record = {
            ts: '2024-12-22T00:00:00Z',
            ms_played: 60000,
            spotify_track_uri: 'spotify:track:abc123',
            master_metadata_track_name: 'Track',
            master_metadata_album_artist_name: 'Artist',
            master_metadata_album_album_name: 'Album',
        };
        expect(detectFormat(record)).toBe('extended');
    });

    it('should detect extended format from ts field', () => {
        const record = {
            ts: '2024-12-22T00:00:00Z',
            ms_played: 60000,
        };
        expect(detectFormat(record)).toBe('extended');
    });

    it('should default to basic for null/undefined', () => {
        expect(detectFormat(null)).toBe('basic');
        expect(detectFormat(undefined)).toBe('basic');
    });

    it('should default to basic for non-object', () => {
        expect(detectFormat('string')).toBe('basic');
        expect(detectFormat(123)).toBe('basic');
    });
});

describe('isBasicFormat', () => {
    it('should return true for valid basic format record', () => {
        const record = {
            endTime: '2024-12-22 00:00',
            artistName: 'Artist',
            trackName: 'Track',
            msPlayed: 60000,
        };
        expect(isBasicFormat(record)).toBe(true);
    });

    it('should return false for extended format record', () => {
        const record = {
            ts: '2024-12-22T00:00:00Z',
            ms_played: 60000,
            spotify_track_uri: 'spotify:track:abc123',
        };
        expect(isBasicFormat(record)).toBe(false);
    });

    it('should return false for incomplete basic record', () => {
        expect(isBasicFormat({ endTime: '2024-12-22 00:00' })).toBe(false);
        expect(isBasicFormat({ artistName: 'Artist' })).toBe(false);
    });
});

describe('isExtendedFormat', () => {
    it('should return true for valid extended format record', () => {
        const record = {
            ts: '2024-12-22T00:00:00Z',
            ms_played: 60000,
            spotify_track_uri: 'spotify:track:abc123',
        };
        expect(isExtendedFormat(record)).toBe(true);
    });

    it('should return false for basic format record', () => {
        const record = {
            endTime: '2024-12-22 00:00',
            artistName: 'Artist',
            trackName: 'Track',
            msPlayed: 60000,
        };
        expect(isExtendedFormat(record)).toBe(false);
    });
});

describe('parseBasicTimestamp', () => {
    it('should parse basic timestamp format', () => {
        const result = parseBasicTimestamp('2024-12-22 14:30', 'UTC');
        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(11); // 0-indexed
        expect(result.getDate()).toBe(22);
    });

    it('should handle midnight', () => {
        const result = parseBasicTimestamp('2024-12-22 00:00', 'UTC');
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
    });

    it('should handle end of day', () => {
        const result = parseBasicTimestamp('2024-12-22 23:59', 'UTC');
        expect(result.getHours()).toBe(23);
        expect(result.getMinutes()).toBe(59);
    });

    it('should fallback for invalid format', () => {
        const result = parseBasicTimestamp('invalid-date', 'UTC');
        expect(result).toBeInstanceOf(Date);
    });
});

describe('parseBasicRecord', () => {
    const validRecord = {
        endTime: '2024-12-22 14:30',
        artistName: 'Test Artist',
        trackName: 'Test Track',
        msPlayed: 60000,
    };

    it('should parse valid record', () => {
        const result = parseBasicRecord(validRecord, 'UTC');
        expect(result).not.toBeNull();
        expect(result!.trackName).toBe('Test Track');
        expect(result!.artistName).toBe('Test Artist');
        expect(result!.msPlayed).toBe(60000);
    });

    it('should calculate playedAt from endTime minus msPlayed', () => {
        const result = parseBasicRecord(validRecord, 'UTC');
        expect(result).not.toBeNull();

        // End time is 14:30, played for 60 seconds = started at 14:29
        expect(result!.playedAt.getMinutes()).toBe(29);
    });

    it('should return null for msPlayed below threshold', () => {
        const record = { ...validRecord, msPlayed: 1000 }; // 1 second
        const result = parseBasicRecord(record, 'UTC');
        expect(result).toBeNull();
    });

    it('should return null for missing trackName', () => {
        const record = { ...validRecord, trackName: '' };
        const result = parseBasicRecord(record, 'UTC');
        expect(result).toBeNull();
    });

    it('should return null for missing artistName', () => {
        const record = { ...validRecord, artistName: '' };
        const result = parseBasicRecord(record, 'UTC');
        expect(result).toBeNull();
    });

    it('should trim whitespace from names', () => {
        const record = {
            ...validRecord,
            trackName: '  Track With Spaces  ',
            artistName: '  Artist With Spaces  ',
        };
        const result = parseBasicRecord(record, 'UTC');
        expect(result!.trackName).toBe('Track With Spaces');
        expect(result!.artistName).toBe('Artist With Spaces');
    });
});

describe('generateNormalizedKey', () => {
    it('should generate lowercase key', () => {
        const key = generateNormalizedKey('Track Name', 'Artist Name');
        expect(key).toBe('track name::artist name');
    });

    it('should be consistent regardless of case', () => {
        const key1 = generateNormalizedKey('TRACK', 'ARTIST');
        const key2 = generateNormalizedKey('track', 'artist');
        expect(key1).toBe(key2);
    });

    it('should remove special characters', () => {
        const key = generateNormalizedKey("Don't Stop!", 'The Artist?');
        expect(key).toBe('dont stop::the artist');
    });

    it('should normalize multiple spaces', () => {
        const key = generateNormalizedKey('Track   Name', 'Artist    Name');
        expect(key).toBe('track name::artist name');
    });

    it('should generate unique keys for different inputs', () => {
        const key1 = generateNormalizedKey('Track A', 'Artist');
        const key2 = generateNormalizedKey('Track B', 'Artist');
        expect(key1).not.toBe(key2);
    });
});

describe('extractUniqueTracksFromStream', () => {
    it('should extract unique tracks from JSON stream', async () => {
        const records = [
            { endTime: '2024-12-22 14:30', artistName: 'Artist A', trackName: 'Track 1', msPlayed: 60000 },
            { endTime: '2024-12-22 15:00', artistName: 'Artist A', trackName: 'Track 1', msPlayed: 120000 },
            { endTime: '2024-12-22 16:00', artistName: 'Artist B', trackName: 'Track 2', msPlayed: 90000 },
        ];

        const stream = Readable.from(JSON.stringify(records));
        const result = await extractUniqueTracksFromStream(stream, 'UTC');

        expect(result.uniqueTracks.size).toBe(2);
        expect(result.events.length).toBe(3);
        expect(result.totalRecords).toBe(3);
    });

    it('should count occurrences of repeated tracks', async () => {
        const records = [
            { endTime: '2024-12-22 14:30', artistName: 'Artist', trackName: 'Track', msPlayed: 60000 },
            { endTime: '2024-12-22 15:00', artistName: 'Artist', trackName: 'Track', msPlayed: 60000 },
            { endTime: '2024-12-22 16:00', artistName: 'Artist', trackName: 'Track', msPlayed: 60000 },
        ];

        const stream = Readable.from(JSON.stringify(records));
        const result = await extractUniqueTracksFromStream(stream, 'UTC');

        const trackKey = generateNormalizedKey('Track', 'Artist');
        const uniqueTrack = result.uniqueTracks.get(trackKey);

        expect(uniqueTrack!.occurrences).toBe(3);
    });

    it('should sum total msPlayed for repeated tracks', async () => {
        const records = [
            { endTime: '2024-12-22 14:30', artistName: 'Artist', trackName: 'Track', msPlayed: 60000 },
            { endTime: '2024-12-22 15:00', artistName: 'Artist', trackName: 'Track', msPlayed: 90000 },
        ];

        const stream = Readable.from(JSON.stringify(records));
        const result = await extractUniqueTracksFromStream(stream, 'UTC');

        const trackKey = generateNormalizedKey('Track', 'Artist');
        const uniqueTrack = result.uniqueTracks.get(trackKey);

        expect(uniqueTrack!.totalMsPlayed).toBe(150000);
    });

    it('should skip records with short play time', async () => {
        const records = [
            { endTime: '2024-12-22 14:30', artistName: 'Artist', trackName: 'Track', msPlayed: 1000 },
            { endTime: '2024-12-22 15:00', artistName: 'Artist', trackName: 'Track', msPlayed: 60000 },
        ];

        const stream = Readable.from(JSON.stringify(records));
        const result = await extractUniqueTracksFromStream(stream, 'UTC');

        expect(result.events.length).toBe(1);
        expect(result.skippedRecords).toBe(1);
    });

    it('should call progress callback', async () => {
        // Create 1500 records to trigger multiple progress callbacks
        const records = Array.from({ length: 1500 }, (_, i) => ({
            endTime: '2024-12-22 14:30',
            artistName: 'Artist',
            trackName: `Track ${i}`,
            msPlayed: 60000,
        }));

        const progressCalls: number[] = [];
        const stream = Readable.from(JSON.stringify(records));

        await extractUniqueTracksFromStream(stream, 'UTC', (processed) => {
            progressCalls.push(processed);
        });

        // Should have been called at 1000 records
        expect(progressCalls).toContain(1000);
    });
});

