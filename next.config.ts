import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker-based deployments (Railway, Koyeb)
  output: "standalone",
  // Allow cross-origin headers required by SharedArrayBuffer / FFmpeg WASM
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  // Turbopack is the default bundler in Next.js 16
  turbopack: {},
};

export default nextConfig;
