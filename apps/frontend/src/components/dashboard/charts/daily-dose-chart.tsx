'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

const fetcher = (url: string) => api.get(url).then((res) => res.data);

export function DailyDoseChart() {
    const { data, isLoading } = useSWR('/me/stats/activity', fetcher);

    const chartData = useMemo(() => {
        if (!data || !data.hourly) return [];
        // Transform userHourStats to 24-hour clock format
        // Ensure all 24 hours are represented
        const fullDay = Array.from({ length: 24 }, (_, i) => {
            const hourStat = data.hourly.find((h: { hour: number; playCount: number }) => h.hour === i);
            return {
                hour: i,
                label: i === 0 ? '12 AM' : i === 12 ? '12 PM' : i > 12 ? `${i - 12} PM` : `${i} AM`,
                count: hourStat ? hourStat.playCount : 0
            };
        });
        return fullDay;
    }, [data]);

    if (isLoading) return <div className="h-[350px] w-full animate-pulse bg-muted/20 rounded-xl" />;

    return (
        <Card disableHover className="col-span-1 shadow-lg border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="bg-gradient-to-r from-teal-400 to-emerald-500 bg-clip-text text-transparent">
                    Daily Dose
                </CardTitle>
                <CardDescription className="text-zinc-400">
                    Your 24-hour listening rhythm.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
                            <PolarGrid stroke="#27272a" />
                            <PolarAngleAxis
                                dataKey="label"
                                tick={{ fill: '#71717a', fontSize: 10 }}
                            />
                            <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                            <Radar
                                name="Plays"
                                dataKey="count"
                                stroke="#10b981"
                                strokeWidth={2}
                                fill="#10b981"
                                fillOpacity={0.3}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#fff' }}
                                itemStyle={{ color: '#fff' }}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
