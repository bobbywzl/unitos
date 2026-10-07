# r2-graph2 (round 2, GRAPH2)

**Intent:** make the graph work at 100 documents, by keyboard, with a screen reader, and on a phone, and keep generated documents and their provenance links apart from the reader's own links.

**Files:**
- src/lib/graph/provenance.ts: new. `isProvenanceLink` tells a generated document's provenance link from a reader's link.
- src/lib/graph/view.ts, src/lib/types.ts: an edge counts provenance links in `provenance`, not in `accepted`; a link carries `provenance: true`.
- src/app/n/[notebookId]/page.tsx: a provenance link paints no mark on its source document. It still lists in the Annotations tab.
- src/components/graph/graph-layout.ts: generated documents sit in a row apart; `extendLayout` places new documents without moving old ones.
- src/components/graph/graph-view.tsx: spotlight by DOM attributes, large mode (plain curves, label LOD, only visible elements), one card per node (notes rows inside), roving tabindex, arrows, `]` `[`, Esc order, aria names with plurals, zoom buttons, provenance toggle, layout kept in localStorage.
- src/components/graph/graph-overlay.tsx: Links list, link side panel, Back restore (graph-keep), skip links, header counts, Stitch slot capped at 45%.
- src/components/graph/links-list.tsx, link-panel.tsx, graph-keep.ts: new.
- src/components/graph/graph-notes.tsx, graph-notes-list.tsx: lit state in its own context; NodeNotes is the chip, NodeNotesRows go in the node card; section and open note kept for Back.
- src/components/graph/stitch-box.tsx: class and attribute lines only (`max-h-full min-h-0`, `role="log" aria-live="polite"`).
- src/components/graph/generated-list.tsx: dates in the UI language.
- src/app/globals.css: graph resting, spotlight, large, LOD, coarse-pointer, focus styles.
- src/lib/i18n/dict/panes.ts, graphNotes.ts: new keys, en and zh.
- SPEC.md §13, §22: behavior above.
- scripts/qa/ui-graph-scale.mjs, ui-graph-r2.mjs: measurements and checks.

**Decisions:**
- A link opens in a side panel at full height, not expanded in place. Round 1's ui-graph-interact "expanded link 400px wide" checks now fail by design.
- Large mode starts at more than 60 nodes or 120 curves; it drops the global dim and the march.
- Provenance links are hidden by default, shown with the toggle; the predicate is shape-based (from a generated document, reason null, offset 0, empty prefix and suffix), no new column.
- Node click behavior is untouched (VIEW2 owns click to select).
