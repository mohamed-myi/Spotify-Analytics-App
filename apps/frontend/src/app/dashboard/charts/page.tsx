'use client';

import { MoodChart } from '@/components/dashboard/charts/mood-chart';
import { DailyDoseChart } from '@/components/dashboard/charts/daily-dose-chart';
import { OnRepeatList } from '@/components/dashboard/charts/on-repeat-list';

export default function ChartsPage() {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Deep Dive Stats</h1>
                <p className="text-zinc-400">Advanced analysis of your listening patterns.</p>
            </div>

            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
                {/* Full width on mobile/tablet, Top Row */}
                <MoodChart />

                {/* Bottom Row */}
                <DailyDoseChart />
                <OnRepeatList />
            </div>
        </div>
    );
}
