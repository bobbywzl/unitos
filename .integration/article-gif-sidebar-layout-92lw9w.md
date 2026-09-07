**Intent:** Fix the production build, which has failed to type-check since the captured-chart round merged.

**Files:**
- `src/lib/parse/render-page.ts`: the captured GIF is stored as a `Buffer`. Prisma's `Bytes` type takes `Uint8Array<ArrayBuffer>`, and the encoder's `Uint8Array` is typed over `ArrayBufferLike`, so `next build` failed with TS2322 at the `imageAsset.create` call. Every Vercel production deployment since e2f2ad4 shows Error for this reason; production still runs f5cd420.

**Decisions:**
- `Buffer.from(gif)` copies the bytes once rather than changing the encoder's return type, so the encoder stays independent of Node types.
- Verified locally: `next build` fails on main with this exact error and passes with the change; `eslint` passes.
