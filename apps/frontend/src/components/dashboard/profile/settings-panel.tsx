"use client";

import { motion } from "framer-motion";
import { Settings, Globe, Eye, Mail, Music, Users, Clock } from "lucide-react";
import { useSettings, useUpdateSettings } from "@/hooks/use-profile";

interface ToggleProps {
    label: string;
    description: string;
    icon: React.ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
}

function Toggle({ label, description, icon, checked, onChange }: ToggleProps) {
    return (
        <div className="flex items-center justify-between py-4 border-b border-white/10 last:border-0">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-white/5 text-white/50 border border-white/10">
                    {icon}
                </div>
                <div>
                    <p className="font-medium text-white">{label}</p>
                    <p className="text-sm text-white/40">{description}</p>
                </div>
            </div>
            <button
                onClick={() => onChange(!checked)}
                className={`relative w-12 h-6 rounded-full transition-colors ${checked ? "bg-mint-600" : "bg-white/20"
                    }`}
            >
                <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${checked ? "translate-x-6" : ""
                        }`}
                />
            </button>
        </div>
    );
}

export function SettingsPanel() {
    const { settings, isLoading, mutate } = useSettings();
    const { updateSettings } = useUpdateSettings();
    const localSettings = settings;

    const handleToggle = async (key: keyof NonNullable<typeof settings>, value: boolean) => {
        if (!localSettings) return;

        const updated = { ...localSettings, [key]: value };
        mutate(updated, false);

        try {
            await updateSettings({ [key]: value });
        } catch {
            mutate();
        }
    };

    if (isLoading || !localSettings) {
        return (
            <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-6 w-32 bg-white/10 rounded" />
                    <div className="space-y-3">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-16 bg-white/5 rounded" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
        >
            <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6">
                {/* Header */}
                <div className="flex items-center gap-2 mb-6">
                    <Settings className="w-5 h-5 text-mint-400" />
                    <h2 className="text-xl font-semibold text-mint-300">Settings</h2>
                </div>

                {/* Toggles */}
                <div className="space-y-1">
                    <Toggle
                        label="Public Profile"
                        description="Allow others to view your profile"
                        icon={<Eye className="w-4 h-4" />}
                        checked={localSettings.isPublicProfile}
                        onChange={(v) => handleToggle("isPublicProfile", v)}
                    />
                    <Toggle
                        label="Share Top Tracks"
                        description="Show your top tracks on public profile"
                        icon={<Music className="w-4 h-4" />}
                        checked={localSettings.shareTopTracks}
                        onChange={(v) => handleToggle("shareTopTracks", v)}
                    />
                    <Toggle
                        label="Share Top Artists"
                        description="Show your top artists on public profile"
                        icon={<Users className="w-4 h-4" />}
                        checked={localSettings.shareTopArtists}
                        onChange={(v) => handleToggle("shareTopArtists", v)}
                    />
                    <Toggle
                        label="Share Listening Time"
                        description="Show your total listening time publicly"
                        icon={<Clock className="w-4 h-4" />}
                        checked={localSettings.shareListeningTime}
                        onChange={(v) => handleToggle("shareListeningTime", v)}
                    />
                    <Toggle
                        label="Email Notifications"
                        description="Receive weekly listening summaries"
                        icon={<Mail className="w-4 h-4" />}
                        checked={localSettings.emailNotifications}
                        onChange={(v) => handleToggle("emailNotifications", v)}
                    />
                </div>

                {/* Timezone Selector */}
                <div className="mt-6 pt-6 border-t border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-white/5 text-white/50 border border-white/10">
                            <Globe className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                            <p className="font-medium text-white">Timezone</p>
                            <p className="text-sm text-white/40">Used for daily stats</p>
                        </div>
                        <select
                            value={localSettings.timezone}
                            onChange={async (e) => {
                                const tz = e.target.value;
                                const updated = { ...localSettings, timezone: tz };
                                mutate(updated, false);
                                await updateSettings({ timezone: tz });
                            }}
                            className="bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-mint-400 backdrop-blur-md"
                        >
                            <option value="UTC">UTC</option>
                            <option value="America/New_York">Eastern Time</option>
                            <option value="America/Chicago">Central Time</option>
                            <option value="America/Denver">Mountain Time</option>
                            <option value="America/Los_Angeles">Pacific Time</option>
                            <option value="Europe/London">London</option>
                            <option value="Europe/Paris">Paris</option>
                            <option value="Europe/Berlin">Berlin</option>
                            <option value="Asia/Tokyo">Tokyo</option>
                            <option value="Asia/Shanghai">Shanghai</option>
                            <option value="Australia/Sydney">Sydney</option>
                            <option value="Pacific/Auckland">Auckland</option>
                        </select>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
