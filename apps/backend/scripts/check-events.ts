/**
 * Debug script to check listening events and their album images
 */
import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
    // Get recent listening events with track/album data
    const events = await prisma.listeningEvent.findMany({
        take: 20,
        orderBy: { playedAt: 'desc' },
        include: {
            track: {
                include: {
                    artists: { include: { artist: true } },
                    album: true
                }
            }
        },
    });

    console.log("=== Recent Listening Events ===\n");
    console.log(`Total events retrieved: ${events.length}\n`);

    let withImage = 0;
    let withoutImage = 0;

    for (const event of events) {
        const track = event.track;
        const hasImage = !!track.album?.imageUrl;

        if (hasImage) {
            withImage++;
        } else {
            withoutImage++;
            console.log(`❌ No image: "${track.name}"`);
            console.log(`   Track spotifyId: ${track.spotifyId}`);
            console.log(`   Album: ${track.album?.name || 'NO ALBUM'}`);
            console.log(`   Album spotifyId: ${track.album?.spotifyId || 'N/A'}`);
            console.log(`   Album imageUrl: ${track.album?.imageUrl || 'NULL'}`);
            console.log();
        }
    }

    console.log("=== Summary ===");
    console.log(`Events with album images: ${withImage}`);
    console.log(`Events without album images: ${withoutImage}`);

    await prisma.$disconnect();
    await pool.end();
}

check().catch(console.error);
