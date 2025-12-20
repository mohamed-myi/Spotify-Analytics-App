import { queueTrackForFeatures, popTracksForFeatures, waitForRateLimit, checkRateLimit, tryLockMetadata } from '../lib/redis';
import { getValidAccessToken } from '../lib/token-manager';
import { getAudioFeaturesBatch } from '../lib/spotify-api';
import { prisma } from '../lib/prisma';
import { workerLoggers } from '../lib/logger';
import { setAudioFeaturesWorkerRunning } from './worker-status';

const log = workerLoggers.audioFeatures;

export async function audioFeaturesWorker() {
    log.info('Audio features worker started');
    setAudioFeaturesWorkerRunning(true);

    // Fetch a recent user who has a valid token.

    while (true) {
        try {
            await waitForRateLimit();

            // Pop batch of tracks
            const trackIds = await popTracksForFeatures(50);
            if (trackIds.length === 0) {
                // Sleep if no work
                await new Promise((resolve) => setTimeout(resolve, 5000));
                continue;
            }

            // Filter to only tracks that haven't been processed recently
            const toProcess: string[] = [];
            for (const id of trackIds) {
                if (await tryLockMetadata('features', id)) {
                    toProcess.push(id);
                }
            }

            if (toProcess.length === 0) {
                log.info({ skipped: trackIds.length }, 'All tracks already processed recently');
                continue;
            }

            // Get a valid token
            const user = await prisma.spotifyAuth.findFirst({
                where: { isValid: true },
                orderBy: { lastRefreshAt: 'desc' },
                select: { userId: true },
            });

            if (!user) {
                log.warn('No valid user tokens found for audio features worker. Retrying...');
                // Re-queue locked tracks
                for (const id of toProcess) {
                    await queueTrackForFeatures(id);
                }
                await new Promise((resolve) => setTimeout(resolve, 10000));
                continue;
            }

            if (!user.userId) { throw new Error("User ID missing"); }
            const tokenResult = await getValidAccessToken(user.userId);

            if (!tokenResult) {
                log.warn('Failed to refresh token for audio features worker');
                continue;
            }

            const accessToken = tokenResult.accessToken;
            const features = await getAudioFeaturesBatch(accessToken, toProcess);

            // Bulk insert
            await prisma.$transaction(
                features
                    .filter((f) => f !== null)
                    .map((f) =>
                        prisma.audioFeatures.upsert({
                            where: { trackId: f!.id },
                            create: {
                                trackId: f!.id,
                                acousticness: f!.acousticness,
                                danceability: f!.danceability,
                                energy: f!.energy,
                                instrumentalness: f!.instrumentalness,
                                key: f!.key,
                                liveness: f!.liveness,
                                loudness: f!.loudness,
                                mode: f!.mode,
                                speechiness: f!.speechiness,
                                tempo: f!.tempo,
                                timeSignature: f!.time_signature,
                                valence: f!.valence,
                                durationMs: f!.duration_ms,
                            },
                            update: {
                                // Usually features don't change, but good to ensure consistency
                                acousticness: f!.acousticness,
                                danceability: f!.danceability,
                                energy: f!.energy,
                                valence: f!.valence,
                                tempo: f!.tempo,
                            }
                        })
                    )
            );

            log.info({ count: trackIds.length }, 'Processed audio features');

        } catch (error) {
            log.error({ error }, 'Error in audio features worker');
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}
