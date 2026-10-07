# r5-ui5

**Intent:** Graph navigation, keyboard and screen reader, and phone: WALK5-09, WALK5-04, WALK5-05 + VIEW5-10, WALK5-11, WALK5-13/14/15, COST5-10. Linda's round 5 direction applies (denser, add nothing new to the screen).

**Files:**
- `src/components/graph/graph-keep.ts`: `linkFrom` kept with the view (WALK5-04).
- `src/components/graph/graph-overlay.tsx`: `[ui5]` blocks: `linkFromValue`, the kept linkFrom; `showHere` (VIEW5-10) passed to `GraphNotesProvider` as `onShowHere`, `key={showTurn}` on `GraphNotesList`; the status line (`data-graph-status`, sr-only) for picks and cards (WALK5-09).
- `src/components/graph/graph-view.tsx`: `[ui5]` blocks: `aria-pressed` on nodes in `applyRoving` + an effect on `selectedIds`; `foldGenerated` (phone, switch off: generated nodes `hidden`, left out of `fitTo`, refit on change).
- `src/components/graph/graph-notes.tsx`: `showSaved` on the context, `onShowHere` prop; the no-document branch of `showNote` uses `history.pushState`; notes chip `whitespace-nowrap`.
- `src/components/graph/stitch-box.tsx`: the blocked line is an always-mounted `role=status`, `aria-describedby` from the textarea, a blocked Enter re-says it; Save as note's Show calls `showSaved`. No storage or turn shape change.
- `src/components/graph/note-gather.tsx`, `link-note-composer.tsx`, `saved-line.ts` (new), `assistant/save-as-note.tsx`: one saved line at a time (WALK5-14); Show → `showSaved`.
- `src/components/graph/link-draft-tag.tsx` (new), `links-list.tsx`, `node-card.tsx`, `panels/annotations-panel.tsx`, `lib/note-drafts.ts` (`hasLinkDraft`, read only): the draft dot (WALK5-13).
- `src/components/collab/reply-thread.tsx`: 24 px hit areas on a fine pointer, row height kept (WALK5-15).
- `src/components/graph/graph-layout.ts`: flat-array force pass and `separate`, bit-identical output (COST5-10).
- `src/lib/i18n/dict/graphView.ts`, `graphNotes.ts`: en + zh strings in `[ui5]` blocks.
- `SPEC.md` §13 and §22: Show on the graph, kept linkFrom, pick status and aria-pressed, the phone fold, the draft dot, the blocked line.
- `scripts/qa/ui-graph-ui5.mjs` (new); `ui-graph-safe.mjs` and `ui-graph-notes.mjs`: Show now stays on the graph; Open in notes leaves it; wait for the URL instead of 800 ms.

**Decisions:**
- Show stays on the graph for the three "saved" lines only; the Notes list's Open in notes and the node card's note row still open the reader (the way out).
- Native pushState only where the document does not change (a note on no document). With `?doc=` the server must render the reader: a native push there left Back on a URL the reader did not draw (tested), so it stays `router.push`.
- Phone fold: no chip (Linda: add nothing new); generated documents are reached by the header count, Generated content and the provenance switch.
- Draft mark is a 6 px clay dot after the link's reason (Linda), not a label.
- WALK5-14's "stale Saved status" is the reader header's SaveIndicator behind the aria-modal graph: not changed (SPEC §6 behaviour).
- WALK5-09's "coverage in the node's name" left to LAYER5 (coverage layer).
- COST5-10: only the layout was cut (bit-identical); the two-commit node draw was not built (graph-view shared with LAYER5, and the box was not quiet enough to judge it).
