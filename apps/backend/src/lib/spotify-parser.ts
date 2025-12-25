import { Source } from '@prisma/client';
import type { SpotifyRecentlyPlayedResponse } from '../types/spotify';
import type { ParsedListeningEvent } from '../types/ingestion';

export function parseRecentlyPlayed(
    response: SpotifyRecentlyPlayedResponse
): ParsedListeningEvent[] {
    return response.items.map((item) => ({
        spotifyTrackId: item.track.id,
        playedAt: new Date(item.played_at),
        msPlayed: item.track.duration_ms,
        isEstimated: true,
        source: Source.API,
        track: {
            spotifyId: item.track.id,
            name: item.track.name,
            durationMs: item.track.duration_ms,
            previewUrl: item.track.preview_url,
            album: {
                spotifyId: item.track.album.id,
                name: item.track.album.name,
                imageUrl: item.track.album.images[0]?.url || null,
                releaseDate: item.track.album.release_date || null,
            },
            artists: item.track.artists.map((artist) => ({
                spotifyId: artist.id,
                name: artist.name,
            })),
        },
    }));
}
