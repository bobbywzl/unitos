**Intent:** Package NOTES of the Stitch + Graph round: replies on links, notes on the nodes and between them, Note on this link, and a Notes list beside the graph's canvas (audit graph-notes.md, packages 1, 2, 3a, 4; findings GN-02, GN-03).

**Files:**
- `src/lib/graph/notes.ts` (new): `notesOnGraph`, `pairKey`, `noteLine` — the notes on the graph, computed from the workspace's outline on the client.
- `src/lib/graph/view.ts`: `withLinkReplies`, a separate query for each edge link's replies and author; `documentsGraph`'s return line calls it. Nothing else in the file changed.
- `src/lib/types.ts`: `GraphEdgeLink.replies?` and `createdById?`.
- `src/app/api/notes/route.ts`: `fromLinkId` (the reader's words, accepted, the link's two ends as sources, `documentId` null).
- `src/components/graph/graph-notes.tsx` (new): context and provider, node chip and card, pair notes, curve marks, the note-only curve.
- `src/components/graph/link-replies.tsx`, `link-note-composer.tsx`, `graph-notes-list.tsx` (new).
- `src/components/graph/graph-view.tsx`, `graph-overlay.tsx`: small insertions marked `[graph-notes]`.
- `src/components/reader/workspace.tsx`: passes `notes` to `GraphOverlay`.
- `src/lib/i18n/dict/graphNotes.ts` (new namespace), `src/lib/i18n/dictionaries.ts` (registers it).
- `SPEC.md` §13: four paragraphs after the Graph paragraph.
- `scripts/qa/ui-graph-notes.mjs`, `scripts/qa/graph-notes-check.ts` (new).

**Decisions:**
- The edge links' replies come from a second query in `withLinkReplies`, not from the link query, so the DATA worker's project-scope change to that query merges cleanly. The fields are optional on `GraphEdgeLink` for the same reason.
- `GraphCanvas`'s node refresh keeps each node's measured size. Without it every `router.refresh()` unmounted the curves (reactflow hides an edge whose node has no size), which closed an expanded link and lost the "Note saved" line and any reply being typed.
- Pair notes count pending notes too (a pending note is still a connection the reader can see); node chips count accepted notes and show pending ones as a dot.
- A note on a link has `documentId` null (the project's note), per the audit's design; the tray lists it under both documents through its sources.
- Package 5 (drop a note onto a curve) was not built.
