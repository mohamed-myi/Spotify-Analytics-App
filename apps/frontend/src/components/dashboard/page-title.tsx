"use client";

import { motion } from "framer-motion";

interface PageTitleProps {
    title: string;
    subtitle?: string;
    description?: string;
}

export function PageTitle({ title, subtitle, description }: PageTitleProps) {
    return (
        <div className="relative min-h-[30vh] w-full flex items-center justify-center mb-12">
            <div className="relative z-10 w-[95%] max-w-[1920px] mx-auto px-4 md:px-6 py-16 flex justify-center">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="max-w-2xl space-y-6 text-center items-center flex flex-col"
                >
                    {/* Badge / Subtitle */}
                    {subtitle && (
                        <div className="inline-block">
                            <motion.span
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: 0.1 }}
                                className="px-4 py-1.5 rounded-full backdrop-blur-md bg-purple-500/20 border border-purple-400/30 text-purple-200 text-sm inline-flex items-center gap-2"
                            >
                                {subtitle}
                            </motion.span>
                        </div>
                    )}

                    {/* Title */}
                    <motion.h1
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.2 }}
                        className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight text-white font-bold"
                    >
                        {title}
                    </motion.h1>

                    {/* Description */}
                    {description && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.2, delay: 0.3 }}
                            className="text-white/60 text-base md:text-lg"
                        >
                            {description}
                        </motion.p>
                    )}
                </motion.div>
            </div>
        </div>
    );
}
