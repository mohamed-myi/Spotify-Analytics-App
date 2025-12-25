import Redis from 'ioredis';

let _redis: Redis | null = null;

function getRedisUrl(): string {
    const url = process.env.REDIS_URL;
    if (!url) {
        throw new Error('REDIS_URL environment variable is required');
    }
    return url;
}

export const redis: Redis = new Proxy({} as Redis, {
    get(_, prop) {
        if (!_redis) {
            _redis = new Redis(getRedisUrl(), {
                maxRetriesPerRequest: null,
            });
        }
        return (_redis as any)[prop];
    },
    set(_, prop, value) {
        if (!_redis) {
            _redis = new Redis(getRedisUrl(), {
                maxRetriesPerRequest: null,
            });
        }
        (_redis as any)[prop] = value;
        return true;
    },
});

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

const PENDING_TRACKS_KEY = 'pending_tracks';

export async function queueTrackForMetadata(spotifyId: string): Promise<void> {
    await redis.sadd(PENDING_TRACKS_KEY, spotifyId);
}

export async function popTracksForMetadata(count: number): Promise<string[]> {
    const tracks: string[] = [];
    for (let i = 0; i < count; i++) {
        const track = await redis.spop(PENDING_TRACKS_KEY);
        if (track) {
            tracks.push(track);
        } else {
            break;
        }
    }
    return tracks;
}

// Checks Redis connectivity
export async function pingRedis(): Promise<boolean> {
    try {
        const result = await redis.ping();
        return result === 'PONG';
    } catch {
        return false;
    }
}

// Caching pattern: Get, Return if cached, Fetch, Set, Return
// Uses BigInt-aware JSON serialization
export async function getOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>
): Promise<T> {
    const cached = await redis.get(key);
    if (cached) {
        try {
            return JSON.parse(cached) as T;
        } catch (err) {
            // If parse fails, ignore cache and fetch fresh
        }
    }

    const data = await fetcher();

    // Only cache if data is not null
    if (data !== null && data !== undefined) {
        // BigInt-aware serializer (same as Fastify global serializer)
        const serialized = JSON.stringify(data, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );
        await redis.setex(key, ttlSeconds, serialized);
    }

    return data;
}

// Metadata cooldown lock prevents repeated API calls for same entity
const METADATA_LOCK_TTL = 86400;

export async function tryLockMetadata(
    type: 'artist' | 'track' | 'features',
    spotifyId: string
): Promise<boolean> {
    const key = `metadata_lock:${type}:${spotifyId}`;
    const result = await redis.set(key, '1', 'EX', METADATA_LOCK_TTL, 'NX');
    return result === 'OK';
}

export async function closeRedis(): Promise<void> {
    await redis.quit();
}
