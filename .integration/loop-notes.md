# loop/notes

**Intent:** Fix the notes tray package of the audit: notes.md N1 to N15, and navigation.md N5, N15, N19, N20, N21, in the files this worker owns; write the rest under Needs.

## Findings

Screenshots are under `.qa-tmp/fix/` in the worktree (not committed: `.qa-tmp` is ignored). The machine ran at a load of 60 to 100 through this round (four workers on 4 cores), so browser runs mostly timed out, and near the end this worker's dev server died with 1 GB of memory free on the machine; it was not restarted, to leave the memory to the other workers. N1 has its own before and after shots; for the rest, the before is the audit's own shot under `/home/user/unitos/.qa-tmp/audit/notes/` and `/home/user/unitos/.qa-tmp/audit/navigation/`, and the after was checked by reading the code, the focused typecheck, and eslint, not in a browser. Each such finding says so.

- **N1 (blocking): fixed, checked in the browser.** The tray's scroll box kept the transform of its `.panel-in` animation (fill mode `both`), so the fixed Undo pill and the selection bar sat inside it and scrolled away (pill at y = -854). Now the animation lets go when it ends (fill mode `backwards`), and both bars are drawn on the body. After: the pill at y = 832 in a 900px window, with the tray scrolled 1424px. `.qa-tmp/fix/N1-before.png` (taken on the main server, same code in these files), `.qa-tmp/fix/N1-after.png`.
- **N3: fixed, not run in a browser.** Delete (a note's Delete and the selection bar's Delete) asks nothing; the notes leave the list at once and the pill says "Note deleted" with Undo. The server deletes nothing while the pill shows. The DELETE runs when the pill goes: after 12 s, on its ✕, on the next delete or merge, or when the page closes (a keepalive request on pagehide). A failed DELETE puts the notes back and the pill says why. Undo reject and Undo merge put the notes back at once. The composer's note joins the top of its section in the frame the composer closes. The script `.qa-tmp/notes/fix-n3.mjs` checks all of it but did not finish under the load.
- **N2: tray side done; the reader side is under Needs.** `workspace.tsx` waits up to 15 s, on every width, for the card of a `dissect:show-note` note and then opens it; the tray unfolds the section that holds it. The reader's Add to section only sends the event for a blank document today.
- **N4: fixed, not run in a browser.** The note picker lists every accepted note, newest edit first, in a box up to 20rem tall (45% of the window on a short one), each row two lines of text plus its number and section. ArrowUp and ArrowDown move the active row, Enter picks it, Escape clears the search and then goes back a step.
- **N5: fixed, not run in a browser.** A section's title row takes drops in the tray and on the notes full page, collapsed or not: the row lights, and the note lands at the top of the section. A collapsed section stays collapsed.
- **N6: fixed, not run in a browser.** A quote dropped on empty tray space makes a new note: under a section it lands at the end of that section, on a section's title row at the top, and below every section at the end of the last one. A hint in the section says where it will land. An annotation dropped there makes a note holding its annotation reference.
- **N7: fixed, not run in a browser.** Escape during a hold drag cancels the drag only: the hold sensor takes the key first and stops it.
- **N8: fixed.** The picker's tooltip said the note is pending, but the note lands accepted. It now reads "Add a note in {section}".
- **N9: fixed, not run in a browser.** A collapsed note and an annotation's gist show one line cut after the last whole word (CJK by character), with no ellipsis (`word-line.tsx`).
- **N10 + nav-N12: fixed, not run in a browser.** In the reader at md and wider, Feedback is a 36px round icon in the right rail, under every tray control. Elsewhere it is the pill it was.
- **N11: fixed in part.** The hold tooltips are short now ("Hold to drag"). A longer delay for that tip is in `tooltip.tsx` (Needs).
- **N12: fixed, not run in a browser.** The note's assistant starts as its chip and opens on a press, or by itself when a typed question waits in it; its hint shows only while the box is focused and empty.
- **N13: fixed in the note, not run in a browser.** A quote dropped on a word in a note lands at the start or end of that line, by which half of the line the pointer is in, so it never splits a sentence. The note sends `dissect:quote-landed` when a quote lands; closing the reader's toolbar on it is under Needs.
- **N14: fixed in part, not run in a browser.** After Done or Cancel the focus goes back to the note's Edit button; a second press on + Note focuses the open composer; the picker's Escape goes back a step. The reader's picker needs one prop (Needs).
- **N15: fixed, not run in a browser.** The lifted tile on a board is opaque.
- **nav-N5: fixed, not run in a browser.** A press on a collapsed Annotations tab entry opens it and jumps to its passage. A jump inside the same project page replaces the history entry instead of adding one, so Back leaves the project as before.
- **nav-N15: fixed, not run in a browser.** The "3 pending" pill is a button: it shows the focused pending note, else the first one, in the tray.
- **nav-N19: not fixed.** The bare ✓ is in `reader-interactions.tsx` (Needs).
- **nav-N20: fixed in part.** The highlight card in the Annotations tab names its kind, "Highlight". The reader's card is in `reader-interactions.tsx` (Needs). Color proposal below; `--kind-*` is unchanged.
- **nav-N21: not fixed.** Stacked annotations need `block-view.tsx` and `reader-interactions.tsx` (Needs).

