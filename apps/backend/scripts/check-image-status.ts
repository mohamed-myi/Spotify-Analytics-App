/**
 * Quick debug script to check real vs test data
 */
import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
    // Count real tracks (22-char base62 IDs)
    const allTracks = await prisma.track.findMany({
        select: {
            spotifyId: true,
            name: true,
            albumId: true,
            album: { select: { imageUrl: true, name: true } }
        },
    });

    const validTracks = allTracks.filter(t => /^[a-zA-Z0-9]{22}$/.test(t.spotifyId));
    const testTracks = allTracks.filter(t => t.spotifyId.startsWith("test-"));

    const validWithImage = validTracks.filter(t => t.album?.imageUrl);
    const validNoImage = validTracks.filter(t => !t.album?.imageUrl);
    const validNoAlbum = validTracks.filter(t => !t.albumId);

    console.log("=== Track Analysis ===");
    console.log(`Total tracks: ${allTracks.length}`);
    console.log(`Real Spotify tracks (22-char ID): ${validTracks.length}`);
    console.log(`Test tracks (test-* ID): ${testTracks.length}`);
    console.log();
    console.log("=== Real Track Image Status ===");
    console.log(`  With album images: ${validWithImage.length}`);
    console.log(`  Without album images: ${validNoImage.length}`);
    console.log(`  Without album link: ${validNoAlbum.length}`);

    if (validNoImage.length > 0) {
        console.log("\nExamples of real tracks without album images:");
        validNoImage.slice(0, 5).forEach(t =>
            console.log(`  - ${t.spotifyId}: "${t.name}" (album: ${t.album?.name || "no album"})`));
    }

    if (validNoAlbum.length > 0) {
        console.log("\nExamples of real tracks without album:");
        validNoAlbum.slice(0, 5).forEach(t =>
            console.log(`  - ${t.spotifyId}: "${t.name}"`));
    }

    await prisma.$disconnect();
    await pool.end();
}

check().catch(console.error);
