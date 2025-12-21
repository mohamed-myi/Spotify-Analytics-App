
"use client";

import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Hero } from "@/components/dashboard/hero";
import { ContentRow } from "@/components/dashboard/content-row";
import { ItemModal } from "@/components/dashboard/item-modal";
import { useUser, useTopArtists, useTopTracks, useRecentHistory } from "@/hooks/use-dashboard";

interface SelectedItem {
    id: string;
    name: string;
    image?: string;
    artist?: string;
    spotifyId?: string;
    artistSpotifyId?: string;
}

export default function DashboardPage() {
    const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
    const [artistRange, setArtistRange] = useState("year");
    const [trackRange, setTrackRange] = useState("4weeks");
    const [isRefreshing, setIsRefreshing] = useState(false);

    const { user } = useUser();
    const hasImported = user?.hasImportedHistory ?? false;

    // Hero shows all-time top artist if imported, else 1-year
    const heroRange = hasImported ? 'alltime' : 'year';
    const { artists: heroArtists } = useTopArtists(heroRange);

    const { artists: topArtists, triggerManualRefresh: refreshArtists } = useTopArtists(artistRange);
    const { tracks: topTracks, triggerManualRefresh: refreshTracks } = useTopTracks(trackRange);
    const { history: recentHistory } = useRecentHistory(20);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        await Promise.all([refreshArtists(), refreshTracks()]);
        setTimeout(() => setIsRefreshing(false), 5000);
    };

    return (
        <AppLayout>
            <div className="min-h-screen bg-background pb-20">

                <Hero
                    title={heroArtists?.[0]?.name || "Loading..."}
                    subtitle="#1 Artist"
                    description={hasImported ? "Your all-time favorite artist." : "Your favorite artist over the last year."}
                    image={heroArtists?.[0]?.image || ""}
                />

                <div className="-mt-32 relative z-20 space-y-8">
                    <ContentRow
                        title="Top Artists"
                        items={topArtists || []}
                        type="artist"
                        showTimeRange
                        selectedRange={artistRange}
                        showRank={true}
                        onRangeChange={setArtistRange}
                        onItemClick={setSelectedItem}
                        onRefresh={handleRefresh}
                        isRefreshing={isRefreshing}
                        hasImportedHistory={hasImported}
                    />

                    <ContentRow
                        title="Recently Played"
                        items={recentHistory || []}
                        type="wide"
                        onItemClick={setSelectedItem}
                    />

                    <ContentRow
                        title="Top Tracks"
                        items={topTracks || []}
                        type="wide"
                        showTimeRange
                        selectedRange={trackRange}
                        showRank={true}
                        onRangeChange={setTrackRange}
                        onItemClick={setSelectedItem}
                        onRefresh={handleRefresh}
                        isRefreshing={isRefreshing}
                        hasImportedHistory={hasImported}
                    />


                </div>
            </div>

            <ItemModal
                isOpen={!!selectedItem}
                onClose={() => setSelectedItem(null)}
                item={selectedItem}
            />
        </AppLayout>
    );
}

