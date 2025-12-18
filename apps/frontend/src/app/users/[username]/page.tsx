"use client";

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/layout/app-layout";
import { ContentRow } from "@/components/dashboard/content-row";
import Image from "next/image";

interface PublicProfile {
    displayName: string;
    imageUrl: string | null;
    createdAt: string;
}

interface TrackData {
    id: string;
    name: string;
    artists: { artist: { name: string } }[];
    album?: { imageUrl?: string };
}

interface ArtistData {
    id: string;
    name: string;
    imageUrl?: string;
}

interface TopDataResponse {
    tracks: TrackData[];
    artists: ArtistData[];
}

interface MappedItem {
    id: string;
    name: string;
    image?: string;
    artist?: string;
}

interface TopData {
    tracks: MappedItem[];
    artists: MappedItem[];
}

export default function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = use(params);
    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [topData, setTopData] = useState<TopData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const userRes = await api.get(`/users/${username}`);
                setProfile(userRes.data);

                const statsRes = await api.get<TopDataResponse>(`/users/${username}/top`);

                const mappedTracks = statsRes.data.tracks.map((t) => ({
                    id: t.id,
                    name: t.name,
                    artist: t.artists[0]?.artist.name || "Unknown",
                    image: t.album?.imageUrl,
                }));

                const mappedArtists = statsRes.data.artists.map((a) => ({
                    id: a.id,
                    name: a.name,
                    image: a.imageUrl,
                }));

                setTopData({ tracks: mappedTracks, artists: mappedArtists });

            } catch (err: unknown) {
                console.error(err);
                const axiosError = err as { response?: { status: number } };
                if (axiosError.response?.status === 403) {
                    setError("This profile is private.");
                } else if (axiosError.response?.status === 404) {
                    setError("User not found.");
                } else {
                    setError("Failed to load profile.");
                }
            } finally {
                setLoading(false);
            }
        };

        if (username) fetchData();
    }, [username]);

    if (loading) {
        return (
            <AppLayout>
                <div className="flex items-center justify-center min-h-[50vh] text-white">
                    <div className="animate-pulse">Loading profile...</div>
                </div>
            </AppLayout>
        );
    }

    if (error || !profile) {
        return (
            <AppLayout>
                <div className="flex items-center justify-center min-h-[50vh] text-white flex-col gap-4">
                    <h1 className="text-2xl font-bold text-red-400">{error}</h1>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout>
            <div className="min-h-screen bg-background container mx-auto px-6 pt-12 pb-20 space-y-12">
                {/* Header */}
                <div className="flex flex-col items-center gap-6">
                    <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-primary/20 bg-gray-800 relative">
                        {profile.imageUrl ? (
                            <Image src={profile.imageUrl} alt={profile.displayName} fill className="object-cover" unoptimized />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-4xl text-gray-400 font-bold">
                                {profile.displayName[0]?.toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div className="text-center">
                        <h1 className="text-4xl font-bold text-white mb-2">{profile.displayName}</h1>
                        <p className="text-gray-400 text-sm">Member since {new Date(profile.createdAt).toLocaleDateString()}</p>
                    </div>
                </div>

                {/* Stats */}
                {topData && (
                    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <ContentRow
                            title="Top Artists"
                            items={topData.artists}
                            type="artist"
                        />
                        <ContentRow
                            title="Top Tracks"
                            items={topData.tracks}
                            type="wide"
                        />
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
