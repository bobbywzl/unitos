# r10-lists10

**Intent:** Round 10 LISTS10: the comment's door keeps the reading position and opens one card (WALK10-05, WALK10-02), a collaborator's new note is new on the graph and the new rows sit together (WALK10-01, WALK10-07, REV10-05, walk §5.5), and `?annotation=` with a wrong or foreign id was probed (REV10-12, no change needed).

**Files:**
- `src/components/reader/reader-interactions.tsx` — after a URL jump (`?src`, `?block`, `?link`, `?annotation`) the account's reading position waits for the reader's own scroll, wheel, touch, pointer press, or scroll key (`accountWaitsForReader`); the comment's door (`kind=comment`) swallows the one `dissect:open-annotation` event it caused (`doorRef`), so only the Annotations tab's card opens and no on-mark card or side card draws over the article.
- `src/components/graph/link-replies.tsx` — the seen store gains `notes` marks (`markNoteSeen`, `useMarkNoteSeen`, `useNewNotes`, `useNewLinks`); `newReplies` is 0 when the newest reply is the account's own; `usePruneLinkSeen` prunes note marks and moves `since` forward to the 90-day cutoff; `useNewCount` takes the notes and counts the new ones.
- `src/components/graph/coverage.tsx` — `CoverageHead` passes `useGraphNotes()?.every` to `useNewCount`; `ListingRow.fresh`; `freshFirst` orders the comments listing's and the waiting list's groups: those with a new row first, by their newest new row, the rest stable.
- `src/components/graph/graph-notes.tsx` — the node's notes chip draws one 6 px dot in the comment color when a note of the node is new (`data-graph-node-notes-new`).
- `src/components/graph/graph-notes-list.tsx` — the Notes list puts new notes first, shows a new single-document note in the default view while new (`newAtOpen` keeps its place for the visit once pressed), draws the dot on the row (`data-graph-notes-new`), and the row's expand and Open in notes mark the note looked at.
- `src/lib/i18n/dict/graphCover.ts` — `newSinceVisitTitle` names notes (en, zh).
- `src/lib/i18n/dict/graphNotes.ts` — `newNoteTitle` (en, zh), the dot's label.
- `SPEC.md` — §13: the reading position after a jump (line ~346), the comment's door (line ~753), the "New since your last visit" paragraph (line ~755).

**Decisions:**
- The account's copy waits after every URL jump, not only the comment's door: a document opened by `?src` or `?block` and left without a scroll keeps the account's old position (or stays "not opened"); the tab's copy still follows the jump. The 5 s first-screen rule still applies once the reader moved.
- Only an ACCEPTED note another person wrote counts as new, by `createdAt`; a pending note is a proposal and an edit moves nothing.
- The new-note dot is in the comment color like the other new marks, not clay (the pending dot on the notes chip is clay).
- `since` moves forward at the prune to the cutoff and never back (REV10-05), instead of keeping the dropped marks.
- `useNewCount` takes the notes as a third parameter from `CoverageHead` (two lines) rather than reading the notes context inside link-replies.tsx, which would make an import cycle.
- A thread whose newest reply is the account's own is not new wherever it was answered (WALK10-07), instead of marking the link seen on the reader's reply.
- REV10-12: a wrong id, a wrong source, a foreign project's ids, or no `kind` open the document with the tab current, no card, no failed request, and no error page, so no check was added.
- The test reply row used for WALK10-07 (`lists10-r-l2-linda`) was removed from my DB copy after the check; nothing of it is in the branch.
