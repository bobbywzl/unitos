# claude/article-gif-sidebar-layout-92lw9w

**Intent:** A URL document keeps a chart the page's scripts animate (Dyna's Figure 4, a 19-second loop drawn by `requestAnimationFrame`, which the render caught with every element at opacity 0) as a GIF of one loop, and reads at the page's own width — the text column as wide as on the page, a figure the page sets wider than its text drawn wider — contracting when the notes tray opens.

**Files:**
- `src/lib/parse/capture-animation.ts` — new: the page's clock paused and stepped (Playwright's clock) per chart; still, settled (one-shot, drawn to its end), or looped (the period found from the svg's numbers repeating within a drift tolerance, one loop screenshotted, encoded, stored, the svg replaced by an `<img>`).
- `src/lib/parse/gif.ts` — new: a dependency-free animated GIF encoder (popular colors exact plus median cut, per-frame change boxes with transparent unchanged pixels, noise-tolerant diffs, LZW).
- `src/lib/parse/render-page.ts` — installs the clock before the page loads, runs the capture after the scroll pass, stores loops as `ImageAsset` rows when asked (`RenderOptions.store`), 150 s render budget.
- `src/lib/parse/ingest.ts` — ingest and re-parse ask the render to store; captured images are claimed by the document after save; a re-parse deletes the last parse's images; `Document.columnWidth` saved and updated on re-parse; `reparseDocument` takes the account.
- `src/app/api/documents/[documentId]/reparse/route.ts` — passes the account to the re-parse.
- `src/lib/parse/sanitize.ts` — the reader's own `/api/images/<id>` src stays as it is; the root figure may carry `width:NNN%` up to 200.
- `src/lib/parse/figures.ts` — a width past 100 on a figure's media or row lifts to the `<figure>`; a bare media element becomes a figure of itself.
- `src/lib/parse/figure-style.ts` — `data-width-pct` past 100 for media and rows wider than the column (105–200); `<body data-column-px>`.
- `src/lib/parse/url.ts`, `src/lib/parse/types.ts` — `ParsedDocument.columnWidth` (400–1100 px); parser version 17.
- `src/lib/derive/figure.ts` — a figure image at `/api/images/<id>` is read from the store for the model, never fetched.
- `prisma/schema.prisma`, `prisma/migrations/20260906140000_page_width_captured_charts/migration.sql` — `Document.columnWidth`, `ImageAsset.documentId` (cascade).
- `src/app/n/[notebookId]/page.tsx`, `src/components/reader/reader-interactions.tsx`, `src/components/reader/reader.tsx`, `src/app/globals.css` — the column width reaches the article as `--reader-column-w`; `.reader-frame` is an inline-size container; a wide figure centers on the column and caps at the frame's width less the cut.
- `SPEC.md` — §2: the page's width, wide figures, animated charts.

**Decisions:**
- One loop of an animated chart is a GIF, not a video: the reader already renders `<img>` figures, the model reads GIFs as images, and no encoder dependency is needed.
- The loop's period comes from the svg's markup numbers, not from pixels: exact repeats fail because the page's animation clock and the stepped clock drift by up to one frame per loop, so each number may differ by a share of what it moves in one step.
- Screenshot diffs ignore pixels that move less than 12 channel units in total: the Dyna page's film grain changed most pixels every frame and made a 24 MB GIF; with the threshold the same loop is 370 KB.
- The width past 100% lives on the root `<figure>` only; nested figures and media stay shares of their figure.
- `Document.columnWidth` is the page's fact and a re-parse updates it; `Document.font` stays the reader's choice.
- Type check and lint did not run in this session: the sandbox refused installing the repository's dependencies.
