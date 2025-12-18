"use client";

import { motion } from "framer-motion";
import { Music, Clock, Disc3, Users } from "lucide-react";
import { Card } from "@/components/ui/card";

interface ListeningStatsProps {
    totalPlays: number;
    formattedTime: string | null;
    uniqueTracks: number;
    uniqueArtists: number;
}

interface StatCardProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    delay: number;
}

function StatCard({ icon, label, value, delay }: StatCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay }}
        >
            <Card disableHover className="p-6 bg-zinc-900/50 border-zinc-800 hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 text-primary">
                        {icon}
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-white">
                            {typeof value === "number" ? value.toLocaleString() : value}
                        </p>
                        <p className="text-sm text-zinc-400">{label}</p>
                    </div>
                </div>
            </Card>
        </motion.div>
    );
}

export function ListeningStats({ totalPlays, formattedTime, uniqueTracks, uniqueArtists }: ListeningStatsProps) {
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Listening Stats</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={<Music className="w-6 h-6" />}
                    label="Total Plays"
                    value={totalPlays}
                    delay={0}
                />
                <StatCard
                    icon={<Clock className="w-6 h-6" />}
                    label="Listening Time"
                    value={formattedTime || "0m"}
                    delay={0.1}
                />
                <StatCard
                    icon={<Disc3 className="w-6 h-6" />}
                    label="Unique Tracks"
                    value={uniqueTracks}
                    delay={0.2}
                />
                <StatCard
                    icon={<Users className="w-6 h-6" />}
                    label="Unique Artists"
                    value={uniqueArtists}
                    delay={0.3}
                />
            </div>
        </div>
    );
}
