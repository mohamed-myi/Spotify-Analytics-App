"use client";

import { motion } from "framer-motion";
import Image from "next/image";

interface ProcessingScreenProps {
    message?: string;
}

export function ProcessingScreen({ message = "Analyzing your music taste..." }: ProcessingScreenProps) {
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black text-white p-6 overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-black" />

            {/* Ambient glow effects */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />

            {/* Content */}
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="text-center z-10 flex flex-col items-center gap-8"
            >
                {/* Logo Container */}
                <motion.div
                    animate={{
                        boxShadow: [
                            "0 0 0px rgba(168, 85, 247, 0)",
                            "0 0 20px rgba(168, 85, 247, 0.3)",
                            "0 0 0px rgba(168, 85, 247, 0)"
                        ]
                    }}
                    transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                    className="relative backdrop-blur-md bg-white/5 border border-white/20 rounded-full p-4 shadow-2xl"
                >
                    <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden relative flex items-center justify-center bg-black/50 border-2 border-white/10">
                        <Image
                            src="/brand/myi-logo.svg"
                            alt="MYI"
                            width={120}
                            height={120}
                            className="w-full h-full p-4"
                            unoptimized
                        />
                    </div>
                </motion.div>

                {/* Status Message */}
                <div className="space-y-3 max-w-md">
                    <motion.h2
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-2xl md:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70"
                    >
                        Syncing Account
                    </motion.h2>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="text-white/60 text-sm md:text-base"
                    >
                        {message}
                    </motion.p>
                </div>

                {/* Loading Indicator */}
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 0.5 }}
                    className="w-48 h-1 bg-white/10 rounded-full overflow-hidden mt-4"
                >
                    <motion.div
                        className="h-full bg-purple-500"
                        animate={{
                            x: ["-100%", "100%"]
                        }}
                        transition={{
                            repeat: Infinity,
                            duration: 1.5,
                            ease: "easeInOut"
                        }}
                    />
                </motion.div>
            </motion.div>

            {/* Bottom branding */}
            <div className="absolute bottom-6 text-center">
                <p className="text-xs text-white/20 tracking-widest uppercase">
                    MYI • Music Intelligence
                </p>
            </div>
        </div>
    );
}
