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
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-4">
      {/* Background Grid Effect, only for authenticated users */}
      {isAuthenticated && (
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none" />
      )}

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center z-10 flex flex-col items-center"
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="w-48 h-48 md:w-60 md:h-60 rounded-full" />
            <Skeleton className="w-32 h-6 rounded-md" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {/* Profile/Logo display */}
            <motion.div
              className="w-48 h-48 md:w-60 md:h-60 rounded-full overflow-hidden shadow-2xl relative flex items-center justify-center"
            >
              {isAuthenticated && user?.image ? (
                <Image src={user.image} alt={user.displayName || "User"} fill className="object-cover" unoptimized />
              ) : (
                // MYI Logo
                <img
                  src="/brand/myi-logo.svg"
                  alt="MYI"
                  className="w-full h-full"
                />
              )}
            </motion.div>
            {isAuthenticated && (
              <span className="text-lg text-gray-400">
                {user?.displayName || "User"}
              </span>
            )}
          </div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="pt-12 flex flex-col items-center gap-3"
        >
          {!isAuthenticated && (
            <span className="text-sm tracking-widest uppercase text-gray-400">
              Who&apos;s listening?
            </span>
          )}
          <button
            onClick={handleEnter}
            className="border border-white/20 hover:border-white px-6 py-2 rounded-sm text-sm tracking-widest uppercase transition-colors"
          >
            {isAuthenticated ? "Enter Dashboard" : "Login with Spotify"}
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
