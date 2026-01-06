import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';

export interface BasicStreamingRecord {
    endTime: string;      // "2024-12-22 00:00" (no timezone, no seconds)
    artistName: string;
    trackName: string;
    msPlayed: number;
}

export interface ExtendedStreamingRecord {
    ts: string;
    ms_played: number;
    spotify_track_uri: string | null;
    master_metadata_track_name: string | null;
    master_metadata_album_artist_name: string | null;
    master_metadata_album_album_name: string | null;
}

export type StreamingFormat = 'basic' | 'extended';

export interface ParsedBasicEvent {
    trackName: string;
    artistName: string;
    playedAt: Date;
    msPlayed: number;
}

export interface UniqueTrack {
    trackName: string;
    artistName: string;
    normalizedKey: string;
    occurrences: number;
    totalMsPlayed: number;
}

const MIN_PLAY_MS = 5000; // Minimum 5 seconds to import

export function detectFormat(firstRecord: unknown): StreamingFormat {
    if (!firstRecord || typeof firstRecord !== 'object') {
        return 'basic';
    }

    const record = firstRecord as Record<string, unknown>;

    if ('spotify_track_uri' in record || 'ts' in record || 'ms_played' in record) {
        return 'extended';
    }

    if ('endTime' in record && 'artistName' in record && 'trackName' in record) {
        return 'basic';
    }

    return 'basic';
}

export function parseBasicTimestamp(endTime: string, userTimezone: string): Date {
    const match = endTime.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) {
        // Fallback: try to parse as-is
        return new Date(endTime);
    }

    const [, year, month, day, hour, minute] = match;

    const isoString = `${year}-${month}-${day}T${hour}:${minute}:00`;

    try {
        // Create date in UTC first
        const utcDate = new Date(isoString + 'Z');

        // Get timezone offset for user's timezone at this date
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: userTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });

        const parts = formatter.formatToParts(utcDate);
        const localParts: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== 'literal') {
                localParts[part.type] = part.value;
            }
        }

        // Treat input as local time
        return new Date(isoString);
    } catch {
        // Fallback if timezone is invalid
        return new Date(isoString);
    }
}

export function parseBasicRecord(
    record: BasicStreamingRecord,
    userTimezone: string
): ParsedBasicEvent | null {
    if (record.msPlayed < MIN_PLAY_MS) {
        return null;
    }

    if (!record.trackName || !record.artistName) {
        return null;
    }

    const endTime = parseBasicTimestamp(record.endTime, userTimezone);
    const playedAt = new Date(endTime.getTime() - record.msPlayed);

    return {
        trackName: record.trackName.trim(),
        artistName: record.artistName.trim(),
        playedAt,
        msPlayed: record.msPlayed,
    };
}

function normalizeForKey(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function generateNormalizedKey(trackName: string, artistName: string): string {
    return `${normalizeForKey(trackName)}::${normalizeForKey(artistName)}`;
}

export async function extractUniqueTracksFromStream(
    fileStream: NodeJS.ReadableStream,
    userTimezone: string,
    onProgress?: (processed: number) => void
): Promise<{
    uniqueTracks: Map<string, UniqueTrack>;
    events: ParsedBasicEvent[];
    totalRecords: number;
    skippedRecords: number;
}> {
    const uniqueTracks = new Map<string, UniqueTrack>();
    const events: ParsedBasicEvent[] = [];
    let totalRecords = 0;
    let skippedRecords = 0;

    const jsonStream = fileStream
        .pipe(parser())
        .pipe(streamArray());

    for await (const { value } of jsonStream) {
        totalRecords++;

        const parsed = parseBasicRecord(value as BasicStreamingRecord, userTimezone);

        if (parsed) {
            events.push(parsed);

            const key = generateNormalizedKey(parsed.trackName, parsed.artistName);
            const existing = uniqueTracks.get(key);

            if (existing) {
                existing.occurrences++;
                existing.totalMsPlayed += parsed.msPlayed;
            } else {
                uniqueTracks.set(key, {
                    trackName: parsed.trackName,
                    artistName: parsed.artistName,
                    normalizedKey: key,
                    occurrences: 1,
                    totalMsPlayed: parsed.msPlayed,
                });
            }
        } else {
            skippedRecords++;
        }

        if (onProgress && totalRecords % 1000 === 0) {
            onProgress(totalRecords);
        }
    }

    return {
        uniqueTracks,
        events,
        totalRecords,
        skippedRecords,
    };
}

export function isBasicFormat(record: unknown): record is BasicStreamingRecord {
    if (!record || typeof record !== 'object') return false;
    const r = record as Record<string, unknown>;
    return (
        typeof r.endTime === 'string' &&
        typeof r.artistName === 'string' &&
        typeof r.trackName === 'string' &&
        typeof r.msPlayed === 'number'
    );
}

export function isExtendedFormat(record: unknown): record is ExtendedStreamingRecord {
    if (!record || typeof record !== 'object') return false;
    const r = record as Record<string, unknown>;
    return (
        typeof r.ts === 'string' &&
        typeof r.ms_played === 'number' &&
        'spotify_track_uri' in r
    );
}

