"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Play } from "lucide-react";
import { useEffect } from "react";
import Image from "next/image";

interface ModalItem {
    id: string;
    name: string;
    image?: string;
    artist?: string;
    spotifyId?: string;
    artistSpotifyId?: string;
}

interface ItemModalProps {
    isOpen: boolean;
    onClose: () => void;
    item: ModalItem | null;
}

export function ItemModal({ isOpen, onClose, item }: ItemModalProps) {
    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isOpen]);

    if (!item) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm"
                    />

                    {/* Modal Content */}
                    <motion.div
                        layoutId={`card-${item.id}`}
                        initial={{ opacity: 0, scale: 0.9, y: 50 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 50 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-[70] m-auto h-fit max-h-[90vh] w-[90vw] max-w-4xl overflow-hidden rounded-xl bg-[#181818] shadow-2xl md:top-10"
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute right-4 top-4 z-20 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
                        >
                            <X className="h-6 w-6" />
                        </button>

                        {/* Hero Image Area */}
                        <div className="relative aspect-video w-full">
                            <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent z-10" />
                            <Image
                                src={item.image || '/placeholder.png'}
                                alt={item.name}
                                fill
                                className="object-cover"
                                unoptimized
                            />

                            <div className="absolute bottom-8 left-8 z-20 space-y-4">
                                <h2 className="text-4xl md:text-5xl font-bold text-white drop-shadow-md">{item.name}</h2>
                                {item.artist && (
                                    <p className="text-2xl text-gray-200 font-medium drop-shadow-md">{item.artist}</p>
                                )}
                            </div>
                        </div>

                        {/* Details Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-8 p-8 text-sm text-gray-300">
                            {/* Left Column: Stats & Desc */}
                            <div className="space-y-6">
                                <div className="flex flex-col sm:flex-row gap-4">
                                    {!(!item.artist) && item.spotifyId && (
                                        <button
                                            onClick={() => window.open(`https://open.spotify.com/track/${item.spotifyId}`, '_blank')}
                                            className="px-6 py-3 rounded-md font-bold text-white bg-black border border-purple-500 hover:bg-purple-900/20 transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Play className="w-4 h-4 fill-current" />
                                            View Song in Spotify
                                        </button>
                                    )}

                                    {(item.artistSpotifyId || (!item.artist && item.spotifyId)) && (
                                        <button
                                            onClick={() => window.open(`https://open.spotify.com/artist/${!item.artist ? item.spotifyId : item.artistSpotifyId}`, '_blank')}
                                            className="px-6 py-3 rounded-md font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors flex items-center justify-center gap-2"
                                        >
                                            View Artist in Spotify
                                        </button>
                                    )}
                                </div>

                                <div className="border-t border-white/10 pt-4">
                                    <h3 className="text-white font-bold mb-2">Your Stats</h3>
                                    <ul className="grid grid-cols-2 gap-y-2">
                                        <li><span className="text-gray-500">Play Count:</span> <span className="text-white">1,245</span></li>
                                        <li><span className="text-gray-500">Total Hours:</span> <span className="text-white">84.5 hrs</span></li>
                                        <li><span className="text-gray-500">First Played:</span> <span className="text-white">Oct 12, 2021</span></li>
                                        <li><span className="text-gray-500">Global Rank:</span> <span className="text-primary font-bold">#4</span></li>
                                    </ul>
                                </div>
                            </div>

                            {/* Right Column: Metadata */}
                            <div className="space-y-2 text-xs">
                                <div>
                                    <span className="text-gray-500">Genres:</span>
                                    <span className="text-white block">Synthwave, Pop, R&B</span>
                                </div>
                                <div>
                                    <span className="text-gray-500">Vibe:</span>
                                    <span className="text-white block">Nostalgic, Energetic</span>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
