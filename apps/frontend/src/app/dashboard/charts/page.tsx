"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { api } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface ActivityStat {
    hour?: number;
    date?: string;
    playCount: number;
}

interface ActivityData {
    hourly: ActivityStat[];
    daily: ActivityStat[];
}

export default function ChartsPage() {
    const [activity, setActivity] = useState<ActivityData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await api.get("/me/stats/activity");
                setActivity(res.data);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    return (
        <AppLayout>
            <div className="min-h-screen bg-background container mx-auto px-6 pt-8 pb-20 space-y-12">
                <h1 className="text-4xl font-bold tracking-tight text-white mb-8">Activity Stats</h1>

                {loading ? (
                    <div className="animate-pulse text-gray-400">Loading charts...</div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Daily Activity */}
                        <div className="bg-[#121212] p-6 rounded-xl border border-white/5 space-y-4">
                            <h2 className="text-xl font-bold text-white">Daily Listening (Last 30 Days)</h2>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={activity?.daily || []}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                        <XAxis
                                            dataKey="date"
                                            tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                            stroke="#888"
                                            fontSize={12}
                                        />
                                        <YAxis stroke="#888" fontSize={12} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#333', border: 'none', color: '#fff' }}
                                            labelFormatter={(val) => new Date(val).toLocaleDateString()}
                                        />
                                        <Bar dataKey="playCount" fill="#A855F7" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Hourly Activity */}
                        <div className="bg-[#121212] p-6 rounded-xl border border-white/5 space-y-4">
                            <h2 className="text-xl font-bold text-white">Hourly Activity (Local Time)</h2>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={activity?.hourly || []}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                        <XAxis dataKey="hour" stroke="#888" fontSize={12} tickFormatter={(val) => `${val}:00`} />
                                        <YAxis stroke="#888" fontSize={12} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#333', border: 'none', color: '#fff' }}
                                            labelFormatter={(val) => `${val}:00 - ${val}:59`}
                                        />
                                        <Bar dataKey="playCount" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
