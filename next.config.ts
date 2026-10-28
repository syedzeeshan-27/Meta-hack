import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone load the dev server through an ngrok HTTPS tunnel (phones need HTTPS for the camera).
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app"],
  cacheComponents: true,
  partialPrefetching: true,
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
