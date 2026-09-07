**Intent:** The deployed browser render finds playwright-core: the production function failed with "Cannot find module '/var/task/node_modules/playwright-core/browsers.json'", which the reader's new error tell surfaced.

**Files:**
- `next.config.ts`: `outputFileTracingIncludes` adds `node_modules/playwright-core/**/*` to every API route's trace. playwright-core is external (unbundled) and reads `browsers.json` and its lib by path at runtime, so the trace missed them and the deployed function had no browser client to connect with.

**Decisions:**
- Every API route rather than the four that launch a browser (add, re-parse, upload review, transcript): one key, no route to forget, and the package is small.
- Verified in the local build: the reparse, documents, and upload-review route traces list `playwright-core/browsers.json`.
