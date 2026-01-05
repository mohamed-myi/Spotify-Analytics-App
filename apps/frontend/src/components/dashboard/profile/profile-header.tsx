"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Calendar, MapPin } from "lucide-react";

interface ProfileHeaderProps {
    displayName: string;
    spotifyId: string;
    imageUrl: string | null;
    country: string | null;
    memberSince: string;
}

export function ProfileHeader({ displayName, spotifyId, imageUrl, country, memberSince }: ProfileHeaderProps) {
    const formattedDate = new Date(memberSince).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 overflow-hidden"
        >
            <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* Avatar */}
                <div className="relative">
                    {/* Glow effect */}
                    <div className="absolute -inset-1 bg-gradient-to-br from-mint-500 to-mint-700 rounded-full opacity-30 blur-lg" />

                    {/* Avatar container */}
                    <div className="relative w-28 h-28 rounded-full border-4 border-mint-500 overflow-hidden bg-white/5 shadow-xl shadow-mint-500/20">
                        {imageUrl ? (
                            <Image
                                src={imageUrl}
                                alt={displayName}
                                fill
                                className="object-cover"
                                unoptimized
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-mint-400 bg-white/5">
                                {displayName?.charAt(0) || "?"}
                            </div>
                        )}
                    </div>

                    {/* Online indicator */}
                    <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-green-500 rounded-full border-4 border-black flex items-center justify-center shadow-lg">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                </div>

                {/* User Info */}
                <div className="flex-1 text-center sm:text-left">
                    <h1 className="text-3xl font-bold text-white">
                        {displayName}
                    </h1>
                    <p className="text-white/50 mt-1">@{spotifyId}</p>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-4">
                        <div className="flex items-center gap-1.5 text-sm text-white/40">
                            <Calendar className="w-4 h-4" />
                            <span>Member since {formattedDate}</span>
                        </div>
                        {country && (
                            <div className="flex items-center gap-1.5 text-sm text-white/40">
                                <MapPin className="w-4 h-4" />
                                <span>{country}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
