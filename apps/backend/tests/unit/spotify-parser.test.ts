import { parseRecentlyPlayed } from '../../src/lib/spotify-parser';
import { Source } from '@prisma/client';
import type { SpotifyRecentlyPlayedResponse } from '../../src/types/spotify';

describe('parseRecentlyPlayed', () => {
    const createMockResponse = (
        overrides: Partial<SpotifyRecentlyPlayedResponse['items'][0]> = {}
    ): SpotifyRecentlyPlayedResponse => ({
        items: [
            {
                played_at: '2025-01-01T12:00:00Z',
                track: {
                    id: 'track-123',
                    name: 'Test Track',
                    duration_ms: 180000,
                    preview_url: 'https://example.com/preview.mp3',
                    album: {
                        id: 'album-123',
                        name: 'Test Album',
                        images: [{ url: 'https://example.com/image.jpg', height: 640, width: 640 }],
                        release_date: '2025-01-01',
                    },
                    artists: [{ id: 'artist-123', name: 'Test Artist' }],
                },
                ...overrides,
            },
        ],
        cursors: { after: '123', before: '456' },
    });

    test('parses valid Spotify response', () => {
        const response = createMockResponse();
        const result = parseRecentlyPlayed(response);

        expect(result).toHaveLength(1);
        expect(result[0].spotifyTrackId).toBe('track-123');
        expect(result[0].playedAt).toEqual(new Date('2025-01-01T12:00:00Z'));
        expect(result[0].msPlayed).toBe(180000);
        expect(result[0].isEstimated).toBe(true);
        expect(result[0].source).toBe(Source.API);
    });

    test('extracts track data correctly', () => {
        const response = createMockResponse();
        const result = parseRecentlyPlayed(response);
        const track = result[0].track;

        expect(track.spotifyId).toBe('track-123');
        expect(track.name).toBe('Test Track');
        expect(track.durationMs).toBe(180000);
        expect(track.previewUrl).toBe('https://example.com/preview.mp3');
    });

    test('extracts album data correctly', () => {
        const response = createMockResponse();
        const result = parseRecentlyPlayed(response);
        const album = result[0].track.album;

        expect(album.spotifyId).toBe('album-123');
        expect(album.name).toBe('Test Album');
        expect(album.imageUrl).toBe('https://example.com/image.jpg');
        expect(album.releaseDate).toBe('2025-01-01');
    });

    test('extracts artist data correctly', () => {
        const response = createMockResponse();
        const result = parseRecentlyPlayed(response);
        const artists = result[0].track.artists;

        expect(artists).toHaveLength(1);
        expect(artists[0].spotifyId).toBe('artist-123');
        expect(artists[0].name).toBe('Test Artist');
    });

    test('handles empty items array', () => {
        const response: SpotifyRecentlyPlayedResponse = {
            items: [],
            cursors: undefined,
        };
        const result = parseRecentlyPlayed(response);
        expect(result).toHaveLength(0);
    });

    test('handles missing album images', () => {
        const response: SpotifyRecentlyPlayedResponse = {
            items: [
                {
                    played_at: '2025-01-01T12:00:00Z',
                    track: {
                        id: 'track-123',
                        name: 'Test Track',
                        duration_ms: 180000,
                        preview_url: null,
                        album: {
                            id: 'album-123',
                            name: 'Test Album',
                            images: [],
                            release_date: '2025-01-01',
                        },
                        artists: [{ id: 'artist-123', name: 'Test Artist' }],
                    },
                },
            ],
        };
        const result = parseRecentlyPlayed(response);
        expect(result[0].track.album.imageUrl).toBeNull();
    });

    test('handles null preview_url', () => {
        const response = createMockResponse();
        response.items[0].track.preview_url = null;
        const result = parseRecentlyPlayed(response);
        expect(result[0].track.previewUrl).toBeNull();
    });

    test('handles multiple artists', () => {
        const response: SpotifyRecentlyPlayedResponse = {
            items: [
                {
                    played_at: '2025-01-01T12:00:00Z',
                    track: {
                        id: 'track-123',
                        name: 'Collab Track',
                        duration_ms: 200000,
                        preview_url: null,
                        album: {
                            id: 'album-123',
                            name: 'Test Album',
                            images: [],
                            release_date: '2025-01-01',
                        },
                        artists: [
                            { id: 'artist-1', name: 'Artist One' },
                            { id: 'artist-2', name: 'Artist Two' },
                            { id: 'artist-3', name: 'Artist Three' },
                        ],
                    },
                },
            ],
        };
        const result = parseRecentlyPlayed(response);
        expect(result[0].track.artists).toHaveLength(3);
        expect(result[0].track.artists[1].name).toBe('Artist Two');
    });

    test('sets isEstimated to true for all items', () => {
        const response: SpotifyRecentlyPlayedResponse = {
            items: [
                {
                    played_at: '2025-01-01T12:00:00Z',
                    track: {
                        id: 'track-1',
                        name: 'Track 1',
                        duration_ms: 180000,
                        preview_url: null,
                        album: { id: 'a1', name: 'A1', images: [], release_date: '2025' },
                        artists: [{ id: 'ar1', name: 'Ar1' }],
                    },
                },
                {
                    played_at: '2025-01-01T12:05:00Z',
                    track: {
                        id: 'track-2',
                        name: 'Track 2',
                        duration_ms: 200000,
                        preview_url: null,
                        album: { id: 'a2', name: 'A2', images: [], release_date: '2025' },
                        artists: [{ id: 'ar2', name: 'Ar2' }],
                    },
                },
            ],
        };
        const result = parseRecentlyPlayed(response);
        expect(result.every((e) => e.isEstimated === true)).toBe(true);
        expect(result.every((e) => e.source === Source.API)).toBe(true);
    });
});
