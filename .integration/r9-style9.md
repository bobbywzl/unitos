# r9-style9

**Intent:** Round 9 STYLE9: the view audit's VIEW9-01..08, the walk's WALK9-03/04/08 as the coordinator folded them in, REV8-04/05/07 on the Stitch box, and the SPEC wording for all of it; display only, net controls at or below zero.

**Files:**
- `src/app/globals.css`: VIEW9-01, a node with a comment waiting on the account draws its coverage ring in the comment color at a far zoom (`.graph-coverage-ring[data-waits]` under `[data-far]`).
- `src/components/graph/coverage.tsx`: VIEW9-01 (`data-waits` on CoverageRing); VIEW9-05 + WALK9-03 (CoverageHead: "N waiting on you" is a press, `DocumentsListing`; AllComments `waitingOnly` with link rows, `LinkWaitingRow`); WALK9-04 a/c (CommentRow quotes `newest` with its author's badge, open and resolved replies apart); WALK9-08 (Gaps only disabled while a listing shows; the listing's found line); the Links list's `NoReplyToggle` removed; the node card's comments press in the chip's form on a phone.
- `src/components/graph/documents-list.tsx`: VIEW9-04 (row summary order: comments, Not opened, parts in the short form); the `listing` state kept per project; AllComments props; the found line only for the rows.
- `src/components/graph/links-list.tsx`: WALK9-03, the Waiting on you switch and its empty line removed (the coordinator's one allowed edit there).
- `src/components/graph/graph-overlay.tsx`: VIEW9-03 (the first pill counts documents only; no false zeros and Loading… on the canvas while the data loads); VIEW9-06 (no Links or Recommended links pill before the first document).
- `src/components/graph/graph-view.tsx`: VIEW9-02 (curve tone from clay-600); VIEW9-01 (`waits` for CurveMarks from `useWaitsForReply`; the key's replies sample "2?"); VIEW9-07 (the Controls before the canvas in the DOM; hover-card rows not Tab stops).
- `src/components/graph/graph-notes.tsx`: VIEW9-01 (CurveMarks `waits` prop draws "?"); VIEW9-07 (`tabStops` on NodeNotesRows, `tabIndex` on GraphNoteRow).
- `src/components/graph/graph-find.tsx`: VIEW9-08 (focus border clay-600).
- `src/components/graph/stitch-box.tsx`: REV8-05 (folded on kept turns; the last command's words in the head row; the fold button and a send unfold).
- `src/components/assistant/clear-conversation.tsx`: REV8-04 (the touch floor), the audit's one-line diff.
- `src/lib/graph/coverage-view.ts`: the three optional `GraphComment` fields the coordinator wrote (`newest`, `openReplies`, `createdAt`) for LISTS9 to fill; no rule changed.
- `src/lib/i18n/dict/graphCover.ts`: `noReply`, `noReplyTitle`, `noReplyNone` removed; `waitingAllTitle` added (en, zh).
- `src/lib/i18n/dict/graphNotes.ts`, `panes.ts`: the key's replies and far-zoom lines; the header's "{docs} document{ds}".
- `scripts/qa/ui-graph-cover4.mjs`, `scripts/qa/panel6-check.ts`: the checks on the removed switch now check its absence and the head's words.
- `SPEC.md` §13 and §22: the wording for every change above; REV8-07 ("a question and the four commands above").

**Decisions:**
- VIEW9-01 far zoom: the walk's ring in the comment color, not the prototype's chip scaling: it marks every waiting node at rest at 1440 and 390 with no overlap (forty 6 of 6, Linda 3 of 3 at 390); the chip scaling would clutter the forty at zoom 0.21.
- The "?" on a curve is computed in LinkEdge through `useWaitsForReply` and passed to CurveMarks, not from `waitsForReply(l, myId)` inside graph-notes.tsx: LISTS9 makes the hook role-aware, and coverage.tsx importing graph-notes.tsx both ways would be a cycle.
- WALK9-03: two presses in the head ("N open comments", "N waiting on you"), not the prototype's one press holding both counts: each count lists what it names, and a reader with comments and nothing waiting is not sent into a mixed list. The waiting list sorts newest first by `newest.createdAt` (else `createdAt`, else the reply's `createdAt`); rows from an answer without the fields keep the reading order, last; documents by their newest thread. A link goes under its from end when listed, else its to end; one with neither end listed is not listed.
- The waiting rows use `useWaitsForReply` / `useCommentWaits` to decide, and `waitingReply` only to pick the reply to quote; the hooks were not touched (LISTS9's).
- The listing (rows / comments / waiting) is kept per project in a module map like the filter and the scroll, so Back from a link answered returns to the waiting list; a listing whose count fell to none gives the rows back (an effect in CoverageHead).
- WALK9-08: Gaps only is disabled while a listing shows (the brief's first option), and the listing's own found line counts its rows.
- WALK9-04 (b), opening the reader on the Annotations tab with the comment expanded, is in reader-interactions.tsx, not an owned file: left for the integrator, the row's address unchanged.
- REV8-05: the fold button does double duty (folded: unfold; else: the pill); the box re-opens from the pill as it was left, and only a graph open starts folded. A viewer's box never folds its turns (they are all it shows).
- Polish skipped: the link panel title wrapping (link-panel.tsx, not owned: suggest `${TEXT_NAME}` or a two-line clamp in RESULT.md); "1 pending" against the key's "2 •" (the words are clearer than a dot that carries its meaning by color alone).
- `data-graph-coverage-noreply` kept on the waiting press (ui-graph-cover4 reads it); the Links list keeps `[data-graph-links-row]` and the asker's row.
