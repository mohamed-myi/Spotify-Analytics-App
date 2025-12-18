import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
}

// Main Redis connection for BullMQ and general use
export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
});

// Track requests per minute to stay under Spotify's 180/min limit
const RATE_LIMIT_KEY = 'spotify:requests:minute';
const RATE_LIMIT_MAX = 150;

export async function checkRateLimit(): Promise<boolean> {
    const count = await redis.incr(RATE_LIMIT_KEY);
    if (count === 1) {
        await redis.expire(RATE_LIMIT_KEY, 60);
    }
    return count <= RATE_LIMIT_MAX;
}

export async function waitForRateLimit(): Promise<void> {
    while (!(await checkRateLimit())) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

// Artist metadata queue for deduplication
const PENDING_ARTISTS_KEY = 'pending_artists';

export async function queueArtistForMetadata(spotifyId: string): Promise<void> {
    await redis.sadd(PENDING_ARTISTS_KEY, spotifyId);
}

export async function popArtistsForMetadata(count: number): Promise<string[]> {
    const artists: string[] = [];
    for (let i = 0; i < count; i++) {
        const artist = await redis.spop(PENDING_ARTISTS_KEY);
        if (artist) {
            artists.push(artist);
        } else {
            break;
        }
    }
    return artists;
}

// Close Redis connection
export async function closeRedis(): Promise<void> {
    await redis.quit();
}
