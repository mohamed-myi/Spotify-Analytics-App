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

// Detects import format using field pattern matching with JSON parse fallback.
// Never silently defaults; throws explicit error if format cannot be determined.
function detectImportFormat(buffer: Buffer): 'basic' | 'extended' {
    // Read more content to ensure we capture at least one complete record
    const rawContent = buffer.toString('utf-8', 0, Math.min(buffer.length, 10000));

    // Remove BOM (byte order mark) if present
    const content = rawContent.replace(/^\uFEFF/, '');

    // Check for format-specific field patterns using regex
    // This is more reliable than JSON parsing because it handles pretty-printed JSON
    const hasExtendedFields = /"spotify_track_uri"\s*:/.test(content) ||
        (/"ts"\s*:/.test(content) && /"ms_played"\s*:/.test(content));

    const hasBasicFields = /"endTime"\s*:/.test(content) &&
        /"artistName"\s*:/.test(content) &&
        /"trackName"\s*:/.test(content) &&
        /"msPlayed"\s*:/.test(content);

    // Extended format takes precedence (it has unique fields)
    if (hasExtendedFields) {
        log.info('Detected extended format via field patterns (endsong.json)');
        return 'extended';
    }

    if (hasBasicFields) {
        log.info('Detected basic format via field patterns (StreamingHistory_music.json)');
        return 'basic';
    }

    // Fallback to JSON parsing if field patterns didn't match
    log.warn({ contentPreview: content.slice(0, 300) }, 'Field pattern detection inconclusive, attempting JSON parse');

    try {
        // Try to extract and parse first JSON object
        const match = content.match(/\{[^{}]*\}/);
        if (match) {
            const firstRecord = JSON.parse(match[0]);

            if (isBasicFormat(firstRecord)) {
                log.info('Detected basic format via JSON parse');
                return 'basic';
            }
            if (isExtendedFormat(firstRecord)) {
                log.info('Detected extended format via JSON parse');
                return 'extended';
            }

            // Last attempt: use the generic detectFormat function
            const detected = detectFormat(firstRecord);
            log.info({ detected }, 'Detected format via generic detection');
            return detected;
        }
    } catch (parseError) {
        log.error({ parseError, contentPreview: content.slice(0, 500) }, 'JSON parse failed during format detection');
    }

    // Fail with clear error message.
    const error = new Error(
        'Unable to detect import file format. Please ensure you are uploading a valid Spotify streaming history JSON file ' +
        '(either endsong.json from Extended History or StreamingHistory_music.json from Basic History).'
    );
    log.error({ contentPreview: content.slice(0, 500) }, error.message);
    throw error;
}

export async function runImport(
    data: Pick<ImportJob, 'userId' | 'jobId' | 'fileData' | 'fileName'>,
    job?: Job<ImportJob>
): Promise<void> {
    const buffer = Buffer.from(data.fileData, 'base64');

    // Format detection can throw; let it propagate to fail the job with clear error
    let format: 'basic' | 'extended';
    try {
        format = detectImportFormat(buffer);
    } catch (detectionError) {
        log.error({ jobId: data.jobId, fileName: data.fileName, error: detectionError }, 'Format detection failed');
        throw detectionError;
    }

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
