"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "poster" | "wide" | "circle" | "standard" | "square";
    children: React.ReactNode;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, variant = "standard", children, ...props }, ref) => {
        const variants = {
            poster: "aspect-[2/3] w-full",
            wide: "aspect-video w-full",
            circle: "aspect-square rounded-full overflow-hidden",
            square: "aspect-square w-full",
            standard: "w-full",
        };

        return (
            <motion.div
                ref={ref}
                whileHover={{ scale: 1.05, zIndex: 10 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={cn(
                    "relative overflow-hidden rounded-lg bg-surface transition-colors hover:shadow-lg hover:shadow-primary/20",
                    variants[variant],
                    className
                )}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                {...props as any}
            >
                {children}
            </motion.div>
        );
    }
);
Card.displayName = "Card";

export { Card };
