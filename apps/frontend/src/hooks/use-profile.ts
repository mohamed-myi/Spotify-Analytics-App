import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import { api, fetcher } from "@/lib/api";

// Types
interface UserProfile {
    id: string;
    spotifyId: string;
    displayName: string;
    email: string;
    imageUrl: string | null;
    country: string;
    createdAt: string;
}

interface ListeningStats {
    totalPlays: number;
    totalListeningMs: string;
    uniqueTracks: number;
    uniqueArtists: number;
    memberSince: string;
}

interface UserSettings {
    isPublicProfile: boolean;
    shareTopTracks: boolean;
    shareTopArtists: boolean;
    shareListeningTime: boolean;
    emailNotifications: boolean;
    timezone: string;
}

// Fetch current user profile from /auth/me
export function useProfile() {
    const { data, error, isLoading, mutate } = useSWR<UserProfile>("/auth/me", fetcher, {
        shouldRetryOnError: false,
    });

    return {
        profile: data,
        isLoading,
        isError: error,
        mutate,
    };
}

// Fetch listening stats summary
export function useListeningStats() {
    const { data, error, isLoading } = useSWR<ListeningStats>("/me/stats/summary", fetcher);

    // Format listening time for display
    const formattedTime = data ? formatListeningTime(Number(data.totalListeningMs)) : null;

    return {
        stats: data,
        formattedTime,
        isLoading,
        isError: error,
    };
}

// Fetch user settings
export function useSettings() {
    const { data, error, isLoading, mutate } = useSWR<UserSettings>("/me/settings", fetcher);

    return {
        settings: data,
        isLoading,
        isError: error,
        mutate,
    };
}

// Update user settings
async function updateSettings(url: string, { arg }: { arg: Partial<UserSettings> }) {
    const res = await api.patch(url, arg);
    return res.data;
}

export function useUpdateSettings() {
    const { trigger, isMutating, error } = useSWRMutation("/me/settings", updateSettings);

    return {
        updateSettings: trigger,
        isUpdating: isMutating,
        error,
    };
}

// Helper to format listening time
function formatListeningTime(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) {
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h`;
    }

    if (hours > 0) {
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m`;
    }

    const minutes = Math.floor(ms / (1000 * 60));
    return `${minutes}m`;
}
