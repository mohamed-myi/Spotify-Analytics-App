import pRetry from 'p-retry';
import type {
    SpotifyRecentlyPlayedResponse,
    SpotifyTopTracksResponse,
    SpotifyTopArtistsResponse,
    SpotifyFullArtist,
    SpotifyArtistsBatchResponse,
    SpotifyTrack,
    SpotifyAlbum,
    SpotifyTracksBatchResponse,
    SpotifyAlbumsBatchResponse,
} from '../types/spotify';
import {
    SpotifyApiError,
    SpotifyUnauthenticatedError,
    SpotifyForbiddenError,
    SpotifyRateLimitError,
    SpotifyDownError,
} from './spotify-errors';
import { getBreaker, shouldCountAsFailure, CircuitBreakerOpenError } from './circuit-breaker';
import { logger } from './logger';

export const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

export { CircuitBreakerOpenError };

export type TimeRange = 'short_term' | 'medium_term' | 'long_term';

export interface RecentlyPlayedOptions {
    limit?: number,
    after?: number,
    before?: number,
}

function getServiceKey(url: string): string {
    const path = new URL(url).pathname;
    if (path.startsWith('/v1/me/player')) return 'spotify:player';
    if (path.startsWith('/v1/me/top')) return 'spotify:top';
    return 'spotify:catalog';
}

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

    const errorText = await response.text();
    throw new SpotifyApiError(`Spotify API error: ${errorText}`, response.status, false);
}

export async function fetchWithRetry<T>(
    url: string,
    accessToken: string,
    options: RequestInit = {}
): Promise<T> {
    const breaker = getBreaker(getServiceKey(url));

    return breaker.execute(
        () => pRetry(
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
                    logger.warn(
                        { attempt: error.attemptNumber, retriesLeft: error.retriesLeft },
                        'Spotify API retry attempt failed'
                    );
                },
            }
        ),
        shouldCountAsFailure
    );
}

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

export async function getTopTracks(
    accessToken: string,
    timeRange: TimeRange = 'medium_term',
    limit: number = 50
): Promise<SpotifyTopTracksResponse> {
    const params = new URLSearchParams({
        time_range: timeRange,
        limit: String(Math.min(limit, 50)),
    });
    const url = `${SPOTIFY_API_URL}/me/top/tracks?${params.toString()}`;
    return fetchWithRetry<SpotifyTopTracksResponse>(url, accessToken);
}

export async function getTopArtists(
    accessToken: string,
    timeRange: TimeRange = 'medium_term',
    limit: number = 50
): Promise<SpotifyTopArtistsResponse> {
    const params = new URLSearchParams({
        time_range: timeRange,
        limit: String(Math.min(limit, 50)),
    });
    const url = `${SPOTIFY_API_URL}/me/top/artists?${params.toString()}`;
    return fetchWithRetry<SpotifyTopArtistsResponse>(url, accessToken);
}

export async function getTracksBatch(
    accessToken: string,
    trackIds: string[]
): Promise<SpotifyTrack[]> {
    if (trackIds.length === 0) return [];
    if (trackIds.length > 50) {
        throw new Error('Cannot fetch more than 50 tracks at once');
    }
    const url = `${SPOTIFY_API_URL}/tracks?ids=${trackIds.join(',')}`;
    const response = await fetchWithRetry<SpotifyTracksBatchResponse>(url, accessToken);
    return response.tracks;
}

export async function getArtistsBatch(
    accessToken: string,
    artistIds: string[]
): Promise<SpotifyFullArtist[]> {
    if (artistIds.length === 0) return [];
    if (artistIds.length > 50) {
        throw new Error('Cannot fetch more than 50 artists at once');
    }
    const url = `${SPOTIFY_API_URL}/artists?ids=${artistIds.join(',')}`;
    const response = await fetchWithRetry<SpotifyArtistsBatchResponse>(url, accessToken);
    return response.artists;
}

export async function getAlbumsBatch(
    accessToken: string,
    albumIds: string[]
): Promise<SpotifyAlbum[]> {
    if (albumIds.length === 0) return [];
    if (albumIds.length > 20) {
        throw new Error('Cannot fetch more than 20 albums at once');
    }
    const url = `${SPOTIFY_API_URL}/albums?ids=${albumIds.join(',')}`;
    const response = await fetchWithRetry<SpotifyAlbumsBatchResponse>(url, accessToken);
    return response.albums;
}
