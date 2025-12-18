// Base class for all Spotify API errors
export class SpotifyApiError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly retryable: boolean
    ) {
        super(message);
        this.name = 'SpotifyApiError';
    }
}

// 401 - Token expired or invalid 
export class SpotifyUnauthenticatedError extends SpotifyApiError {
    constructor(message = 'Access token expired or invalid') {
        super(message, 401, true);
        this.name = 'SpotifyUnauthenticatedError';
    }
}

// 403 - Scope insufficient or user revoked access
export class SpotifyForbiddenError extends SpotifyApiError {
    constructor(message = 'Forbidden - check scopes or user access') {
        super(message, 403, false);
        this.name = 'SpotifyForbiddenError';
    }
}

// 429 - Rate limited
export class SpotifyRateLimitError extends SpotifyApiError {
    constructor(
        public readonly retryAfterSeconds: number,
        message = 'Rate limited by Spotify'
    ) {
        super(message, 429, true);
        this.name = 'SpotifyRateLimitError';
    }
}

// 5xx - Spotify is down
export class SpotifyDownError extends SpotifyApiError {
    constructor(statusCode: number, message = 'Spotify service unavailable') {
        super(message, statusCode, true);
        this.name = 'SpotifyDownError';
    }
}
