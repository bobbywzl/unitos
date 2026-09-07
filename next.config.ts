import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom and unpdf break route modules when bundled; load them from node_modules at runtime.
  // @napi-rs/canvas is a native addon Turbopack cannot place in a chunk.
  // playwright-core drives the browser transcription rung and loads only when
  // one is configured; it spawns processes and must stay unbundled.
  serverExternalPackages: ["jsdom", "unpdf", "@napi-rs/canvas", "playwright-core"],
  // playwright-core reads browsers.json and its lib at runtime by path, so the
  // file trace of a route that launches the browser (an add, a re-parse, the
  // upload review, a transcript) misses them and the deployed function fails
  // with "Cannot find module '.../playwright-core/browsers.json'". The whole
  // package travels with every API route.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
