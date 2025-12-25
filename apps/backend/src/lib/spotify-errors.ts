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

export class SpotifyUnauthenticatedError extends SpotifyApiError {
    constructor(message = 'Access token expired or invalid') {
        super(message, 401, true);
        this.name = 'SpotifyUnauthenticatedError';
    }
}

export class SpotifyForbiddenError extends SpotifyApiError {
    constructor(message = 'Forbidden - check scopes or user access') {
        super(message, 403, false);
        this.name = 'SpotifyForbiddenError';
    }
}

export class SpotifyRateLimitError extends SpotifyApiError {
    constructor(
        public readonly retryAfterSeconds: number,
        message = 'Rate limited by Spotify'
    ) {
        super(message, 429, true);
        this.name = 'SpotifyRateLimitError';
    }
}

export class SpotifyDownError extends SpotifyApiError {
    constructor(statusCode: number, message = 'Spotify service unavailable') {
        super(message, statusCode, true);
        this.name = 'SpotifyDownError';
    }
}

export function isRetryableError(error: unknown): boolean {
    if (error instanceof SpotifyApiError) {
        if (error instanceof SpotifyUnauthenticatedError) return false;
        return error.retryable;
    }
    if (error instanceof Error && error.message.includes('fetch failed')) {
        return true;
    }
    return false;
}
