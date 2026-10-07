# r5-safe5

**Intent:** Data safety for round 5: Remove hides links and never deletes them, with Undo and Restore (WALK5-01, WALK5-08); an older tab's Remove guesses no project (REV5-01); SPEC conflict blocks resolved, with a check (REV5-02, VIEW5-11); Note on this link's Cancel keeps the words (WALK5-02); an offline gathered note keeps the reader's words on replay (REV5-06).

**Files:**
- `src/app/api/links/[linkId]/route.ts`: DELETE hides an accepted link and never deletes it. With no project named, a link that must stay answers 409. The meta keeps hiddenIn, the reason and toQuotedText. The answer returns `{ ok, hidden, editId }`.
- `src/app/api/links/[linkId]/hidden/route.ts` (new): DELETE `?notebookId=` removes that project's hide row. An editor or the owner can do it. It records a LINK_ADD with meta.restored.
- `src/lib/collab.ts`: linkHideProjects doc; withoutOtherProjectLinkEdits honours meta.hiddenIn.
- `src/app/n/[notebookId]/page.tsx`, `src/lib/types.ts` (HistoryEntry.restoreLinkId, restored), `src/components/collab/history-control.tsx` (Restore on the row; new `notebookId` prop), `src/components/reader/workspace.tsx` (passes it).
- `src/components/panels/annotations-panel.tsx`: Undo in the existing message line; passes the maker to the confirm.
- `src/components/collab/confirm-link-removal.ts`: an optional `madeBy` argument; the confirm names the maker.
- `src/components/graph/link-note-composer.tsx`: Cancel keeps the draft; 44 px buttons, 12 px apart, on touch.
- `src/lib/anchors/note-quotes.ts` (resolveNoteQuotesKeeping), `src/app/api/notes/route.ts`, `src/lib/constants.ts` (REPLAY_HEADER, QUOTES_KEPT_HEADER), `src/lib/offline/queue.ts` (marks replays, counts kept quotes), `src/components/offline-status.tsx` (says so in the pill).
- i18n: panes, panels, graphNotes, common (en and zh).
- SPEC.md: §12 and §13 conflict blocks resolved; §13 Remove, Restore and Cancel; §17 replay.
- `scripts/qa/conflict-marker-check.mjs` (`npm run check:conflicts`), `scripts/qa/link-remove-check.ts`, `scripts/qa/gather-replay-check.mjs`, `scripts/qa/ui-link-remove.mjs`, and `scripts/qa/link-scope-check.ts` (section 4 now expects 409 from an older tab).

**Decisions:**
- Dismiss on a recommended link that nobody else replied on, and that no other account's project shows, still deletes the row. It is an AI proposal the reader never took, and deleting it lets a later scan propose it again.
- Undo of a just-made link in the reader (reader-interactions undo stack) goes through the same DELETE, so it now hides the link and does not delete it. History lists that link as removed, with Restore.
- An older tab's removal of a link that no other account needs is hidden in every project of that one account that the caller edits. Before this change it was deleted.
- REV5-06 is handled on the server and applies only to replays (x-unitos-replay). Online, an unresolved quote still answers 400, so the reader can fix it. The notice sits in the offline pill, which the graph covers, so the reader sees it after the graph closes. The dock was left alone because GATHER5 owns it.
- Undo is a line in the existing message slot, Restore is on the existing History row, and the maker is named in the existing confirm. This follows Linda's 20:34 direction: no new panels.
