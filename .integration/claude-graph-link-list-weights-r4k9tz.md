# claude/graph-link-list-weights-r4k9tz

**Intent:** In the graph, a pair's curve shows how many links hold it — wider and deeper clay with every link — and hovering or pinning the curve lists those links, each with its description and quotes, each opening the reader on that link.

**Files:**
- `src/lib/types.ts` — `GraphEdgeLink` (id, both document ids, both quotes, the description, recommended) and `GraphEdge.links`.
- `src/app/n/[notebookId]/page.tsx` — the graph's link query selects the fields the list shows, accepted links first then oldest first, and each pair's edge carries its links.
- `src/components/graph/graph-view.tsx` — `edgeTone(depth)`: the curve's clay mixes from clay-400 (one link) to clay-900 (eight or more); the stroke is a gradient along the curve, deepest at the middle; width runs 1.6 to 8 px on the same scale. Hovering a curve, or clicking it to pin, renders the pair's link list in reactflow's label layer at the curve's midpoint: the count, then one row per link — the description (or the from quote when there is none), the quotes cut at a word boundary, a Recommended mark — each row `router.push` to `/n/<id>?doc=<from>&link=<id>`. The spotlight's clear waits 160 ms so the pointer can cross from the curve into the list; the list's own hover cancels it; a pinned curve keeps its pair lit; a click on the pane unpins.
- `src/lib/i18n/dict/panes.ts` — `graphPairLinkOne`, `graphPairLinks`, `graphOpenLink`, `graphLinkRecommended`; `graphHint` says a deeper line means more links and that a line lists them, en and zh.
- `SPEC.md` §13 — the Graph paragraph.

**Decisions:**
- Depth and width both scale with the count, on one scale (1 → 8+ links), so a bold curve reads as bold at any zoom: width alone flattens when zoomed out, color alone when zoomed in. The gradient is along the chord, deepest at the middle, so a heavy curve reads as a weighted band rather than a flat stroke.
- A link opens the reader on its from end (`?doc=<from>&link=<id>`), the jump every other link surface uses (the Annotations tab, the reader's link chips, the Recommended links list); "the links page" was read as that reader position, since it flashes the exact mark. A recommended link paints no mark yet, so it lands on the document with the link marked Recommended in the list.
- The list is pinned by a click, not only shown on hover, so touch readers and a slow pointer can reach the rows; hover alone would close it on the way there.
- Verified: `eslint`, `next build`. Not verified in a browser: no pgvector Postgres in this environment, so the canvas was not rendered with real links.
