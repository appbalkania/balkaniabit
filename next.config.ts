import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen in this app is behind a login and reads live data per request,
  // so the static-shell caching model (cacheComponents) is deliberately not enabled.
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb", // receipt photo uploads
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
