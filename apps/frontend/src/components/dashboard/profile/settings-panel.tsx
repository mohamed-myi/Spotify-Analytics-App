"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Settings, Globe, Lock, Eye, Mail, Music, Users, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
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
        <div className="flex items-center justify-between py-4 border-b border-zinc-800 last:border-0">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-zinc-800 text-zinc-400">
                    {icon}
                </div>
                <div>
                    <p className="font-medium text-white">{label}</p>
                    <p className="text-sm text-zinc-500">{description}</p>
                </div>
            </div>
            <button
                onClick={() => onChange(!checked)}
                className={`relative w-12 h-6 rounded-full transition-colors ${checked ? "bg-primary" : "bg-zinc-700"
                    }`}
            >
                <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? "translate-x-6" : ""
                        }`}
                />
            </button>
        </div>
    );
}

export function SettingsPanel() {
    const { settings, isLoading, mutate } = useSettings();
    const { updateSettings } = useUpdateSettings();
    const [localSettings, setLocalSettings] = useState(settings);

    useEffect(() => {
        if (settings) {
            setLocalSettings(settings);
        }
    }, [settings]);

    const handleToggle = async (key: keyof typeof settings, value: boolean) => {
        if (!localSettings) return;

        const updated = { ...localSettings, [key]: value };
        setLocalSettings(updated);

        try {
            await updateSettings({ [key]: value });
            mutate(updated, false);
        } catch (error) {
            // Revert on error
            setLocalSettings(localSettings);
        }
    };

    if (isLoading || !localSettings) {
        return (
            <Card disableHover className="p-6 bg-zinc-900/50 border-zinc-800">
                <div className="animate-pulse space-y-4">
                    <div className="h-6 w-32 bg-zinc-800 rounded" />
                    <div className="space-y-3">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-16 bg-zinc-800 rounded" />
                        ))}
                    </div>
                </div>
            </Card>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
        >
            <Card disableHover className="p-6 bg-zinc-900/50 border-zinc-800">
                <div className="flex items-center gap-2 mb-6">
                    <Settings className="w-5 h-5 text-primary" />
                    <h2 className="text-xl font-semibold text-white">Settings</h2>
                </div>

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

                <div className="mt-6 pt-4 border-t border-zinc-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-zinc-800 text-zinc-400">
                            <Globe className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                            <p className="font-medium text-white">Timezone</p>
                            <p className="text-sm text-zinc-500">Used for daily stats</p>
                        </div>
                        <select
                            value={localSettings.timezone}
                            onChange={async (e) => {
                                const tz = e.target.value;
                                setLocalSettings({ ...localSettings, timezone: tz });
                                await updateSettings({ timezone: tz });
                                mutate({ ...localSettings, timezone: tz }, false);
                            }}
                            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
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
            </Card>
        </motion.div>
    );
}
