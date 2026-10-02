import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom, unpdf, and pdfjs-dist break route modules when bundled; load them from node_modules at runtime.
  // @napi-rs/canvas is a native addon Turbopack cannot place in a chunk.
  // playwright-core drives the browser transcription rung and loads only when
  // one is configured; it spawns processes and must stay unbundled.
  serverExternalPackages: ["jsdom", "unpdf", "pdfjs-dist", "@napi-rs/canvas", "playwright-core"],
  // playwright-core reads browsers.json and its lib at runtime by path, so the
  // file trace of a route that launches the browser (an add, a re-parse, the
  // upload review, a transcript) misses them and the deployed function fails
  // with "Cannot find module '.../playwright-core/browsers.json'". The whole
  // package travels with every API route. So do pdf.js's CMaps, which pdf.js
  // reads by path when a PDF sets CJK text in a font without a Unicode map
  // (lib/pdf-runtime.ts), the page editor's English dictionary, which
  // the PDF parse reads by path to judge a line-end hyphen
  // (lib/parse/pdf/text.ts), and pdfjs-dist's wasm decoders, standard
  // fonts, and worker, which a page render loads by path to draw a scan's
  // JBIG2, CCITT, and JPEG 2000 images (lib/handwritten/pages.ts).
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/playwright-core/**/*",
      "./src/lib/parse/pdf/cmaps/**/*",
      "./public/spelling/**/*",
      "./node_modules/pdfjs-dist/wasm/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  // In development every saved server file refreshes the router from the HMR
  // socket; a refresh that lands while the reader hydrates meets the hidden
  // div Next streams its metadata into and throws a hydration mismatch. In
  // development the metadata blocks instead; production keeps streaming it.
  ...(process.env.NODE_ENV === "development" ? { htmlLimitedBots: /.*/ } : {}),
};

export default nextConfig;
