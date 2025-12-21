import { prisma } from '../lib/prisma';
import { queueArtistForMetadata, queueTrackForFeatures } from '../lib/redis';
import type { ParsedListeningEvent, SyncSummary, InsertResultWithIds, SyncContext } from '../types/ingestion';

export async function upsertAlbum(
    album: ParsedListeningEvent['track']['album'],
    ctx?: SyncContext
): Promise<string> {
    // Check cache first
    if (ctx?.albumCache.has(album.spotifyId)) {
        return ctx.albumCache.get(album.spotifyId)!;
    }

    // Check database before writing (avoids unnecessary dead tuples)
    const existing = await prisma.album.findUnique({
        where: { spotifyId: album.spotifyId },
        select: { id: true },
    });

    if (existing) {
        ctx?.albumCache.set(album.spotifyId, existing.id);
        return existing.id;
    }

    // Only create if missing
    const created = await prisma.album.create({
        data: {
            spotifyId: album.spotifyId,
            name: album.name,
            imageUrl: album.imageUrl,
            releaseDate: album.releaseDate,
        },
        select: { id: true },
    });

    ctx?.albumCache.set(album.spotifyId, created.id);
    return created.id;
}

export async function upsertArtist(
    artist: { spotifyId: string; name: string },
    ctx?: SyncContext
): Promise<string> {
    // Check cache first
    if (ctx?.artistCache.has(artist.spotifyId)) {
        return ctx.artistCache.get(artist.spotifyId)!;
    }

    const existing = await prisma.artist.findUnique({
        where: { spotifyId: artist.spotifyId },
        select: { id: true, imageUrl: true },
    });

    if (existing) {
        // If missing metadata, queue for backfill
        if (!existing.imageUrl) {
            await queueArtistForMetadata(artist.spotifyId);
        }
        // Store in cache
        ctx?.artistCache.set(artist.spotifyId, existing.id);
        return existing.id;
    }

    const created = await prisma.artist.create({
        data: {
            spotifyId: artist.spotifyId,
            name: artist.name,
        },
        select: { id: true },
    });
    await queueArtistForMetadata(artist.spotifyId);

    // Store in cache
    ctx?.artistCache.set(artist.spotifyId, created.id);
    return created.id;
}

export async function upsertTrack(
    track: ParsedListeningEvent['track'],
    ctx?: SyncContext
): Promise<{ trackId: string; artistIds: string[] }> {
    // Check cache first for track
    if (ctx?.trackCache.has(track.spotifyId)) {
        // Still need artist IDs, but they should also be cached now
        const artistIds = await Promise.all(
            track.artists.map((a) => upsertArtist(a, ctx))
        );
        return { trackId: ctx.trackCache.get(track.spotifyId)!, artistIds };
    }

    const albumId = await upsertAlbum(track.album, ctx);
    const artistIds = await Promise.all(
        track.artists.map((a) => upsertArtist(a, ctx))
    );

    const existing = await prisma.track.findUnique({
        where: { spotifyId: track.spotifyId },
        select: { id: true },
    });

    if (existing) {
        await prisma.track.update({
            where: { id: existing.id },
            data: {
                name: track.name,
                previewUrl: track.previewUrl,
            },
        });

        // Ensure TrackArtist relationships exist
        for (const artistId of artistIds) {
            await prisma.trackArtist.upsert({
                where: {
                    trackId_artistId: {
                        trackId: existing.id,
                        artistId,
                    },
                },
                create: {
                    trackId: existing.id,
                    artistId,
                },
                update: {},
            });
        }

        // Store in cache
        ctx?.trackCache.set(track.spotifyId, existing.id);
        return { trackId: existing.id, artistIds };
    }

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
        select: { id: true, spotifyId: true },
    });

    // Queue for audio features
    await queueTrackForFeatures(created.spotifyId);

    // Store in cache
    ctx?.trackCache.set(track.spotifyId, created.id);
    return { trackId: created.id, artistIds };
}

export async function insertListeningEvent(
    userId: string,
    event: ParsedListeningEvent,
    ctx?: SyncContext
): Promise<'added' | 'skipped' | 'updated'> {
    const result = await insertListeningEventWithIds(userId, event, ctx);
    return result.status;
}

export async function insertListeningEventWithIds(
    userId: string,
    event: ParsedListeningEvent,
    ctx?: SyncContext
): Promise<InsertResultWithIds> {
    const { trackId, artistIds } = await upsertTrack(event.track, ctx);

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

    const baseResult = { trackId, artistIds, playedAt: event.playedAt, msPlayed: event.msPlayed };

    if (!existing) {
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
        return { status: 'added', ...baseResult };
    }

    if (event.source === 'api') {
        return { status: 'skipped', ...baseResult };
    }

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
        return { status: 'updated', ...baseResult };
    }

    return { status: 'skipped', ...baseResult };
}

export async function insertListeningEvents(
    userId: string,
    events: ParsedListeningEvent[],
    ctx?: SyncContext
): Promise<SyncSummary> {
    const summary: SyncSummary = { added: 0, skipped: 0, updated: 0, errors: 0 };

    for (const event of events) {
        try {
            const result = await insertListeningEvent(userId, event, ctx);
            summary[result]++;
        } catch (error) {
            console.error('Failed to insert event:', error);
            summary.errors++;
        }
    }

    return summary;
}

export async function insertListeningEventsWithIds(
    userId: string,
    events: ParsedListeningEvent[],
    ctx?: SyncContext
): Promise<{ summary: SyncSummary; results: InsertResultWithIds[] }> {
    const summary: SyncSummary = { added: 0, skipped: 0, updated: 0, errors: 0 };
    const results: InsertResultWithIds[] = [];

    for (const event of events) {
        try {
            const result = await insertListeningEventWithIds(userId, event, ctx);
            summary[result.status]++;
            results.push(result);
        } catch (error) {
            console.error('Failed to insert event:', error);
            summary.errors++;
        }
    }

    return { summary, results };
}

