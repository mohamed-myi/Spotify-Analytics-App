export const DEFAULT_RETRY_OPTIONS = {
    attempts: 5,
    backoff: {
        type: 'exponential' as const,
        delay: 1000,
    },
};

export const DEFAULT_JOB_OPTIONS = {
    ...DEFAULT_RETRY_OPTIONS,
    removeOnComplete: 100,
    removeOnFail: false,
};

export const ARTIST_METADATA_JOB_OPTIONS = {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 60000 },
    removeOnComplete: 50,
    removeOnFail: 100,
};

export const DLQ_SUFFIX = ':dlq';
