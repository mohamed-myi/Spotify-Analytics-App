// Spotify API response types

export interface SpotifyErrorResponse {
    error: string;
    error_description?: string;
}

export interface SpotifyTokenResponse {
    access_token: string;
    token_type: string;
    scope: string;
    expires_in: number;
    refresh_token?: string;
}

export interface SpotifyUserProfile {
    id: string;
    display_name: string | null;
    email: string;
    country: string;
    images: Array<{ url: string; height: number; width: number }>;
}

export interface SpotifyRecentlyPlayedResponse {
    items: Array<{
        track: SpotifyTrack;
        played_at: string;
    }>;
    cursors?: {
        after: string;
        before: string;
    };
}

export interface SpotifyTrack {
    id: string;
    name: string;
    duration_ms: number;
    preview_url: string | null;
    album: SpotifyAlbum;
    artists: SpotifyArtist[];
}

export interface SpotifyAlbum {
    id: string;
    name: string;
    images: Array<{ url: string; height: number; width: number }>;
    release_date: string;
}

export interface SpotifyArtist {
    id: string;
    name: string;
}

// Play context (album, playlist, or artist the track was played from)
export interface SpotifyPlayContext {
    type: 'album' | 'artist' | 'playlist';
    href: string;
    uri: string;
}

// Full artist with images and genres (from /artists endpoint)
export interface SpotifyFullArtist {
    id: string;
    name: string;
    images: Array<{ url: string; height: number; width: number }>;
    genres: string[];
    popularity: number;
}

// Response from GET /artists?ids=...
export interface SpotifyArtistsBatchResponse {
    artists: SpotifyFullArtist[];
}
