import { prisma } from '../lib/prisma';
import { queueArtistForMetadata } from '../lib/redis';
import type { ParsedListeningEvent, SyncSummary } from '../types/ingestion';

// Upsert album, returning internal ID
async function upsertAlbum(
    album: ParsedListeningEvent['track']['album']
): Promise<string> {
    const result = await prisma.album.upsert({
        where: { spotifyId: album.spotifyId },
        create: {
            spotifyId: album.spotifyId,
            name: album.name,
            imageUrl: album.imageUrl,
            releaseDate: album.releaseDate,
        },
        update: {
            name: album.name,
            imageUrl: album.imageUrl,
        },
        select: { id: true },
    });
    return result.id;
}

// Upsert artist (minimal), queue for metadata if missing imageUrl
async function upsertArtist(artist: {
    spotifyId: string;
    name: string;
}): Promise<string> {
    const existing = await prisma.artist.findUnique({
        where: { spotifyId: artist.spotifyId },
        select: { id: true, imageUrl: true },
    });

    if (existing) {
        // If missing metadata, queue for backfill
        if (!existing.imageUrl) {
            await queueArtistForMetadata(artist.spotifyId);
        }
        return existing.id;
    }

    // New artist - create minimal and queue for metadata
    const created = await prisma.artist.create({
        data: {
            spotifyId: artist.spotifyId,
            name: artist.name,
        },
        select: { id: true },
    });
    await queueArtistForMetadata(artist.spotifyId);
    return created.id;
}

// Upsert track with album and artist relations
async function upsertTrack(
    track: ParsedListeningEvent['track']
): Promise<string> {
    const albumId = await upsertAlbum(track.album);
    const artistIds = await Promise.all(track.artists.map(upsertArtist));

    // Check if track exists
    const existing = await prisma.track.findUnique({
        where: { spotifyId: track.spotifyId },
        select: { id: true },
    });

    if (existing) {
        // Update track metadata
        await prisma.track.update({
            where: { id: existing.id },
            data: {
                name: track.name,
                previewUrl: track.previewUrl,
            },
        });
        return existing.id;
    }

    // Create new track with artist relations
    const created = await prisma.track.create({
        data: {
            spotifyId: track.spotifyId,
            name: track.name,
            durationMs: track.durationMs,
            previewUrl: track.previewUrl,
            albumId,
            artists: {
                create: artistIds.map((artistId) => ({ artistId })),
            },
        },
        select: { id: true },
    });
    return created.id;
}

// Insert listening event (skips duplicates via unique constraint)
export async function insertListeningEvent(
    userId: string,
    event: ParsedListeningEvent
): Promise<'added' | 'skipped' | 'updated'> {
    const trackId = await upsertTrack(event.track);

    // Check if record exists
    const existing = await prisma.listeningEvent.findUnique({
        where: {
            userId_trackId_playedAt: {
                userId,
                trackId,
                playedAt: event.playedAt,
            },
        },
        select: { isEstimated: true, source: true },
    });

    if (!existing) {
        // New record - insert
        await prisma.listeningEvent.create({
            data: {
                userId,
                trackId,
                playedAt: event.playedAt,
                msPlayed: event.msPlayed,
                isEstimated: event.isEstimated,
                source: event.source,
            },
        });
        return 'added';
    }

    // Record exists
    if (event.source === 'api') {
        // API data never overwrites - skip
        return 'skipped';
    }

    // Import source - can claim estimated records
    if (existing.isEstimated && event.source === 'import') {
        await prisma.listeningEvent.update({
            where: {
                userId_trackId_playedAt: {
                    userId,
                    trackId,
                    playedAt: event.playedAt,
                },
            },
            data: {
                msPlayed: event.msPlayed,
                isEstimated: false,
                source: 'import',
            },
        });
        return 'updated';
    }

    // Already has ground truth - skip
    return 'skipped';
}

// Batch insert with summary
export async function insertListeningEvents(
    userId: string,
    events: ParsedListeningEvent[]
): Promise<SyncSummary> {
    const summary: SyncSummary = { added: 0, skipped: 0, updated: 0, errors: 0 };

    for (const event of events) {
        try {
            const result = await insertListeningEvent(userId, event);
            summary[result]++;
        } catch (error) {
            console.error('Failed to insert event:', error);
            summary.errors++;
        }
    }

    return summary;
}
