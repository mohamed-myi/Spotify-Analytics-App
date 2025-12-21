"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/use-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import { Play } from "lucide-react";

export default function LandingPage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated } = useUser();

  const handleEnter = () => {
    if (isAuthenticated) {
      router.push("/dashboard");
    } else {
      // Redirect to login through proxy (ensures same-origin cookies)
      window.location.href = "/api/auth/login";
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-6 relative overflow-hidden">
      {/* Background - Subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-black" />

      {/* Ambient glow effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl" />

      {/* Content */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="text-center z-10 flex flex-col items-center"
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-6">
            {/* Glassmorphic skeleton container */}
            <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-full p-4">
              <Skeleton className="w-40 h-40 md:w-52 md:h-52 rounded-full bg-white/10" />
            </div>
            <Skeleton className="w-32 h-5 rounded-md bg-white/10" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            {/* Profile/Logo Container - Glassmorphic */}
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="relative"
            >
              {/* Outer glow ring */}
              <div className="absolute -inset-2 bg-gradient-to-br from-purple-500 to-purple-700 rounded-full opacity-30 blur-xl" />

              {/* Glassmorphic container */}
              <div className="relative backdrop-blur-md bg-white/5 border border-white/20 rounded-full p-3 shadow-2xl">
                <div className="w-40 h-40 md:w-52 md:h-52 rounded-full overflow-hidden relative flex items-center justify-center bg-black/50 border-2 border-white/10">
                  {isAuthenticated && user?.image ? (
                    <Image
                      src={user.image}
                      alt={user.displayName || "User"}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    // MYI Logo - retained
                    <img
                      src="/brand/myi-logo.svg"
                      alt="MYI"
                      className="w-full h-full p-4"
                    />
                  )}
                </div>
              </div>
            </motion.div>

            {/* User name for authenticated users */}
            {isAuthenticated && user && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-lg text-white/70"
              >
                {user.displayName}
              </motion.p>
            )}
          </div>
        )}

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-12 flex flex-col items-center gap-4"
        >
          {/* Subtitle for unauthenticated */}
          {!isAuthenticated && !isLoading && (
            <span className="text-sm tracking-widest uppercase text-white/40 mb-2">
              Who&apos;s listening?
            </span>
          )}

          {/* Primary CTA Button */}
          <button
            onClick={handleEnter}
            className={`
                            flex items-center gap-3 px-8 py-4 rounded-full font-medium text-base transition-all duration-300
                            ${isAuthenticated
                ? "bg-white text-black hover:bg-gray-100 shadow-xl shadow-white/10 hover:scale-105"
                : "backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 text-white hover:border-white/40"
              }
                        `}
          >
            {isAuthenticated ? (
              <>
                <Play className="w-5 h-5 fill-black" />
                Enter Dashboard
              </>
            ) : (
              "Login with Spotify"
            )}
          </button>

          {/* Footer note */}
          {!isAuthenticated && !isLoading && (
            <p className="text-xs text-white/30 mt-4">
              Connect your Spotify account to see your stats
            </p>
          )}
        </motion.div>
      </motion.div>

      {/* Bottom branding */}
      <div className="absolute bottom-6 text-center">
        <p className="text-xs text-white/20 tracking-widest">
          MYI • Your Music Intelligence
        </p>
      </div>
    </div>
  );
}
