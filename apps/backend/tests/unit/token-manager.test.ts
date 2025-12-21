// Token manager tests; mocking prisma and spotify modules

// Mock modules before importing the module under test
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        spotifyAuth: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));

jest.mock('../../src/lib/spotify', () => ({
    refreshAccessToken: jest.fn(),
    TokenRefreshError: class TokenRefreshError extends Error {
        isRevoked: boolean;
        constructor(message: string, isRevoked: boolean) {
            super(message);
            this.isRevoked = isRevoked;
        }
    },
}));

jest.mock('../../src/lib/encryption', () => ({
    decrypt: jest.fn((val: string) => `decrypted_${val}`),
    encrypt: jest.fn((val: string) => `encrypted_${val}`),
}));

import {
    getValidAccessToken,
    refreshUserToken,
    invalidateUserToken,
    recordTokenFailure,
    resetTokenFailures,
} from '../../src/lib/token-manager';
import { prisma } from '../../src/lib/prisma';
import { refreshAccessToken, TokenRefreshError } from '../../src/lib/spotify';
import { decrypt, encrypt } from '../../src/lib/encryption';

describe('token-manager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getValidAccessToken', () => {
        test('returns null when no auth record exists', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await getValidAccessToken('user-123');
            expect(result).toBeNull();
        });

        test('returns null when auth is invalid', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                userId: 'user-123',
                isValid: false,
                refreshToken: 'token',
                lastRefreshAt: new Date(),
            });

            const result = await getValidAccessToken('user-123');
            expect(result).toBeNull();
        });

        test('refreshes token when auth is valid', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                userId: 'user-123',
                isValid: true,
                refreshToken: 'encrypted_refresh_token',
                lastRefreshAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
            });

            (refreshAccessToken as jest.Mock).mockResolvedValue({
                access_token: 'new_access_token',
                expires_in: 3600,
                refresh_token: 'new_refresh_token',
            });

            const result = await getValidAccessToken('user-123');
            expect(result).toEqual({
                accessToken: 'new_access_token',
                expiresIn: 3600,
            });
        });
    });

    describe('refreshUserToken', () => {
        test('returns null when no auth record', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await refreshUserToken('user-123');
            expect(result).toBeNull();
        });

        test('returns null when auth is invalid', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                isValid: false,
            });

            const result = await refreshUserToken('user-123');
            expect(result).toBeNull();
        });

        test('decrypts refresh token before use', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                userId: 'user-123',
                isValid: true,
                refreshToken: 'stored_encrypted_token',
                lastRefreshAt: new Date(),
            });

            (refreshAccessToken as jest.Mock).mockResolvedValue({
                access_token: 'new_access',
                expires_in: 3600,
            });

            await refreshUserToken('user-123');

            expect(decrypt).toHaveBeenCalledWith('stored_encrypted_token');
            expect(refreshAccessToken).toHaveBeenCalledWith('decrypted_stored_encrypted_token');
        });

        test('encrypts new refresh token if Spotify returns one', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                userId: 'user-123',
                isValid: true,
                refreshToken: 'old_encrypted',
                lastRefreshAt: new Date(),
            });

            (refreshAccessToken as jest.Mock).mockResolvedValue({
                access_token: 'new_access',
                expires_in: 3600,
                refresh_token: 'brand_new_refresh_token',
            });

            await refreshUserToken('user-123');

            expect(encrypt).toHaveBeenCalledWith('brand_new_refresh_token');
            expect(prisma.spotifyAuth.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        refreshToken: 'encrypted_brand_new_refresh_token',
                        consecutiveFailures: 0,
                    }),
                })
            );
        });

        test('returns access token and expires_in on success', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                userId: 'user-123',
                isValid: true,
                refreshToken: 'token',
                lastRefreshAt: new Date(),
            });

            (refreshAccessToken as jest.Mock).mockResolvedValue({
                access_token: 'shiny_new_token',
                expires_in: 7200,
            });

            const result = await refreshUserToken('user-123');
            expect(result).toEqual({
                accessToken: 'shiny_new_token',
                expiresIn: 7200,
            });
        });

        test('invalidates token on TokenRefreshError with isRevoked', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                userId: 'user-123',
                isValid: true,
                refreshToken: 'token',
                lastRefreshAt: new Date(),
            });

            const revokedError = new TokenRefreshError('Token revoked', true);
            (refreshAccessToken as jest.Mock).mockRejectedValue(revokedError);

            const result = await refreshUserToken('user-123');
            expect(result).toBeNull();
            expect(prisma.spotifyAuth.update).toHaveBeenCalledWith({
                where: { userId: 'user-123' },
                data: { isValid: false, lastFailureReason: 'token_revoked_by_user' },
            });
        });

        test('throws error on non-revocation failure', async () => {
            (prisma.spotifyAuth.findUnique as jest.Mock).mockResolvedValue({
                userId: 'user-123',
                isValid: true,
                refreshToken: 'token',
                lastRefreshAt: new Date(),
            });

            const networkError = new Error('Network failed');
            (refreshAccessToken as jest.Mock).mockRejectedValue(networkError);

            await expect(refreshUserToken('user-123')).rejects.toThrow('Network failed');
        });
    });

    describe('invalidateUserToken', () => {
        test('sets isValid to false with reason', async () => {
            await invalidateUserToken('user-123', 'test_reason');

            expect(prisma.spotifyAuth.update).toHaveBeenCalledWith({
                where: { userId: 'user-123' },
                data: { isValid: false, lastFailureReason: 'test_reason' },
            });
        });

        test('uses unknown as default reason', async () => {
            await invalidateUserToken('user-123');

            expect(prisma.spotifyAuth.update).toHaveBeenCalledWith({
                where: { userId: 'user-123' },
                data: { isValid: false, lastFailureReason: 'unknown' },
            });
        });
    });

    describe('recordTokenFailure', () => {
        test('increments failure count and returns false when under threshold', async () => {
            (prisma.spotifyAuth.update as jest.Mock).mockResolvedValue({
                consecutiveFailures: 1,
            });

            const result = await recordTokenFailure('user-123', 'test_failure');

            expect(result).toBe(false);
            expect(prisma.spotifyAuth.update).toHaveBeenCalledWith({
                where: { userId: 'user-123' },
                data: {
                    consecutiveFailures: { increment: 1 },
                    lastFailureAt: expect.any(Date),
                    lastFailureReason: 'test_failure',
                },
            });
        });

        test('invalidates and returns true when threshold reached', async () => {
            (prisma.spotifyAuth.update as jest.Mock).mockResolvedValue({
                consecutiveFailures: 3,
            });

            const result = await recordTokenFailure('user-123', 'test_failure');

            expect(result).toBe(true);
            // Should have called update twice; once for failure record, once for invalidation
            expect(prisma.spotifyAuth.update).toHaveBeenCalledTimes(2);
        });
    });

    describe('resetTokenFailures', () => {
        test('resets consecutiveFailures to 0', async () => {
            await resetTokenFailures('user-123');

            expect(prisma.spotifyAuth.update).toHaveBeenCalledWith({
                where: { userId: 'user-123' },
                data: { consecutiveFailures: 0 },
            });
        });
    });
});

