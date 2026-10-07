# r3-notes3

**Intent:** Make the graph intertwine with notes and the reader (WALK3-01, WALK3-03, VIEW3-02, VIEW3-04, VIEW3-05, VIEW3-09): notes on a link are found where they were written, a note can be shown on the graph, and a link's replies show in the reader.

**Files:**
- `src/lib/source-mark.ts` (new): `sourceIdsAttr` and `sourceMarkSelector`; every anchor over a mark's words rides in `data-source-ids`.
- `src/components/reader/block-view.tsx`: marks carry `data-source-ids`; the chain icon counts a link's open replies (`linkReplies`).
- `src/components/reader/table-marks.ts`, `src/components/docs/annotation-marks.tsx`: the same `data-source-ids`; the page editor's chain counts replies; its flash finds pieces by either attribute.
- `src/components/docs/layer/comment-card.tsx`, `src/components/docs/suggest/layer.tsx`: comment lookups use `sourceMarkSelector`.
- `src/components/reader/reader-interactions.tsx`: source lookups use `sourceMarkSelector`; `linksByBlock` takes `replies`; `?link=` arrival dispatches `dissect:focus-link`.
- `src/app/n/[notebookId]/page.tsx`: each link view carries its open reply count (from the replies it already reads).
- `src/components/reader/workspace.tsx`: `GraphFocus` state; `openGraph(focus?)`; the rail passes the reader's `?link=`; `dissect:open-graph` and `?graphNote=` open the graph on a note; `dissect:focus-link` turns the tray to Annotations on the link card.
- `src/components/graph/graph-keep.ts`: `GraphFocus`, `requestGraph`, `OPEN_GRAPH_EVENT`, `GRAPH_NOTE_PARAM`, `shownId` in the keep.
- `src/components/graph/graph-overlay.tsx`: `focus` prop decides the first list and link; `shownNoteId`; the link panel's Back goes to Links or Notes.
- `src/components/graph/graph-notes.tsx`: `LinkNotes`; `every` (unfiltered notes); `setFocusLit`.
- `src/components/graph/graph-notes-list.tsx`: the shown note first, its documents lit, the links between them; the one-document line with Show them and the notes full page link.
- `src/components/graph/link-panel.tsx`: `LinkNotes`, `backLabel`.
- `src/components/graph/graph-view.tsx`: the spotlight looks for undrawn nodes for a few frames.
- `src/components/outline/note-card.tsx`: Show on graph in the footer.
- `src/components/panels/annotations-panel.tsx`: link cards get `data-annotation-link-id` and Show on graph.
- `src/lib/graph/notes.ts`: `notesOnLink`.
- `src/lib/i18n/dict/graphNotes.ts`: en and zh strings.
- `SPEC.md` §5 (marks over the same words), §13 (link panel notes, focus opens, reader replies, Notes list).
- `scripts/qa/ui-graph-notes3.mjs` (new), `scripts/qa/graph-notes-check.ts` (notesOnLink cases).

**Decisions:**
- WALK3-01: fixed generally (all covering anchor ids on the mark) rather than a block/offset fallback in `flashSource`; one mark per span stays, so nothing repaints differently.
- WALK3-03: "notes on this link" = notes with a quote at each end (quote overlap or inside the end's block), not every note quoting both documents; the curve's list keeps the pair-wide "Notes quoting both".
- Notes quoting one document stay folded under the count line in the default Notes list, with Show them (in place) and a notes full page link, so the list stays a lens on connections first and every note is one click away; Show on graph reaches a one-document note directly.
- A single-document shown note lists its document's links ("Links of this document"); two or more list the links between them.
- `?link=` arrival turns only the tray's tab (no forced unfold, no phone sheet, no split-strip scroll). Linda may still be asked about this default.
- The notes full page's Show on graph goes to `/n/<id>?graph=1&graphNote=` (the workspace opens the graph; ✕ leaves the reader, browser Back returns to the full page).
- Reply counts ride on the page's link views (no new query: replies were already loaded).
