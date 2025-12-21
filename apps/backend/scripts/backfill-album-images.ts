/**
 * Script to backfill track album metadata from Spotify API.
 * Finds tracks without albums or albums without images and fetches from Spotify.
 * Run with: npx tsx apps/backend/scripts/backfill-album-images.ts
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
const BATCH_SIZE = 50;

// Valid Spotify ID is 22 characters, base62
function isValidSpotifyId(id: string): boolean {
    return /^[a-zA-Z0-9]{22}$/.test(id);
}

async function fetchTracksBatch(accessToken: string, trackIds: string[]): Promise<any[]> {
    const response = await fetch(`${SPOTIFY_API_URL}/tracks?ids=${trackIds.join(",")}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        console.error(`Failed to fetch tracks: ${response.status} ${response.statusText}`);
        return [];
    }
    const data = await response.json();
    return data.tracks || [];
}

async function backfillAlbumImages() {
    console.log("Analyzing track/album data...\n");

    // Step 1: Find tracks with no album
    const tracksWithoutAlbum = await prisma.track.findMany({
        where: { albumId: null },
        select: { id: true, spotifyId: true, name: true },
    });
    console.log(`Tracks without album: ${tracksWithoutAlbum.length}`);

    // Step 2: Find albums without images
    const albumsWithoutImage = await prisma.album.findMany({
        where: { imageUrl: null },
        select: { id: true, spotifyId: true, name: true },
    });
    console.log(`Albums without imageUrl: ${albumsWithoutImage.length}`);

    // Step 3: Find tracks that have albums but albums have no image
    const tracksWithAlbumNoImage = await prisma.track.findMany({
        where: {
            albumId: { not: null },
            album: { imageUrl: null },
        },
        select: { id: true, spotifyId: true, name: true, album: { select: { id: true, spotifyId: true } } },
    });
    console.log(`Tracks with album but no image: ${tracksWithAlbumNoImage.length}\n`);

    // Combine all tracks that need backfill
    const allTracksToBackfill = new Map<string, { id: string; spotifyId: string; name: string }>();
    let invalidIdCount = 0;
    const invalidExamples: string[] = [];

    for (const track of tracksWithoutAlbum) {
        if (isValidSpotifyId(track.spotifyId)) {
            allTracksToBackfill.set(track.spotifyId, track);
        } else {
            invalidIdCount++;
            if (invalidExamples.length < 3) invalidExamples.push(track.spotifyId);
        }
    }

    for (const track of tracksWithAlbumNoImage) {
        if (isValidSpotifyId(track.spotifyId)) {
            allTracksToBackfill.set(track.spotifyId, { id: track.id, spotifyId: track.spotifyId, name: track.name });
        } else {
            invalidIdCount++;
            if (invalidExamples.length < 3) invalidExamples.push(track.spotifyId);
        }
    }

    if (invalidIdCount > 0) {
        console.log(`WARNING: ${invalidIdCount} tracks have invalid Spotify IDs (examples: ${invalidExamples.join(", ")})`);
    }

    const tracksToProcess = Array.from(allTracksToBackfill.values());
    console.log(`Total unique tracks to backfill: ${tracksToProcess.length}\n`);

    if (tracksToProcess.length === 0) {
        // Check if there are albums without images that we could update directly
        if (albumsWithoutImage.length > 0) {
            console.log("No valid tracks to process, but found albums without images.");
            console.log("   This might indicate tracks have old-format Spotify IDs.");
            console.log("   Attempting to find valid tracks linked to these albums...\n");

            for (const album of albumsWithoutImage) {
                if (!isValidSpotifyId(album.spotifyId)) {
                    console.log(`   Skipping album with invalid ID: ${album.spotifyId}`);
                    continue;
                }
                const track = await prisma.track.findFirst({
                    where: { albumId: album.id },
                    select: { id: true, spotifyId: true, name: true },
                });
                if (track && isValidSpotifyId(track.spotifyId)) {
                    allTracksToBackfill.set(track.spotifyId, track);
                }
            }
        }

        if (allTracksToBackfill.size === 0) {
            console.log("All tracks have valid album images or no valid IDs to process!");
            return;
        }
    }

    // Get a user with a valid token
    const user = await prisma.user.findFirst({
        where: { auth: { isValid: true } },
        select: { id: true, displayName: true },
    });

    if (!user) {
        console.error("ERROR: No user with valid token found");
        return;
    }

    console.log(`Using token from user: ${user.displayName || user.id}\n`);

    const tokenResult = await getValidAccessToken(user.id);
    if (!tokenResult) {
        console.error("ERROR: Failed to get valid access token");
        return;
    }

    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    // Process in batches
    for (let i = 0; i < tracksToProcess.length; i += BATCH_SIZE) {
        const batch = tracksToProcess.slice(i, i + BATCH_SIZE);
        const spotifyIds = batch.map((t) => t.spotifyId);

        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tracksToProcess.length / BATCH_SIZE)}...`);

        try {
            const spotifyTracks = await fetchTracksBatch(tokenResult.accessToken, spotifyIds);

            for (const spotifyTrack of spotifyTracks) {
                if (!spotifyTrack) continue;

                try {
                    // Upsert album with image
                    const album = await prisma.album.upsert({
                        where: { spotifyId: spotifyTrack.album.id },
                        create: {
                            spotifyId: spotifyTrack.album.id,
                            name: spotifyTrack.album.name,
                            imageUrl: spotifyTrack.album.images?.[0]?.url || null,
                            releaseDate: spotifyTrack.album.release_date || null,
                        },
                        update: {
                            imageUrl: spotifyTrack.album.images?.[0]?.url || null,
                        },
                        select: { id: true },
                    });

                    // Update track to link to album
                    await prisma.track.update({
                        where: { spotifyId: spotifyTrack.id },
                        data: {
                            albumId: album.id,
                            durationMs: spotifyTrack.duration_ms,
                            previewUrl: spotifyTrack.preview_url,
                        },
                    });

                    // Ensure artist associations exist
                    for (const spotifyArtist of spotifyTrack.artists) {
                        const artist = await prisma.artist.upsert({
                            where: { spotifyId: spotifyArtist.id },
                            create: {
                                spotifyId: spotifyArtist.id,
                                name: spotifyArtist.name,
                            },
                            update: {},
                            select: { id: true },
                        });

                        const track = await prisma.track.findUnique({
                            where: { spotifyId: spotifyTrack.id },
                            select: { id: true },
                        });

                        if (track) {
                            await prisma.trackArtist.upsert({
                                where: {
                                    trackId_artistId: {
                                        trackId: track.id,
                                        artistId: artist.id,
                                    },
                                },
                                create: {
                                    trackId: track.id,
                                    artistId: artist.id,
                                },
                                update: {},
                            });
                        }
                    }

                    updatedCount++;
                } catch (err) {
                    console.error(`  Error updating track ${spotifyTrack.id}:`, err);
                    errorCount++;
                }
            }

            processedCount += batch.length;

        } catch (err) {
            console.error(`  Batch error:`, err);
            errorCount += batch.length;
        }

        // Rate limit delay
        await new Promise((r) => setTimeout(r, 100));
    }

    console.log(`\nAlbum image backfill complete!`);
    console.log(`   Processed: ${processedCount}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Errors: ${errorCount}`);
}

backfillAlbumImages()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
        process.exit(0);
    });
