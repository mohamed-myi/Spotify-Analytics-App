import { Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { processImportStream } from '../services/import';
import { processBasicImportStream } from '../services/basic-import';
import { detectFormat, isBasicFormat, isExtendedFormat } from '../lib/basic-import-parser';
import { Readable } from 'stream';
import { workerLoggers } from '../lib/logger';

const log = workerLoggers.import;

const MAX_SAFE_PAYLOAD_SIZE = 10 * 1024 * 1024;
const LOCK_REFRESH_INTERVAL = 30000; // Refresh lock every 30 seconds
const EXTENDED_LOCK_DURATION = 3600000; // 60 minutes for basic imports

export interface ImportJob {
    userId: string;
    jobId: string;
    fileData: string;
    fileName: string;
}

function detectImportFormat(buffer: Buffer): 'basic' | 'extended' {
    try {
        // Parse enough to find the first record
        const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 2000));
        const match = content.match(/\{[^{}]*\}/);
        if (!match) return 'extended'; // Default to extended

        const firstRecord = JSON.parse(match[0]);

        if (isBasicFormat(firstRecord)) {
            return 'basic';
        }
        if (isExtendedFormat(firstRecord)) {
            return 'extended';
        }

        return detectFormat(firstRecord);
    } catch {
        log.warn('Failed to detect format, defaulting to extended');
        return 'extended';
    }
}

export async function runImport(
    data: Pick<ImportJob, 'userId' | 'jobId' | 'fileData' | 'fileName'>,
    job?: Job<ImportJob>
): Promise<void> {
    const buffer = Buffer.from(data.fileData, 'base64');
    const format = detectImportFormat(buffer);

    log.info({ jobId: data.jobId, format, fileName: data.fileName }, 'Detected import format');

    if (format === 'basic') {
        let lockRefreshInterval: NodeJS.Timeout | undefined;

        if (job) {
            lockRefreshInterval = setInterval(async () => {
                try {
                    await job.extendLock(job.token!, EXTENDED_LOCK_DURATION);
                    log.debug({ jobId: data.jobId }, 'Extended job lock');
                } catch (error) {
                    log.warn({ jobId: data.jobId, error }, 'Failed to extend job lock');
                }
            }, LOCK_REFRESH_INTERVAL);
        }

        try {
            const stream = Readable.from(buffer);
            await processBasicImportStream(data.userId, data.jobId, data.fileName, stream);
        } finally {
            if (lockRefreshInterval) {
                clearInterval(lockRefreshInterval);
            }
        }
    } else {
        const stream = Readable.from(buffer);
        await processImportStream(data.userId, data.jobId, data.fileName, stream);
    }
}

async function updateImportJobStatus(
    jobId: string,
    status: 'FAILED',
    error: unknown
): Promise<void> {
    try {
        const { prisma } = await import('../lib/prisma.js');
        await prisma.importJob.update({
            where: { id: jobId },
            data: {
                status,
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                completedAt: new Date(),
            },
        });
    } catch (dbError) {
        log.error({ jobId, dbError }, 'Failed to update job status in DB');
    }
}

const processImport = async (job: Job<ImportJob>): Promise<void> => {
    const { jobId, fileData } = job.data;

    const estimatedDecodedSize = fileData.length * 0.75;
    if (estimatedDecodedSize > MAX_SAFE_PAYLOAD_SIZE) {
        log.warn(
            { jobId, payloadSizeMB: Math.round(estimatedDecodedSize / 1024 / 1024) },
            'Large import payload may cause memory pressure - consider S3 streaming'
        );
    }

    try {
        await runImport(job.data, job);
    } catch (error) {
        log.error({ jobId, error }, 'Import job failed');
        await updateImportJobStatus(jobId, 'FAILED', error);
        throw error;
    }
};

export const importWorker = new Worker<ImportJob>(
    'import-history',
    processImport,
    {
        connection: redis,
        concurrency: 1,
        lockDuration: EXTENDED_LOCK_DURATION, // Extended to support basic imports
        stalledInterval: 120000, // Check for stalled jobs every 2 minutes
    }
);

importWorker.on('completed', (job) => {
    log.info({ jobId: job.data.jobId }, 'Import job completed');
});

importWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.data.jobId, error: err.message }, 'Import job failed');
});

export async function closeImportWorker(): Promise<void> {
    await importWorker.close();
}

process.on('SIGTERM', async () => {
    log.info('SIGTERM received, closing import worker...');
    await closeImportWorker();
});

process.on('SIGINT', async () => {
    log.info('SIGINT received, closing import worker...');
    await closeImportWorker();
});
