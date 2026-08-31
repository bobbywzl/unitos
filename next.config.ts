import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom and unpdf break route modules when bundled; load them from node_modules at runtime.
  // @napi-rs/canvas is a native addon Turbopack cannot place in a chunk.
  serverExternalPackages: ["jsdom", "unpdf", "@napi-rs/canvas"],
};

export default nextConfig;
