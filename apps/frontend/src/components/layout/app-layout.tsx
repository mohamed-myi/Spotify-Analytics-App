"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { LogOut, Upload } from "lucide-react";
import { useUser } from "@/hooks/use-dashboard";
import { ImportHistoryModal } from "@/components/ImportHistoryModal";

interface AppLayoutProps {
    children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
    const [scrolled, setScrolled] = React.useState(false);
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useUser();
    const [isImportOpen, setIsImportOpen] = React.useState(false);


    const handleLogout = async () => {
        try {
            await api.post("/auth/logout");
            router.push("/");
        } catch (err) {
            console.error("Logout failed", err);
        }
    };

    // Handle scroll effect for navbar
    React.useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30">
            {/* Sticky Top Navigation */}
            <header
                className={cn(
                    "fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-6 py-4 flex items-center justify-between",
                    scrolled ? "bg-black/80 backdrop-blur-md border-b border-white/5" : "bg-transparent"
                )}
            >
                <Link href="/dashboard" className="flex items-center justify-center w-12 h-12 rounded-full border-2 border-primary hover:border-primary-light transition-colors">
                    <span className="text-xl font-bold tracking-tighter text-primary hover:text-primary-light transition-colors">MYI</span>
                </Link>

                <nav className="flex items-center gap-6 text-sm font-medium text-gray-400">
                    <Link
                        href="/dashboard"
                        className={cn("hover:text-white transition-colors", pathname === "/dashboard" && "text-white")}
                    >
                        Browse
                    </Link>
                    <Link
                        href="/dashboard/history"
                        className={cn("hover:text-white transition-colors", pathname === "/dashboard/history" && "text-white")}
                    >
                        History
                    </Link>
                    <Link
                        href="/dashboard/charts"
                        className={cn("hover:text-white transition-colors flex items-center gap-2", pathname === "/dashboard/charts" && "text-white")}
                    >
                        Stats
                    </Link>
                    <Link
                        href="/dashboard/profile"
                        className={cn("hover:text-white transition-colors", pathname === "/dashboard/profile" && "text-white")}
                    >
                        Profile
                    </Link>
                    <button
                        onClick={handleLogout}
                        className="text-gray-400 hover:text-white transition-colors flex items-center gap-2"
                        title="Logout"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>

                    <button
                        onClick={() => setIsImportOpen(true)}
                        className="text-gray-400 hover:text-white transition-colors flex items-center gap-2"
                        title="Import Data"
                    >
                        <Upload className="w-4 h-4" />
                    </button>

                    {user && (
                        <Link href={`/users/${user.id}`} title="My Profile">
                            <div className="w-8 h-8 rounded-full bg-surface border border-white/10 flex items-center justify-center overflow-hidden hover:border-primary transition-colors relative">
                                {user.image ? (
                                    <Image src={user.image} alt={user.displayName} fill className="object-cover" unoptimized />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-xs font-bold text-white">
                                        {user.displayName?.[0]?.toUpperCase() || "U"}
                                    </div>
                                )}
                            </div>
                        </Link>
                    )}
                </nav>
            </header>

            {/* Main Content */}
            <main className="flex-1 pt-20 pb-20 relative z-0">
                {children}
            </main>

            {/* Sticky Bottom Bar (Import Status / Player) */}
            <footer className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-white/5 px-6 py-3 flex items-center justify-between">
                <div className="text-xs text-gray-500 font-mono">
                    SYNC STATUS: <span className="text-green-500">IDLE</span>
                </div>
                <div className="text-xs text-gray-600">
                    v3.0.0
                </div>
            </footer>

            <ImportHistoryModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
        </div>
    );
}