## Files

- `src/app/globals.css`: `.panel-in` fill mode `backwards`, so fixed controls inside the tray stay fixed (N1).
- `src/components/outline/merge-undo.tsx`: drawn on the body (`onBody`, `BOTTOM_PILL`); a delete state with Undo, and a notice state for a change that failed (N1, N3).
- `src/components/outline/selection-bar.tsx`: drawn on the body; Delete with no confirm, through `removeNotes` (N1, N3).
- `src/components/outline/outline.tsx`: draws the selection bar and the pill once, not again under an open board (N1).
- `src/components/outline/use-outline.ts`: optimistic delete with Undo, Undo reject, Undo merge, composer save, tray drops (N3, N6). Functions listed below.
- `src/components/outline/note-composer.tsx`: `onRelease` (the composer hands its note to the list), empty Save is Cancel, `focusComposer` (N3, N14).
- `src/components/outline/notes-tray.tsx`: quote and card drops on tray space and on section title rows, the drop hint, unfolding a section for a shown note, + Note focuses an open composer (N2, N5, N6, N14).
- `src/components/outline/section-item.tsx`: the full page's title row takes drops; + Note focus; composer release (N5, N14).
- `src/components/outline/section-board.tsx`: composer release; the lifted tile (N3, N15).
- `src/components/outline/note-tile.tsx`: `lifted` drops the see-through (N15).
- `src/components/outline/note-editor.tsx`: the drop lands at a line's start or end; `quoteLanded()` (N13).
- `src/components/outline/note-card.tsx`: Delete with Undo, `quoteLanded()`, `WordLine`, focus after Done and Cancel (N3, N9, N13, N14). Functions listed below.
- `src/components/outline/word-line.tsx` (new): one line cut at a whole word (N9).
- `src/components/outline/note-assistant.tsx`: starts as the chip; hint only when focused and empty (N12).
- `src/components/sortable.tsx`: a `[data-drop-header]` row is a drop line at the top of its list; `useDropHeader` (N5).
- `src/components/hold-sensor.ts`: Escape in a drag is taken in the capture phase and stopped (N7).
- `src/components/use-note-drop.ts`: `QUOTE_LANDED_EVENT` and `quoteLanded()` (N13).
- `src/components/reader/note-picker.tsx`: `pickerNotes`, keyboard, taller list, two-line rows, `onEscape` (N4, N8, N14).
- `src/components/reader/workspace.tsx`: show-note waits for the card on every width and opens it; the pending pill is a button (N2, nav-N15).
- `src/components/feedback-button.tsx`: the rail icon in the reader (N10).
- `src/components/panels/annotation-card.tsx`: `jumpToAnnotation` (replace inside the project page), a press on the gist opens and jumps, the highlight names its kind, `WordLine`, the jump pill says Jump (nav-N5, nav-N20, N9).
- `src/components/panels/annotation-menu.tsx`: `jumpToAnnotation`; picker Escape back to the menu (nav-N5, N14).
- `src/components/panels/annotations-panel.tsx`: the conversation overlay drawn on the body (N1, same cause); passes the project id for the jump (nav-N5).
- `src/lib/i18n/dict/outline.ts`, `panels.ts`, `panes.ts`, `reader.ts`: the new and shortened strings, en and zh, in the fixed terms.
- `SPEC.md`: §6 lines for delete with Undo, the pill on the body, Undo merge and reject, quote drops on the tray and on title rows, Escape in a drag, the picker, the cut at a word, the assistant chip, the composer's release, and the annotation jump.

### Functions changed in `use-outline.ts`

