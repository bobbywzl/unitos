# loop/r15-notes

**Intent:** fix round 15's notes package (PACKAGES.md section 3): NOTE15-01 first (blocking, rule zero: History's merge row gets Restore), then NOTE15-02, 03, 04, 05, 09, 10, 11, 12, 13, 14, 15, 16. NOTE15-06 belongs to the edge package.

Screenshots: `/home/user/wt/r15-notes/.qa-tmp/fix/<ID>-before.png` and `<ID>-after.png`, copied to `/mnt/project-files/interaction-loop/round-15/img/`. Scripts and logs: `/home/user/wt/r15-notes/.qa-tmp/notes/`, `.qa-tmp/before/`, `.qa-tmp/after*/`. A before with no rerun of its own (the machine crashed the page under load) is the audit's screenshot, named as such below.

## Findings

### Blocking

- **NOTE15-01 fixed.** History's merge row has Restore (tip: "Put the merged notes back beside the note they went into, with their sources and replies. The note keeps its text"). Restore puts every consumed note that is not back right under the target, in its order (in its own section, else the project's first, when the target is gone), with copies of the sources it quoted (the target keeps its own: its text may quote them) and the replies written under it (moved back from the target; written again from the kept note when gone). The target's text is never written. A merge now keeps each consumed note whole in the event (`keepNote`: edits, side chats, sources, replies, documentId), so Restore and the 12 s Undo bring back edits, side chats and the note's document too; merges made before this round come back from the snapshot's columns, sources and replies. A second Restore, or Undo after Restore, answers 409; Restore after Undo is refused the same way. Before (audit `m1-ai-edit-*`, `NOTE15-01-before.png`): Merge with AI, one edit to the target, the pill says "Edited since the merge" and goes at 12 s; History's row has no Restore; the consumed note is gone for good. After (`m1r-restore.mjs`, `NOTE15-01-after.png`): Restore → S back under T with 1 source and 1 reply; T keeps its edited text and its 2 sources; a second Restore 409; Undo 409; reload: both notes on screen, the same in the db. `m1u-api.mjs`: the 12 s Undo brings back the note, its edits and its documentId. **origin/main has the same loss**: its only way back is `merge/undo/route.ts`, which refuses once the target's text changed (`target.content !== snapshot.mergedContent`) and the pill goes at 12 s; main has no History restore route at all.

### The rest

