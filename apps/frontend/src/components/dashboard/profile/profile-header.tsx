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
            className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-gradient-to-r from-zinc-900/80 to-zinc-800/50 rounded-2xl border border-white/5"
        >
            {/* Avatar */}
            <div className="relative">
                <div className="w-28 h-28 rounded-full border-4 border-primary overflow-hidden bg-zinc-800">
                    {imageUrl ? (
                        <Image
                            src={imageUrl}
                            alt={displayName}
                            fill
                            className="object-cover"
                            unoptimized
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-primary">
                            {displayName?.charAt(0) || "?"}
                        </div>
                    )}
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-green-500 rounded-full border-4 border-zinc-900 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
            </div>

            {/* User Info */}
            <div className="flex-1 text-center sm:text-left">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                    {displayName}
                </h1>
                <p className="text-zinc-400 mt-1">@{spotifyId}</p>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-4 text-sm text-zinc-400">
                    <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        <span>Member since {formattedDate}</span>
                    </div>
                    {country && (
                        <div className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4" />
                            <span>{country}</span>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
