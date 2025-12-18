"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/use-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";

export default function LandingPage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated } = useUser();

  const handleEnter = () => {
    if (isAuthenticated) {
      router.push("/dashboard");
    } else {
      // Redirect to backend login
      window.location.href = `${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001'}/auth/login`;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-white p-4">
      {/* Background Grid Effect */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none" />

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center space-y-8 z-10"
      >
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Who&apos;s listening?</h1>

        {isLoading ? (
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="w-32 h-32 md:w-40 md:h-40 rounded-md" />
            <Skeleton className="w-32 h-6 rounded-md" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 group cursor-pointer" onClick={handleEnter}>
            <motion.div
              whileHover={{ scale: 1.05, borderColor: "#A855F7" }}
              className="w-32 h-32 md:w-40 md:h-40 rounded-md overflow-hidden border-2 border-transparent transition-all shadow-2xl relative"
            >
              {isAuthenticated && user?.image ? (
                <Image src={user.image} alt={user.displayName || "User"} fill className="object-cover" unoptimized />
              ) : (
                <div className="w-full h-full bg-surface flex items-center justify-center text-4xl text-gray-500">?</div>
              )}
            </motion.div>
            <span className="text-lg text-gray-400 group-hover:text-white transition-colors">
              {isAuthenticated ? (user?.displayName || "User") : "Login with Spotify"}
            </span>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="pt-12"
        >
          <button
            onClick={handleEnter}
            className="border border-white/20 hover:border-white px-6 py-2 rounded-sm text-sm tracking-widest uppercase transition-colors"
          >
            {isAuthenticated ? "Enter Dashboard" : "Connect Account"}
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