- **NOTE15-11 fixed** (with 01). A merge row reads Restored once its merge was undone or restored (`undoneAt` or `restoredAt`), as a restored removal does.
- **NOTE15-02 fixed.** The tray tells its cards whether the reader can see it (`CardDropShown` context, `visible={isOpen("notes")}` from the workspace); a hidden tray's cards are not drop targets, so `useCardDropOpen` counts only notes on screen. Before (`r1`, `r2`, `NOTE15-02-before.png`, `-before-annotations-tab.png`): Annotations tab rows with grips, a grip drag with 0 targets; panel closed: card head hold true, a "Highlight" ghost over nothing. After (`r2b.mjs`, block 17): panel closed, card head hold false, 0 drop targets; Annotations tab, hold false, 0 targets, 0 grips; Notes tab, hold true with its tip, 1 target. `NOTE15-02-after.png`, `-after-annotations-tab.png`.
- **NOTE15-03 fixed.** The board's open note draws whole (`opened` on NoteCard: a local fold state; the chevron still folds it). `b1-board.log`: open note h 60, expanded false → h 96, expanded true. `NOTE15-03-before.png`, `-after.png`.
- **NOTE15-04 fixed.** The notes column keeps its place and width (760 px). The annotation stands in the right gutter (absolute, sticky, up to 360 px) when the window is at least 1400 px wide; narrower, it is a sheet fixed at the bottom right (`bottom-20`, `max-h-[55vh]`, 360 px from md up), over the page, not in the column. Before (`before/l1.log`): CLS 0.8056, note box [364,420,712] → [164,420,760]; ✕ shift 0.1119. After (`after4/l1.log`): CLS 0, note box [364,420,712] → [364,420,712]; ✕ shift 0, note box stays. Press to side loaded 1143 → 1744 ms with 2 long tasks either way; the machine ran at load 11 for the after run and the side fetches what it fetched before, so read it as noise, not as a cost of the change. The side stands at the top of the gutter (sticky), not level with the note. `NOTE15-04-before.png`, `-after.png`.
- **NOTE15-05 fixed.** The focused pending note scrolls into view only when the last input was a key (`lastInputWasKey`, set by capture listeners for keydown and pointerdown). A press keeps the page still, and the page opens at its top. Before (audit `l2`): the fifth Accept 463 → 4453; opened at 883 (big project), 683 from the tray (`before/l1.log` step d). After (`after/l2.log`): opened at 0; five Accepts 673 → 673 each. `NOTE15-05-before.png` (audit `l2-2-after-last-accept.png`), `NOTE15-05-after.png` (the page opened at its top).
- **NOTE15-09 fixed.** The annotation's ⋯ Add to a note… runs what a drop runs: the quote, the annotation reference row, and the words (`referenceMarkdownForDrop`, `PATCH /api/notes/:id { append, copySourcesFrom }`), and posts the Undo pill ("Added to note #cwoeiv · Undo ✕"); the toast is shown only when no pill took the post; the doubled "##" is gone. Undo sends the old text back with `removeSources` for the sources it added, and refuses (Not saved) when the note changed since. With no document (an annotation off a document), it falls back to the join merge as before. Before (audit `r1` step 5, `NOTE15-09-before.png`): `###### Merged note` and the words, no quote, no row, toast "Added to note ##28sf4x", no Undo. After (`v09.mjs`, `NOTE15-09-after.png`): pill, no toast; N2 gets the quote, the `[Comment](…)` row and the words, sources 0 → 1; Undo → text back, sources 0; added again, the same after reload.
- **NOTE15-10 fixed.** A reference to an annotation that answers 404 says "This annotation was deleted. History can restore it." (sand); any other failure says "Not loaded. Try again." (`common.notLoaded`) and logs to the console. Before (`before/r3`): "Could not load the annotation". After (`after3/r3.log`): "Annotation ✕ This annotation was deleted. History can restore it." after the 404. `NOTE15-10-before.png`, `-after.png`.
- **NOTE15-12 fixed.** A pending tile shows Accept in its head row where an accepted tile shows its Select circle (a pending note has no Select); viewers keep the Pending label. `b1-board.log` step 3: tile controls ["Copy note ID"] → ["Copy note ID","Accept"]. `NOTE15-12-before.png`, `-after.png`.
- **NOTE15-13 not fixed.** Keeping the editor open through Group by means reopening it from the note's local draft in `use-note-draft.ts`, which belongs to the edge package and is being rewritten this round for EDGE15-01 (the save rebased on the merged text). Reopening it on the old draft code risks the very loss EDGE15-01 fixes (older text saved over newer words). The words are kept by the close save, as before. Path once EDGE15-01 lands: `note-groups.tsx` reopens the editing note through `editRequest`, adopting the local draft. `NOTE15-13-before.png` (audit `x1-c2-after-group-by.png`); no after.
- **NOTE15-14 fixed.** On a coarse pointer the ⋯ and the chevron of an annotation row have 36 px hit areas (`pointer-coarse:` negative margins, as `merge-undo.tsx`); the grip goes with 02. `ph-ann.log`: ⋯ 22×22 → 36×36, chevron 18×18 → 36×36; the ⋯ menu still opens. `NOTE15-14-before.png`, `-after.png`.
- **NOTE15-15 fixed.** The Annotations tab and the annotations full page hide a row on `dissect:note-removed` and show it again on `dissect:note-restored` (`useRemovedNotes`). Before (audit `d2`): row there at 117 and 673 ms, gone at 1367 ms. After (`d2`, `NOTE15-15-after.png`): row gone at 122 ms; Undo brings the comment back (db).
- **NOTE15-16 fixed.** A tile carries no `data-tip` on a coarse pointer (`useCoarsePointer`). After (`after2/ph-board`): no tip over + Note and ✕ while a finger carries a tile. `NOTE15-16-before.png` (audit), `-after.png`.
- **NOTE15-06** belongs to the edge package; not touched.

## Files

