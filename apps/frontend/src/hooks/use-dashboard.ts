import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { fetcher, api } from "@/lib/api";
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
    const { data, error, isLoading, mutate } = useSWR<UserProfile>("/auth/me", fetcher, {
        shouldRetryOnError: false,
    });

    return {
        user: data,
        isLoading,
        isError: error,
        isAuthenticated: !!data,
        mutate,
    };
}

export function useTopArtists(range: string = "4weeks") {
    const { data: rawData, error, isLoading, mutate } = useSWR<SpotifyArtistResponse[] | { status: string; data: [] }>(
        `/me/stats/top/artists?range=${range}`,
        fetcher,
        {
            refreshInterval: (data) => {
                // Poll every 3 seconds if status is 'processing'
                return (data && 'status' in data && data.status === 'processing') ? 3000 : 0;
            }
        }
    );

    const isProcessing = rawData && 'status' in rawData && rawData.status === 'processing';
    const data = isProcessing ? [] : (rawData as SpotifyArtistResponse[]);

    const mappedData = Array.isArray(data) ? data.map((item, index) => ({
        id: item.id,
        spotifyId: item.spotifyId,
        name: item.name,
        image: item.imageUrl || "",
        rank: item.rank || index + 1,
    })) : [];

    const triggerManualRefresh = async () => {
        try {
            await api.post('/me/stats/top/refresh');
            // Revalidate after delay to allow background job to complete
            setTimeout(() => mutate(), 5000);
        } catch {
            // 429 means cooldown active - ignore
        }
    };

    return {
        artists: mappedData,
        isLoading,
        isProcessing, // Expose processing state
        isError: error,
        mutate,
        triggerManualRefresh,
    };
}

export function useTopTracks(range: string = "4weeks") {
    const { data: rawData, error, isLoading, mutate } = useSWR<SpotifyTrackResponse[] | { status: string; data: [] }>(
        `/me/stats/top/tracks?range=${range}`,
        fetcher,
        {
            refreshInterval: (data) => {
                // Poll every 3 seconds if status is 'processing'
                return (data && 'status' in data && data.status === 'processing') ? 3000 : 0;
            }
        }
    );

    const isProcessing = rawData && 'status' in rawData && rawData.status === 'processing';
    const data = isProcessing ? [] : (rawData as SpotifyTrackResponse[]);

    const mappedData = Array.isArray(data) ? data.map((item, index) => ({
        id: item.id,
        spotifyId: item.spotifyId,
        name: item.name,
        artist: item.artists?.[0]?.artist?.name || "Unknown",
        artistSpotifyId: item.artists?.[0]?.artist?.spotifyId,
        album: item.album?.name || "Unknown Album",
        image: item.album?.imageUrl || "",
        rank: item.rank || index + 1,
    })) : [];

    const triggerManualRefresh = async () => {
        try {
            await api.post('/me/stats/top/refresh');
            setTimeout(() => mutate(), 5000);
        } catch {
            // 429 means cooldown active - ignore
        }
    };

    return {
        tracks: mappedData,
        isLoading,
        isProcessing, // Expose processing state
        isError: error,
        mutate,
        triggerManualRefresh,
    };
}

export function useRecentHistory(limit: number = 50) {
    const { data, error, isLoading } = useSWR<HistoryResponse>(`/me/history?limit=${limit}`, fetcher);

    const mappedData = data?.events?.map((event) => ({
        id: event.id,
        spotifyId: event.track.spotifyId,
        name: event.track.name,
        artist: event.track.artists?.[0]?.artist?.name || "Unknown",
        artistSpotifyId: event.track.artists?.[0]?.artist?.spotifyId,
        image: event.track.album?.imageUrl || "",
        playedAt: event.playedAt
    }));

    return {
        history: mappedData,
        isLoading,
        isError: error
    };
}

// Paginated history response includes total count
interface PaginatedHistoryResponse {
    events: HistoryEvent[];
    total: number;
    page: number;
    limit: number;
}

// Mapped history item type
export interface MappedHistoryItem {
    id: string;
    spotifyId: string;
    name: string;
    artist: string;
    artistSpotifyId?: string;
    image: string;
    playedAt: string;
}

export function useInfiniteHistory(pageSize: number = 100) {
    const getKey = (pageIndex: number, previousPageData: PaginatedHistoryResponse | null) => {
        // Reached the end - no more data
        if (previousPageData && previousPageData.events.length === 0) return null;
        // First page or subsequent pages
        return `/me/history?page=${pageIndex + 1}&limit=${pageSize}`;
    };

    const { data, error, isLoading, isValidating, size, setSize } = useSWRInfinite<PaginatedHistoryResponse>(
        getKey,
        fetcher,
        {
            revalidateFirstPage: false,
            revalidateOnFocus: false,
            persistSize: true,
        }
    );

    // Flatten all pages into a single array
    const allEvents = data ? data.flatMap(page => page.events) : [];

    // Map to frontend format
    const history: MappedHistoryItem[] = allEvents.map((event) => ({
        id: event.id,
        spotifyId: event.track.spotifyId,
        name: event.track.name,
        artist: event.track.artists?.[0]?.artist?.name || "Unknown",
        artistSpotifyId: event.track.artists?.[0]?.artist?.spotifyId,
        image: event.track.album?.imageUrl || "",
        playedAt: event.playedAt
    }));

    // Determine if there are more pages
    const total = data?.[0]?.total ?? 0;
    const hasMore = history.length < total;

    // Loading more (not initial load)
    const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");

    const loadMore = () => {
        if (!isLoadingMore && hasMore) {
            setSize(size + 1);
        }
    };

    return {
        history,
        total,
        isLoading,
        isLoadingMore: isValidating && size > 1,
        hasMore,
        loadMore,
        isError: error
    };
}


