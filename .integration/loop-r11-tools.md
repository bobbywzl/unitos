# loop/r11-tools

**Intent:** fix round 11's reader tools package (the TOOL11 findings but TOOL11-10, EDGE11-02/06/07, SEL11-03/04/05, PAGE11-02, the reader half of PAGE11-03), then the reader-interactions halves the coordinator handed over (page editor Needs 1, 2, 4; notes Needs; marks Needs).

Screenshots are under `.qa-tmp/fix/` in this worktree (`<ID>-before.png`, `<ID>-after*.png`). Scripts are under `.qa-tmp/tools/`, `.qa-tmp/page/`, `.qa-tmp/marks/`, each run on a fresh copy of the Memory document in my own project and deleted after.

## Findings

Rule zero, for every blocking finding: the typed words were checked across a reload, Escape, a failed request (a 500 and offline), and a second tab (`v01`, `v03`, `v05`, `v06`, `x13c`, `x26`, `d03`; re-run after the last merge of the loop branch, all pass).

- **TOOL11-01 (blocking): fixed.** A follow-up or a Reply that fails, or is sent offline, goes back into the box with the reason under it (`data-send-error`); kept after Escape, reopen, and reload; sends once the request works. `TOOL11-01-before*.png` / `TOOL11-01-after*.png` (failed, offline, reload, assistant reload).
- **TOOL11-02 (blocking): fixed.** Queued messages are kept in the card's draft; ✕ and Escape stop no run, and the turn in flight is stored. `TOOL11-02-before*.png` / `TOOL11-02-after*.png`.
- **TOOL11-03 (blocking): fixed.** A comment on an answer keeps a draft by conversation and quote (`cardCommentKey`) across Escape, Cancel, ✕, and a reload; the post clears it. `TOOL11-03-before.png` / `TOOL11-03-after*.png`.
- **TOOL11-04 / EDGE11-02 (blocking): fixed.** Toolbar drafts re-read storage before each write and change only their own entry; card drafts write only the keys a tab changed (`writeCardDrafts`) and hear the other tab (`onCardDraftsChange`). `TOOL11-04-before.png`, `EDGE11-02-before.png` / `TOOL11-04-after*.png`, `EDGE11-02-after.png`.
- **TOOL11-05 (blocking): fixed.** The draft goes once Save lands; a draft typed on older text is merged with the stored text by `reconcileNoteText` (the base is kept in `unitos-card-draft-bases`). `TOOL11-05-before*.png` / `TOOL11-05-after*.png`.
- **TOOL11-06 (blocking): fixed.** Regenerate sends `conversationOf`; the new annotation is stored with the old one's turns before the old one is deleted (History keeps it whole; Restore puts it back). `TOOL11-06-before.png` / `TOOL11-06-after.png`.
- **TOOL11-07: fixed.** A tool conversation's plan shows under its turns in its own card; a chat's plan closes with its card and returns with it; only the panel's plan floats. `TOOL11-07-before.png` / `TOOL11-07-after*.png`.
- **TOOL11-08 / EDGE11-06: fixed.** A failed Comment reopens the toolbar on its words with the box, the words, and the reason; a dropped connection queues it (Unitos Premium), as a note's write is queued. `TOOL11-08-before.png`, `EDGE11-06-before.png` / `TOOL11-08-after.png`, `EDGE11-06-after.png`.
- **TOOL11-09: fixed.** A failed, stopped, or declined Regenerate keeps the output and annotation that stand with the reason under the output (`data-run-error`); the next Regenerate replaces, never adds. `TOOL11-09-before*.png` / `TOOL11-09-after.png`.
- **TOOL11-10: not mine** (block-view.tsx, the marks worker). Its reader-interactions half is applied here (marks Needs, below).
- **TOOL11-11: fixed.** Each thread keeps its own box (`AssistantChat.inputs`); Back shows the main box; the side chat reopens with its words. `TOOL11-11-before.png` / `TOOL11-11-after*.png`.
- **TOOL11-12: fixed.** The assistant card's max width stops 8px short of the pane's right edge. `TOOL11-12-before.png` / `TOOL11-12-after.png`.
- **TOOL11-13: fixed.** A width change re-places the toolbar from the tint when the focus is in a field (`tintRange`, `placeToolboxAgain`); a card with typed words or a queue stays open when the reader turns narrow. `TOOL11-13-before.png` / `TOOL11-13-after*.png`.
- **TOOL11-14: fixed.** No error turn; the words go back to the box. `TOOL11-14-before.png` / `TOOL11-14-after.png`.
- **TOOL11-15: fixed.** The chat's line uses `assistant.proposedActions` ("Proposed 2 actions"). `TOOL11-15-before.png` / `TOOL11-15-after.png`.
- **TOOL11-16: fixed.** Escape in Add to notes folds the box and leaves the toolbar. `TOOL11-16-before.png` / `TOOL11-16-after.png`.
- **TOOL11-17: fixed.** On a phone the view ends at the bottom bar's top; the card scrolls in with its foot, and again when the run lands. `TOOL11-17-before.png` / `TOOL11-17-after.png`.
- **EDGE11-07: fixed.** The hint is done once it has played; it reads "The tools open next to the selection" (zh 旁边). `EDGE11-07-before.png` / `EDGE11-07-after*.png`.
- **SEL11-03: fixed** from the code: the on-mark card closes on a click that did not move (4px), not on mousedown. It did not reproduce on my rig before (the first drag selected), so the before shot shows the setup. `SEL11-03-before.png` / `SEL11-03-after.png`.
- **SEL11-04: fixed.** When `--cards-room` changes with a toolbar open, the toolbar is re-placed 400 ms later (after the 0.35 s slide). `SEL11-04-before.png` / `SEL11-04-after.png` (toolbox at 854, no block under it).
- **SEL11-05: fixed.** Past 40 paragraphs the toolbar shows "Select at most 40 paragraphs to use the tools." in place of the tools; nothing is sent. `SEL11-05-before.png` / `SEL11-05-after.png`.
- **PAGE11-02 (blocking): fixed** through the toolbar draft (`assistant` kind, by the bar's words): Escape, a press elsewhere, and a reload keep the bar's question; a successful run clears it. `d03-escape-drafts.mjs`: all three tools have their draft back. `PAGE11-02-before*.png` / `PAGE11-02-after.png`.
- **PAGE11-03 (reader half): not added.** The page worker's `collapse.tsx` takes the click on a core; a reader-side handler too would flip the block twice.
- **PAGE11-07 (reader half, page Needs 2): applied.** The Collapse button sends `{ mode: "viewing", collapse: true } satisfies ModeRequest`; `c01-collapse-editing.mjs`: Collapse off goes back to Editing and a key types. `PAGE11-07-after.png`.
- **Page Needs 4 (block reader left-off mark): applied.** After an exact restore whose block starts above the pane's edge, the mark stands above the first block whose top shows. `leftoff.mjs`: block top at -82, mark at 124, in view, on the next block. `N2-leftoff-after.png`.
- **Notes Needs: applied.** Add to notes and Add to a note… send `onSourceLost: "keep"`, and a dropped source shows the notes package's toast (`outline.quoteSourceLost`).
- **NOTE11-10 / NAV11-01 (reject Undo): fixed** in `merge-undo.tsx` and `workspace.tsx`. One pill for a merge, a delete, and a reject, newest first, drawn by the workspace, so it shows with the tray folded. `reject-undo.mjs`: pill with the tray open and folded; Undo with the tray folded puts the note back. `NOTE11-10-after-open.png`, `NOTE11-10-after-folded.png`.
- **Marks Needs: applied as written** (`markOfSource`, the chooser's Note row, the hold's `words` and `armed`). Re-run on my copy of the stacked cases (`.qa-tmp/marks/`): the stacked clicks offer every note and annotation, a Note row opens the note in the tray, the second of two highlights on the same words opens its card, a slow click (700 ms) opens the card, a 700 ms hold lifts the mark, and a 300 or 450 ms pause then a drag selects and opens the toolbar. Two observations, both the same on the loop branch's code without my package: (1) headless Chromium selects nothing when the mouse coordinates are fractional (the marks scripts' `pause.mjs` and `hold.mjs` press at a character's center); rounded coordinates select (`.qa-tmp/tools/marks-check.mjs`). (2) `holddrop.mjs` with a 650 ms hold onto a collapsed note row in the tray shows the ghost over the note but sends no request, so the source count stays 1; I could not confirm round 9's held drop here.

## Files

- `src/lib/toolbar-drafts.ts`: toolbar drafts read storage before each write and listen to the storage event; card drafts write only changed keys, keep bases (`unitos-card-draft-bases`), `onCardDraftsChange`, `cardCommentKey`. `saveCardDrafts` removed (no other caller).
- `src/components/reader/reader-interactions.tsx`: every reader fix above; the page, notes, and marks Needs.
- `src/components/assistant/answer-tools.tsx`: `CommentBox` takes `draft`/`onDraft`; Escape closes only the box.
- `src/app/api/derive/route.ts`: `conversationOf` carries a card's conversation onto the regenerated annotation (only a note of the same project with a source on the same document).
- `src/lib/anchors/passage-limit.ts` (new) and `src/lib/anchors/passage.ts`: `MAX_SEGMENTS` in a module the client can import; passage.ts re-exports it unchanged.
- `src/lib/i18n/dict/reader.ts`: `passageTooLong` (en, zh); `touchHint` wording (en, zh).
- `src/components/outline/merge-undo.tsx`: the reject in the one pill, newest change first.
- `src/components/outline/notes-tray.tsx`: no longer draws the pill (the workspace does).
- `src/components/reader/workspace.tsx`: draws the one pill in place of the reject bar.
- `SPEC.md`: §4 Regenerate, §6 drafts, placement, left-off mark, hint, Undo pill, §7 chat card and side chats.

## Decisions

- Regenerate deletes the old annotation once the new one is stored (SPEC §4 "the one it replaced goes then"), after copying its turns. Comments on the old answer (`Reply` rows) stay with the old annotation, which History keeps whole; they quote the old answer's words, so they are not moved onto the new text.
- ✕ on the assistant card no longer stops the turn in flight (TOOL11-02): Stop stops; ✕ and Escape close. SPEC §7 says so.
- PAGE11-02: I kept the bar's question as a toolbar draft (`assistant`, by its first block and offsets, a selection over some of the same words finds it) instead of the page worker's `barDraftKey` card draft, so one store holds it; `d03` passes.
- The edit hint (desktop too) is done after it plays once, not only after a double-click.
- A comment whose save fails on a dropped connection (fetch throws before any answer) is queued like a note write; a server error is not queued and reopens the box.
- I edited `src/lib/i18n/dict/reader.ts` (two strings, one new key) and moved `MAX_SEGMENTS` to `passage-limit.ts`; neither file was named for another worker.
- `workspace.tsx`, `merge-undo.tsx`, and `notes-tray.tsx` were edited under the coordinator's hand-over.
- I regenerated this worktree's Prisma client after merging the navigation package (`KeptDocument`); the table already existed in the database.

## Needs

- `src/components/assistant/assistant-panel.tsx`: the panel's comment on an answer should pass `draft`/`onDraft` to `CommentBox` (the reader's card does now); today the panel's comment box keeps nothing.
- Unsaved side chats (`AssistantChat.inputs` for a side chat with no note yet) have no cap beyond the card drafts' newest 50.
- `src/lib/prompts/types.ts:152`: the "Web sources" heading has no "(in the answer's language)" (audit note, not a finding).
- NAV11-15 (`src/lib/i18n/dict/works.ts`, from the notes Needs) is not mine and not done.
- The held drop onto a note row (round 9) should be checked by the marks or notes owner, per the observation above.