- `src/lib/notes/merge-restore.ts` (new): `restoreMerge`, `mergedNoteWrites`, `keptOfMerged`, `liveDocumentsOf`.
- `src/lib/notes/merge-snapshot.ts`: a merged note keeps `documentId` and `kept` (the note whole); the snapshot keeps `restoredAt`, `restoredById`.
- `src/lib/notes/removed.ts`: `noteWrites` exported; `keptNoteFrom`.
- `src/app/api/notes/merge/route.ts`: keeps each consumed note whole in the event.
- `src/app/api/notes/merge/undo/route.ts`: refuses after a Restore; writes the notes back through `mergedNoteWrites` (edits, documentId, side chats).
- `src/app/api/notebooks/[notebookId]/history/[eventId]/route.ts`: NOTE_MERGE restore; answers `{ ok, noteId, sectionId, note, notes }`.
- `src/lib/history/list.ts`: a merge row is restorable when it kept notes; Restored once undone or restored.
- `src/components/collab/history-control.tsx`: `tellNoteBack` for each note the merge Restore put back; the merge row's tip.
- `src/lib/i18n/dict/outline.ts` (en, zh): `historyRestoreMergeTitle` added; `annotationLoadFailed` renamed `annotationGone` with the new words.
- `src/components/outline/use-card-drop.ts`: `CardDropShown` context.
- `src/components/outline/notes-tray.tsx`: `visible` prop, provides `CardDropShown`.
- `src/components/reader/workspace.tsx` (shared, one line): `visible={isOpen("notes")}` on `<NotesTray>`.
- `src/components/outline/note-card.tsx`: drop target only when shown; `opened` prop; the pending scroll only after a key.
- `src/components/outline/note-tile.tsx`: Accept on a pending tile; no tip on a coarse pointer.
- `src/components/outline/section-board.tsx`: the open note drawn whole; no wide column for the side.
- `src/components/outline/annotation-side.tsx`: the side in the gutter or as a bottom-right sheet; the 404 words.
- `src/components/panels/annotation-card.tsx`: `annotationReferenceOf` (shared by the grip and the menu); chevron hit area.
- `src/components/panels/annotation-menu.tsx`: Add to a note as a drop, with the pill and Undo; ⋯ hit area.
- `src/components/panels/annotations-panel.tsx`, `annotations-full-page.tsx`: removed rows hidden at once.
- `src/lib/notes/undo-pill.ts`: `useRemovedNotes`.
- `src/app/api/notes/[noteId]/route.ts`: copied annotation sources are returned in `added` (so Undo can remove them). The save path's merge is untouched.
- `SPEC.md`: the lines for merge Undo and History's Restore (§6), Add to a note, the annotation beside a note, the pending-keys scroll, the board's open note and the pending tile's Accept.

## Decisions

- Restore copies the sources and moves the replies. The target's text may quote the merged notes' sources, so it keeps them; a reply belongs to one note, and it was written under the merged note.
- Restore leaves the target's text as it is (the reader's newer words stay); only the 12 s Undo puts the target's old text back.
- Restore and Undo shut each other out (one way back per merge), so a merge never comes back twice.
- Side chats of a restored note come back at the end of its section (they never show in the list).
- The annotation stands in the gutter from 1400 px (760 column + 24 + 360 + margins), not the audit's 1280: at 1280 a 320 px side would cover the column's edge. Narrower windows get a bottom-right sheet over the page rather than a box under the note, so the column never moves.
- The pending tile's Accept takes the place of the Select circle and the Pending label for an editor; a viewer keeps the label.
- Undo of Add to a note refuses when the note changed since (it would write older text over newer words).

## Needs

- Nav (`panels.ts`, theirs): `annotationNoteAdded`/`annotationNoteMade` keep `#{id}`; the menu now passes the id without its "#". `annotationAddToNoteTitle` could say it adds the quote and a row that opens the annotation.
- Edge: NOTE15-13 waits on EDGE15-01's `use-note-draft.ts` (see above).
- Merge: the one shared line in `workspace.tsx`. i18n: `outline.historyRestoreMergeTitle` (new), `outline.annotationGone` (was `annotationLoadFailed`; no other reader of the old key).
- No migration, no schema change. Merges made before this branch carry no `kept` note and come back from the snapshot's columns.
