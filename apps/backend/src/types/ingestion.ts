// Data contracts for the ingestion pipeline
export interface ParsedListeningEvent {
    spotifyTrackId: string;
    playedAt: Date;
    msPlayed: number;
    isEstimated: boolean;
    source: 'api' | 'import';

    // Embedded track data 
    track: {
        spotifyId: string;
        name: string;
        durationMs: number;
        previewUrl: string | null;
        album: {
            spotifyId: string;
            name: string;
            imageUrl: string | null;
            releaseDate: string | null;
        };
        artists: Array<{
            spotifyId: string;
            name: string;
            // imageUrl and genres are NOT included (queued for backfill)
        }>;
    };
}

// For the metadata backfill queue
export interface ArtistMetadataJob {
    spotifyId: string;
    addedAt: Date;
}

// Sync summary for logging
export interface SyncSummary {
    added: number;
    skipped: number;
    updated: number;
    errors: number;
}

// Result from inserting a listening event (includes IDs for aggregation)
export interface InsertResultWithIds {
    status: 'added' | 'skipped' | 'updated';
    trackId: string;
    artistIds: string[];
    playedAt: Date;
    msPlayed: number;
}

