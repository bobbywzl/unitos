# loop/r15-select

**Intent:** fix round 15's select package (PACKAGES.md section 1): marks, the toolbox and its keys, cards, slides and sheets, transcripts. The findings are SEL15-01 to 07 and 10 to 13, SEL15-06 with TOOL15-08 and EDGE15-07 (the card head decision), EDGE15-08, and EDGE15-10.

No finding in this package is blocking. No path touched here writes user data, apart from the Undo pill that a note-making drop now shows. That Undo deletes only the note the drop made, through the existing delete pill.

## Findings

Scripts are in `.qa-tmp/sel/` (copies of the audit's scripts on :3141, plus `head15.mjs`, `ctrla15.mjs`, `viewer15.mjs`). Screenshots are in `.qa-tmp/fix/<ID>-before.png` / `-after.png`, also copied to `/mnt/project-files/interaction-loop/round-15/img/`.

| ID | Fixed | Before | After |
|---|---|---|---|
| SEL15-01 | yes | `zhkeys.mjs`/`zh.mjs`: a double click on 大脑 selects the paragraph (79 characters) in Viewing and Editing. Ctrl+Shift+← selects "阅读时，我们的大脑". Ctrl+Backspace removes 9 characters. | 大脑 in both modes, and 一周. Ctrl+Shift+← gives "大脑", Ctrl+Shift+→ gives "会". Ctrl+Backspace removes 2 characters. Ctrl+Z is exact. |
| SEL15-02 | yes | `officecards.mjs`: the deck's card is 1008×131 at y 713, under the whole slide, and the slides below shift. The sheet's card is 1020 wide. `longsheet2.mjs`: the card opens at top 963 (viewport 900) and slides to 750. | The deck's card is 300×131 at (89, 509) by the words, and no block moves. The sheet's card is 300 wide at (235, 395). The long sheet's card is at 367 from its first frame (128 ms), with no slide. |
| SEL15-03 | yes | `linkshow.mjs`: the ends' ancestors are plain SPAN/TD, so the link is drawn at neither end. | `A.link-mark` at both ends (deck and sheet), after a reload. `linkoffice.mjs` makes the link and both ends show it. |
| SEL15-04 | yes | `kboffice.mjs` deck and book: 81 Tabs reach no mark, and Enter opens nothing. | 1 Tab from the article reaches the first mark ("View the annotation"). Enter opens its card. Escape gives the focus back to the mark. Ctrl+A and Alt+F10 still work. |
| SEL15-05 | yes | `video4.mjs`: after a click on a line, Space leaves the video paused at 37.5 s, with a ring on the line. | After the click the focus is the player's. Space plays (38.9 s, playing). A line takes Enter to seek. |
| SEL15-06 / TOOL15-08 / EDGE15-07 | yes | `head15.mjs`: the Explain card moves only after rests of 60–120 ms and lifts (the ghost) from 200 ms. The highlight card never moves and lifts from 120 ms. A finger lifts at 200 ms. A drop on the tray makes a note with no pill. | Every card (Explain, highlight) moves after rests of 60–250 ms and lifts at 350 ms. A finger moves the card up to 260 ms and lifts at 400 ms. The drop shows "Note added · Undo". Undo takes the note out (database: notes 1 → 2 → 1 after the delete pill's 12 s). |
| SEL15-07 | yes | `undoreply.mjs`: the comment card reads "COMMENT ✕" with 3 replies stored. | The card lists the replies (each with Resolve and ×) under the comment. The same applies to the annotation card. |
| SEL15-10 | yes | `video3.mjs`: the hover pill is 158×27 and covers words of the line above, on 4 of 4 lines. | Comment and Explain are 24 px icons (58×28 in all) in the margin left of the line's first row, covering no word on 4 of 4 lines. Their names are in aria-label and the tip. |
| SEL15-11 | yes | `explore.mjs`: the edit hint row stands over the sheet's last line. | No hint on slides or sheets. |
| SEL15-12 | yes | `slides2.mjs`: a click and a circle on the chart select nothing. `sheets.mjs`: a drag from row number 3 to "South" selects "". | A click or a circle on the chart selects its data ("Revenue Cost / Q1 3.8 2 / …") and opens the toolbox. The row number drag selects "South" with the toolbox. Nothing new is drawn. |
| SEL15-13 | yes | `editbar.mjs` at 1440: "⇥" and "Remove ¶" lie over Collapse. At 1000 the bar runs past the pane's left edge. | Collapse is on top at all three points at 1440 and at 1000. The bar sits under the band and wraps to two rows at 1000. |
| EDGE15-08 | yes | `viewer15.mjs` (sign-in on, isolated database `dissect_r15sel`, test reader 4 as viewer): a word, a phrase and a double click all open nothing. | One word or a double click shows a toolbox with Define alone. Define answers, and 0 notes and 0 sources are written (database). A phrase opens nothing. 0 write controls. |
| EDGE15-10 | yes | `ctrla15.mjs` zh copy: the first article Tab stop is the Translate button. Ctrl+A from the page start selects 546 characters of the page, not in the article, with no toolbox. Import (page editor): Ctrl+A selects 1,569–1,592 characters of the page, never the article. | zh: the first article stop is the article itself (Tab 11). Ctrl+A from the start, the header or the article selects 193 characters, in the article, with the toolbox. Import: 1,392 characters, in the article, with the toolbox, from all three. |

Rule zero, origin/main: no blocking finding is in this package. The losses the briefs list belong to other packages.

## Files

- `src/components/docs/typing/chars.ts`: `Intl.Segmenter("zh", word)` cuts runs of Han, Hiragana or Katakana. Full-width punctuation ends a word (SEL15-01).
- `src/components/reader/table-marks.ts`:
  - Link marks are drawn in SLIDE, SHEET and TABLE replicas (SEL15-03).
  - A mark's first piece is a Tab stop, and Enter opens it (SEL15-04).
  - A press on a chart or a row number starts the selection at its first word (SEL15-12).
- `src/components/reader/reader-interactions.tsx` (shared; small in-place hunks):
  - `passageBox` returns `left` and `blockHeight`. `overBlock` and `dockUnderWords`, with the tall-block branch in `claimSideSlot` and `layoutNarrowCards` (SEL15-02).
  - `officeDocument` hides the edit hint (SEL15-11).
  - `dragCard` holds for `TOUCH_HOLD_MS`. The annotation card's head row is `dragCard`, and `data-hold-head` is gone (SEL15-06).
  - `CardReplies` sits in the comment card and the annotation card (SEL15-07).
  - The viewer gates in `onMouseUp`, `onReaderKeyUp` and `onSelectionChange`. `has()` needs `canEdit` except for Define. The assistant row sits under `has("assistant")`, and the lead-tool effect is skipped for a viewer (EDGE15-08).
  - `onSelectAll` covers the page editor and every focus. `lastPressedPane` is new (EDGE15-10).
  - A `band` prop goes to `Reader` (SEL15-13).
- `src/components/reader/reader.tsx`:
  - Transcript lines: the focus moves to the player after a click, a line takes Enter only, and the icon tools sit in the margin with a 250 ms rest to switch lines (SEL15-05, 10).
  - The article is one Tab stop when no mark is on the path (EDGE15-10).
  - The edit bar sits under the band (SEL15-13).
- `src/components/video/video-pane.tsx`: the line tools are icon-only buttons with aria-label (SEL15-10).
- `src/components/video/video-player.tsx`: `data-video-player` on the root, so the line can hand it the focus (SEL15-05).
- `src/components/outline/use-outline.ts` (**notes package's file**): `addDroppedNote` posts the Undo pill (SEL15-06). The hunk is 3 lines plus the import.
- `src/lib/i18n/dict/reader.ts`: `reader.noteAdded`, en "Note added", zh "笔记已添加".
- `SPEC.md`:
  - §6 line 372: no edit hint on slides and sheets.
  - Line 373: the edit bar sits under the band.
  - Line 382: the keyboard line (article Tab stop, the Ctrl/Cmd+A rule, transcript Enter/Space, line tools in the margin).
  - Line 385: the head row at TOUCH_HOLD_MS for both pointers, and the Note added pill.
  - Line 696: a viewer's popover holds Define alone.
  - §27: a new "### Reading them" (marks, selecting, cards, no edit hint).
  - The page editor's word keys: Intl.Segmenter.

## Decisions

- SEL15-06: one hold time for both pointers. `TOUCH_HOLD_MS` (300 ms) is used, per the lead's decision, for the head row only. The hold on a card's blank space keeps `watchHold`'s own times.
- SEL15-02: a block counts as "tall" when it is taller than a third of the pane. Such a block keeps its height: the card stands over the block under the marked line, at most 300 px wide. Short paragraphs keep the old room-under-the-paragraph layout.
- SEL15-12: the chart's whole data is selected on a release over the chart. A drag extends from its first data word. Nothing new is drawn (the data text stays hidden, so there is no tint).
- SEL15-10: the line tools lost their visible words (icon-only, named in aria-label and the tip). That is shrinking, not a new control. On a phone they stand over the line, as before.
- SEL15-05: after a pointer click on a line the focus goes to the player, so Space plays. A keyboard Enter on a line keeps the focus on the line. After Space the player draws its own focus ring, the same ring it draws when it has the focus from Tab.
- EDGE15-08: a viewer gets no Ctrl+A toolbox (it would be empty for a multi-word selection), so the browser's Select all runs there.
- EDGE15-10: Ctrl+A with no pane pressed or focused goes to the first `[data-reader-root]` on the page. In split view the pane last pressed or focused wins.
- SEL15-13: the bar moves under the band only where the band exists (not split, not embedded, not a transcript, not the page editor). Elsewhere it stays at top-3.

## Needs (for the lead when merging)

- **Notes package file:** `src/components/outline/use-outline.ts` gets a 3-line hunk in `addDroppedNote` (`postUndoPill({ message: t("reader.noteAdded"), undo: () => removeNotes([id]) })`) and the `postUndoPill` import. If the notes package reshapes `addDroppedNote` or `removeNotes`, keep this call after the note lands.
- **Page package:** `CardReplies` renders `<ReplyThread target={{ noteId }} replies onChange>` as it is. The page package changes `reply-thread.tsx` (the delete pill, the draft). If its props change, adjust the one call in `CardReplies` (reader-interactions.tsx, near `lastPressedPane`).
- **i18n:** one new key, `reader.noteAdded` (en and zh).
- **SPEC:** the lines listed under Files. Line 382 (the keyboard paragraph) also holds round 14's sentence on Ctrl/Cmd+A "with the focus in the block reader's article", which my new sentence widens. Keep mine if another package also edits that line.
- **Test data:**
  - Rerunning `undoreply.mjs` adds a reply each time.
  - A Chromium crash right after the trash press committed the delete of my test comment "Notes comment SEL15" (6 replies), as designed (the pill commits on page close). It is in History as NOTE_REMOVE `cmv05gw8p00097djef910gvo9`, with its replies in the event's meta. Restore it there if the project is kept. My attempt to restore it through the History API was refused by the permission check.
  - The isolated database `dissect_r15sel` (made for the viewer check) is still there.
- **Not a bug:** the toolbox comment Save on speaker notes does send the POST. On my first try the route was still compiling. Recheck on a warm server if in doubt.
