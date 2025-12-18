import {
    SpotifyApiError,
    SpotifyUnauthenticatedError,
    SpotifyForbiddenError,
    SpotifyRateLimitError,
    SpotifyDownError,
} from '../../src/lib/spotify-errors';

describe('SpotifyApiError', () => {
    test('has correct properties', () => {
        const error = new SpotifyApiError('Test error', 400, false);
        expect(error.message).toBe('Test error');
        expect(error.statusCode).toBe(400);
        expect(error.retryable).toBe(false);
        expect(error.name).toBe('SpotifyApiError');
    });

    test('is instanceof Error', () => {
        const error = new SpotifyApiError('Test', 400, false);
        expect(error).toBeInstanceOf(Error);
    });
});

describe('SpotifyUnauthenticatedError', () => {
    test('has statusCode 401 and is retryable', () => {
        const error = new SpotifyUnauthenticatedError();
        expect(error.statusCode).toBe(401);
        expect(error.retryable).toBe(true);
        expect(error.name).toBe('SpotifyUnauthenticatedError');
    });

    test('accepts custom message', () => {
        const error = new SpotifyUnauthenticatedError('Custom message');
        expect(error.message).toBe('Custom message');
    });

    test('has default message', () => {
        const error = new SpotifyUnauthenticatedError();
        expect(error.message).toBe('Access token expired or invalid');
    });
});

describe('SpotifyForbiddenError', () => {
    test('has statusCode 403 and is NOT retryable', () => {
        const error = new SpotifyForbiddenError();
        expect(error.statusCode).toBe(403);
        expect(error.retryable).toBe(false);
        expect(error.name).toBe('SpotifyForbiddenError');
    });
});

describe('SpotifyRateLimitError', () => {
    test('has statusCode 429 and stores retryAfterSeconds', () => {
        const error = new SpotifyRateLimitError(120);
        expect(error.statusCode).toBe(429);
        expect(error.retryable).toBe(true);
        expect(error.retryAfterSeconds).toBe(120);
        expect(error.name).toBe('SpotifyRateLimitError');
    });

    test('accepts custom message', () => {
        const error = new SpotifyRateLimitError(60, 'Too many requests');
        expect(error.message).toBe('Too many requests');
        expect(error.retryAfterSeconds).toBe(60);
    });
});

describe('SpotifyDownError', () => {
    test('has 5xx statusCode and is retryable', () => {
        const error = new SpotifyDownError(503);
        expect(error.statusCode).toBe(503);
        expect(error.retryable).toBe(true);
        expect(error.name).toBe('SpotifyDownError');
    });

    test('works with different 5xx codes', () => {
        const error500 = new SpotifyDownError(500);
        const error502 = new SpotifyDownError(502);
        expect(error500.statusCode).toBe(500);
        expect(error502.statusCode).toBe(502);
    });
});
