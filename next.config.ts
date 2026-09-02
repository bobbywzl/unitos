import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom and unpdf break route modules when bundled; load them from node_modules at runtime.
  // @napi-rs/canvas is a native addon Turbopack cannot place in a chunk.
  // playwright-core drives the browser transcription rung and loads only when
  // one is configured; it spawns processes and must stay unbundled.
  serverExternalPackages: ["jsdom", "unpdf", "@napi-rs/canvas", "playwright-core"],
};

export default nextConfig;
