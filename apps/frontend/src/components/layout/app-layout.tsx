"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LogOut, Upload, Menu, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useUser, useTopArtists } from "@/hooks/use-dashboard";
import { useSongOfTheDay } from "@/hooks/use-song-of-the-day";
import { ImportHistoryModal } from "@/components/ImportHistoryModal";
import { LogoutConfirmationDialog } from "@/components/ui/logout-confirmation-dialog";
import { BackgroundModeProvider, useBackgroundMode } from "@/contexts/background-mode-context";
import { motion, AnimatePresence } from "framer-motion";

interface AppLayoutProps {
    children: React.ReactNode;
}

// Wrapper that provides the context
export function AppLayout({ children }: AppLayoutProps) {
    return (
        <BackgroundModeProvider>
            <AppLayoutInner>{children}</AppLayoutInner>
        </BackgroundModeProvider>
    );
}

// Inner component that can use the context
function AppLayoutInner({ children }: AppLayoutProps) {
    const [scrolled, setScrolled] = React.useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
    const pathname = usePathname();
    const { user } = useUser();
    const [isImportOpen, setIsImportOpen] = React.useState(false);
    const [isLogoutOpen, setIsLogoutOpen] = React.useState(false);

    const { mode, next, previous } = useBackgroundMode();

    const { artists } = useTopArtists("year");
    const { image: songImage } = useSongOfTheDay();

    const backgroundImage = React.useMemo(() => {
        if (mode === "song-of-the-day") {
            return songImage || artists?.[0]?.image || "";
        }
        return artists?.[0]?.image || "";
    }, [mode, songImage, artists]);

    // Handle scroll effect for navbar
    React.useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // Close mobile menu on route change
    React.useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [pathname]);

    React.useEffect(() => {
        if (isMobileMenuOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isMobileMenuOpen]);

    const navLinks = [
        { href: "/dashboard", label: "Browse" },
        { href: "/dashboard/history", label: "History" },
    ];

    return (
        <div className="min-h-screen flex flex-col bg-black text-white selection:bg-primary/30">
            {/* Fixed Persistent Background Image with Fade Animation */}
            <AnimatePresence mode="wait">
                {backgroundImage && (
                    <motion.div
                        key={backgroundImage}
                        className="fixed inset-0 z-0"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                    >
                        {/* 
                            Background image with Next.js Image for optimization
                        */}
                        <Image
                            src={backgroundImage}
                            alt="Background"
                            fill
                            priority
                            className="object-cover"
                            style={{ objectPosition: 'center 20%' }}
                            unoptimized
                        />
                        {/* Gradient overlays for readability - lighter opacity */}
                        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black" />
                        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/20 to-transparent" />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Content wrapper with relative positioning */}
            <div className="relative z-10 min-h-screen flex flex-col">
                {/* Sticky Top Navigation - Glassmorphic */}
                <header
                    className={cn(
                        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
                        scrolled
                            ? "backdrop-blur-xl bg-white/5 border-b border-white/10"
                            : "bg-transparent"
                    )}
                >
                    <nav className="w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-4 flex items-center justify-center relative">
                        {/* Logo - Absolute left */}
                        <Link
                            href="/dashboard"
                            className="absolute left-4 md:left-6 flex items-center justify-center w-10 h-10 rounded-full overflow-hidden hover:opacity-80 transition-opacity shadow-lg shadow-purple-500/30"
                        >
                            <Image src="/brand/myi-logo.svg" alt="MYI" width={40} height={40} className="w-full h-full" unoptimized />
                        </Link>

                        {/* Desktop Nav Links - True Center */}
                        <div className="hidden md:flex items-center gap-8">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={cn(
                                        "text-sm font-medium transition-colors",
                                        pathname === link.href
                                            ? "text-white/90"
                                            : "text-white/60 hover:text-white"
                                    )}
                                >
                                    {link.label}
                                </Link>
                            ))}
                        </div>

                        {/* Desktop Right Side Actions - Absolute right */}
                        <div className="absolute right-4 md:right-6 hidden md:flex items-center gap-3">
                            {/* Background rotation arrows */}
                            <button
                                onClick={previous}
                                className="w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                                aria-label="Previous background"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                                onClick={next}
                                className="w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                                aria-label="Next background"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>

                            <button
                                onClick={() => setIsImportOpen(true)}
                                className="w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                                title="Import Data"
                            >
                                <Upload className="w-4 h-4" />
                            </button>

                            <button
                                onClick={() => setIsLogoutOpen(true)}
                                className="w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                                title="Logout"
                            >
                                <LogOut className="w-4 h-4" />
                            </button>

                            {user && (
                                <Link href="/dashboard/profile" title="My Profile">
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg shadow-purple-500/30 overflow-hidden relative">
                                        {user.image ? (
                                            <Image src={user.image} alt={user.displayName} fill className="object-cover" unoptimized />
                                        ) : (
                                            <span className="text-xs font-bold text-white">
                                                {user.displayName?.[0]?.toUpperCase() || "U"}
                                            </span>
                                        )}
                                    </div>
                                </Link>
                            )}
                        </div>

                        {/* Mobile Center: Background Rotation Arrows */}
                        <div className="md:hidden flex items-center gap-2">
                            <button
                                onClick={previous}
                                className="w-8 h-8 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                                aria-label="Previous background"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                                onClick={next}
                                className="w-8 h-8 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                                aria-label="Next background"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Mobile Hamburger Button - Absolute right */}
                        <button
                            onClick={() => setIsMobileMenuOpen(true)}
                            className="md:hidden absolute right-4 w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                            aria-label="Open menu"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    </nav>
                </header>

                {/* Mobile Menu Overlay */}
                {isMobileMenuOpen && (
                    <div className="fixed inset-0 z-[60] md:hidden">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-black/80 backdrop-blur-md animate-fade-in"
                            onClick={() => setIsMobileMenuOpen(false)}
                        />

                        {/* Slide-out Drawer */}
                        <div className="absolute right-0 top-0 bottom-0 w-72 backdrop-blur-2xl bg-gradient-to-b from-white/10 to-white/5 border-l border-white/20 animate-slide-in-right">
                            {/* Drawer Header */}
                            <div className="flex items-center justify-between p-4 border-b border-white/10">
                                {user && (
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg shadow-purple-500/30 overflow-hidden relative">
                                            {user.image ? (
                                                <Image src={user.image} alt={user.displayName} fill className="object-cover" unoptimized />
                                            ) : (
                                                <span className="text-sm font-bold text-white">
                                                    {user.displayName?.[0]?.toUpperCase() || "U"}
                                                </span>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-white">{user.displayName}</p>
                                            <p className="text-xs text-white/50">View Profile</p>
                                        </div>
                                    </div>
                                )}
                                <button
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className="w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                                    aria-label="Close menu"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Navigation Links */}
                            <nav className="p-4 space-y-2">
                                {navLinks.map((link) => (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        className={cn(
                                            "block px-4 py-3 rounded-lg text-sm font-medium transition-all",
                                            pathname === link.href
                                                ? "bg-white/10 text-white"
                                                : "text-white/60 hover:bg-white/5 hover:text-white"
                                        )}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                    >
                                        {link.label}
                                    </Link>
                                ))}

                                {user && (
                                    <Link
                                        href="/dashboard/profile"
                                        className={cn(
                                            "block px-4 py-3 rounded-lg text-sm font-medium transition-all",
                                            pathname === "/dashboard/profile"
                                                ? "bg-white/10 text-white"
                                                : "text-white/60 hover:bg-white/5 hover:text-white"
                                        )}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                    >
                                        Profile
                                    </Link>
                                )}
                            </nav>

                            {/* Action Buttons */}
                            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10 space-y-3">
                                <button
                                    onClick={() => {
                                        setIsMobileMenuOpen(false);
                                        setIsImportOpen(true);
                                    }}
                                    className="w-full px-4 py-3 rounded-lg backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-medium text-white flex items-center justify-center gap-2 transition-all"
                                >
                                    <Upload className="w-4 h-4" />
                                    Import Data
                                </button>
                                <button
                                    onClick={() => {
                                        setIsMobileMenuOpen(false);
                                        setIsLogoutOpen(true);
                                    }}
                                    className="w-full px-4 py-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 text-sm font-medium text-red-400 flex items-center justify-center gap-2 transition-all"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Logout
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Content */}
                <main className="flex-1 pt-20 pb-20 relative z-0">
                    {children}
                </main>

                {/* Sticky Bottom Bar - Glassmorphic */}
                <footer className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/5 border-t border-white/10 px-6 py-3 flex items-center justify-between">
                    <div className="text-xs text-white/40 font-mono">
                        SYNC STATUS: <span className="text-green-400">IDLE</span>
                    </div>
                    <div className="text-xs text-white/30">
                        v3.0.0
                    </div>
                </footer>

                <ImportHistoryModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
                <LogoutConfirmationDialog isOpen={isLogoutOpen} onClose={() => setIsLogoutOpen(false)} />
            </div>
        </div>
    );
}
