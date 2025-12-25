import { Queue } from 'bullmq';
import { redis } from '../lib/redis';
import { ARTIST_METADATA_JOB_OPTIONS, DEFAULT_JOB_OPTIONS } from './worker-config';

export const syncUserQueue = new Queue('sync-user', {
    connection: redis,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export const artistMetadataQueue = new Queue('artist-metadata', {
    connection: redis,
    defaultJobOptions: ARTIST_METADATA_JOB_OPTIONS,
});

export const importQueue = new Queue('import-history', {
    connection: redis,
    defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        attempts: 3,
    },
});
