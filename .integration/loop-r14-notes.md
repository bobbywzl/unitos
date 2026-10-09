# loop/r14-notes

**Intent:** fix round 14's notes package (PACKAGES.md section 3): NOTE14-01 and 02 first (blocking, rule zero), then NOTE14-11 (one editor bar), every other NOTE14 finding, EDGE14-10, SEL14-04 and PAGE14-06 (the reader's and the page editor's trash posts the notes' Undo pill), and NOTE14-09 (the same from the Annotations tab and its full page). Make the pill callable by an event.

Screenshots: `/home/user/wt/r14-notes/.qa-tmp/fix/<ID>-before.png` / `<ID>-after.png`, copied to `/mnt/project-files/interaction-loop/round-14/img/`. Scripts and logs: `/home/user/wt/r14-notes/.qa-tmp/notes/`.

## The Undo pill event (for package 2 and anyone else)

`window.dispatchEvent(new CustomEvent("dissect:undo-pill", { detail: { message, undo, commit? }, cancelable: true }))`, or `postUndoPill(post)` from `src/lib/notes/undo-pill.ts`. 12 s, Undo and ✕, Ctrl+Z presses Undo. `commit` runs once the pill goes without Undo (12 s, ✕, the next delete or post, pagehide); with no pill on the page, `postUndoPill` runs `commit` at once and returns false. For a note row of any kind (annotation, comment, conversation), `deleteNoteWithUndo(noteId, message, onBack?)` does the whole thing: the marks fade, `DELETE /api/notes/:id` (now answers `{ ok, eventId, notebookId }`), the pill, and Undo is History's Restore of that event.

NAV14-08 hook: `tellNoteBack(answer, fallbackId?)` in `src/lib/notes/undo-pill.ts`. The restore route (`POST /api/notebooks/:id/history/:eventId`) answers `{ ok, noteId, sectionId, note }` for a note; `tellNoteBack(answer)` dispatches `dissect:note-back` `{ noteId, sectionId?, note? }` (the outline puts the note in its section at once) and `dissect:note-restored`.

## Findings

### Blocking

- **NOTE14-01 fixed.** A section deleted elsewhere while the reader types in one of its notes or its composer: a write to a note kept in the section's `SECTION_REMOVE` event makes a new note of the words (the section of the same title, else the project's first, else a new section of the deleted one's title), and the pill says "This note was deleted elsewhere. Your words are kept in a new note." The event remembers the new note per gone note (`keptAsByNote` in meta), so later writes land there. Before (audit): beta rows 0 after Escape and reload. After (`fix-r0-other-tab.log`, `fix-r0-other-composer.log`): beta rows 1 after typing, after Escape, after reload; alpha stays in the event. `NOTE14-01-before.png`, `NOTE14-01-after.png`. origin/main loses the same words.
- **NOTE14-02 fixed.** The composer's Escape and Done close it at once (before: 1.3 s in the tray, 2 s on the full page with the caret still in it; words typed in that wait were cleared and a space then made a new note). The note shows at the top of its section and the save follows; the local draft keeps the words until the server has them; a failed save puts them back in the composer, marked Not saved; the focus goes to + Note only when a key opened the composer. After (`fix-compose-close.log`): Escape then reload rows 1; writes failing: closed in 16 to 30 ms, words back in the composer marked Not saved, rows 0; network back, Escape: rows 1; reload rows 1. `NOTE14-02-before.png`, `NOTE14-02-after.png`, `NOTE14-02-after-failed-save.png`.

### The rest

