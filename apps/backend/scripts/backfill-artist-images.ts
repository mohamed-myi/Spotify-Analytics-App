/**
 * Script to backfill artist images from Spotify API.
 * Run with: npx tsx apps/backend/scripts/backfill-artist-images.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getValidAccessToken } from "../src/lib/token-manager";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SPOTIFY_API_URL = "https://api.spotify.com/v1";

// Valid Spotify ID is 22 characters, base62
function isValidSpotifyId(id: string): boolean {
    return /^[a-zA-Z0-9]{22}$/.test(id);
}

async function fetchSingleArtist(accessToken: string, spotifyId: string): Promise<any | null> {
    try {
        const response = await fetch(`${SPOTIFY_API_URL}/artists/${spotifyId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) return null;
        return response.json();
    } catch {
        return null;
    }
}

async function backfillArtistImages() {
    console.log("Starting artist image backfill...");

    // Get a user with a valid token
    const user = await prisma.user.findFirst({
        where: { auth: { isValid: true } },
        select: { id: true, displayName: true },
    });

    if (!user) {
        console.error("No user with valid token found");
        return;
    }

    console.log(`Using token from user: ${user.displayName || user.id}`);

    const tokenResult = await getValidAccessToken(user.id);
    if (!tokenResult) {
        console.error("Failed to get valid access token");
        return;
    }

    // Get all artists missing images
    const artists = await prisma.artist.findMany({
        where: { imageUrl: null },
        select: { id: true, spotifyId: true, name: true },
    });

    console.log(`Found ${artists.length} artists missing images`);

    if (artists.length === 0) {
        console.log("All artists have images!");
        return;
    }

    // Filter to only valid Spotify IDs
    const validArtists = artists.filter((a) => isValidSpotifyId(a.spotifyId));
    const invalidCount = artists.length - validArtists.length;
    if (invalidCount > 0) {
        console.log(`Skipping ${invalidCount} artists with invalid Spotify IDs`);
    }

    let updated = 0;
    let failed = 0;

    // Process one at a time to handle bad IDs gracefully
    for (let i = 0; i < validArtists.length; i++) {
        const artist = validArtists[i];

        if ((i + 1) % 10 === 0 || i === 0) {
            console.log(`Processing ${i + 1}/${validArtists.length}...`);
        }

        const spotifyArtist = await fetchSingleArtist(tokenResult.accessToken, artist.spotifyId);

        if (spotifyArtist && spotifyArtist.images?.[0]?.url) {
            await prisma.artist.update({
                where: { id: artist.id },
                data: {
                    imageUrl: spotifyArtist.images[0].url,
                    genres: spotifyArtist.genres || [],
                },
            });
            updated++;
        } else {
            failed++;
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 50));
    }

    console.log(`\nArtist image backfill complete!`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Failed/No image: ${failed}`);
    console.log(`   Invalid IDs skipped: ${invalidCount}`);
}

backfillArtistImages()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
        process.exit(0);
    });

