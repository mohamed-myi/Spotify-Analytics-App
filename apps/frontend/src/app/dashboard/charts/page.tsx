'use client';

import { AppLayout } from '@/components/layout/app-layout';
import { MoodChart } from '@/components/dashboard/charts/mood-chart';
import { DailyDoseChart } from '@/components/dashboard/charts/daily-dose-chart';
import { OnRepeatList } from '@/components/dashboard/charts/on-repeat-list';
import { PageTitle } from '@/components/dashboard/page-title';

export default function ChartsPage() {
    return (
        <AppLayout>
            <div className="min-h-screen">
                <div className="w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-8 md:py-16 space-y-8">
                    {/* Page Header */}
                    <div className="mb-[-3rem]">
                        <PageTitle
                            title="Statistics"
                            subtitle="All About You"
                            description="Advanced analysis of your listening patterns."
                        />
                    </div>

                    {/* Charts Grid */}
                    <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
                        {/* Mood Chart - Full width on mobile, spans 2 cols on desktop */}
                        <div className="lg:col-span-2">
                            <MoodChart />
                        </div>

                        {/* Bottom Row - Side by side */}
                        <DailyDoseChart />
                        <OnRepeatList />
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
