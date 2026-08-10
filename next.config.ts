import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom and unpdf break route modules when bundled; load them from node_modules at runtime.
  serverExternalPackages: ["jsdom", "unpdf"],
};

export default nextConfig;
