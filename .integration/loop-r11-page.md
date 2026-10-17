# loop/r11-page

**Intent:** fix the round 11 page editor findings (PAGE11-01 to PAGE11-09 in `.qa-tmp/audit/r11/page.md`) and SEL11-01 for the page editor, in the files the page editor owns.

## Findings

Screenshots are under `.qa-tmp/fix/` in this worktree (git-excluded). Scripts are under `.qa-tmp/audit/r11/page/`, pointed at :3132 and at this round's own test project.

- **PAGE11-01 (blocking, rule zero): fixed.** Restore this version now saves the text on screen and keeps it as a version before it restores. If either step fails, nothing is restored, the page keeps its text, and the panel says "Your current text could not be kept as a version, so nothing was restored. Check your connection and try again." Proof: `p01-restore-kept.mjs offline-saved | offline-unsaved | online` checks the DocumentVersion rows and the stored rich text. Offline, with the words saved or not saved, the restore is refused: the words stay in the editor and the stored text, and no version row is added. Back online, a second Restore keeps a version that holds the words, then restores. All three modes PASS. `d02-restore.mjs offline` now shows the same. Shots: `PAGE11-01-before.png`, `PAGE11-01-after.png`, `PAGE11-01-after-unsaved.png`.
- **PAGE11-02 (blocking): fixed only once Needs (1) is applied.** The assistant's bar lives in reader-interactions.tsx and nothing of it is in docs. With the diff applied, `d03-escape-drafts.mjs` shows the Assistant draft back after Escape and reopen. Shots: `PAGE11-02-before.png`, `PAGE11-02-after.png` (taken with the diff applied in the working tree, not committed).
- **PAGE11-03: fixed** in `docs/layer/collapse.tsx`. The collapsed view takes the click on a core itself. A press that did not move, with no words selected and not on a mark or a chip, reads the unit whole. `k01-core-click.mjs` gives cores 26 → 25 and the clicked core is read whole. Shots: `PAGE11-03-before.png`, `PAGE11-03-after.png`.
- **PAGE11-04: fixed** in `docs/layer/left-off.ts`. `k02-leftoff.mjs 1500`: the scroll is still restored to 1431 as before, and the ribbon is now at y 202, under the header bottom at 182 (before: 144, hidden). It is also in view at 700 and at 1000 wide (191), and the page-gap case is unchanged (430). Shots: `PAGE11-04-before.png`, `PAGE11-04-after.png`.
- **PAGE11-05: fixed** in the new `docs/page/keep-place.ts`. `r03-reflow-middle.mjs`: Show pages from the middle went to 2710 (before: 18, the title). `r01-reflow.mjs 1000`: Viewing → Editing → Viewing keeps "Researchers measure…" in view (before: the title). The 390 touch run is close (Editing 144 vs 499 in Viewing, and the block at the line is kept). Shots: `PAGE11-05-before.png`, `PAGE11-05-after.png`.
- **PAGE11-06: fixed** in `docs/docs-editor.tsx`. `r04-edit-caret.mjs`, by the menu and by the keys: the caret goes to 3126, the start of the first block in view (y 205). "Q" lands there and the scroll stays at 1234 (before: the caret at 1, Q in the title, and the pane jumped to 65). Shots: `PAGE11-06-before.png`, `PAGE11-06-after.png`.
- **PAGE11-07: fixed on the docs side; the reader's one-line change is Needs (2).** `c01-collapse-editing.mjs` with the diff applied: Collapse off goes back to editing and the typed "Z" lands after the words (before: viewing, and the key typed nothing). Shots: `PAGE11-07-before.png`, `PAGE11-07-after.png`.
- **PAGE11-08: fixed.** The box now reads "Copy suggestions" (zh 复制建议). Comments are annotations, which stay with the original (SPEC §29). Shots: `PAGE11-08-before.png`, `PAGE11-08-after.png` (`d04b-copy-dialog.mjs`).
- **PAGE11-09: fixed** in `version-view.tsx` and `css/versions.css`. On a pane under 600 px the panel stacks under the page. At 390 touch the panel is [0,465,390,325] and the page [12,140,366,…] fits the canvas (before: panel 195 wide, page 408 wide in a 195 canvas). The 1440 layout is unchanged. Shots: `PAGE11-09-before.png`, `PAGE11-09-after.png` (`v02-phone.mjs`).
- **SEL11-01 (page editor side): fixed; the chooser's note row is Needs (3).** Every annotation and note on the clicked words rides on the mark (`data-stack-sources`), and a click (a Ctrl+click while writing) sends them all to the reader's chooser at the click. The mark's pick no longer depends on row order, and a highlight's color paints over a nested note's clay. `sel-click.mjs`: highlight + note on the same words, and a note nested in gold, open a chooser with Highlight and Note in Viewing and with Ctrl+click in Editing. With Needs (3) applied, the Note row sends show-note. Shots: `SEL11-01-before.png`, `SEL11-01-after.png`, `SEL11-01-before-nested.png`, `SEL11-01-after-nested.png`.

