import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { UserProfile } from "@/lib/types";

// API response types
interface SpotifyArtistResponse {
    id: string;
    spotifyId: string;
    name: string;
    imageUrl?: string;
    rank?: number;
}

interface SpotifyTrackResponse {
    id: string;
    spotifyId: string;
    name: string;
    artists?: { artist: { name: string; spotifyId: string } }[];
    album?: { name: string; imageUrl?: string };
    rank?: number;
}

interface HistoryEvent {
    id: string;
    playedAt: string;
    track: {
        spotifyId: string;
        name: string;
        artists: { artist: { name: string; spotifyId: string } }[];
        album?: { imageUrl?: string };
    };
}

interface HistoryResponse {
    events: HistoryEvent[];
}

export function useUser() {
    const { data, error, isLoading } = useSWR<UserProfile>("/auth/me", fetcher, {
        shouldRetryOnError: false,
    });

    return {
        user: data,
        isLoading,
        isError: error,
        isAuthenticated: !!data,
    };
}

export function useTopArtists(range: string = "4weeks") {
    const { data, error, isLoading } = useSWR<SpotifyArtistResponse[]>(`/me/stats/top/artists?range=${range}`, fetcher);

    const mappedData = data?.map((item, index) => ({
        id: item.id,
        spotifyId: item.spotifyId,
        name: item.name,
        image: item.imageUrl || "",
        rank: item.rank || index + 1,
    }));

    return {
        artists: mappedData,
        isLoading,
        isError: error,
    };
}

export function useTopTracks(range: string = "4weeks") {
    const { data, error, isLoading } = useSWR<SpotifyTrackResponse[]>(`/me/stats/top/tracks?range=${range}`, fetcher);

    const mappedData = data?.map((item, index) => ({
        id: item.id,
        spotifyId: item.spotifyId,
        name: item.name,
        artist: item.artists?.[0]?.artist?.name || "Unknown",
        artistSpotifyId: item.artists?.[0]?.artist?.spotifyId,
        album: item.album?.name || "Unknown Album",
        image: item.album?.imageUrl || "",
        rank: item.rank || index + 1,
    }));

    return {
        tracks: mappedData,
        isLoading,
        isError: error,
    };
}

export function useRecentHistory(limit: number = 50) {
    const { data, error, isLoading } = useSWR<HistoryResponse>(`/me/history?limit=${limit}`, fetcher);

    const mappedData = data?.events?.map((event) => ({
        id: event.id,
        spotifyId: event.track.spotifyId,
        name: event.track.name,
        artist: event.track.artists[0]?.artist.name || "Unknown",
        artistSpotifyId: event.track.artists[0]?.artist.spotifyId,
        image: event.track.album?.imageUrl || "",
        playedAt: event.playedAt
    }));

    return {
        history: mappedData,
        isLoading,
        isError: error
    };
}

