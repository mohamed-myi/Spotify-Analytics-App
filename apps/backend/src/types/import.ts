import { JobStatus } from '@prisma/client';

export interface EndsongRecord {
    ts: string;
    ms_played: number;
    spotify_track_uri: string | null;
    master_metadata_track_name: string | null;
    master_metadata_album_artist_name: string | null;
    master_metadata_album_album_name: string | null;
    skipped: boolean | null;
    offline: boolean | null;
    reason_start: string | null;
    reason_end: string | null;
}

export interface ParsedImportEvent {
    trackUri: string;
    trackSpotifyId: string;
    playedAt: Date;
    msPlayed: number;
    isSkip: boolean;
    trackName: string;
    artistName: string;
    albumName: string;
}

export interface UnresolvedTrack {
    trackName: string;
    artistName: string;
    occurrences: number;
}

export interface ImportProgress {
    status: JobStatus;
    phase?: 'resolving' | 'creating';
    totalUniqueTracks?: number;
    resolvedTracks?: number;
    totalRecords: number;
    processedRecords: number;
    addedRecords: number;
    skippedRecords: number;
    unresolvedTracks?: UnresolvedTrack[];
    errorMessage?: string;
}

export type ImportFormat = 'extended' | 'basic';
