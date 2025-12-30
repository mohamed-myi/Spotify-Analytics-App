process.env.REDIS_URL = 'redis://mock:6379';

import { Worker } from 'bullmq';
import { setupTopStatsWorker, topStatsWorker, closeTopStatsWorker } from '../../../src/workers/top-stats-worker';
import { processUserTopStats } from '../../../src/services/top-stats-service';

// Mock dependencies
jest.mock('../../../src/lib/redis', () => ({
    waitForRateLimit: jest.fn().mockResolvedValue(undefined),
    getRedisUrl: jest.fn().mockReturnValue('redis://mock:6379'),
    REDIS_CONNECTION_CONFIG: {},
    redis: {
        quit: jest.fn(),
    }
}));

jest.mock('../../../src/services/top-stats-service', () => ({
    processUserTopStats: jest.fn(),
}));

jest.mock('../../../src/lib/token-manager', () => ({
    recordTokenFailure: jest.fn(),
}));

jest.mock('../../../src/workers/top-stats-queue', () => ({
    topStatsQueue: {
        pause: jest.fn(),
        resume: jest.fn(),
    },
}));

jest.mock('../../../src/workers/worker-status', () => ({
    setTopStatsWorkerRunning: jest.fn(),
}));

jest.mock('../../../src/lib/logger', () => ({
    workerLoggers: {
        topStats: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        },
    },
}));

// Mock BullMQ Worker
jest.mock('bullmq', () => {
    return {
        Worker: jest.fn().mockImplementation((queueName, processor, options) => {
            return {
                on: jest.fn(),
                close: jest.fn(),
                processor, // Expose processor for testing
            };
        }),
        UnrecoverableError: class extends Error { },
    };
});

describe('Top Stats Worker', () => {
    let mockProcessor: Function;

    beforeEach(async () => {
        jest.clearAllMocks();
        // Ensure any previous worker is closed
        await closeTopStatsWorker();
        // Setup new worker
        setupTopStatsWorker();
        const MockWorker = require('bullmq').Worker;
        // The last call to Worker constructor should be our worker
        mockProcessor = MockWorker.mock.calls[MockWorker.mock.calls.length - 1][1];
    });

    afterEach(async () => {
        await closeTopStatsWorker();
    });

    it('processes job successfully', async () => {
        (processUserTopStats as jest.Mock).mockResolvedValue(undefined);

        const job = {
            id: 'job-123',
            data: { userId: 'user-1', priority: 'high' },
        };

        await mockProcessor(job);

        expect(processUserTopStats).toHaveBeenCalledWith('user-1', 'job-123', expect.any(AbortSignal));
    });

    it('passes AbortSignal to service', async () => {
        let capturedSignal: AbortSignal | undefined;
        (processUserTopStats as jest.Mock).mockImplementation((userId, jobId, signal) => {
            capturedSignal = signal;
            return Promise.resolve();
        });

        const job = {
            id: 'job-123',
            data: { userId: 'user-1', priority: 'high' },
        };

        await mockProcessor(job);

        expect(capturedSignal).toBeDefined();
        expect(capturedSignal?.aborted).toBe(false);
    });

    it('aborts signal on timeout', async () => {
        jest.useFakeTimers();

        let capturedSignal: AbortSignal | undefined;

        // Return a promise that never resolves naturally, but resolves if aborted
        (processUserTopStats as jest.Mock).mockImplementation(async (userId, jobId, signal) => {
            capturedSignal = signal;
            return new Promise((resolve, reject) => {
                // Check frequently for abort
                const interval = setInterval(() => {
                    if (signal.aborted) {
                        clearInterval(interval);
                        resolve(undefined); // Resolve so Promise.race knows the task "finished" (even if via abort)
                    }
                }, 100);
            });
        });

        const job = {
            id: 'job-123',
            data: { userId: 'user-1', priority: 'high' },
        };

        // Start processing
        const processingPromise = mockProcessor(job);

        // Fast forward past timeout (120000ms)
        jest.advanceTimersByTime(121000);

        // Expect the timeout error from the worker's Promise.race
        await expect(processingPromise).rejects.toThrow('Job timeout');

        expect(capturedSignal?.aborted).toBe(true);

        jest.useRealTimers();
    });
});
