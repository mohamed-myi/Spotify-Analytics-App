"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { PageTitle } from "@/components/dashboard/page-title";
import { PlaylistFeatureTile } from "@/components/playlists/playlist-feature-tile";
import { ShuffleModal } from "@/components/playlists/shuffle-modal";
import { TopStatsModal } from "@/components/playlists/top-stats-modal";
import { RecentModal } from "@/components/playlists/recent-modal";
import { Shuffle, BarChart3, Clock } from "lucide-react";
import { useState } from "react";
import { AnimatePresence } from "framer-motion";

export default function PlaylistsPage() {
    const [activeModal, setActiveModal] = useState<'shuffle' | 'top50' | 'recent' | null>(null);

    return (
        <AppLayout>
            <div className="min-h-screen pb-20">
                <PageTitle
                    title="Custom Playlists"
                    subtitle="Generate custom mixes from your stats & library"
                />

                <div className="w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                        <PlaylistFeatureTile
                            icon={Shuffle}
                            title="True Shuffle"
                            description="Tired of the same songs in your shuffle? Time to truly randomize it.."
                            onClick={() => setActiveModal('shuffle')}
                        />

                        <PlaylistFeatureTile
                            icon={BarChart3}
                            title="Top 50 Songs"
                            description="Create a playlist of your top 50 tracks from any time range."
                            onClick={() => setActiveModal('top50')}
                        />

                        <PlaylistFeatureTile
                            icon={Clock}
                            title="Flashback Playlist"
                            description="Pick any time range and make a take a trip down memory lane."
                            onClick={() => setActiveModal('recent')}
                        />
                    </div>
                </div>

                {/* Modals */}
                <AnimatePresence>
                    {activeModal === 'shuffle' && (
                        <ShuffleModal
                            isOpen={true}
                            onClose={() => setActiveModal(null)}
                        />
                    )}
                    {activeModal === 'top50' && (
                        <TopStatsModal
                            isOpen={true}
                            onClose={() => setActiveModal(null)}
                        />
                    )}
                    {activeModal === 'recent' && (
                        <RecentModal
                            isOpen={true}
                            onClose={() => setActiveModal(null)}
                        />
                    )}
                </AnimatePresence>
            </div>
        </AppLayout>
    );
}
