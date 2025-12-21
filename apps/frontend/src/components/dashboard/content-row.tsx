"use client";

import { Card } from "@/components/ui/card";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import Image from "next/image";

interface ContentItem {
    id: string;
    name: string;
    image?: string;
    artist?: string;
    spotifyId?: string;
    artistSpotifyId?: string;
}

interface ContentRowProps {
    title: string;
    items: ContentItem[];
    type: "track" | "artist" | "wide";
    showTimeRange?: boolean;
    selectedRange?: string;
    showRank?: boolean;
    onRangeChange?: (range: string) => void;
    onItemClick?: (item: ContentItem) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    hasImportedHistory?: boolean;
}

export function ContentRow({ title, items, type, showTimeRange = false, selectedRange = "year", showRank = false, onRangeChange, onItemClick, onRefresh, isRefreshing = false, hasImportedHistory = false }: ContentRowProps) {
    const scrollContainer = useRef<HTMLDivElement>(null);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const baseRanges = [
        { label: "Last 4 Weeks", value: "4weeks" },
        { label: "Last 6 Months", value: "6months" },
        { label: "Last 1 Year", value: "year" }
    ];
    const ranges = hasImportedHistory
        ? [...baseRanges, { label: "All Time", value: "alltime" }]
        : baseRanges;

    const currentLabel = ranges.find(r => r.value === selectedRange)?.label || "Last 1 Year";

    const scroll = (direction: "left" | "right") => {
        if (scrollContainer.current) {
            const scrollAmount = direction === "left" ? -800 : 800;
            scrollContainer.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
        }
    };

    return (
        <div className="mb-12 space-y-4 group">
            <div className="px-8 md:px-16 flex items-end justify-between">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-semibold text-primary cursor-pointer">
                        {title}
                    </h2>

                    {showTimeRange && (
                        <div className="relative">
                            <button
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                            >
                                {currentLabel}
                                <ChevronRight className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-90' : ''}`} />
                            </button>

                            {isDropdownOpen && (
                                <div className="absolute top-full left-0 mt-2 w-40 bg-[#1a1a1a] border border-white/10 rounded-md shadow-xl z-50 overflow-hidden">
                                    {ranges.map((range) => (
                                        <button
                                            key={range.value}
                                            onClick={() => {
                                                onRangeChange?.(range.value);
                                                setIsDropdownOpen(false);
                                            }}
                                            className={`w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${selectedRange === range.value ? 'text-primary' : 'text-gray-300'}`}
                                        >
                                            {range.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            disabled={isRefreshing}
                            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
                            title="Refresh data"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                </div>
                <div className="hidden group-hover:flex gap-2">
                    <button onClick={() => scroll("left")} className="p-1 rounded-full bg-black/50 border border-white/10 hover:border-white/50 transition">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button onClick={() => scroll("right")} className="p-1 rounded-full bg-black/50 border border-white/10 hover:border-white/50 transition">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div
                ref={scrollContainer}
                className="flex gap-4 overflow-x-auto px-8 md:px-16 pb-8 scrollbar-hide snap-x"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {items.map((item, i) => (
                    <div key={item.id} className="flex-none snap-start cursor-pointer relative" onClick={() => onItemClick?.(item)}>
                        {type === "artist" && (
                            <div className="w-[180px] space-y-2 relative">
                                <Card variant="circle" className="border-4 border-transparent hover:border-primary/50 relative">
                                    <Image src={item.image || '/placeholder.png'} alt={item.name} fill className="object-cover bg-gray-800" unoptimized />
                                </Card>
                                <div className="text-center">
                                    <p className="font-medium text-gray-200 truncate">{item.name}</p>
                                    {showRank && (
                                        <p className="text-sm font-bold text-primary mt-1">#{i + 1}</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {type === "track" && (
                            <div className="w-[200px] space-y-2 relative">
                                <Card variant="square">
                                    <Image src={item.image || '/placeholder.png'} alt={item.name} fill className="object-cover bg-gray-800" unoptimized />
                                </Card>
                                <div className="flex gap-3 items-start mt-2">
                                    {showRank && (
                                        <span className="text-lg font-bold text-white/40 leading-tight">
                                            {i + 1}
                                        </span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium text-gray-200 truncate">{item.name}</p>
                                        <p className="text-sm text-gray-400 truncate">{item.artist}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {type === "wide" && (
                            <div className="w-[200px] space-y-2 relative">
                                <Card variant="square" className="relative group/card">
                                    <Image src={item.image || '/placeholder.png'} alt={item.name} fill className="object-cover opacity-80 group-hover/card:opacity-100 transition bg-gray-800" unoptimized />

                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition bg-black/40">
                                        <div className="rounded-full bg-white p-3 shadow-xl">
                                            <ChevronRight className="w-6 h-6 text-black fill-current" />
                                        </div>
                                    </div>
                                </Card>
                                <div className="flex gap-3 items-start mt-2">
                                    {showRank && (
                                        <span className="text-lg font-bold text-white/40 leading-tight">
                                            {i + 1}
                                        </span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium text-gray-200 truncate">{item.name}</p>
                                        {item.artist && <p className="text-sm text-gray-400 truncate">{item.artist}</p>}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
