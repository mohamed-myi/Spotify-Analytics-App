import { prisma } from '../lib/prisma';
import { queueArtistForMetadata } from '../lib/redis';
import { logger } from '../lib/logger';
import { topStatsQueue } from '../workers/top-stats-queue';

const log = logger.child({ module: 'HealingService' });

// Configuration constants
const ARTIST_METADATA_BATCH_SIZE = 1000;
const ACTIVE_USER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const HEAL_JOB_PRIORITY = 1;

export class HealingService {
    static async healAll(): Promise<void> {
        log.info('Starting self-healing process...');

        await Promise.all([
            this.healArtistMetadata(),
            this.healTopStats(),
        ]);

        log.info('Self-healing process completed');
    }

    static async healArtistMetadata(): Promise<void> {
        try {
            // Find artists with no image URL (likely raw imports or failed metadata fetch)
            const orphans = await prisma.artist.findMany({
                where: {
                    imageUrl: null,
                },
                select: { spotifyId: true },
                take: ARTIST_METADATA_BATCH_SIZE,
            });

            if (orphans.length === 0) return;

            log.warn({ count: orphans.length }, 'Found artists with missing metadata. Queueing for repair...');

            for (const artist of orphans) {
                await queueArtistForMetadata(artist.spotifyId);
            }
        } catch (error) {
            log.error({ error }, 'Failed to heal artist metadata');
        }
    }

    static async healTopStats(): Promise<void> {
        try {
            // Active users (valid token) who haven't populated top stats yet
            // This happens if the top-stats-worker failed or hasn't run for a new user
            const activeWindowStart = new Date(Date.now() - ACTIVE_USER_WINDOW_MS);

            const users = await prisma.user.findMany({
                where: {
                    auth: { isValid: true },
                    lastIngestedAt: { gte: activeWindowStart },
                    spotifyTopTracks: { none: {} }  // No top tracks recorded
                },
                select: { id: true }
            });

            if (users.length === 0) return;

            log.warn({ count: users.length }, 'Found active users with missing Top Stats. Queueing for repair...');

            const jobs = users.map(user => ({
                name: `heal-top-stats-${user.id}`,
                data: { userId: user.id, priority: 'high' as const },
                opts: { priority: HEAL_JOB_PRIORITY }
            }));

            await topStatsQueue.addBulk(jobs);

        } catch (error) {
            log.error({ error }, 'Failed to heal top stats');
        }
    }
}

