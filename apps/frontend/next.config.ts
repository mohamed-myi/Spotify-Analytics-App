import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: 'i.scdn.co' },
            { protocol: 'https', hostname: 'mosaic.scdn.co' },
            { protocol: 'https', hostname: 'wrapped-images.spotifycdn.com' },
            { protocol: 'https', hostname: 'platform-lookaside.fbsbx.com' }, // Sometimes used for generic avatars
        ],
    },
};

export default nextConfig;
