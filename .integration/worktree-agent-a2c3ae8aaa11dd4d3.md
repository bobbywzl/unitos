**Intent:** fix the graph canvas and overlay layout from the round-1 Stitch/Graph audit (CANVAS package: GR-01–08, 10–14, 16, 17; BOX-03–06, 18, 19; GN-05, 07–10).

**Files:**
- `src/components/graph/graph-layout.ts` (new): a seeded force layout per linked group, groups packed, unlinked documents in a grid; shaped for the pane (wide, square, tall).
- `src/components/graph/graph-view.tsx`: the fit runs through the live helper into the free canvas (insets); labels and pills scale with zoom; link lists are a screen-sized portal beside the curve (a sheet on phones); node card; key (? button); dragged positions in localStorage; keyboard; Escape for canvas things; cited ring; layout cache.
- `src/components/graph/graph-overlay.tsx`: dialog role, focus, Tab trap; Escape from the inside out; header plurals and accepted-only counts; runs left shown as plain text; pills in one scrolling row below 900px; empty cards; places and measures the Stitch box (beside a list ≥1000, folded under a list <1000, folded on first open <640, clear of Feedback 768–1100); wires `onShowRecommended`, `onCited`; `onNavigate` prop.
- `src/components/graph/stitch-box.tsx`: optional `open`/`onOpenChange` (controlled fold) and the two BOX props declared; the root and the pill no longer position themselves.
- `src/components/graph/link-detail.tsx`: `showReason` prop.
- `src/components/graph/generated-list.tsx`: bottom room for the folded pill below 1000px.
- `src/components/reader/workspace.tsx`: the graph in the URL (`graph=1`), so Back reopens it.
- `src/lib/types.ts`, `src/lib/graph/view.ts`, `src/app/n/[notebookId]/page.tsx`: `GraphNode.kind`, `GraphNode.blockCount` (one grouped, read-only count).
- `src/lib/i18n/dict/panes.ts`: graph keys, en and zh (graphHint and graphPickHint removed).
- `src/app/globals.css`: graph label/pill scale, focus ring, coarse-pointer hit path, float-in, reduced motion.
- `SPEC.md` §13; `scripts/qa/graph-layout-check.ts`, `ui-graph-canvas.mjs`, `ui-graph-interact.mjs`, `ui-graph-perf.mjs`.

**Decisions:**
- No d3-force dependency: an in-house deterministic force pass (~20 ms for 40 documents, cached per tab).
- Click on a node still opens the document (GR-15). The card says what a click does, and Back returns to the graph.
- Dragged positions are kept per browser in localStorage, not on the server.
- When nodes do not fit at the least zoom (0.45), the fit shows the top of the layout, where the linked groups are.
- Feedback stays visible. Between 768 and 1100px the box is narrowed so it clears Feedback.
