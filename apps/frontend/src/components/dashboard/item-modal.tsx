"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Play, ExternalLink } from "lucide-react";
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
                    {/* Backdrop - Glassmorphic */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md"
                    />

                    {/* Modal Content - Glassmorphic */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                    >
                        <div
                            className="w-full max-w-lg backdrop-blur-2xl bg-gradient-to-b from-white/10 to-white/5 border border-white/20 rounded-2xl overflow-hidden shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header Image Section */}
                            <div className="relative aspect-square">
                                <Image
                                    src={item.image || '/placeholder.png'}
                                    alt={item.name}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                />
                                {/* Gradient Overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                                {/* Close Button */}
                                <button
                                    onClick={onClose}
                                    className="absolute top-4 right-4 w-10 h-10 rounded-full backdrop-blur-xl bg-black/40 hover:bg-black/60 border border-white/20 flex items-center justify-center transition-all"
                                >
                                    <X className="w-5 h-5" />
                                </button>

                                {/* Title and Artist on Image */}
                                <div className="absolute bottom-6 left-6 right-6">
                                    <h3 className="text-3xl font-bold text-white mb-2">{item.name}</h3>
                                    {item.artist && (
                                        <p className="text-white/80 text-lg">{item.artist}</p>
                                    )}
                                </div>
                            </div>

                            {/* Content Section */}
                            <div className="p-6">
                                {/* Action Buttons */}
                                <div className="flex gap-3">
                                    {item.artist && item.spotifyId && (
                                        <button
                                            onClick={() => window.open(`https://open.spotify.com/track/${item.spotifyId}`, '_blank')}
                                            className="flex-1 px-4 py-3 rounded-xl backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 transition-all flex items-center justify-center gap-2 text-sm font-medium"
                                        >
                                            <Play className="w-4 h-4" />
                                            View Song
                                        </button>
                                    )}
                                    {(item.artistSpotifyId || (!item.artist && item.spotifyId)) && (
                                        <button
                                            onClick={() => window.open(`https://open.spotify.com/artist/${!item.artist ? item.spotifyId : item.artistSpotifyId}`, '_blank')}
                                            className="flex-1 px-4 py-3 rounded-xl bg-mint-600 hover:bg-mint-700 transition-all flex items-center justify-center gap-2 text-sm font-medium"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                            View Artist
                                        </button>
                                    )}
                                </div>

                                {/* Stats Section */}
                                <div className="mt-6 pt-6 border-t border-white/10">
                                    <h4 className="text-white font-semibold mb-4">Your Stats</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="backdrop-blur-md bg-white/5 rounded-lg p-3 border border-white/10">
                                            <p className="text-white/50 text-xs mb-1">Play Count</p>
                                            <p className="text-white font-semibold">Coming soon</p>
                                        </div>
                                        <div className="backdrop-blur-md bg-white/5 rounded-lg p-3 border border-white/10">
                                            <p className="text-white/50 text-xs mb-1">Total Hours</p>
                                            <p className="text-white font-semibold">Coming soon</p>
                                        </div>
                                        <div className="backdrop-blur-md bg-white/5 rounded-lg p-3 border border-white/10">
                                            <p className="text-white/50 text-xs mb-1">First Played</p>
                                            <p className="text-white font-semibold">Coming soon</p>
                                        </div>
                                        <div className="backdrop-blur-md bg-white/5 rounded-lg p-3 border border-white/10">
                                            <p className="text-white/50 text-xs mb-1">Your Rank</p>
                                            <p className="text-mint-400 font-semibold">Coming soon</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
