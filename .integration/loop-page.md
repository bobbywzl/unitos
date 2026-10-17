# loop/page

**Intent:** Fix the page editor package of the audit (page.md P1, P3, P5, P6, P8, P9, and tools.md T18) in `src/components/docs/**`, and write what other files need under Needs.

## Findings

Screenshots are under `.qa-tmp/fix/` in the worktree (not committed: `.qa-tmp` is ignored). Every finding was checked in one browser pass on this worktree's dev server (port 3123, 1440×900). The befores ran on the base code (9ecd2b3's `src/components/docs` put back for the run) and the afters on the branch head. The scripts are `.qa-tmp/fix/f-all.mjs` (TAG=before|after; P5, P8, P9, P6, P3, T18 in one session) and `.qa-tmp/fix/f-p1.mjs`; their logs are `f-all-before.out`, `f-all-after.out`, `f-all-after-p3.out`, `f-all-after-t18.out`, `f-all-after-p9.out`, `f-p1-before.out`, and `f-p1-after.out`.

- **P1: fixed.** Before: after a reload at scroll 365 the caret stood at the document's start, out of view, and the first key typed "QAlpha…" and threw the pane to 222. After: the caret stands at the start of the block at the reading line; when that block began above the toolbar, at the start of its first whole line under the toolbar (Echo's third line, top 196, toolbar bottom 182). Q lands there, and the pane stays at 365, in two runs. Home after End goes to the line's start (audit note N1 not reproduced). `P1-before.png`, `P1-before-reload.png`, `P1-after.png`, `P1-after-reload.png`.
- **P3: fixed.** Before: a drag along the last line in view (17 px above the pane's bottom) selected 866 characters and scrolled the pane 300 px; a rest 12 px above the edge scrolled 365 px in 0.5 s. After: the drags along the last three lines select 35, 35, and 38 characters with no scroll; a rest 12 px above the edge scrolls 134 px in 1.5 s, and a rest 3 px above it scrolls at once. The drags change no text (checked). `P3-before.png`, `P3-after.png`.
- **P5: fixed.** Before: in Editing a click on the words of an Explain opened the Explanation card. After: in Editing and Suggesting a click places the caret and opens nothing. Ctrl+click (⌘ on a Mac) opens the card, and so does the mark's chip; the mark's tooltip reads "Ctrl+click to view the annotation". In Viewing a click opens the card as before. A suggestion card stays in reach: its Reject sits at y 427, pressable. `P5-before.png`, `P5-before-ctrl-click.png`, `P5-after.png`, `P5-after-ctrl-click.png`.
- **P6: fixed.** Before: Escape left Version history open; after Back, and after Viewing → Editing, the editor had no focus and a typed "v" went nowhere. After: Escape closes Version history; after Escape, Back, and Viewing → Editing the editor has the focus at the same caret (2952) and scroll (365), and "v" lands in "Lima paragraph". `P6-before.png`, `P6-before-escape.png`, `P6-before-mode.png`, `P6-after.png`, `P6-after-mode.png`.
- **P8: fixed.** Before: Shift+Tab at a list line's end typed a tab, three times ("Third item⇥⇥⇥"), and in a paragraph's middle it typed one too. After: Shift+Tab never types a tab: at the line's end it does nothing at level 1, and in a paragraph's middle it does nothing. Tab and Shift+Tab at a list line's start nest and lift as before. `P8-before.png`, `P8-after.png`.
- **P9: page side fixed; the reader side is under Needs.** Before and after on this branch: Ctrl+K on a selected word opens the link box at [382,781] with the field focused, while the selection toolbar stays at [1110,617]. The link box now sends `dissect:close-toolbar` from the page as it opens. With a listener for it added to `reader-interactions.tsx` for the run only (not committed), the toolbar closes, the link box takes the keys, and Escape gives the page back its selection ("Hotel"). `P9-before.png`, `P9-after.png` (without the listener), `P9-after-with-listener.png`.
- **T18: fixed.** Before: with a suggestion card open at [757,899], the next card stood at [907,943] in a 900 px window while its words were in view. After: the open card and the card under it go up together, [706,848] and [856,892], and the open card still stands beside its words; its Accept is pressable at y 727. The Feedback control no longer sits on the card column: it is the 36 px round icon at [1396,804,1432,840], right of the column (which ends at x 1376). `T18-before.png`, `T18-before-end.png`, `T18-after.png`, `T18-after-end.png`.

The first after-run found a bug in the P3 drag of commit b4150a0: the selection grown on the drag's first move held the press point, so Chromium started a native drag and drop, and three drags moved a few letters each in the test document. Commit 28dc66c cancels that drag and drop, and the reruns show no text changed by a drag; the words in the test document were put back (`.qa-tmp/fix/fix-india.mjs`, and the first lines of `probe-p3.mjs`). No other document was touched.

### The page audit's scripts, rerun on the head

All of `.qa-tmp/audit/page/` p00–p20 and q01–q26, one browser at a time, the test document "Page fix (loop/page)" reset with `mkdoc.mjs` before each (`.qa-tmp/fix/rerun.sh`; logs in `.qa-tmp/fix/rerun/`). Every script exits 0 except these four, none for a fault in this branch:

- `p01-dom`: the script reads `className.split` on an SVG element and throws before it measures anything; not in the audit's results either.
- `q04-two-tabs`: the first run timed out waiting for `networkidle` after a reload (the two tabs poll every 2 s). Run again on a new document it exits 0 with every line as in the audit: the other tab's words land, and Home, End, and Backspace act at the caret (`q04-two-tabs-2.out`).
- `q15-ai-tools`: on the reset document it failed, because `mkdoc` resets the text but the Explain, Simplify, and highlight from earlier runs re-anchor by their quotes. A chip at the end of a mark moved the script's drag target to the line's end, and the existing highlight disables Highlight in sage. Run on a new document it exits 0, and every line matches the audit's run on the base code (`q15-ai-tools-3.out`).
- `q17-suggest`: it stops at line 28 (`at(p, "new Juliet")` finds nothing), as the audit's own run did. Before that line the head does better than the base: the click in "Kilo" moves the caret there in Suggesting, so Ctrl+Backspace suggests removing "Kilo", where the base run removed "Juliet" because its click on a mark opened a card instead (P5).

Drags compared with the audit: a drag inside a selection still moves the words (`q07`). A drag to the pane's bottom edge, held, still scrolls to the end and selects to the pointer (`p05`). A drag along the last line in view selects 35 characters, where the audit saw 866 (`q14`). The first run of `p07` hit its 900 s timeout while the machine thrashed (load 50 to 60, 14 of 15 GB used); it exits 0 after the dev server's restart.

Type check: the full `npx tsc --noEmit` ran out its 30 minutes under that load. A focused run (`.qa-tmp/tsconfig.focus.json`: every file in `src/components/docs/` and `docsLayer.ts`, with all they import, 282 files under `src/`) is clean. `npx eslint` is clean on every changed file.

## Files

- `src/components/docs/docs-editor.tsx`: the caret at the reading position after a load (`readingCaret`, `caretAtReadingPosition`) (P1); the marks know whether the page is being written (`marksEditing`), and a click on the page while it is editable opens no mark (P5); a switch to Editing or Suggesting focuses the page at its caret (P6).
- `src/components/docs/page/margin-select.ts`: one edge scroll for drags (`edgeScroll`: the band, its rim, the rest, the gentle ramp) used by the margin drag and by a new drag on the words (`followTextDrag`), which owns the selection and the scroll and cancels the browser's drag and drop of the words it selects (P3).
- `src/components/docs/areas/page.tsx`: a press on the words starts `followTextDrag` (P3).
- `src/components/docs/page/geometry.ts`: `scrollParent` also finds the pane while its scroll is held off (`data-edge-drag`) (P3).
- `src/components/docs/frame.css`: `[data-page-editor][data-edge-drag]` holds the browser's own scroll off during a drag (P3).
- `src/components/docs/annotation-marks.tsx`: in Editing and Suggesting a plain click places the caret, Ctrl/⌘+click opens the mark, and the tooltip says so (P5).
- `src/lib/i18n/dict/docsLayer.ts`: `modClickAnnotation`, `modClickNote` in en and zh (P5).
- `src/components/docs/suggest/layer.tsx`: the open card goes above a fixed card instead of below the pane's bottom (P5), and the cards under the open card whose words are in view end inside the pane (T18).
- `src/components/docs/versions/version-history.tsx`: Back focuses the page at its caret (P6).
- `src/components/docs/versions/version-view.tsx`: Escape closes Version history (P6).
- `src/components/docs/typing/keys.ts`: Shift+Tab never types a tab (P8).
- `src/components/docs/typing/events.ts`: `CLOSE_TOOLBAR_EVENT` (P9).
- `src/components/docs/link-dialog.tsx`: sends `CLOSE_TOOLBAR_EVENT` as the link box opens (P9).
- `SPEC.md` §29: the lines for Version history, The page, The caret, the mode at the right end, Tab, Links, the card column, and The Unitos layer.

## Decisions

- P1: when the block at the reading line began above the toolbar, the caret goes to the start of the first whole line under the toolbar, not to the block's start (which would scroll the pane). The caret follows the reading position while reader-interactions holds it (up to `POSITION_HOLD_MS`) and stops at the reader's first press, key, wheel, touch, or own selection.
- P3: the page takes the drag on the words over from Chromium (the pane's own scroll held off with `overflow-y: hidden` during the drag, its scrollbar's room kept as padding so nothing moves), because Chromium's selection autoscroll starts 20 px inside the edge and cannot be slowed. A press on selected words still moves them (native drag and drop), and a double or triple click's drag stays the browser's.
- P5: the card opens from Ctrl/⌘+click and from the mark's chip, not from a hover, so a click while writing always places the caret. The tooltip names the keys the platform's way.
- P6: Escape in Version history is heard on the document in the bubble phase and yields to an open menu or dialog and to the panel's text fields.
- T18: the open card may go up as long as at least 20 px of it stays level with its words; past that the next card stays below the window, as before.

## Needs

- `src/components/reader/reader-interactions.tsx` (P9): listen for `dissect:close-toolbar` on the pane container, next to `dissect:toast`, and close the selection toolbar: `const onCloseToolbar = () => { setPopover(null); setSubmenu(null); };` with `container.addEventListener("dissect:close-toolbar", onCloseToolbar)` and its removal in the cleanup. Checked in the browser with exactly this code.

## Data this worker added

All in project Interaction QA (`cmuryv6oc00007dpbl3k6sjo7`): the blank documents "Page fix (loop/page)" `cmut44fzt00007d8lnkdfx401`, which `mkdoc.mjs` reset many times and which holds the Explains, Simplifies, comments, highlights, and assistant runs of these checks, and three new documents for the reruns: "Page fix q15 (loop/page)" `cmutn4p6y01dr7dlqv6ch7gsw`, "Page fix q04-two-tabs (loop/page)" `cmutn5py901fj7dlqzrxhv0ec`, and "Page fix q17-suggest (loop/page)" `cmutn74w601gp7dlqukyu81ym`. Nothing else was written, and nothing was deleted.
