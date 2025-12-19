'use client';

import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { Clock } from 'lucide-react';
import Image from 'next/image';

const fetcher = (url: string) => api.get(url).then((res) => res.data);

function formatDuration(msStr: string | number) {
    const ms = typeof msStr === 'string' ? parseInt(msStr) : msStr;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

export function OnRepeatList() {
    const { data: tracks, isLoading } = useSWR('/me/stats/top/tracks?sortBy=time', fetcher);

    if (isLoading) return <div className="h-[350px] w-full animate-pulse bg-muted/20 rounded-xl" />;

    return (
        <Card disableHover className="col-span-1 shadow-lg border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
                    <Clock className="w-5 h-5 text-orange-400" />
                    On Repeat (Real Deal)
                </CardTitle>
                <CardDescription className="text-zinc-400">
                    Your favorites tracks by total time listened. Tracking begins upon first login, if you want full history please import your spotify data.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {tracks?.slice(0, 50).map((track: { id: string; name: string; artists: { name: string }[]; album: { name: string; imageUrl: string }; totalMs: string; playCount: number }, i: number) => (
                        <div key={track.id} className="flex items-center gap-3 group">
                            <span className="text-2xl font-bold text-zinc-700 w-8 text-center group-hover:text-orange-500 transition-colors">
                                {i + 1}
                            </span>
                            <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md">
                                {track.album?.imageUrl && (
                                    <Image
                                        src={track.album.imageUrl}
                                        alt={track.album.name}
                                        fill
                                        sizes="48px"
                                        className="object-cover"
                                    />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-zinc-200 truncate group-hover:text-orange-400 transition-colors">
                                    {track.name}
                                </p>
                                <p className="text-sm text-zinc-500 truncate">
                                    {track.artists?.map((a: { name?: string }) => a?.name).filter(Boolean).join(', ') || 'Unknown Artist'}
                                </p>
                            </div>
                            <div className="text-right">
                                <span className="block font-mono text-sm font-bold text-orange-500/90">
                                    {formatDuration(track.totalMs)}
                                </span>
                                <span className="text-xs text-zinc-600">
                                    {track.playCount} plays
                                </span>
                            </div>
                        </div>
                    ))}
                    {!tracks?.length && (
                        <div className="text-center text-zinc-500 py-8">
                            No listening history found yet.
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
