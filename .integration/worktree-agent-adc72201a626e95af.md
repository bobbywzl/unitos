**Intent:** Round 2 VIEW2: a holistic view of content on the graph — the node card (a click selects), the gist on hover, Find across the project, the last Stitch answer's links lit in place, the mock's distinct gists, and GR-18 (the graph's data loads when the graph opens, offline copy included).

**Files:**
- `src/app/api/notebooks/[notebookId]/graph/route.ts`, `src/lib/graph/data.ts` (new): GR-18, the graph's data on open; recommended links as ids into the edges; the links' people.
- `src/app/api/notebooks/[notebookId]/outline/route.ts`, `src/lib/graph/outline.ts` (new): the node card's outline (skeleton gist + part summaries, else contents, else headings; the part each link end sits in). Raw SQL reads `skeleton->'gist'`/`->'parts'`, never the lines.
- `src/app/api/notebooks/[notebookId]/find/route.ts`, `src/lib/graph/find.ts` (new): Find, word-start / CJK substring, no model.
- `src/components/graph/graph-content.tsx` (new): `CLICK_SELECTS` (decision 2, option A; false = B), the content context, the overlay's state hook (selection, find, proposed links, Ask Stitch prefill), `graphDoc=`/`graphFind=` in the URL.
- `src/components/graph/graph-data.tsx` (new): `GraphOverlayLoader`, fetches the graph route on open and on every rev change, per-tab cache, merges the route's people into the collab context.
- `src/components/graph/node-card.tsx` (new): the pinned card / phone sheet, ← → walk, and `NodeCardExtras` (hover gist + notes lines).
- `src/components/graph/graph-find.tsx` (new): the Find box and the Find list.
- `src/components/graph/graph-overlay.tsx`: `[view2]` blocks — props `gists`/`loading`/`loadFailed`, `"document" | "find"` in `list`, the hook, clearCited also clears proposed links, scanLeft follows the prop, insets for the card/sheet, the Find box in the header, the canvas waits for the data, the card and Find list render, StitchBox `onProposed`/`prefill`, RecommendedLinkList orders and marks the answer's links.
- `src/components/graph/graph-view.tsx`: `[view2]` insertions — imports; DocumentNode find count + fade; LinkEdge violet halo; EdgeLinkList answer's links first + mark; NodeCard gist/notes + hint; GraphKey gestures; GraphCanvas spotlight on the selected node, `activate` selects, `onNodeContextMenu`, no hover card on the selected node.
- `src/components/graph/graph-notes.tsx`: NodeNotes is the chip only; the separate notes hover card is gone (VIEW2-01).
- `src/components/graph/stitch-box.tsx`: props `onProposed`, `prefill` (~15 lines).
- `src/lib/graph/stitch.ts`: collect each created link's id; `linkIds` in the result (3 lines). `src/lib/types.ts`: `StitchResult.linkIds?`.
- `src/components/reader/workspace.tsx`, `src/app/n/[notebookId]/page.tsx`: the `graph` prop and its reads (documentsGraph, listGenerated, linkScanRunsLeft, recommended authors) are gone from the page.
- `src/lib/offline/saved.ts`, `public/sw.js`: the copy keeps the graph and outline routes; the worker serves them network first.
- `src/lib/i18n/dict/graphView.ts` (new namespace, en + zh), `src/lib/i18n/dictionaries.ts`.
- `scripts/qa/mock-kimi.mjs`: distinct skeleton gist/summaries per document (VIEW2-05); `MOCK_KIMI_PORT`.
- `scripts/qa/ui-graph-view.mjs`, `scripts/qa/ui-graph-offline.mjs`, `scripts/qa/graph-outline-check.ts`, `scripts/qa/graph-payload.sh`: checks.
- `SPEC.md` §13 (click rule, card, Find, data on open), §17 (offline copy holds the graph data), §22 (linkIds, proposed links lit).

**Decisions:**
- Decision 2 taken as option A behind `CLICK_SELECTS`; right-click / long press also pins the card (that is option B's way in, live in both).
- Space on a focused node still picks (existing gesture kept); Enter selects, Enter on the selected node opens.
- → walks to the most linked document not just come from, ← walks back (a trail), rather than a fixed next/previous order.
- A link row in the card opens the reader at the link (not pinning the curve: pinning lives inside graph-view).
- Notes "+ N more" expands in place rather than opening the Notes list.
- The canvas waits for the graph route before drawing (no re-layout when the edges land); a per-tab cache draws a reopen at once.
- The overlay refetches on the page's `rev` prop (every mutation already bumps the rev and refreshes the page), so no new refresh hook.
- Find's Ask Stitch adds the question after words already in the box, never over them.
- Skipped P3.4 (cited passages in the card): needs the `onCited` contract in stitch-box (PR #23 territory).