## Regression run

I ran the area's whole script set against :3132 with the Needs diff applied in the working tree (`.qa-tmp/run-all.sh`, log `.qa-tmp/fix/run-all.log`). These pass as in the audit or better: d01 (all four cases; the first run of case 4 fell to a dev-server restart and passed on a rerun), d02 online, d03 (all three drafts back), d05, d06, d07 (B's words merged into the restored text), s01, s02, c01, c02, k01 (blank document and Markdown import), k02 (1500 and 900), m01, o01, r01 (1000 and 390 touch), r02 (Markdown import, and the PDF in pages), r03, r04, v01 (1440 and 390 touch), v02, z01, sel-click, d04b. d02 offline now refuses the restore and keeps the word: this is PAGE11-01's new behavior. One open item in f01: the Define stack measured a pending suggestion card ("You Add: R11sugA") that s01 left in the same document. That is a test-data effect, not a change in this branch. The machine was short of memory throughout (other workers' dev servers), so Chromium and the dev servers were OOM-killed several times. Every script that crashed was rerun to a clean finish.

## Files

- `src/components/docs/layer/flush.ts`: `flushDocument` answers whether every pane's text reached the server. A failed flush counts as false instead of being swallowed.
- `src/components/docs/use-docs-save.ts`: `flush` returns whether the stored copy matches the screen.
- `src/components/docs/docs-editor.tsx`: the page editor registers its own flush, so imports are covered too. It also holds the keep-place hook (PAGE11-05), the caret placed at the reading line on a switch out of Viewing (PAGE11-06, `readingCaret`, `caretInView`), the return from Collapse (PAGE11-07), and the click point passed to `openMarkAt` (SEL11-01).
- `src/components/docs/versions/version-view.tsx`: Restore waits for the flush and the version POST, and stops with a message when either fails. Name current version refuses unsaved text. Narrow layout (PAGE11-09).
- `src/components/docs/versions/version-history.tsx`: Name current version refuses unsaved text.
- `src/app/api/documents/[documentId]/versions/route.ts`: the 400 for an empty text now also carries `reason: "empty"`, so Restore can tell "nothing to keep" from a failure.
- `src/lib/i18n/dict/docsVersions.ts`: `restoreNotKept`, `notSaved` (en, zh).
- `src/components/docs/layer/collapse.tsx`: a click on a core reads its unit whole.
- `src/components/docs/layer/left-off.ts`: once the pane stands at the position, the mark moves to the first block whose top shows under the header, or inside a tall block at the reading line.
- `src/components/docs/page/keep-place.ts` (new): keeps the block at the reading line across pages and pageless.
- `src/components/docs/toolbar.tsx`, `src/components/docs/typing/events.ts`: the mode request `{ mode: "viewing", collapse: true }`.
- `src/lib/i18n/dict/docsPage.ts`: `copySuggestions` reads "Copy suggestions" / 复制建议.
- `src/components/docs/css/versions.css`: the stacked layout under 600 px.
- `src/components/docs/annotation-marks.tsx`: `data-stack-sources`, the order-free pick, an annotation's color over a note's clay, and `openMarkAt(target, at)` that sends `sources`.
- `SPEC.md`: §29 Version history (restore and naming offline, the phone layout), §29 Make a copy, §29 the Unitos layer (stacked marks), §28 page editor (click on a core, Collapse off), §6 left-off mark in the page editor, §30 imports (caret on leaving Viewing, keep-place).

