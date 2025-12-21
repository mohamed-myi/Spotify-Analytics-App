"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { useRecentHistory } from "@/hooks/use-dashboard";
import { useState, useMemo } from "react";
import { ItemModal } from "@/components/dashboard/item-modal";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { PageTitle } from "@/components/dashboard/page-title";

interface HistoryItem {
    id: string;
    name: string;
    artist: string;
    image?: string;
    playedAt: string;
    spotifyId?: string;
    artistSpotifyId?: string;
}

interface Section {
    title: string;
    items: HistoryItem[];
}

// Helper to check same day
const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
};

// Desktop tile component - unified size with Dashboard
function DesktopHistoryTile({
    item,
    onItemClick
}: {
    item: HistoryItem;
    onItemClick?: (item: HistoryItem) => void;
}) {
    return (
        <div
            className="group cursor-pointer"
            onClick={() => onItemClick?.(item)}
        >
            {/* Glass Style, Medium padding for unified sizing */}
            <div className="backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-3.5 transition-all duration-300 hover:scale-105 shadow-xl">
                {/* Album Cover */}
                <div className="relative mb-3">
                    <div className="aspect-square rounded-md overflow-hidden bg-white/5">
                        {item.image ? (
                            <Image
                                src={item.image}
                                alt={item.name}
                                fill
                                className="object-cover"
                                unoptimized
                            />
                        ) : (
                            <div className="w-full h-full bg-white/10" />
                        )}
                    </div>
                    {/* Explicit Badge */}
                    {item.name.length % 4 === 0 && (
                        <div className="absolute top-2 right-2">
                            <span className="px-1.5 py-0.5 rounded backdrop-blur-md bg-black/60 border border-white/20 text-[10px] font-medium">
                                E
                            </span>
                        </div>
                    )}
                </div>

                {/* Track Info */}
                <div>
                    <p className="text-sm truncate mb-1 text-white group-hover:text-purple-300 transition-colors">
                        {item.name}
                    </p>
                    <p className="text-xs text-white/50 truncate">
                        {item.artist}
                    </p>
                </div>
            </div>
        </div>
    );
}

// Mobile stacked tile component (consistent with content-row)
function MobileHistoryTile({
    item,
    onItemClick
}: {
    item: HistoryItem;
    onItemClick?: (item: HistoryItem) => void;
}) {
    return (
        <div
            className="flex items-center gap-3 backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-3 cursor-pointer transition-all"
            onClick={() => onItemClick?.(item)}
        >
            {/* Square Image */}
            <div className="w-12 h-12 rounded-md overflow-hidden bg-white/5 flex-shrink-0 relative">
                {item.image ? (
                    <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        className="object-cover"
                        unoptimized
                    />
                ) : (
                    <div className="w-full h-full bg-white/10" />
                )}
            </div>

            {/* Text Content */}
            <div className="flex-1 min-w-0">
                <p className="text-sm truncate text-white">{item.name}</p>
                <p className="text-xs text-white/50 truncate">{item.artist}</p>
            </div>
        </div>
    );
}

// Section component - shows all items (no carousel limit for History)
function HistorySection({
    section,
    onItemClick
}: {
    section: Section;
    onItemClick: (item: HistoryItem) => void;
}) {
    const MOBILE_LIMIT = 10;
    const mobileItems = section.items.slice(0, MOBILE_LIMIT);

    return (
        <section>
            {/* Section Header */}
            <h2 className="text-purple-200 text-lg md:text-xl font-medium mb-4">
                {section.title}
            </h2>

            {/* Desktop Grid - 6 columns, all items */}
            <div className="hidden md:grid grid-cols-6 gap-4">
                {section.items.map((item) => (
                    <DesktopHistoryTile
                        key={item.id}
                        item={item}
                        onItemClick={onItemClick}
                    />
                ))}
            </div>

            {/* Mobile Stacked List - limited to 10 */}
            <div className="md:hidden space-y-2 max-h-[520px] overflow-y-auto pr-2">
                {mobileItems.map((item) => (
                    <MobileHistoryTile
                        key={item.id}
                        item={item}
                        onItemClick={onItemClick}
                    />
                ))}
            </div>
        </section>
    );
}

export default function HistoryPage() {
    const { history, isLoading, isError } = useRecentHistory(200);
    const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

    const groupedHistory = useMemo<Section[]>(() => {
        if (!history) return [];

        const sections: Section[] = [
            { title: "Today", items: [] },
            { title: "Yesterday", items: [] },
            { title: "Earlier this Month", items: [] },
            { title: "Older", items: [] }
        ];

        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);

        history.forEach((item: HistoryItem) => {
            const playedAt = new Date(item.playedAt);

            if (isSameDay(playedAt, now)) {
                sections[0].items.push(item);
            } else if (isSameDay(playedAt, yesterday)) {
                sections[1].items.push(item);
            } else if (playedAt.getMonth() === now.getMonth() && playedAt.getFullYear() === now.getFullYear()) {
                sections[2].items.push(item);
            } else {
                sections[3].items.push(item);
            }
        });

        return sections.filter(s => s.items.length > 0);
    }, [history]);

    return (
        <AppLayout>
            <div className="min-h-screen">
                <div className="w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-8 md:py-16">
                    {/* Page Title - Standardized */}
                    <PageTitle
                        title="History"
                        subtitle="Your Listening Journey"
                        description="Review what you've been listening to recently."
                    />

                    {/* Loading State */}
                    {isLoading && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            {Array.from({ length: 12 }).map((_, i) => (
                                <div key={i} className="backdrop-blur-md bg-white/5 border border-white/10 rounded-lg p-2.5 animate-pulse">
                                    <div className="aspect-square rounded-md bg-white/10 mb-2" />
                                    <div className="h-3 bg-white/10 rounded mb-1" />
                                    <div className="h-2 bg-white/5 rounded w-2/3" />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Error State */}
                    {isError && (
                        <div className="backdrop-blur-md bg-red-500/10 border border-red-400/30 rounded-xl p-6 text-center">
                            <p className="text-red-300">Failed to load history. Please try again later.</p>
                        </div>
                    )}

                    {/* Empty State */}
                    {!isLoading && !isError && groupedHistory.length === 0 && (
                        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-12 text-center">
                            <p className="text-white/60">No listening history found.</p>
                        </div>
                    )}

                    {/* History Sections */}
                    {!isLoading && groupedHistory.length > 0 && (
                        <div className="space-y-10">
                            {groupedHistory.map((section) => (
                                <HistorySection
                                    key={section.title}
                                    section={section}
                                    onItemClick={setSelectedItem}
                                />
                            ))}
                        </div>
                    )}
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

