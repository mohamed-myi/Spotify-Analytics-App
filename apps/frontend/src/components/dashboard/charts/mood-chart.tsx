'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

const fetcher = (url: string) => api.get(url).then((res) => res.data);

export function MoodChart() {
    const { data, isLoading } = useSWR('/me/stats/mood', fetcher);

    const chartData = useMemo(() => {
        if (!data) return [];
        return data.map((d: any) => ({
            date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            valence: Math.round(d.valence * 100), // Scale to 0-100
            energy: Math.round(d.energy * 100),
        }));
    }, [data]);

    if (isLoading) return <div className="h-[350px] w-full animate-pulse bg-muted/20 rounded-xl" />;

    return (
        <Card className="col-span-full lg:col-span-2 shadow-lg border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl font-bold bg-gradient-to-r from-yellow-400 to-purple-500 bg-clip-text text-transparent">
                            Mood Model
                        </CardTitle>
                        <CardDescription className="text-zinc-400">
                            Your music's emotional timeline over the last 30 days.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorValence" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis
                                dataKey="date"
                                stroke="#52525b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={30}
                            />
                            <YAxis
                                stroke="#52525b"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#fff' }}
                                itemStyle={{ color: '#fff' }}
                            />
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <Area
                                type="monotone"
                                dataKey="valence"
                                name="Happiness"
                                stroke="#eab308"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorValence)"
                            />
                            <Area
                                type="monotone"
                                dataKey="energy"
                                name="Energy"
                                stroke="#8b5cf6"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorEnergy)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
