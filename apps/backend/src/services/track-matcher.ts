import { distance as levenshteinDistance } from 'fastest-levenshtein';
import type { SpotifyTrack } from '../types/spotify';
import { logger } from '../lib/logger';

export interface TrackQuery {
    trackName: string;
    artistName: string;
    msPlayed: number;
}

export interface MatchResult {
    spotifyTrackId: string | null;
    confidence: number;
    matchedTrack?: {
        name: string;
        artistName: string;
        durationMs: number;
    };
}

interface ScoredTrack {
    track: SpotifyTrack;
    score: number;
    artistScore: number;
    trackNameScore: number;
    durationValid: boolean;
}

function jaroWinklerSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < s1.length; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, s2.length);

        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0;

    let k = 0;
    for (let i = 0; i < s1.length; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }

    const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

    let prefix = 0;
    for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
        if (s1[i] === s2[i]) prefix++;
        else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
}

function normalizeString(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' ')    // Normalize whitespace
        .trim();
}

function cleanTrackName(name: string): string {
    return name
        .replace(/\s*[-–—]\s*(remaster(ed)?|remix|live|acoustic|radio edit|single version|album version|explicit|clean).*$/i, '')
        .replace(/\s*\((remaster(ed)?|remix|live|acoustic|radio edit|single version|album version|explicit|clean|feat\.?.*)\).*$/i, '')
        .replace(/\s*\[(remaster(ed)?|remix|live|acoustic|radio edit|single version|album version|explicit|clean|feat\.?.*)\].*$/i, '')
        .trim();
}

function getPrimaryArtistName(track: SpotifyTrack): string {
    if (track.artists && track.artists.length > 0) {
        return track.artists[0].name;
    }
    return '';
}

function scoreTrack(track: SpotifyTrack, query: TrackQuery): ScoredTrack {
    const queryTrackNorm = normalizeString(cleanTrackName(query.trackName));
    const queryArtistNorm = normalizeString(query.artistName);

    const trackNameNorm = normalizeString(cleanTrackName(track.name));
    const artistNameNorm = normalizeString(getPrimaryArtistName(track));

    const artistScore = jaroWinklerSimilarity(queryArtistNorm, artistNameNorm);

    const trackNameScore = jaroWinklerSimilarity(queryTrackNorm, trackNameNorm);

    const durationValid = query.msPlayed <= (track.duration_ms * 1.1);

    // Weighted average: artist 0.4, track name 0.5, duration bonus 0.1
    const score = (artistScore * 0.4) + (trackNameScore * 0.5) + (durationValid ? 0.1 : 0);

    return {
        track,
        score,
        artistScore,
        trackNameScore,
        durationValid,
    };
}

export function findBestMatch(
    searchResults: SpotifyTrack[],
    query: TrackQuery,
    minArtistSimilarity: number = 0.7,
    minOverallScore: number = 0.6
): MatchResult {
    if (searchResults.length === 0) {
        return { spotifyTrackId: null, confidence: 0 };
    }

    const scoredTracks = searchResults.map(track => scoreTrack(track, query));

    const filteredTracks = scoredTracks.filter(st => st.artistScore >= minArtistSimilarity);

    if (filteredTracks.length === 0) {
        logger.debug(
            { query, bestArtistScore: Math.max(...scoredTracks.map(st => st.artistScore)) },
            'No tracks passed artist similarity filter'
        );
        return { spotifyTrackId: null, confidence: 0 };
    }

    filteredTracks.sort((a, b) => {
        if (Math.abs(a.score - b.score) < 0.05) {
            // Scores are close, use popularity as tie-breaker
            return (b.track.popularity || 0) - (a.track.popularity || 0);
        }
        return b.score - a.score;
    });

    const bestMatch = filteredTracks[0];

    if (bestMatch.score < minOverallScore) {
        logger.debug(
            { query, bestScore: bestMatch.score, threshold: minOverallScore },
            'Best match did not meet minimum score threshold'
        );
        return { spotifyTrackId: null, confidence: bestMatch.score };
    }

    logger.debug(
        {
            query: `${query.trackName} - ${query.artistName}`,
            matched: `${bestMatch.track.name} - ${getPrimaryArtistName(bestMatch.track)}`,
            score: bestMatch.score,
            artistScore: bestMatch.artistScore,
            trackNameScore: bestMatch.trackNameScore,
        },
        'Track matched successfully'
    );

    return {
        spotifyTrackId: bestMatch.track.id,
        confidence: bestMatch.score,
        matchedTrack: {
            name: bestMatch.track.name,
            artistName: getPrimaryArtistName(bestMatch.track),
            durationMs: bestMatch.track.duration_ms,
        },
    };
}

export function buildSearchQuery(trackName: string, artistName: string): string {
    const cleanedTrack = cleanTrackName(trackName);
    const cleanedArtist = artistName.replace(/[^\w\s]/g, '').trim();

    return `track:${cleanedTrack} artist:${cleanedArtist}`;
}

export function generateCacheKey(trackName: string, artistName: string): string {
    const normalizedTrack = normalizeString(trackName);
    const normalizedArtist = normalizeString(artistName);
    return `${normalizedTrack}::${normalizedArtist}`;
}

