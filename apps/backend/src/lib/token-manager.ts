import { prisma } from './prisma';
import { decrypt, encrypt } from './encryption';
import { refreshAccessToken, TokenRefreshError } from './spotify';
import { logger } from './logger';

// Access tokens expire in 1 hour; refresh proactively at 50 minutes
const REFRESH_THRESHOLD_MS = 50 * 60 * 1000;

// Number of consecutive failures before invalidating token
const MAX_CONSECUTIVE_FAILURES = 3;

export interface TokenResult {
    accessToken: string;
    expiresIn: number;
}

// Gets a valid access token for a user, refreshing if needed
export async function getValidAccessToken(userId: string): Promise<TokenResult | null> {
    const auth = await prisma.spotifyAuth.findUnique({
        where: { userId },
    });

    if (!auth || !auth.isValid) {
        return null;
    }

    const timeSinceRefresh = Date.now() - auth.lastRefreshAt.getTime();
    const needsRefresh = timeSinceRefresh > REFRESH_THRESHOLD_MS;

    if (needsRefresh) {
        const refreshed = await refreshUserToken(userId);
        if (!refreshed) {
            return null;
        }
        return refreshed;
    }

    // Access tokens are not persisted, so always refresh to get a valid one
    const refreshed = await refreshUserToken(userId);
    return refreshed;
}

// Refreshes the user's token and updates the database
export async function refreshUserToken(userId: string): Promise<TokenResult | null> {
    const auth = await prisma.spotifyAuth.findUnique({
        where: { userId },
    });

    if (!auth || !auth.isValid) {
        return null;
    }

    try {
        const decryptedRefreshToken = decrypt(auth.refreshToken);
        const tokens = await refreshAccessToken(decryptedRefreshToken);

        // Spotify may return a new refresh token
        const newRefreshToken = tokens.refresh_token || decryptedRefreshToken;
        const encryptedNewToken = encrypt(newRefreshToken);

        await prisma.spotifyAuth.update({
            where: { userId },
            data: {
                refreshToken: encryptedNewToken,
                lastRefreshAt: new Date(),
                isValid: true,
                consecutiveFailures: 0, // Reset on successful refresh
            },
        });

        return {
            accessToken: tokens.access_token,
            expiresIn: tokens.expires_in,
        };
    } catch (error) {
        if (error instanceof TokenRefreshError && error.isRevoked) {
            // Token was revoked by user - immediate invalidation
            await invalidateUserToken(userId, 'token_revoked_by_user');
            logger.warn({ userId }, 'Token revoked by user');
            return null;
        }

        // Other errors - log but don't invalidate 
        logger.error({ userId, error }, 'Token refresh failed');
        throw error;
    }
}

// Records a token failure and returns true if token was invalidated
export async function recordTokenFailure(userId: string, reason: string): Promise<boolean> {
    const auth = await prisma.spotifyAuth.update({
        where: { userId },
        data: {
            consecutiveFailures: { increment: 1 },
            lastFailureAt: new Date(),
            lastFailureReason: reason,
        },
    });

    logger.warn(
        { userId, consecutiveFailures: auth.consecutiveFailures, reason },
        'Token failure recorded'
    );

    // Only invalidate after threshold reached
    if (auth.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await invalidateUserToken(userId, `max_failures_reached:${reason}`);
        return true;
    }
    return false;
}

// Resets failure count after successful API call
export async function resetTokenFailures(userId: string): Promise<void> {
    await prisma.spotifyAuth.update({
        where: { userId },
        data: { consecutiveFailures: 0 },
    });
}

// Marks a user's token as invalid 
export async function invalidateUserToken(userId: string, reason?: string): Promise<void> {
    await prisma.spotifyAuth.update({
        where: { userId },
        data: {
            isValid: false,
            lastFailureReason: reason || 'unknown',
        },
    });
    logger.error({ userId, reason }, 'Token invalidated');
}

