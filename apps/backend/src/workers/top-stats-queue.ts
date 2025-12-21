import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export interface TopStatsJobData {
    userId: string;
    priority: 'high' | 'low';  // High = lazy trigger, Low = background sweep
}

// Queue for top-stats refresh jobs
export const topStatsQueue = new Queue<TopStatsJobData>('top-stats', {
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
    },
});
