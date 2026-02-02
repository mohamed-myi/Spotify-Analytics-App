/**
 * Demo User Seeding Script
 * 
 * This script creates a demo user with anonymized data exported from a real user.
 * Run with: npx tsx prisma/seed-demo.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root 
config({ path: resolve(__dirname, '../.env') });

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Term, BucketType, JobStatus } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Fixed IDs for demo user
const DEMO_USER_ID = 'demo_user_fixed_id';
const DEMO_SPOTIFY_ID = 'demo_spotify_user';

// Configuration
const SOURCE_USER_ID = process.env.SOURCE_USER_ID; // Set this to export from your account

async function main() {
    console.log('Starting demo user seeding...');

    // Step 1: Create or update demo user
    const demoUser = await prisma.user.upsert({
        where: { id: DEMO_USER_ID },
        create: {
            id: DEMO_USER_ID,
            spotifyId: DEMO_SPOTIFY_ID,
            displayName: 'Demo User',
            email: 'demo@myi.app',
            imageUrl: null, // Will use default avatar
            country: 'US',
            isDemo: true,
            role: 'DEMO',
            totalPlayCount: 0,
            totalListeningMs: BigInt(0),
        },
        update: {
            isDemo: true,
            role: 'DEMO',
            displayName: 'Demo User',
        }
    });
    console.log(`Created/updated demo user: ${demoUser.id}`);

    // Step 2: Create demo user settings
    await prisma.userSettings.upsert({
        where: { userId: DEMO_USER_ID },
        create: { userId: DEMO_USER_ID },
        update: {}
    });
    console.log('Created demo user settings');

    // Step 3: Copy data from source user if provided
    if (SOURCE_USER_ID) {
        await copyDataFromSourceUser(SOURCE_USER_ID);
    } else {
        console.log('No SOURCE_USER_ID provided, skipping data copy');
        console.log('Set SOURCE_USER_ID env var to copy and anonymize your data');
    }

    // Step 4: Create sample completed import job for demo
    await prisma.importJob.upsert({
        where: { id: 'demo_import_job' },
        create: {
            id: 'demo_import_job',
            userId: DEMO_USER_ID,
            fileName: 'StreamingHistory_music_0.json',
            status: JobStatus.COMPLETED,
            totalEvents: 15000,
            processedEvents: 15000,
            startedAt: new Date(Date.now() - 86400000), // 1 day ago
            completedAt: new Date(Date.now() - 86400000 + 120000), // 2 min duration
        },
        update: {}
    });
    console.log('Created demo import job');

    console.log('Demo user seeding complete!');
}

async function copyDataFromSourceUser(sourceUserId: string) {
    console.log(`Copying data from user: ${sourceUserId}`);

    // Get source user stats
    const sourceUser = await prisma.user.findUnique({
        where: { id: sourceUserId },
        select: { totalPlayCount: true, totalListeningMs: true }
    });

    if (!sourceUser) {
        console.log('Source user not found');
        return;
    }

    // Update demo user with source user's stats
    await prisma.user.update({
        where: { id: DEMO_USER_ID },
        data: {
            totalPlayCount: sourceUser.totalPlayCount,
            totalListeningMs: sourceUser.totalListeningMs,
        }
    });

    // Copy top tracks (these reference shared track/artist entities)
    const topTracks = await prisma.spotifyTopTrack.findMany({
        where: { userId: sourceUserId }
    });

    if (topTracks.length > 0) {
        // Delete existing demo top tracks
        await prisma.spotifyTopTrack.deleteMany({
            where: { userId: DEMO_USER_ID }
        });

        // Create new demo top tracks
        await prisma.spotifyTopTrack.createMany({
            data: topTracks.map(t => ({
                userId: DEMO_USER_ID,
                trackId: t.trackId,
                term: t.term,
                rank: t.rank,
            })),
            skipDuplicates: true,
        });
        console.log(`Copied ${topTracks.length} top tracks`);
    }

    // Copy top artists
    const topArtists = await prisma.spotifyTopArtist.findMany({
        where: { userId: sourceUserId }
    });

    if (topArtists.length > 0) {
        await prisma.spotifyTopArtist.deleteMany({
            where: { userId: DEMO_USER_ID }
        });

        await prisma.spotifyTopArtist.createMany({
            data: topArtists.map(a => ({
                userId: DEMO_USER_ID,
                artistId: a.artistId,
                term: a.term,
                rank: a.rank,
            })),
            skipDuplicates: true,
        });
        console.log(`Copied ${topArtists.length} top artists`);
    }

    // Copy user track stats (top 500 by play count)
    const trackStats = await prisma.userTrackStats.findMany({
        where: { userId: sourceUserId },
        orderBy: { playCount: 'desc' },
        take: 500,
    });

    if (trackStats.length > 0) {
        await prisma.userTrackStats.deleteMany({
            where: { userId: DEMO_USER_ID }
        });

        await prisma.userTrackStats.createMany({
            data: trackStats.map(s => ({
                userId: DEMO_USER_ID,
                trackId: s.trackId,
                playCount: s.playCount,
                totalMs: s.totalMs,
                lastPlayedAt: s.lastPlayedAt,
            })),
            skipDuplicates: true,
        });
        console.log(`Copied ${trackStats.length} track stats`);
    }

    // Copy user artist stats (top 200 by play count)
    const artistStats = await prisma.userArtistStats.findMany({
        where: { userId: sourceUserId },
        orderBy: { playCount: 'desc' },
        take: 200,
    });

    if (artistStats.length > 0) {
        await prisma.userArtistStats.deleteMany({
            where: { userId: DEMO_USER_ID }
        });

        await prisma.userArtistStats.createMany({
            data: artistStats.map(s => ({
                userId: DEMO_USER_ID,
                artistId: s.artistId,
                playCount: s.playCount,
                totalMs: s.totalMs,
            })),
            skipDuplicates: true,
        });
        console.log(`Copied ${artistStats.length} artist stats`);
    }

    // Copy time bucket stats (all)
    const bucketStats = await prisma.userTimeBucketStats.findMany({
        where: { userId: sourceUserId }
    });

    if (bucketStats.length > 0) {
        await prisma.userTimeBucketStats.deleteMany({
            where: { userId: DEMO_USER_ID }
        });

        await prisma.userTimeBucketStats.createMany({
            data: bucketStats.map(s => ({
                userId: DEMO_USER_ID,
                bucketType: s.bucketType,
                bucketDate: s.bucketDate,
                playCount: s.playCount,
                totalMs: s.totalMs,
                uniqueTracks: s.uniqueTracks,
            })),
            skipDuplicates: true,
        });
        console.log(`Copied ${bucketStats.length} bucket stats`);
    }

    // Copy hour stats
    const hourStats = await prisma.userHourStats.findMany({
        where: { userId: sourceUserId }
    });

    if (hourStats.length > 0) {
        await prisma.userHourStats.deleteMany({
            where: { userId: DEMO_USER_ID }
        });

        await prisma.userHourStats.createMany({
            data: hourStats.map(s => ({
                userId: DEMO_USER_ID,
                hour: s.hour,
                playCount: s.playCount,
                totalMs: s.totalMs,
            })),
            skipDuplicates: true,
        });
        console.log(`Copied ${hourStats.length} hour stats`);
    }

    // Copy sample listening events (last 1000) - these are already anonymized since they reference shared tracks
    const events = await prisma.listeningEvent.findMany({
        where: { userId: sourceUserId },
        orderBy: { playedAt: 'desc' },
        take: 1000,
    });

    if (events.length > 0) {
        // Get count of existing demo events
        const existingCount = await prisma.listeningEvent.count({
            where: { userId: DEMO_USER_ID }
        });

        if (existingCount < 500) {
            // Only seed if demo user has fewer than 500 events
            for (const event of events) {
                try {
                    await prisma.listeningEvent.create({
                        data: {
                            userId: DEMO_USER_ID,
                            trackId: event.trackId,
                            playedAt: event.playedAt,
                            msPlayed: event.msPlayed,
                            isEstimated: event.isEstimated,
                            isSkip: event.isSkip,
                            source: event.source,
                        }
                    });
                } catch {
                    // Skip duplicates
                }
            }
            console.log(`Copied up to ${events.length} listening events`);
        } else {
            console.log(`Demo user already has ${existingCount} events, skipping event copy`);
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
