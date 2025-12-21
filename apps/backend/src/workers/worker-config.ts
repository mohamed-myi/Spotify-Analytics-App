// Shared BullMQ worker configuration for retry strategies.

// Default retry options with exponential backoff.
// Attempts: 5 (1s, 2s, 4s, 8s, 16s)
export const DEFAULT_RETRY_OPTIONS = {
    attempts: 5,
    backoff: {
        type: 'exponential' as const,
        delay: 1000,
    },
};

// Job cleanup configuration.
export const DEFAULT_JOB_OPTIONS = {
    ...DEFAULT_RETRY_OPTIONS,
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: false,   // Keep failed jobs for inspection
};

// Dead letter queue suffix for naming.
export const DLQ_SUFFIX = ':dlq';