- `useOutline` state at the top: `rawTree`/`setTree`, the `hidden` set, `tree` (the raw tree without hidden notes), `treeRef`, `notice`, `composedSection`.
- New helpers: `placeOf`, `putBack`, `withoutNotes`, `localNote`; new types `Placed`, `LastDelete`; `LastMerge.before`.
- `undoMerge`: puts the notes back from `before` at once; refresh on error.
- New delete block: `restoreNotes`, `commitDelete`, `commitDeleteRef`, the pagehide and unmount effect, `removeNotes`, `undoDelete`.
- `rejectNote` and `undoReject` (the `rejects` ref map).
- `actions.addNote`: the new note goes to the top at once.
- `actions.addDroppedNote` (new), `actions.expectComposed` (new), `actions.dismissNotice` (new).
- `actions.saveNote`: content shown at once, put back on error; a composed note joins its section.
- `mergeNotes`: commits a waiting delete; snapshots `before`.
- `dismissMerge`: commits a waiting delete.
- `actions.deleteNote`: unchanged (the composer's immediate delete of its own empty draft).

### Functions changed in `note-card.tsx`

- `NoteCommands` type and `useCommands`: `deleteNote` replaced by `removeNotes`.
- `NoteCardBody` only: `takeDrop` and `onQuote` call `quoteLanded()`; the collapsed line and the floating placeholder render `WordLine`; the Delete button calls `removeNotes([note.id])` with no confirm; a `refocus` ref and an effect focus the Edit button after Done or Cancel. One import line each for `WordLine` and `quoteLanded`.

## Decisions

- The delete waits on the client, not the server: the server deletes nothing while Undo shows, so Undo needs no request and a closed tab loses nothing it should keep. The DELETE goes as a keepalive request on pagehide. A crash of the browser while the pill shows leaves the note on the server (kept, not lost). `lib/api.ts` has no keepalive option, so `use-outline.ts` sends that one request with `fetch` and the account header.
- The composer's own delete of its empty draft stays immediate (it is not a user's note yet).
- `src/components/outline/**` is treated as this package's, except `use-note-compose.ts`, `use-note-draft.ts`, and `save-state.tsx`, which I did not touch.
- N1's before shot came from the main server (port 3111), which runs the same code in these files.
- A drop on a section's title row lands at the top of the section; a collapsed section is not opened by hovering it.
- The picker sorts by the newest edit, not by the open document first: one rule a reader can predict.
- The note's assistant starts as its chip; the open or closed choice is kept per browser as before, and only "open" opens it.
- Feedback moves to the rail only in the reader; on other pages it is the pill it was.
- An annotation dropped on a section makes a note that holds its annotation reference (the same line a drop on a note writes).
- Escape in the picker first clears the search, then goes back one step (to the menu in the Annotations tab).

## Commits

- `9bc0dee` N1, N3 (and N11's shorter strings in `outline.ts`).
- `91f06c0` N5, N6, N7, N13, N15, N2 tray side, nav-N15.
- `eb5e2d8` N4, N8, N9, N12, N14, N10, N3 card side.
- `7706b19` nav-N5, nav-N20 in part, N9 in the tab.
- `c455803` SPEC.md.

## Checks

- Typecheck: the full `npx tsc --noEmit` timed out under the load; a focused config over every changed file and directory (`.qa-tmp/tsconfig.check.json`, extends the root config) exits 0 with no errors. Run the full check after the merge.
- `npx eslint` on every changed file: clean.

## Needs (files I do not own)

- **N2**, `src/components/reader/reader-interactions.tsx` `addToSection` (near line 4443): send `dissect:show-note` with `note.id` for every document, not only `if (richTextRef.current)`. The tray then unfolds the section and opens the note.
- **N13**, `reader-interactions.tsx`: listen for `dissect:quote-landed` (`QUOTE_LANDED_EVENT` in `use-note-drop.ts`) and close the selection toolbar and its tint.
- **N14**, `reader-interactions.tsx` near line 8758: pass `onEscape={() => setAddMode("sections")}` to `NotePicker`.
- **nav-N19**, `reader-interactions.tsx` near lines 9236 to 9244: show the word `t("common.resolve")` in place of the bare ✓.
- **nav-N20**, `reader-interactions.tsx`, the highlight card: name the kind, "Highlight", as the Annotations tab now does.
- **nav-N21**, `block-view.tsx` and `reader-interactions.tsx`: a click on stacked marks offers every annotation under the pointer in a small chooser, not only the top one.
- **N11**, `src/components/tooltip.tsx`: an optional longer delay for the hold tip.
- `src/lib/api.ts` (safety worker): an optional `keepalive` option, so `use-outline.ts` can drop its own fetch for the pagehide DELETE.

### Color proposal for nav-N20 (values unchanged)

- Plum highlight to a light rose, such as `#f2a7bd`, away from the assistant's violet.
- Sage highlight to a light lime, such as `#cfe07a`, away from Simplify's green.
- The jump flash to a neutral, not clay, so it does not read as a highlight.
