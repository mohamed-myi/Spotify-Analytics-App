export interface Artist {
    id: string;
    name: string;
    image: string;
    rank?: number;
}

export interface Track {
    id: string;
    name: string;
    artist: string;
    album: string;
    image: string;
    playedAt?: string;
    playCount?: number;
    rank?: number;
}

export interface UserProfile {
    id: string;
    displayName: string;
    image: string;
    hasImportedHistory?: boolean;
}
