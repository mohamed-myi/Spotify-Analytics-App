"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "poster" | "wide" | "circle" | "standard" | "square";
    disableHover?: boolean;
    children: React.ReactNode;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, variant = "standard", disableHover = false, children, ...props }, ref) => {
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
                whileHover={disableHover ? undefined : { scale: 1.05, zIndex: 10 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={cn(
                    // Glassmorphic card styling
                    "relative overflow-hidden rounded-lg",
                    "backdrop-blur-md bg-white/5 hover:bg-white/10",
                    "border border-white/10 hover:border-white/20",
                    "transition-all duration-300",
                    "shadow-xl hover:shadow-mint-500/20",
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

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight text-white", className)} {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-white/50", className)} {...props} />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
