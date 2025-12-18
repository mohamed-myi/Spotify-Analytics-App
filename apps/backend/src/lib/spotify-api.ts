import pRetry from 'p-retry';
import type {
    SpotifyRecentlyPlayedResponse,
    SpotifyFullArtist,
    SpotifyArtistsBatchResponse,
    SpotifyTrack,
} from '../types/spotify';
import {
    SpotifyApiError,
    SpotifyUnauthenticatedError,
    SpotifyForbiddenError,
    SpotifyRateLimitError,
    SpotifyDownError,
} from './spotify-errors';

const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

// Options for recently played tracks
export interface RecentlyPlayedOptions {
    limit?: number;  // 1-50, default 50
    after?: number;  // get plays after this time (ms)
    before?: number; // get plays before this time (ms)
}

// Handle API response and throw appropriate errors
async function handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
        return response.json() as Promise<T>;
    }

    if (response.status === 401) {
        throw new SpotifyUnauthenticatedError();
    }

    if (response.status === 403) {
        throw new SpotifyForbiddenError();
    }

    if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        throw new SpotifyRateLimitError(retryAfter);
    }

    if (response.status >= 500) {
        throw new SpotifyDownError(response.status);
    }

    // Other errors
    const errorText = await response.text();
    throw new SpotifyApiError(`Spotify API error: ${errorText}`, response.status, false);
}

// Wrapper for fetch with retry logic (retries only on 5xx errors)
async function fetchWithRetry<T>(
    url: string,
    accessToken: string,
    options: RequestInit = {}
): Promise<T> {
    return pRetry(
        async () => {
            const response = await fetch(url, {
                ...options,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    ...options.headers,
                },
            });
            return handleResponse<T>(response);
        },
        {
            retries: 3,
            onFailedAttempt: (error) => {
                if (!(error instanceof SpotifyDownError)) {
                    throw error;
                }
                console.log(
                    `Spotify API retry attempt ${error.attemptNumber} failed. ` +
                    `${error.retriesLeft} retries left.`
                );
            },
        }
    );
}

// Fetch recently played tracks
export async function getRecentlyPlayed(
    accessToken: string,
    options: RecentlyPlayedOptions = {}
): Promise<SpotifyRecentlyPlayedResponse> {
    const params = new URLSearchParams();

    params.set('limit', String(options.limit || 50));

    if (options.after) {
        params.set('after', String(options.after));
    } else if (options.before) {
        params.set('before', String(options.before));
    }

    const url = `${SPOTIFY_API_URL}/me/player/recently-played?${params.toString()}`;
    return fetchWithRetry<SpotifyRecentlyPlayedResponse>(url, accessToken);
}

// Fetch multiple artists in a single request 
export async function getArtistsBatch(
    accessToken: string,
    artistIds: string[]
): Promise<SpotifyFullArtist[]> {
    if (artistIds.length === 0) {
        return [];
    }

    if (artistIds.length > 50) {
        throw new Error('Cannot fetch more than 50 artists at once');
    }

    const url = `${SPOTIFY_API_URL}/artists?ids=${artistIds.join(',')}`;
    const response = await fetchWithRetry<SpotifyArtistsBatchResponse>(url, accessToken);
    return response.artists;
}

// Fetch a single track
export async function getTrack(
    accessToken: string,
    trackId: string
): Promise<SpotifyTrack> {
    const url = `${SPOTIFY_API_URL}/tracks/${trackId}`;
    return fetchWithRetry<SpotifyTrack>(url, accessToken);
}
