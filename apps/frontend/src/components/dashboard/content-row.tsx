"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, ChevronLeft, RefreshCw } from "lucide-react";
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

// Desktop tile component - unified size with History
function DesktopTile({
    item,
    index,
    type,
    showRank,
    onItemClick
}: {
    item: ContentItem;
    index: number;
    type: "track" | "artist" | "wide";
    showRank: boolean;
    onItemClick?: (item: ContentItem) => void;
}) {
    return (
        <div
            className="group cursor-pointer"
            onClick={() => onItemClick?.(item)}
        >
            {/* Glassmorphic Card - Medium padding for unified sizing */}
            <div className="backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-3.5 transition-all duration-300 hover:scale-105 shadow-xl">
                {/* Image Container */}
                <div className="relative mb-3">
                    {type === "artist" ? (
                        // Circular for artists on desktop
                        <div className="aspect-square rounded-full overflow-hidden bg-white/5 border-2 border-white/10">
                            <div className="relative w-full h-full">
                                <Image
                                    src={item.image || '/placeholder.png'}
                                    alt={item.name}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                />
                            </div>
                        </div>
                    ) : (
                        // Square for tracks
                        <div className="aspect-square rounded-md overflow-hidden bg-white/5">
                            <div className="relative w-full h-full">
                                <Image
                                    src={item.image || '/placeholder.png'}
                                    alt={item.name}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                />
                            </div>
                        </div>
                    )}

                    {/* TOP Badge for #1 Artist */}
                    {type === "artist" && index === 0 && (
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                            <span className="px-2 py-0.5 rounded backdrop-blur-md bg-green-500/30 border border-green-400/40 text-[10px] text-green-200 font-medium">
                                TOP
                            </span>
                        </div>
                    )}

                    {/* Explicit Badge for tracks (simulated) */}
                    {type !== "artist" && index % 3 === 0 && (
                        <div className="absolute top-2 right-2">
                            <span className="px-1.5 py-0.5 rounded backdrop-blur-md bg-black/60 border border-white/20 text-[10px] font-medium">
                                E
                            </span>
                        </div>
                    )}
                </div>

                {/* Text Content */}
                <div>
                    <p className="text-sm truncate mb-1 text-white">{item.name}</p>
                    {type === "artist" ? (
                        showRank && <p className="text-xs text-purple-400">Rank #{index + 1}</p>
                    ) : (
                        // For tracks: show artist and optionally rank
                        <div className="flex items-center gap-2">
                            {showRank && <span className="text-xs text-purple-400">#{index + 1}</span>}
                            <p className="text-xs text-white/50 truncate">{item.artist || "Unknown"}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Mobile stacked tile component - horizontal layout with square images
function MobileTile({
    item,
    index,
    showRank,
    onItemClick
}: {
    item: ContentItem;
    index: number;
    showRank: boolean;
    onItemClick?: (item: ContentItem) => void;
}) {
    return (
        <div
            className="flex items-center gap-3 backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-3 cursor-pointer transition-all"
            onClick={() => onItemClick?.(item)}
        >
            {/* Rank Number */}
            {showRank && (
                <span className="text-xs text-purple-400 w-5 text-center font-medium">
                    {index + 1}
                </span>
            )}

            {/* Square Image */}
            <div className="w-12 h-12 rounded-md overflow-hidden bg-white/5 flex-shrink-0 relative">
                <Image
                    src={item.image || '/placeholder.png'}
                    alt={item.name}
                    fill
                    className="object-cover"
                    unoptimized
                />
            </div>

            {/* Text Content */}
            <div className="flex-1 min-w-0">
                <p className="text-sm truncate text-white">{item.name}</p>
                {item.artist && (
                    <p className="text-xs text-white/50 truncate">{item.artist}</p>
                )}
            </div>
        </div>
    );
}

export function ContentRow({
    title,
    items,
    type,
    showTimeRange = false,
    selectedRange = "year",
    showRank = false,
    onRangeChange,
    onItemClick,
    onRefresh,
    isRefreshing = false,
    hasImportedHistory = false
}: ContentRowProps) {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [carouselPage, setCarouselPage] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Desktop: 2 rows 
    const ITEMS_PER_PAGE = 12;
    // Mobile: limit to 10 items
    const MOBILE_LIMIT = 10;

    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const canGoNext = carouselPage < totalPages - 1;
    const canGoPrev = carouselPage > 0;

    // Get items for current desktop page
    const desktopItems = items.slice(
        carouselPage * ITEMS_PER_PAGE,
        (carouselPage + 1) * ITEMS_PER_PAGE
    );

    // Mobile items limited to 10
    const mobileItems = items.slice(0, MOBILE_LIMIT);

    const handleNext = () => {
        if (canGoNext) {
            setCarouselPage(prev => prev + 1);
        }
    };

    const handlePrev = () => {
        if (canGoPrev) {
            setCarouselPage(prev => prev - 1);
        }
    };

    const baseRanges = [
        { label: "Last 4 Weeks", value: "4weeks" },
        { label: "Last 6 Months", value: "6months" },
        { label: "Last 1 Year", value: "year" }
    ];
    const ranges = hasImportedHistory
        ? [...baseRanges, { label: "All Time", value: "alltime" }]
        : baseRanges;

    const currentLabel = ranges.find(r => r.value === selectedRange)?.label || "Last 1 Year";

    return (
        <div className="w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    {/* Section Title - Purple accent */}
                    <h2 className="text-purple-300 text-lg md:text-xl font-medium">
                        {title}
                    </h2>

                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            disabled={isRefreshing}
                            className="p-1.5 rounded-full text-white/40 hover:text-white/70 disabled:opacity-50 transition-colors"
                            title="Refresh data"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {/* Time Range Selector */}
                    {showTimeRange && (
                        <div className="relative">
                            <button
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="text-white/60 hover:text-white text-sm transition-colors flex items-center gap-1"
                            >
                                {currentLabel}
                                <ChevronRight className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-90' : ''}`} />
                            </button>

                            {isDropdownOpen && (
                                <>
                                    {/* Backdrop to close dropdown */}
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setIsDropdownOpen(false)}
                                    />
                                    {/* Dropdown - Glassmorphic */}
                                    <div className="absolute top-full right-0 mt-2 w-40 backdrop-blur-xl bg-white/10 border border-white/20 rounded-lg shadow-xl z-50 overflow-hidden">
                                        {ranges.map((range) => (
                                            <button
                                                key={range.value}
                                                onClick={() => {
                                                    onRangeChange?.(range.value);
                                                    setIsDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors ${selectedRange === range.value ? 'text-purple-300' : 'text-white/70'
                                                    }`}
                                            >
                                                {range.label}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Desktop Carousel Navigation Arrows */}
                    <div className="hidden md:flex items-center gap-1">
                        <button
                            onClick={handlePrev}
                            disabled={!canGoPrev}
                            className="w-8 h-8 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            aria-label="Previous"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleNext}
                            disabled={!canGoNext}
                            className="w-8 h-8 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            aria-label="Next"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Desktop Grid Layout - 2 rows with smooth transition */}
            <div className="hidden md:block overflow-hidden">
                <div
                    className="grid grid-cols-6 gap-4 transition-all duration-500 ease-in-out"
                    style={{
                        // Smooth fade effect for page transitions
                        opacity: 1,
                    }}
                >
                    {desktopItems.map((item, i) => (
                        <DesktopTile
                            key={item.id}
                            item={item}
                            index={carouselPage * ITEMS_PER_PAGE + i}
                            type={type}
                            showRank={showRank}
                            onItemClick={onItemClick}
                        />
                    ))}
                </div>
            </div>

            {/* Mobile Stacked List - 10 items with vertical scroll */}
            <div
                ref={scrollContainerRef}
                className="md:hidden space-y-2 max-h-[520px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10"
            >
                {mobileItems.map((item, i) => (
                    <MobileTile
                        key={item.id}
                        item={item}
                        index={i}
                        showRank={showRank}
                        onItemClick={onItemClick}
                    />
                ))}
            </div>
        </div>
    );
}
