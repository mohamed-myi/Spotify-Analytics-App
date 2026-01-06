import { findBestMatch, buildSearchQuery, generateCacheKey } from '../../src/services/track-matcher';
import type { SpotifyTrack } from '../../src/types/spotify';

function createMockTrack(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
    return {
        id: 'mock-id',
        name: 'Mock Track',
        duration_ms: 200000,
        popularity: 50,
        explicit: false,
        preview_url: null,
        album: {
            id: 'album-id',
            name: 'Mock Album',
            images: [],
            release_date: '2024-01-01',
        },
        artists: [{ id: 'artist-id', name: 'Mock Artist' }],
        ...overrides,
    };
}

describe('findBestMatch', () => {
    const query = {
        trackName: 'Bohemian Rhapsody',
        artistName: 'Queen',
        msPlayed: 354000,
    };

    it('should return null when no results provided', () => {
        const result = findBestMatch([], query);
        expect(result.spotifyTrackId).toBeNull();
        expect(result.confidence).toBe(0);
    });

    it('should match exact track and artist name', () => {
        const tracks = [
            createMockTrack({
                id: 'correct-id',
                name: 'Bohemian Rhapsody',
                artists: [{ id: 'a1', name: 'Queen' }],
                duration_ms: 354000,
            }),
        ];

        const result = findBestMatch(tracks, query);
        expect(result.spotifyTrackId).toBe('correct-id');
        expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should handle case-insensitive matching', () => {
        const tracks = [
            createMockTrack({
                id: 'correct-id',
                name: 'BOHEMIAN RHAPSODY',
                artists: [{ id: 'a1', name: 'QUEEN' }],
            }),
        ];

        const result = findBestMatch(tracks, query);
        expect(result.spotifyTrackId).toBe('correct-id');
    });

    it('should match tracks with remastered suffix', () => {
        const tracks = [
            createMockTrack({
                id: 'correct-id',
                name: 'Bohemian Rhapsody - Remastered 2011',
                artists: [{ id: 'a1', name: 'Queen' }],
            }),
        ];

        const result = findBestMatch(tracks, query);
        expect(result.spotifyTrackId).toBe('correct-id');
        expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should reject tracks with low artist similarity', () => {
        const tracks = [
            createMockTrack({
                id: 'wrong-id',
                name: 'Bohemian Rhapsody',
                artists: [{ id: 'a1', name: 'Completely Different Artist' }],
            }),
        ];

        const result = findBestMatch(tracks, query, 0.7);
        expect(result.spotifyTrackId).toBeNull();
    });

    it('should prefer higher popularity on tie-breaker', () => {
        const tracks = [
            createMockTrack({
                id: 'low-pop',
                name: 'Bohemian Rhapsody',
                artists: [{ id: 'a1', name: 'Queen' }],
                popularity: 30,
            }),
            createMockTrack({
                id: 'high-pop',
                name: 'Bohemian Rhapsody',
                artists: [{ id: 'a1', name: 'Queen' }],
                popularity: 90,
            }),
        ];

        const result = findBestMatch(tracks, query);
        expect(result.spotifyTrackId).toBe('high-pop');
    });

    it('should select best match from multiple candidates', () => {
        const tracks = [
            createMockTrack({
                id: 'wrong-artist',
                name: 'Bohemian Rhapsody',
                artists: [{ id: 'a1', name: 'Some Cover Band' }],
            }),
            createMockTrack({
                id: 'correct',
                name: 'Bohemian Rhapsody',
                artists: [{ id: 'a1', name: 'Queen' }],
            }),
            createMockTrack({
                id: 'wrong-track',
                name: 'Different Song',
                artists: [{ id: 'a1', name: 'Queen' }],
            }),
        ];

        const result = findBestMatch(tracks, query);
        expect(result.spotifyTrackId).toBe('correct');
    });

    it('should handle feat. in track names', () => {
        const tracks = [
            createMockTrack({
                id: 'correct-id',
                name: 'Bohemian Rhapsody (feat. Some Artist)',
                artists: [{ id: 'a1', name: 'Queen' }],
            }),
        ];

        const result = findBestMatch(tracks, query);
        expect(result.spotifyTrackId).toBe('correct-id');
    });

    it('should return confidence below threshold as no match', () => {
        const tracks = [
            createMockTrack({
                id: 'partial-match',
                name: 'Bohemian',
                artists: [{ id: 'a1', name: 'Queen' }],
            }),
        ];

        const result = findBestMatch(tracks, query, 0.7, 0.9);
        expect(result.spotifyTrackId).toBeNull();
    });
});

describe('buildSearchQuery', () => {
    it('should build query with track and artist fields', () => {
        const query = buildSearchQuery('Bohemian Rhapsody', 'Queen');
        expect(query).toBe('track:Bohemian Rhapsody artist:Queen');
    });

    it('should clean remastered suffix from track name', () => {
        const query = buildSearchQuery('Bohemian Rhapsody - Remastered 2011', 'Queen');
        expect(query).toBe('track:Bohemian Rhapsody artist:Queen');
    });

    it('should remove special characters from artist name', () => {
        const query = buildSearchQuery('Track', 'Artist (feat. Other)');
        expect(query).toContain('artist:Artist');
    });
});

describe('generateCacheKey', () => {
    it('should generate consistent lowercase key', () => {
        const key1 = generateCacheKey('Bohemian Rhapsody', 'Queen');
        const key2 = generateCacheKey('BOHEMIAN RHAPSODY', 'QUEEN');
        expect(key1).toBe(key2);
    });

    it('should remove special characters', () => {
        const key = generateCacheKey("Don't Stop Me Now", 'Queen');
        expect(key).toBe('dont stop me now::queen');
    });

    it('should normalize whitespace', () => {
        const key = generateCacheKey('Track   Name', 'Artist    Name');
        expect(key).toBe('track name::artist name');
    });

    it('should generate unique keys for different tracks', () => {
        const key1 = generateCacheKey('Track A', 'Artist');
        const key2 = generateCacheKey('Track B', 'Artist');
        expect(key1).not.toBe(key2);
    });
});