## Decisions

- PAGE11-01: I chose "wait for both, else stop" over one server-side restore save. The restore stays one client change that Ctrl+Z takes back, and the save path (`rich-text` route) is unchanged. The server answers `reason: "empty"` so an empty text still restores.
- PAGE11-01: the page editor now registers its own flush with `layer/flush.ts`, beside the reader's registration, which is for blank documents only. Two concurrent flushes are safe because `save()` runs one at a time.
- PAGE11-04: I placed the mark on the first block whose top shows, not at the reading line. A line drawn through the middle of a paragraph reads as a rule across the words. The first block in view is the block the reader reads into next. Drawing at the line is kept only as the fallback for a block taller than the pane. The scroll is never moved for the mark.
- PAGE11-05: the place is read on every scroll (once a frame) and put back for 1.5 s after a layout swap, or until a wheel, touch, press, or key. That is shorter than the reader's 8 s hold on open, because the pages here are already measured.
- PAGE11-06: `readingCaret` falls to the next block's start when the only line of a block under the header is its last. This also improves the after-reload caret (P1).
- PAGE11-07: an explicit mode request instead of guessing from timing. Until the reader sends it, nothing changes.
- PAGE11-08: I relabeled the box instead of copying comments, per SPEC §29 ("comments … stay with the original").
- PAGE11-09: on a phone the list sits under the page, not first-list-then-page. One screen shows both, and Back and Escape work as before.
- SEL11-01: the page editor sends every source (annotations and notes) in `sources` to the existing chooser event, so the block reader's fix for the same finding and this one meet in one chooser.
- I treated the page editor's dict namespaces (`docsVersions`, `docsPage`) as part of the page editor package.

## Needs

The exact diff is `.qa-tmp/needs-reader-interactions.diff` in this worktree (applied in the working tree for the runs, not committed). It covers:

1. **PAGE11-02**, `src/components/reader/reader-interactions.tsx`: keep the assistant bar's typed instruction in the card drafts, keyed by its words (`barDraftKey(anchor)` = `bar:` + every segment's blockId:layer:start-end). `keepCardDraft(barDraftKey(bar.anchor), bar.input)` runs with the other cards' drafts, and `openBar` starts from `cardDraftsRef.current?.[barDraftKey(target.anchor)] ?? ""`. Send already sets the input to "", which clears the draft. SPEC §29's sentence "Escape or a press anywhere else closes the bar and stops nothing" should add: "and the typed instruction comes back when the bar opens again on the same words, until Send".
2. **PAGE11-07**, the same file, the Collapse button: `fireDocs(page, DOCS_EVENT.mode, { mode: "viewing", collapse: true } satisfies ModeRequest)` in place of `"viewing"`, and import `type ModeRequest` from `@/components/docs/typing/events`.
3. **SEL11-01**, the same file, the stack chooser: a source with no annotation (`annotationBubbles` and `annotationsBySource` miss it) whose mark in `anchorHighlights` is a plain note gets a "Note" row in clay (`t("reader.note")`) that dispatches `dissect:show-note {noteId}`. Also `src/lib/i18n/dict/reader.ts`: `note: "Note"` / `"笔记"`. Skip this if the block reader's SEL11-01 fix already lists notes in the chooser. The page editor sends the same `sources` list that the block reader sends.
4. **N2 (block reader left-off mark)**, `src/components/reader/reader.tsx` `LeftOffMark` / reader-interactions.tsx `setLeftOffBlockId`: the same rule as PAGE11-04. On an exact restore (the tab's copy), when the position's block's top is above the pane's top edge, put the mark above the first block whose top shows.
