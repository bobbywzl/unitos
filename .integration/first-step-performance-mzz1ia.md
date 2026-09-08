# claude/first-step-performance-mzz1ia

**Intent:** The fetch step of a URL add with script-drawn charts took over a minute; find why and cut the steps that do not earn their time.

**Files:**
- `src/lib/parse/render-page.ts` — the upload assistant's review (no store) no longer installs the clock or steps the charts; the scroll runs inside the page in one round trip instead of one per viewport; the network-idle cap is 4 s instead of 10.
- `src/lib/parse/capture-animation.ts` — a recorded frame is one `Page.captureScreenshot` over a CDP session instead of `page.screenshot` (five round trips a frame); the sampler answers its first sample with its start, one round trip fewer per chart.
- `src/lib/browser.ts` — the endpoint candidate that connected is remembered, so a plan that refuses 300 s pays that refusal once per server.
- `SPEC.md` — §2 says the review does not step the charts and names the frame capture.

**Decisions:**
- The review keeps the browser render (scrolled DOM) so its figure audit still sees script-drawn figures; only the chart stepping is dropped there. Dropping the render too would have halved the review's time again but changed what the audit reports.
- Network-idle cap 4 s: a page that keeps a connection open burned the whole 10 s on every render; the scroll after it still gives late chart data several seconds of real time.
- Frame rate stays 10 fps; the cut is per-frame cost, not quality.
