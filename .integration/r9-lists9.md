# r9-lists9

**Intent:** Round 9 LISTS package of the Stitch and graph loop: one waiting rule for the graph's reply marks (WALK9-01, WALK9-02, WALK9-09, REV9-04), a comment's address opens the Annotations tab (WALK9-04 b), a document shown five seconds counts as opened (WALK9-05), "new since your last visit" on the existing mark (WALK9-06), the curve step keeps a removed link's slot (WALK9-07), and Note on this link fills the new note instead of its own composer (WALK9-10).

**Files:**
- `src/lib/graph/coverage-view.ts` — `commentWaits` and `waitingReply` read the newest reply only: resolved → nobody waits; the newest words by this account → nobody; by an account outside the project (`members`) → nobody. `GraphComment` gains the STYLE9 contract fields `newest`, `openReplies`, `createdAt`, all optional; `commentWaits` reads `newest` when present and falls back to `lastById`.
- `src/lib/graph/coverage.ts` — the coverage answer carries `members` (the owner and the collaborators by email); the comment query joins the newest reply (`LEFT JOIN LATERAL`) and counts open replies; `lastById` is null when the deciding account is outside the project.
- `src/components/graph/coverage.tsx` — `useMembers`, `useWaitsForReply`, `useCommentWaits` gate on `canEdit` and `members`; the node comment chip draws the new-since-visit dot (`useNewComments`).
- `src/components/collab/reply-thread.tsx`, `src/components/collab/history-control.tsx`, `src/lib/i18n/dict/common.ts` — "Former collaborator" / "前协作者" in place of "?" for an account no longer in the project.
- `src/components/reader/reader-interactions.tsx` — `?annotation=<id>&kind=comment` dispatches `dissect:focus-annotation` (Annotations tab, comment expanded); the open is deferred one tick so the listeners of later effects hear it. The account's reading position is saved once after `ACCOUNT_SAVE_SHOWN_MS` when the first block is in view and the document had no account copy.
- `src/lib/reading-position.ts` — `ACCOUNT_SAVE_SHOWN_MS` and `firstBlockShown`.
- `src/components/graph/link-replies.tsx` — the seen store keeps per-comment marks (`comments`); pure `newReplies`, `newLink`, `newComment`; hooks `useNewLink`, `useNewComment`, `useNewComments`, `useNewCount`, `useMarkCommentSeen`; a link's thread marks the link seen by max(reply createdAt, link createdAt).
- `src/components/graph/graph-notes.tsx` — `CurveMarks` draws the dot for a new link when the curve has no open reply.
- `src/lib/types.ts`, `src/lib/graph/view.ts` — `GraphEdgeLink.createdAt` (optional, additive) on the edge.
- `src/components/graph/graph-overlay.tsx` — `openCurveLinks` keeps the removed link in its slot (accepted first, oldest first) while its Undo line shows; `NoteOnLink` in the curve's rows.
- `src/components/graph/link-note-composer.tsx` — rewritten: `useNoteOnLink` puts the link's two passages into the gather dock (opened, focus in the words box) and carries a leftover link-note draft into it; `NoteOnLink` is the button.
- `src/components/graph/link-panel.tsx` — Note on this link calls `useNoteOnLink`; the panel's own composer is gone.
- `src/components/graph/note-gather.tsx` — `GatherValue.add(quotes, carry?)`; Save sends `fromLinkId` when the two quotes are the ends of one link and words exist, else `quotes`.
- `src/lib/note-drafts.ts` — `GatherDraftQuote.linkId`, kept by the parser.
- `src/lib/i18n/dict/graphCover.ts`, `src/lib/i18n/dict/graphNotes.ts` — the waiting titles reworded to the newest-reply rule; the new-since-visit titles and counts (en, zh); the link-note composer strings removed, `noteOnLinkTitle` added.
- `SPEC.md` §13 — the waiting rule, the new-since-visit mark, and Note on this link through the dock.
- `scripts/qa/layer5-check.ts` — W1–W6 and REV9-04 cases of the waiting rule, and the Linda SQL block on the newest-reply rule.
- `scripts/qa/ui-link-remove.mjs`, `ui-graph-lists4.mjs`, `ui-graph-ui5.mjs`, `ui-graph-safe.mjs`, `ui-link-drop.mjs`, `ui-graph-notes.mjs`, `ui-graph-style7.mjs` — Note on this link steps read the dock's selectors.

**Decisions:**
- The waiting rule has one source: the newest reply decides, and nothing waits on an account that cannot reply or on words by an account outside the project. The server's `lastById` keeps its shape for older clients, and the client's hooks gate on `canEdit` and `members`; `commentWaits` keeps working on an answer without `newest` (an older server during a deploy).
- The STYLE9 contract fields are optional and filled by this branch's server; the fallback to `lastById` stays so the two branches merge in either order.
- WALK9-05 writes the account's copy once, through the existing `saveAccountPosition` and its `WHERE at < EXCLUDED.at` upsert: no migration, the tab's copy and how a document opens are unchanged.
- "New since your last visit" reuses the seen store's key and `since`; a recommended link, a provenance link, and a link with no author are never new. The head's "· N new" and "new rows first" are STYLE9's lines (`useNewCount`, `useNewComments`, `useMarkCommentSeen` are exported for them); the dot on the node chip and the curve are here.
- The removed link's slot is computed from the edge's order (recommended asc, createdAt asc), with no ref: the Undo line is the only state.
- Note on this link keeps the server path (`fromLinkId`) only when the dock holds exactly the two ends of one link with words; any other content saves as quotes. A leftover link-note draft (`graph-link-note:*`, including a refused replay's words) is carried into the dock when the link opens, then cleared, so no typed words are lost.
- Existing data touched: none deleted or rewritten. `ReadingPosition` gains rows only through the existing upsert; the seen store and the gather draft are per-browser conveniences; `DocLink`, `Reply`, `Note`, and `Source` rows are read, never changed by these commits.
