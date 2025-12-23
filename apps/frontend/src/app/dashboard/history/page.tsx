"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { useInfiniteHistory, MappedHistoryItem } from "@/hooks/use-dashboard";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ItemModal } from "@/components/dashboard/item-modal";
import Image from "next/image";
import { PageTitle } from "@/components/dashboard/page-title";
import { Loader2 } from "lucide-react";

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
    key: string;
    items: HistoryItem[];
}


const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
};

// Get the section key and title for a given date
function getDateSection(playedAt: Date, now: Date): { key: string; title: string } {
    const msPerDay = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor((now.getTime() - playedAt.getTime()) / msPerDay);

    if (isSameDay(playedAt, now)) {
        return { key: "today", title: "Today" };
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (isSameDay(playedAt, yesterday)) {
        return { key: "yesterday", title: "Yesterday" };
    }

    if (diffDays >= 2 && diffDays <= 7) {
        return { key: "last-week", title: "Last Week" };
    }

    if (diffDays >= 8 && diffDays <= 14) {
        return { key: "2-weeks-ago", title: "2 Weeks Ago" };
    }

    if (diffDays >= 15 && diffDays <= 21) {
        return { key: "3-weeks-ago", title: "3 Weeks Ago" };
    }

    if (diffDays >= 22 && diffDays <= 30) {
        return { key: "month-ago", title: "A Month Ago" };
    }

    // For older dates, calculate months ago
    const monthsAgo = Math.floor(diffDays / 30);
    if (monthsAgo <= 1) {
        return { key: "month-ago", title: "A Month Ago" };
    }

    return { key: `${monthsAgo}-months-ago`, title: `${monthsAgo} Months Ago` };
}

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
            <div className="backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-3.5 transition-all duration-300 hover:scale-105 shadow-xl">
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
                    {item.name.length % 4 === 0 && (
                        <div className="absolute top-2 right-2">
                            <span className="px-1.5 py-0.5 rounded backdrop-blur-md bg-black/60 border border-white/20 text-[10px] font-medium">
                                E
                            </span>
                        </div>
                    )}
                </div>

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

// Mobile stacked tile component
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

            <div className="flex-1 min-w-0">
                <p className="text-sm truncate text-white">{item.name}</p>
                <p className="text-xs text-white/50 truncate">{item.artist}</p>
            </div>
        </div>
    );
}

function HistorySection({
    section,
    onItemClick
}: {
    section: Section;
    onItemClick: (item: HistoryItem) => void;
}) {
    return (
        <section>
            <h2 className="text-purple-200 text-lg md:text-xl font-medium mb-4">
                {section.title}
            </h2>

            {/* Desktop Grid - 6 columns */}
            <div className="hidden md:grid grid-cols-6 gap-4">
                {section.items.map((item) => (
                    <DesktopHistoryTile
                        key={item.id}
                        item={item}
                        onItemClick={onItemClick}
                    />
                ))}
            </div>

            {/* Mobile Stacked List - all items */}
            <div className="md:hidden space-y-2">
                {section.items.map((item) => (
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
    const { history, isLoading, isLoadingMore, isError, hasMore, loadMore } = useInfiniteHistory(100);
    const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

    // Ref to trigger loading more
    const sentinelRef = useRef<HTMLDivElement>(null);

    // Observer for infinite scroll
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
                    loadMore();
                }
            },
            {
                // Trigger when 400px from viewport
                rootMargin: "400px",
                threshold: 0
            }
        );

        observer.observe(sentinel);

        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, loadMore]);

    const groupedHistory = useMemo<Section[]>(() => {
        if (!history || history.length === 0) return [];

        const now = new Date();
        const sectionMap = new Map<string, Section>();
        const sectionOrder: string[] = [];

        history.forEach((item: MappedHistoryItem) => {
            const playedAt = new Date(item.playedAt);
            const { key, title } = getDateSection(playedAt, now);

            if (!sectionMap.has(key)) {
                sectionMap.set(key, { key, title, items: [] });
                sectionOrder.push(key);
            }

            sectionMap.get(key)!.items.push(item);
        });

        // Return sections in order they were encountered
        return sectionOrder.map(key => sectionMap.get(key)!);
    }, [history]);

    return (
        <AppLayout>
            <div className="min-h-screen">
                <div className="w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-8 md:py-16">
                    <PageTitle
                        title="History"
                        subtitle="Your Listening Journey"
                        description="Review what you've been listening to recently."
                    />

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

                    {!isLoading && !isError && groupedHistory.length === 0 && (
                        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-12 text-center">
                            <p className="text-white/60">No listening history found.</p>
                        </div>
                    )}

                    {!isLoading && groupedHistory.length > 0 && (
                        <div className="space-y-10">
                            {groupedHistory.map((section) => (
                                <HistorySection
                                    key={section.key}
                                    section={section}
                                    onItemClick={setSelectedItem}
                                />
                            ))}

                            <div ref={sentinelRef} className="h-4" />

                            {isLoadingMore && (
                                <div className="flex justify-center py-8">
                                    <div className="flex items-center gap-3 text-white/60">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span className="text-sm">Loading more...</span>
                                    </div>
                                </div>
                            )}

                            {/* End of history indicator */}
                            {!hasMore && history && history.length > 0 && (
                                <div className="text-center py-8">
                                    <p className="text-white/40 text-sm">You've reached the end of your history</p>
                                </div>
                            )}
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
