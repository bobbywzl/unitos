# r8-lists8

**Intent:** Round 8 LISTS8: give the graph's lists Linda's holistic view across documents (one "waiting on you" rule for links and comments, every open comment in one press with its author, whole titles, links first on the node card, "1 of 2" on a multi-link curve's panel) without adding net controls.

**Files:**
- `src/lib/graph/coverage-view.ts`: `GraphComment` gains `authorId` and `lastById`; `commentWaits` replaces `commentAsks` (WALK8-01).
- `src/lib/graph/coverage.ts`: the comments query reads `Note.createdById` and the last open reply's `userId` (read only).
- `src/components/graph/coverage.tsx`: head counts links + comments waiting, its "N open comments" press, `AllComments`, the row's count is text, `WaitsMark`, author badge on `CommentRow`, "1 resolved comment" (WALK8-01/02/11).
- `src/components/graph/documents-list.tsx`: one head row (name, filter, ✕), the counts line, the all-comments view, opened rows list their comments, shut rows drop links/notes counts and wrap instead of cutting titles (WALK8-02/03).
- `src/components/graph/list-name.tsx`: optional `tip`.
- `src/components/graph/graph-ui.ts`: `LIST_HEAD` (sticky head row, WALK8-09).
- `src/components/graph/{links-list,generated-list,graph-notes-list}.tsx`, `graph-overlay.tsx` (Recommended head): `LIST_HEAD` on the head row; links-list filter reads replies (WALK8-08).
- `src/components/graph/graph-overlay.tsx`: Links filter seeded only when the card's document has an accepted link (WALK8-04); `openCurveLinks` + `onStep` to the link panel (WALK8-05); `findWords` to the gather dock (WALK7-13).
- `src/components/graph/link-panel.tsx`: "1 of 2" with ‹ › in the head row on a multi-link curve.
- `src/components/graph/graph-view.tsx`: first Esc after a node click closes the card (WALK8-04); `freezeHover` in `expandLink` (WALK8-05); `touchInput` from `(pointer: coarse)` (WALK8-10); hollow not-opened dot, and the key's document row explains the ring and the hollow dot (WALK8-07); `nodeCommentsWidth(c, myId)`.
- `src/components/graph/node-card.tsx`: LINKS, NOTES, then CONTENTS (WALK8-06).
- `src/components/graph/note-gather.tsx`: chip text around Find's words (WALK7-13; draft shape unchanged).
- `src/lib/i18n/dict/{graphCover,panes}.ts`: en + zh strings.
- `scripts/qa/layer5-check.ts`: `commentWaits` cases; SQL cross-check of `lastById`.
- `scripts/qa/ui-graph-documents.mjs`, `ui-graph-lists4.mjs`: follow the moved order phrase and the dropped links count.
- `SPEC.md` §13.

**Decisions:**
- The per-row "N open comments" toggle became text and an opened row lists its comments directly, so the head's new press does not raise controls across the H2 path (shut view +1, each opened row with comments −1).
- A comment with no reply written by another person waits on you (the comment is its last open word); a link with no reply still waits on no one (WALK7-04 unchanged).
- The "?" glyph stays; its meaning and tooltip changed to "Waiting on you".
- Shut Documents rows stay one line (VIEW6-04): the title keeps up to 75% of the row, the counts truncate first (whole in their tooltip).
- The documents/links/notes counts and the order moved to the list name's tooltip.
- The curve step wraps (‹ on the first goes to the last).
- WALK7-11 skipped (layout of 40 nodes at 390 px is graph-layout's, not lists'); WALK8-07's far-zoom waiting dot skipped.
