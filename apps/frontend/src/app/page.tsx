"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/use-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import { Play, Sparkles } from "lucide-react";

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
      <div className="absolute inset-0 bg-gradient-to-br from-mint-950/20 via-black to-black" />

      {/* Ambient glow effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-mint-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-mint-600/10 rounded-full blur-3xl" />

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
              <div className="absolute -inset-2 bg-gradient-to-br from-mint-500 to-mint-700 rounded-full opacity-30 blur-xl" />

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
                    <Image
                      src="/brand/myi-logo.svg"
                      alt="MYI"
                      width={160}
                      height={160}
                      className="w-full h-full p-4"
                      unoptimized
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

          {/* Logout Button for Authenticated Users */}
          {isAuthenticated && (
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.reload();
              }}
              className="text-sm text-white/50 hover:text-white transition-colors hover:underline mt-2"
            >
              Logout
            </button>
          )}

          {/* Try Demo Button for Unauthenticated */}
          {!isAuthenticated && !isLoading && (
            <a
              href="/api/auth/demo"
              className="mt-6 flex items-center gap-2 px-6 py-3 rounded-full backdrop-blur-md bg-mint-500/20 hover:bg-mint-500/30 border border-mint-500/40 hover:border-mint-500/60 text-mint-200 hover:text-white text-sm font-medium transition-all duration-300"
            >
              <Sparkles className="w-4 h-4" />
              Try Demo
            </a>
          )}

          {/* Development Mode Disclaimer */}
          {!isAuthenticated && !isLoading && (
            <div className="mt-4 max-w-sm backdrop-blur-md bg-black/60 border border-mint-500/50 rounded-xl p-4 text-center">
              <p className="text-white text-sm font-medium mb-1">
                In Development
              </p>
              <p className="text-white/70 text-xs leading-relaxed">
                Due to Spotify&apos;s API policies, only registered accounts can login.
                Try the demo above to get a feel for the project!
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* Bottom branding */}
      <div className="absolute bottom-6 text-center">
        <p className="text-xs text-white/20 tracking-widest">
          Brought to you by MYI
        </p>
      </div>
    </div>
  );
}
