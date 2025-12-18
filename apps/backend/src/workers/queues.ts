import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

// Queue for syncing individual users' listening history
export const syncUserQueue = new Queue('sync-user', {
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
});

// Queue for artist metadata enrichment (low priority, batch processing)
export const artistMetadataQueue = new Queue('artist-metadata', {
    connection: redis,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 60000 },
        removeOnComplete: 50,
        removeOnFail: 100,
    },
});
