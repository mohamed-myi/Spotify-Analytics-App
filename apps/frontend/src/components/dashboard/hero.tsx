"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Play, Info, Music, User } from "lucide-react";
import { useBackgroundMode } from "@/contexts/background-mode-context";

interface HeroProps {
    title: string;
    subtitle: string;
    description: string;
    image: string;  // Kept for compatibility, but background now handled by AppLayout
    songOfTheDayName?: string;
    songOfTheDayArtist?: string;
    songOfTheDayContext?: string;
    topArtistName?: string;
}

export function Hero({ title, subtitle, description, songOfTheDayName, songOfTheDayArtist, songOfTheDayContext, topArtistName }: HeroProps) {
    const { mode } = useBackgroundMode();

    // Dynamic content based on mode
    const dynamicTitle = mode === "song-of-the-day" && songOfTheDayName
        ? songOfTheDayName
        : mode === "top-artist" && topArtistName
            ? topArtistName
            : title;

    const dynamicSubtitle = mode === "song-of-the-day"
        ? (songOfTheDayContext || "Song of the Day")
        : mode === "top-artist"
            ? "Your Top Artist"
            : subtitle;

    const dynamicDescription = mode === "song-of-the-day" && songOfTheDayArtist
        ? `by ${songOfTheDayArtist}`
        : mode === "top-artist"
            ? "Your most listened artist this year"
            : description;

    const ModeIcon = mode === "song-of-the-day" ? Music : User;

    return (
        <div className="relative min-h-[70vh] md:min-h-[80vh] w-full flex items-center justify-center mb-12">
            {/* Content - no background needed, AppLayout provides persistent background */}
            <div className="relative z-10 w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-16 md:py-24 flex justify-center">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="max-w-2xl space-y-6 text-center items-center flex flex-col"
                >
                    {/* Badge - Glassmorphic with mode icon */}
                    <div className="inline-block">
                        <AnimatePresence mode="wait">
                            <motion.span
                                key={mode}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="px-4 py-1.5 rounded-lg bg-neutral-900 border border-mint-500 text-white text-sm font-medium inline-flex items-center gap-2"
                            >
                                <ModeIcon className="w-3.5 h-3.5" />
                                {dynamicSubtitle}
                            </motion.span>
                        </AnimatePresence>
                    </div>

                    {/* Title - Responsive sizing with animation */}
                    <AnimatePresence mode="wait">
                        <motion.h1
                            key={`${mode}-${dynamicTitle}`}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight text-white font-bold"
                        >
                            {dynamicTitle}
                        </motion.h1>
                    </AnimatePresence>

                    {/* Description with animation */}
                    <AnimatePresence mode="wait">
                        <motion.p
                            key={`${mode}-desc`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="text-white/60 text-base md:text-lg"
                        >
                            {dynamicDescription}
                        </motion.p>
                    </AnimatePresence>

                    {/* Buttons - Responsive layout */}
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-4">
                        <button className="px-6 py-3 rounded-full bg-white text-black hover:scale-105 transition-transform flex items-center justify-center gap-2 shadow-xl font-medium">
                            <Play className="w-4 h-4 fill-black" />
                            {mode === "song-of-the-day" ? "Play Song" : "Play Artist"}
                        </button>
                        <button className="px-6 py-3 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 transition-all flex items-center justify-center gap-2 font-medium">
                            <Info className="w-4 h-4" />
                            {mode === "song-of-the-day" ? "Track Info" : "Artist Info"}
                        </button>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