- **NOTE14-11 fixed.** One bar on one row on every note editor (tray, notes full page, board's open note, floating card): Undo, Redo | Line ▾ | B, I, U, Color | Voice typing. Line names the line's kind and opens one menu (Text, H1–H3, the four lists, Quote, Indent, Outdent, Image, each with its shortcut), fixed to the window, flipping up when the room is above. The floating card's Assistant moved into its Done row. Controls (tray / floating / page / board): 20 / 22 / 24 / 24 before, 14 / 16 / 14 / 14 after. Line menu runs saved "## bar heading", "- bar indent", "  - bar nested" to the db, same after reload, tray, page, and phone (`fix-11-*.log`). Also fixed: a line style picked with the caret in a line left the whole line selected, so the next key replaced the line (word loss); the caret now stays where it was. `NOTE14-11-before.png`, `-after.png`.
- **NOTE14-04 fixed.** The drop line and the covered card are stores read per card (`useLine`, `useIsMergeTarget`); NoteCard is memoized. Full page, 50 notes, 30 moves (`h2-drag-prof`, two runs each): long tasks 18–24 → 4–13; longest 318–554 ms → 75–133 ms; busy 3.8–4.1 s → 1.1–1.4 s. `NOTE14-04-before.png`, `-after.png`.
- **NOTE14-03 fixed.** A finger lifts at 300 ms (`TOUCH_HOLD_MS`, `holdMs(pointerType)` in `src/lib/hold-drag.ts`); a mouse keeps 150 ms. A drag that changes nothing scrolls the lists back to where they were (`restoreLiftScroll`). Tray sheet, 390 px touch (`fix-03-tray.log`): before, a first move at 170 / 200 / 400 ms lifted and the sheet went 315 → 0; after, a first move at 306 ms scrolls (315 → 734), a 485 ms rest lifts, nothing moves, the sheet stays at 315. `NOTE14-03-before.png`, `-after.png`.
- **NOTE14-13 fixed in the notes.** Finger hold 300 ms as the document list; the notes' drop line (column and grid) carries the document list's knob (`globals.css`, `.drop-line::before`, `.drop-line-grid::before`). Mouse timings stay (lead's decision). `NOTE14-13-before.png`, `-after.png`.
- **NOTE14-05 fixed.** A match stays a one-line row (the note's first line holding the match, marker off, lit); the field takes every key at once and the list follows through `useDeferredValue`. Key "e" (`fix-05-*.log`): tray longest task 660 → 99 ms, rows stay 44 px, layout shift 0.18 → 0.0001; full page 241 → 95 ms, rows stay 60 px. `NOTE14-05-before.png`, `-after.png`.
- **NOTE14-06 fixed.** The tray stays mounted behind other tabs once shown; a board draws 12 tiles first, then 12 a frame. Notes press 714 → 132 ms; board first answer 504–885 → 417 ms (`fix-06.log`). `NOTE14-06-before.png`, `-after.png`.
- **NOTE14-07 fixed.** A section's Delete takes it off the screen at once and shows the pill; Undo puts it back at once; a refresh landing first never undoes either (`goneSections`, `backSections`). Phone run (`fix-08-section.mjs`): off the screen 0.3 s after the bin, server delete at 0.75 s; after Undo back while the db still reads 0 rows; reload: section and 3 notes there. `NOTE14-07-before.png`, `-after.png`.
- **NOTE14-08, NOTE14-15, EDGE14-10 fixed.** Delete moved into the rename row (end of the title field; the pencil opens it), so the header at rest is the title and its pencil, and a long title wraps beside the pencil. The pill names what went: "“A long section titl…” deleted · 3 notes". On touch the pill's Undo is 57×36 (was 57×24) and ✕ 36×36. `NOTE14-08-*.png`, `NOTE14-15-*.png`, `EDGE14-10-*.png`.
- **NOTE14-09 fixed.** The Annotations tab and the annotations full page delete through `deleteNoteWithUndo`. Tab (`fix-a3-tab.log`): row 0, pill "Comment deleted · Undo ✕"; Undo → row 1; reload → row 1, words on screen. Ctrl+Z run (`fix-a3-tab-key.log`) the same. `NOTE14-09-before.png`, `-after.png`.
- **SEL14-04, PAGE14-06 fixed.** The reader's annotation card trash and the page editor's comment card trash go through `deleteNoteWithUndo` (`reader-interactions.tsx` only; `comment-card.tsx` untouched). Page editor run (`fix-a3-page.log`): pill after 18 ms, row 0; Undo → row 1; reload → row 1. Not browser-tested: the block document's annotation card path (`deleteAnnotation`), same code. `SEL14-04-*.png`, `PAGE14-06-*.png`.
- **NOTE14-10 fixed.** The board's + Note with the composer open puts the caret back in it (`focusComposer`). Before: focus stayed on the button, typed words went nowhere. After (`fix-10.log`): typed words in a field true, rows 1. `NOTE14-10-before.png`, `-after.png`.
- **NOTE14-12 fixed.** The reject pill has ✕ and lasts 12 s like every other pill; one pill component for note, section, merge, reject, and posted deletes (`fix-12.log`: "Note rejected Undo ✕", on top on the full page and the board). `NOTE14-12-before.png`, `-after.png`.
- **NOTE14-14 half fixed.** A search keeps the note being edited in the list until its editor closes (`editing-notes.ts`): editors 0 → 1 in the tray and on the full page (`fix-14.log`). Not fixed: a new Group by still closes the editor (words kept, as before); see Decisions. `NOTE14-14-before.png`, `-after.png`.

### Lead asks

- Edge (1): a retry of a failed note save reads the server's text (`serverTree`), not the overlay. Edge (2): "Notes 0" hidden (count only when > 0), and an empty tray shows only its one line (no lone icon row). `EMPTY-tray-after.png`. Commit d778db0.
- Nav: NAV14-08 route and hook done (`tellNoteBack`). History restore on the full page: note on screen at 310 ms with the note in the answer, 1119 ms with the id alone (audit: 3–5 s) (`fix-nav08.log`).

## Files

- `src/lib/notes/undo-pill.ts` (new): the pill event, `postUndoPill`, `usePostedUndo`, `deleteNoteWithUndo`, `tellNoteBack`, `NOTE_BACK_EVENT`, `deletedKey`.
- `src/lib/notes/view.ts` (new): `noteViewOf(id)`, the note as the outline draws it, for the restore route's answer.
- `src/lib/notes/gone.ts`: a write to a note kept in a section's removal event makes a new note; `keptAsByNote`; `keptHome` type.
- `src/app/api/notes/route.ts`, `src/app/api/notes/[noteId]/route.ts`: the kept-words path (NOTE14-01); DELETE answers the event id.
- `src/app/api/notebooks/[notebookId]/history/[eventId]/route.ts`: a note's restore answers `{ ok, noteId, sectionId, note }`.
- `src/components/outline/use-note-compose.ts`, `note-composer.tsx`: Escape/Done close at once, background save, draft kept until the server has it (NOTE14-02).
- `src/components/outline/use-outline.ts`: posted pill, optimistic section delete/undo, `backNotes`, 12 s reject, editing note in search, retry from the server's text.
- `src/components/outline/merge-undo.tsx`: one pill, ✕ everywhere, 36 px on touch, section words, posted pill, Ctrl+Z.
- `src/components/outline/note-editor.tsx`, `floating-note-editor.tsx`, `note-groups.tsx`: one bar, Line ▾, caret kept after a line style.
- `src/components/outline/note-card.tsx`, `note-tile.tsx`, `src/components/sortable.tsx`: drag stores, memo, restore scroll on a drop that changes nothing; search row.
- `src/components/outline/editing-notes.ts` (new): the notes with an open editor.
- `src/components/outline/notes-tray.tsx`, `outline.tsx`: deferred search; empty tray's row.
- `src/components/outline/section-item.tsx`: Delete in the rename row, title and pencil wrap.
- `src/components/outline/section-board.tsx`: + Note focus, staged tiles.
- `src/lib/hold-drag.ts`, `src/components/hold-sensor.ts`: 300 ms touch hold, `restoreLiftScroll`.
- `src/app/globals.css`: the drop line's knob (two rules).
- `src/components/panels/annotations-panel.tsx`, `annotations-full-page.tsx`: delete with the pill.
- `src/components/reader/reader-interactions.tsx` (shared, small hunks): the cards' trash with the pill.
- `src/components/reader/workspace.tsx` (shared, small hunks): tray kept mounted; count only when > 0.
- `src/lib/i18n/dict/outline.ts`: keys below, en and zh.
- `SPEC.md`: §6 notes lines and History's Restore line.

## Decisions

- **Group by still closes the editor (NOTE14-14 second half).** The list is drawn anew; an editor reopened on the new card could start from the tree's older text and save it over newer words (rule zero risk). The words are kept by the editor's close save, as before.
- **Delete moved into the rename row** rather than spacing two 36 px buttons: one tap at rest can no longer delete a section; the pencil, then the bin. Undo stays one tap.
- **Search deferred (`useDeferredValue`)** rather than a minimum of 2 characters: the first key still filters.
- **The tray stays mounted (hidden) once shown**; other tabs still mount on press. Its memory stays while the reader is open.
- **A board draws 12 tiles, then 12 a frame**, rather than virtualizing: drag and drop keep every tile in the DOM.
- **Section delete is optimistic**; a failed delete puts the section back and says so.
- **Mouse hold timings unchanged** (lead's decision); only touch moved to 300 ms.

## Needs (for the lead when merging)

- **Nav:** `tree-drag.ts` should import `TOUCH_HOLD_MS` / `holdMs` from `src/lib/hold-drag.ts` instead of its own 300. `history-control` should call `tellNoteBack(answer)` and drop its refresh wait (`refreshUntilRestored`).
- **Tools / select:** the explain, simplify, and conversation trashes can call `deleteNoteWithUndo(noteId, t(deletedKey(kind)))` or post `dissect:undo-pill`.
- **i18n (outline.ts, en and zh):** new `undoPostedTitle`, `sectionDeletedNotes`, `sectionDeletedOneNote`, `highlightDeleted`, `commentDeleted`, `annotationDeleted`, `conversationDeleted`, `tipLineMenu`, `lineText`, `tipLineText`; changed `sectionDeleted` ("“{title}” deleted"), `keptAsNewNote`.
- **SPEC.md:** three hunks in §6 (about lines 334–358, 366, 713).
- **Expected conflicts:** `use-outline.ts` (edge's retry change; keep mine, which already reads `serverTree`), `src/lib/i18n/dict/outline.ts` (edge's `byDocumentEmpty`; take both), `notes-tray.tsx` (edge's empty states; keep the row hidden when there are no notes and take edge's words), `workspace.tsx` (two hunks).
- `src/components/docs/layer/comment-card.tsx` is untouched (page's MoreHorizIcon stays).
- No migration, no `prisma generate`. `SECTION_REMOVE` meta gains `keptAsByNote` only when words are kept.
