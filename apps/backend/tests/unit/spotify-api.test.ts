// Mock p-retry to avoid ESM issues
jest.mock('p-retry', () => ({
    __esModule: true,
    default: jest.fn(async (fn: () => Promise<unknown>) => fn()),
}));

import { mockFetch, restoreFetch, createMockResponse } from '../mocks/fetch.mock';
import { getRecentlyPlayed, getArtistsBatch, getTrack } from '../../src/lib/spotify-api';
import {
    SpotifyUnauthenticatedError,
    SpotifyForbiddenError,
    SpotifyRateLimitError,
    SpotifyDownError,
    SpotifyApiError,
} from '../../src/lib/spotify-errors';

describe('spotify-api', () => {
    afterEach(() => {
        restoreFetch();
    });

    describe('getRecentlyPlayed', () => {
        const mockRecentlyPlayedResponse = {
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
            cursors: { after: '123', before: '456' },
        };

        test('returns parsed response on success', async () => {
            mockFetch(async () => createMockResponse(200, mockRecentlyPlayedResponse));

            const result = await getRecentlyPlayed('valid-token');
            expect(result.items).toHaveLength(1);
            expect(result.items[0].track.id).toBe('track-123');
        });

        test('passes limit parameter', async () => {
            let capturedUrl = '';
            mockFetch(async (url) => {
                capturedUrl = url;
                return createMockResponse(200, mockRecentlyPlayedResponse);
            });

            await getRecentlyPlayed('token', { limit: 25 });
            expect(capturedUrl).toContain('limit=25');
        });

        test('passes after parameter', async () => {
            let capturedUrl = '';
            mockFetch(async (url) => {
                capturedUrl = url;
                return createMockResponse(200, mockRecentlyPlayedResponse);
            });

            await getRecentlyPlayed('token', { after: 1234567890 });
            expect(capturedUrl).toContain('after=1234567890');
        });

        test('throws SpotifyUnauthenticatedError on 401', async () => {
            mockFetch(async () => createMockResponse(401, { error: 'Unauthorized' }));

            await expect(getRecentlyPlayed('bad-token')).rejects.toThrow(
                SpotifyUnauthenticatedError
            );
        });

        test('throws SpotifyForbiddenError on 403', async () => {
            mockFetch(async () => createMockResponse(403, { error: 'Forbidden' }));

            await expect(getRecentlyPlayed('token')).rejects.toThrow(SpotifyForbiddenError);
        });

        test('throws SpotifyRateLimitError on 429 with Retry-After header', async () => {
            mockFetch(async () =>
                createMockResponse(429, { error: 'Rate limited' }, { 'Retry-After': '120' })
            );

            try {
                await getRecentlyPlayed('token');
                fail('Expected SpotifyRateLimitError');
            } catch (error) {
                expect(error).toBeInstanceOf(SpotifyRateLimitError);
                expect((error as SpotifyRateLimitError).retryAfterSeconds).toBe(120);
            }
        });

        test('throws SpotifyDownError on 500', async () => {
            // Disable retry for test speed
            mockFetch(async () => createMockResponse(500, { error: 'Server error' }));

            await expect(getRecentlyPlayed('token')).rejects.toThrow(SpotifyDownError);
        });

        test('throws SpotifyDownError on 503', async () => {
            mockFetch(async () => createMockResponse(503, { error: 'Service unavailable' }));

            await expect(getRecentlyPlayed('token')).rejects.toThrow(SpotifyDownError);
        });

        test('throws SpotifyApiError on other 4xx errors', async () => {
            mockFetch(async () => createMockResponse(400, { error: 'Bad request' }));

            await expect(getRecentlyPlayed('token')).rejects.toThrow(SpotifyApiError);
        });
    });

    describe('getArtistsBatch', () => {
        const mockArtistsBatchResponse = {
            artists: [
                {
                    id: 'artist-1',
                    name: 'Artist One',
                    images: [{ url: 'https://example.com/a1.jpg', height: 640, width: 640 }],
                    genres: ['pop'],
                    popularity: 80,
                },
            ],
        };

        test('returns artists on success', async () => {
            mockFetch(async () => createMockResponse(200, mockArtistsBatchResponse));

            const result = await getArtistsBatch('token', ['artist-1']);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Artist One');
        });

        test('returns empty array for empty input', async () => {
            const result = await getArtistsBatch('token', []);
            expect(result).toEqual([]);
        });

        test('throws error for more than 50 artists', async () => {
            const ids = Array.from({ length: 51 }, (_, i) => `artist-${i}`);
            await expect(getArtistsBatch('token', ids)).rejects.toThrow(
                'Cannot fetch more than 50 artists at once'
            );
        });

        test('passes artist IDs in URL', async () => {
            let capturedUrl = '';
            mockFetch(async (url) => {
                capturedUrl = url;
                return createMockResponse(200, mockArtistsBatchResponse);
            });

            await getArtistsBatch('token', ['a1', 'a2', 'a3']);
            expect(capturedUrl).toContain('ids=a1,a2,a3');
        });
    });

    describe('getTrack', () => {
        const mockTrackResponse = {
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
        };

        test('returns track on success', async () => {
            mockFetch(async () => createMockResponse(200, mockTrackResponse));

            const result = await getTrack('token', 'track-123');
            expect(result.id).toBe('track-123');
            expect(result.name).toBe('Test Track');
        });

        test('includes track ID in URL', async () => {
            let capturedUrl = '';
            mockFetch(async (url) => {
                capturedUrl = url;
                return createMockResponse(200, mockTrackResponse);
            });

            await getTrack('token', 'my-track-id');
            expect(capturedUrl).toContain('/tracks/my-track-id');
        });
    });
});
