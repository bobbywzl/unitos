# r7-style7

**Intent:** Give the graph's controls one look per action (VIEW7-01..07, 10, 11) and bring the last small touch targets to the floor (WALK7-10), without adding or removing a control.

**Files:**
- `src/components/graph/graph-ui.ts` (new): the one style set: ACTION, ACTION_ON, ACTION_NOTE(_IN), ACTION_DANGER, ACTION_ACCEPT, LEAD(_PRIMARY), DOC_CHIP, SECTION_HEAD, HEAD_PLAIN, CLOSE, TEXT_HIT.
- `link-panel.tsx`: Remove red (VIEW7-01), shared shapes, 16 px title as an h2 (VIEW7-04), Undo a 24/44 px pill (WALK7-10).
- `graph-overlay.tsx`: header counts drawn as a pill (VIEW7-06); Scan, Accept, Dismiss, the recommended chip and ✕ on the shared shapes.
- `graph-view.tsx`: curve list Accept/Dismiss, key heads and ✕ (now with a tooltip), zoom stack `data-tip` in place of `title`.
- `node-card.tsx`, `graph-find.tsx`, `link-detail.tsx`, `links-list.tsx`, `coverage.tsx`, `generated-list.tsx`, `stitch-passage-card.tsx`, `note-gather.tsx`, `link-note-composer.tsx`, `graph-notes.tsx`: shared shapes, chip, heads, ✕; the new note's Save/Discard (WALK7-10).
- `documents-list.tsx`: a shut row's padding moves onto its button (VIEW7-07); the generated mark keeps its place; text links' hit areas.
- `graph-notes-list.tsx`: Open in notes on the first row at rest (VIEW7-11); row actions on the shared shapes.
- `stitch-box.tsx`: three class strings (Pick documents, a picked chip, Clear) get the touch floor.
- `assistant/save-as-note.tsx`, `rating-buttons.tsx`: Save as note 24/44 px; the thumbs a 24 px hit area (40 under a finger) drawn in 16 px of the row. These are shared with the reader.
- `panels/annotations-panel.tsx`: the reader's link card draws Show on graph, Remove and Undo in the graph's shapes (VIEW7-05).
- `tooltip.tsx`: after a press, no bubble until the pointer moves (VIEW7-10).
- `SPEC.md` §13: one look per action; Open in notes on the first row.
- `scripts/qa/ui-graph-style7.mjs` (new check); `scripts/qa/ui-graph-chrome6.mjs`: VIEW6-06 reads the second row, VIEW7-11 the first.

**Decisions:**
- A row action is 44 px under a finger (round 6's link panel size, asserted by ui-link-remove), not the prototype's 40; ✕ and lead buttons 40; a document chip 32.
- Text links inside a line (Show them, Notes full page, Turn it on, N more) grow their hit area with padding and a matching negative margin, so lines keep their height.
- Reply in the reader stays the reply thread's own look: `ReplyThread` also serves notes and edits.
- Sage stays on canvas marks and section group names; text heads are sand-600 like every other head.
- VIEW7-08 (four text sizes) not built: it rewrites many lines in files LISTS7 restructures this round.
