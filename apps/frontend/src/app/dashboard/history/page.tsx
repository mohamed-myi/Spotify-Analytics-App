"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Card } from "@/components/ui/card";
import { useRecentHistory } from "@/hooks/use-dashboard";
import { useState, useMemo } from "react";
import { ItemModal } from "@/components/dashboard/item-modal";
import Image from "next/image";

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
            <div className="min-h-screen bg-background container mx-auto px-6 pt-8 pb-20 space-y-12">
                <h1 className="text-4xl font-bold tracking-tight text-primary mb-8">History</h1>
                {isLoading && <p className="text-white">Loading history...</p>}
                {isError && <p className="text-red-400">Failed to load history. Please try again later.</p>}
                {!isLoading && !isError && groupedHistory.length === 0 && <p className="text-white">No history found.</p>}
                {!isLoading && groupedHistory.length > 0 && (
                    <div className="space-y-8">
                        {groupedHistory.map((section) => (
                            <section key={section.title} className="space-y-4">
                                <h2 className="text-2xl font-semibold text-primary">{section.title}</h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {section.items.map((item) => (
                                        <div
                                            key={item.id}
                                            className="space-y-3 group cursor-pointer"
                                            onClick={() => setSelectedItem(item)}
                                        >
                                            <Card variant="square" className="border border-white/5 group-hover:border-primary/50 transition-colors">
                                                {item.image ? (
                                                    <Image src={item.image} alt={item.name} fill className="object-cover" unoptimized />
                                                ) : (
                                                    <div className="w-full h-full bg-gray-800" />
                                                )}
                                            </Card>
                                            <div>
                                                <p className="font-medium text-white truncate group-hover:text-primary transition-colors">{item.name}</p>
                                                <p className="text-sm text-gray-400 truncate">{item.artist}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            <ItemModal
                isOpen={!!selectedItem}
                onClose={() => setSelectedItem(null)}
                item={selectedItem}
            />
        </AppLayout >
    );
}
