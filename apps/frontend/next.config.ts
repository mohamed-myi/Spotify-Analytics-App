import type { NextConfig } from "next";

// Backend URL for API proxy (AWS EC2 in production, local in dev)
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: 'i.scdn.co' },
            { protocol: 'https', hostname: 'mosaic.scdn.co' },
            { protocol: 'https', hostname: 'wrapped-images.spotifycdn.com' },
            { protocol: 'https', hostname: 'image-cdn-ak.spotifycdn.com' },
            { protocol: 'https', hostname: 'image-cdn-fa.spotifycdn.com' },
            { protocol: 'https', hostname: 'platform-lookaside.fbsbx.com' }, // Sometimes used for generic avatars
        ],
    },
    // Proxy API requests through Next.js to avoid cross-origin cookie issues on mobile
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: `${BACKEND_URL}/:path*`,
            },
        ];
    },
};

export default nextConfig;
