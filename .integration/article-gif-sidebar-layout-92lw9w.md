**Intent:** A figure the page draws with scripts comes over on its own once a browser is configured, the reader shows its place moving while that runs, and a failed render says why instead of leaving the caption alone in silence.

**Files:**
- `src/lib/browser.ts`: a Browserless endpoint that sets no `timeout` gets one of 300 s. The service ends a session at 60 s by default, and a page render with a chart capture takes longer (48 s against a local server, more over the network) — the likely reason the production capture fell back to the static page in silence.
- `src/lib/parse/render-page.ts`: `renderIfNeeded` returns the page and a `RenderReport` (whether a render ran; why it did not deliver — the connection refused, the time up, the chart capture failed, a loop not found — the failure's first line). The render never throws, as before.
- `src/lib/parse/ingest.ts`: the report rides with the save stage as `renderError` and lands on the document as `figureRenderAt` and `figureRenderError` (both null when no render ran, so a browser configured later gets one on open).
- `src/lib/parse/url.ts`, `src/lib/upload-assistant.ts`: read the page out of the new return shape.
- `src/lib/parse/figure-audit.ts`: `captionGaps` — the captions left without their figure, with their block ids, for parsed blocks and stored rows alike; `auditFigures` shares the predicate.
- `prisma/schema.prisma`, `prisma/migrations/20260907090000_figure_render_state`: the two columns.
- `src/components/reader/figure-capture.tsx`: the run's state (a store the bar writes and the reader reads), the moving-picture icon, and the figure's place: "Unitos is moving Figure 4 over…" while it runs, the reason and Try again when it failed, the variable to set when no browser is configured.
- `src/components/reader/document-bar.tsx`: the silent re-parse also runs on open when a caption has no figure, a browser is configured, and no render has run for the document; it drives the store and the header shows the same moving pill; the bar's line after a re-parse carries the render's error; Try again re-runs it.
- `src/components/reader/workspace.tsx`, `src/app/n/[notebookId]/page.tsx`, `src/components/reader/reader-interactions.tsx`, `src/components/reader/reader.tsx`: the gaps and the render state travel to the bar and the reader; the reader renders the figure's place above each gap.
- `src/lib/i18n/dict/panes.ts`, `src/app/globals.css`, `SPEC.md` §15.

**Decisions:**
- One automatic run per document, persisted (`figureRenderAt`), rather than one per open: a run is a full re-parse with model passes and a browser session, and a failing endpoint would otherwise cost that on every open. Try again is the manual path after that.
- The failure reason is shown verbatim (first line, 200 chars), not translated: it names the endpoint, the token, or the time, which is what the deployer needs to see.
- Verified locally with the sandbox Chromium against the saved dyna.co page: the report is `attempted: true, error: null`, Figure 4 comes over as a 372 KB GIF, and the audit has no caption without its figure; a dead endpoint yields the ECONNREFUSED reason with the static page standing. `next build`, `tsc`, and `eslint` pass.
