import { prisma } from './prisma';
import { decrypt, encrypt } from './encryption';
import { refreshAccessToken, TokenRefreshError } from './spotify';

// Access tokens expire in 1 hour; refresh proactively at 50 minutes
const REFRESH_THRESHOLD_MS = 50 * 60 * 1000;

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

    // Get et a fresh one anyway since they aren't stored.
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
            },
        });

        return {
            accessToken: tokens.access_token,
            expiresIn: tokens.expires_in,
        };
    } catch (error) {
        if (error instanceof TokenRefreshError && error.isRevoked) {
            // Token was revoked by user
            await invalidateUserToken(userId);
            console.error(`Token revoked for user ${userId}`);
            return null;
        }

        // Other errors - log but don't invalidate 
        console.error(`Token refresh failed for user ${userId}:`, error);
        throw error;
    }
}

// Marks a user's token as invalid 
export async function invalidateUserToken(userId: string): Promise<void> {
    await prisma.spotifyAuth.update({
        where: { userId },
        data: { isValid: false },
    });
}
