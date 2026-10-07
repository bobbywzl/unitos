# r3-graph3

**Intent:** Round 3 graph fixes in the canvas and overlay: the node card counts what the canvas draws and opens links in the side panel, curve marks sit above and off the nodes, Find adds to the picks, keys and focus, header pills that fit, touch, generated documents, the card's walk keys, stale data, and Find on punctuation (WALK3-02/04/06/07/08/09/10/11/12/13/14/15/17, VIEW3-01, VIEW3-03, REV3-09/10/11).

**Files:**
- `src/components/graph/node-card.tsx`: links grouped as the canvas draws them (provenance only with the switch on); `linkLine` "N links · M recommended"; a link row opens the link panel and shows its reply count; generated-document block; ← → say when there is nothing to walk and ignore modified keys; no key hints on touch; outline refetches with the data.
- `src/components/graph/graph-view.tsx`: curve marks in reactflow's label layer, placed together by `placeMarks`; provenance state from the content context; generated labels and aria-labels; duplicate generated titles take their command's first words; touch skips hover cards.
- `src/components/graph/graph-notes.tsx`: `CurveMarks` as HTML (`data-curve-marks`, `data-graph-curve-mark`, `[data-n]`), `MarkPlacesContext`; reply mark in the comment kind color.
- `src/lib/graph/curve-place.ts` (new): node rooms and greedy mark placement.
- `src/components/graph/graph-overlay.tsx`: pills reordered and shortened below 1400px with a scroll fade; `aria-controls`; focus into a list and back to its opener; link panel Back to the Links list or the card; stale notice with Try again; provenance in the content context; Find picks as a union.
- `src/components/graph/graph-content.tsx`, `graph-keep.ts`: context fields (`showProvenance`, `generatedCommands`, `openLinkFromCard`, `recommendedLinkIds`), `useCoarsePointer`; the keep gains `provenance`.
- `src/components/graph/graph-data.tsx`: keeps the time of the last load; 403/404 drops the data; passes `stale`.
- `src/components/graph/graph-find.tsx`, `src/lib/graph/find.ts`: union picks, Ask label with picks, generated documents last and only with provenance on; narrower boxes on small screens; `\m` only when the query starts with a letter or digit.
- `src/components/graph/links-list.tsx`, `link-panel.tsx`, `generated-list.tsx`, `graph-notes-list.tsx`: Links filter; Back label; labelled provenance switch; focus attributes; 96px foot padding clear of Feedback.
- `src/components/graph/stitch-box.tsx`: singular "1 document picked"; Tap wording on touch; the answer line says proposed links were reviewed.
- `src/components/reader/workspace.tsx`: M opens the graph (`aria-keyshortcuts`).
- `src/app/globals.css`: label layer z-index, mark spotlight and settling, `text-wrap: balance` on labels, pill-row fade.
- `src/lib/i18n/dict/{graphView,panes,stitch}.ts`: en and zh strings.
- `scripts/qa/graph3-check.ts` (new), `scripts/qa/ui-graph-notes.mjs`: checks; marks locator follows the HTML marks.
- `SPEC.md` §13.

**Decisions:**
- The shortcut is M, not G: G, J, K and E belong to the pending queue (`use-outline.ts`), which swallows G.
- Pick these takes a union like Ask Stitch, so both Find buttons behave the same.
- Below 1400px only the last four pills drop to mark and count; Find, Notes and Links keep their labels.
- Feedback stays where it is; the side lists end 96px clear of it instead.
- Marks are placed by a greedy pass over estimated node rooms (text width by letter class), not by measuring the DOM, so placement is pure and checkable.
- WALK3-16 (Stitch drafts) skipped: the brief rules out drafts for the Stitch box.
