# r4-perf4

**Intent:** Cut the cost and time of Find, the skeleton check on save, the offline copy, the graph's first open, the graph's 304, and the skeleton build of a large import (COST4-02, 04, 05, 06, 07, 08).

**Files:**
- `src/lib/graph/find.ts`, `src/app/api/notebooks/[notebookId]/find/route.ts`, `src/components/graph/graph-find.tsx`: one passage for the top 30 documents (`FIND_TOP`), counts for the rest; a bare row loads its passage on view (`limit=1`); a word under 3 characters matches only whole.
- `scripts/qa/graph3-check.ts`: the whole-word cases, JS and SQL.
- `src/lib/graph/skeleton.ts`: `refreshSkeleton` reads one small row first, then `staleSkeletonDocument` (SQL drift for one document, shared `staleIn` with `staleSkeletonDocuments`); `windowSchema` takes keyed lines; windows bounded per document and per process.
- `src/lib/prompts/skeleton.ts`, `src/lib/derive/config.ts`: the keyed answer form; `SKELETON_WINDOW_CONCURRENCY`, `SKELETON_WINDOWS_IN_FLIGHT`.
- `src/lib/offline/saved.ts`, `public/sw.js` (comment): `?provenance=1` saved only when the bare graph counts provenance links.
- `src/components/icons.tsx`, `src/app/layout.tsx`, `src/components/outline/note-card.tsx`, `note-tile.tsx`: row icons as `<use>` of one sprite (`IconSprite`, `RowIcon`).
- `src/components/graph/graph-overlay.tsx`, `src/components/reader/workspace.tsx`: `preloadGraphView` on hover/focus of Graph, on M, on every open.
- `src/lib/graph/version.ts` (new), `scripts/qa/graph-version-check.ts` (new): the graph version key helper; NOT wired into the route.
- `src/lib/graph/data.ts`: `documentGists` ORDER BY id (a stable body hash).
- `scripts/qa/skeleton-window-check.ts` (new), `scripts/qa/ui-graph-offline.mjs`: checks.
- `SPEC.md` §13, §17, §22.

**Decisions:**
- "Short words": a Latin word query of 2 characters matches only whole words, 3+ at a word start; CJK stays a substring from 2; punctuation-first stays anywhere.
- Bare Find rows load one passage (`limit=1`) when they scroll into view, not ten.
- The sprite holds only the six shapes repeated per row, not every icon (a full sprite would add bytes to every page).
- `refreshSkeleton` keeps the exact JS check after the SQL says stale, so the decision is the same as before.
- COST4-07 left unwired (SAFE4 owns the ETag); the helper's contract is in version.ts.
- Window limits 4 per document and 12 per process.
