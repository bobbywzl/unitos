# loop/r14-select

**Intent:** fix round 14's selection package (SEL14-01, 02, 05, 06, 08, 09, 10; TOOL14-03, EDGE14-09; PAGE14-02, EDGE14-06; PAGE14-07, PAGE14-11; EDGE14-05): marks, the toolbox and its keys, the cards a mark opens, and links, with the lead's Tab and focus decisions and no new visible control.

Before numbers come from the audit's scripts run against the base code (ff4a7fd) on this package's own project "Fix r14 select"; after numbers from the same scripts against this branch (:3141). Scripts: the audit's selection scripts in `.qa-tmp/sel/`, new ones in `.qa-tmp/mine/` (`keys.mjs` marks, Space, Escape, Tab, F10, Ctrl+A, the mode switch, the right-click menu; `cardhead.mjs` / `toolhead.mjs` a hold on a card's head; `linkrows.mjs`, `phonebanner.mjs` the link banner; `defineshot.mjs` Define frame by frame; `slideprobe.mjs` the column under a card). Logs `.qa-tmp/logs/`, screenshots `.qa-tmp/fix/<ID>-before.png` / `-after.png`, also copied to `/mnt/project-files/interaction-loop/round-14/img/`.

No blocking finding in this package (none touches a write path).

## Findings

| id | status | before → after |
|---|---|---|
| SEL14-01 | fixed | A click on a highlight left the focus on the mark: Space scrolled 0 → 0 and reopened the card; Escape drew a ring on the mark; a drag that started in a mark, then Space, opened the card → the focus is on the page (`BODY`), Space scrolls 0 → 693 (0 → 728 after Escape), no ring, a drag then Space scrolls. Space is never a mark's; Enter opens a mark the keys reached. `SEL14-01-*.png`, `SEL14-01b-*.png`, `SEL14-01-*.log` |
| TOOL14-03, EDGE14-09 | fixed (same cause) | A card the mouse opened, closed by Escape: focus `MARK` with a ring → `BODY`, no ring, Space scrolls 0 → 728. A card the keys opened still gives the focus back to its mark with the ring. `TOOL14-03-*.png`, `EDGE14-09-*.png` |
| SEL14-02, PAGE14-02, EDGE14-06 | fixed (the Tab decision) | Page editor in Editing with words selected: Tab went to the toolbox; the list line did not nest, the cell did not move → Tab nests "Third item" (depth 1 → 2), moves to the next cell (0 → 1). Alt+F10 and Shift+F10 move the focus to the toolbox's first row in every mode and reader; Tab still enters the toolbox in Viewing and the block reader. The right-click menu stays on Ctrl+Shift+X (13 rows). `SEL14-02-*.png`, `PAGE14-02-*.png`, `EDGE14-06-*.png` |
| EDGE14-05 | fixed | A keyboard reader in a block document (a mark reached with Tab): Ctrl+A selected the whole page (7815 characters), no toolbox → the article (7682 characters) and the toolbox opens; Alt+F10 focuses its first row; Escape twice clears the selection. `EDGE14-05-*.png` |
| PAGE14-07 | fixed | Editing → Viewing → Editing with words selected: the toolbox closed at the first switch → it stays on the selection with the new mode's rows (Assistant in Viewing, Edit with the assistant in Editing). A change of words still closes it. `PAGE14-07-*.png` |
| PAGE14-11 | fixed | Tab in the Shift+F10 right-click menu: the text grew by 1 (a tab typed) → 0, and the menu closes with the focus in the text. `PAGE14-11-*.png` |
| SEL14-06 | fixed | Define: the Add to notes row moved down in steps as the definition streamed (y 449 → 451 → 493 … 507) → one move to the word with Defining… and Stop, then the definition whole in one frame. Not a single frame from the press: Stop stays reachable while it is written. `SEL14-06-*.png`, `SEL14-06-*.log` |
| SEL14-08 | fixed | The cards over the article carried a separate grip glyph beside the head → the grip is gone; the card's head row is the handle: a drag moves the card ([768,501] → [688,509] on Explain), a hold of `HOLD_MS` with the pointer still lifts the annotation's ghost; dropped on a note it adds the annotation reference (database: note `cmuziurys000r7desz2lpqhb5` holds the `[Highlight](…)` row). The head's tip says Hold, then drag onto a note while a note can take the drop. Before: the audit's `selection-14-08a-grip-drag.png`. After: `SEL14-08-after.png` (1440), `SEL14-08b-after.png` (390), `SEL14-08c-after.png` (Explain). |
| SEL14-09 | partly fixed | The mark's tip "Click to view the annotation" → "View the annotation" (and "View the note"): words a touch reader can follow. The tip still shows on a long press of a mark (500 and 800 ms): `tooltip.tsx` is package 4's (Needs). `SEL14-09-*.png` |
| SEL14-10 | fixed | The link banner stood over the first line of the article (y 120–155) → in the block reader it stands in the article's band (x 185, y 84, 592 × 28; band 68–116), left of the controls, with the whole sentence; at 390 and 1000 px, where the band is narrower than 24rem, it wraps under the controls, as before. The toolbox rows do not jump before the card shows (530 → 500 in the frame the card appears); the Link here jump was not reproduced. `SEL14-10-*.png` |
| SEL14-05 | not fixed: not reproduced | `slideprobe.mjs`, 4 runs: `--cards-room` is set once (112px) and the column moves in one continuous transition (left 158 → 46 within ~240–670 ms), with no pause. The audit's pause fits a main-thread long task during the transition. The column's slide itself waits on Linda (SEL13-10). `SEL14-05-before.png`, `SEL14-05-probe.log` |

Regression: the audit's focus, keys and selection scripts on this branch; Explain on fresh words, the card drag, Add to notes, the context menu (13 rows), the Escape order. The machine's memory pressure crashed the dev server and Chromium several times; each run was repeated.

## Moved actions (every action stays reachable)
- The grip on the reader's cards over the article (Explain, Simplify, the analysis, the visualization, the assistant's card, a comment, a highlight) → a hold on the card's head row. The page editor's comment card keeps its grip.
- The toolbox from the keyboard in Editing and Suggesting: Tab → Alt+F10 or Shift+F10 (Tab is the text's there).
- Space on a focused mark no longer opens it: Enter does.
- The link banner in the block reader: under the controls → in the band, left of the controls.

## Files
- `src/components/reader/block-view.tsx`: Space out of a mark's keys; a press on a mark gives the focus back to the page.
- `src/components/reader/reader-interactions.tsx`: `layerByKeyRef` (a layer the mouse opened gives the focus to the page); Tab handler (Editing and Suggesting keep Tab), `onF10`; Ctrl+A with the focus in the article; `toolboxDocRef` (a mode switch keeps the toolbox); `dragCard` takes the annotation reference and lifts it on a hold; the annotation card's head is `data-hold-head`; the grips out of the reader's cards; Define shows the text once whole; the link banner (`linkBanner`, `bandBanner`) in the band.
- `src/components/docs/insert/context-menu.tsx` (package 5's file, one effect in `ContextMenuHost`): Tab closes the right-click menu and types nothing (PAGE14-11 named this menu). Registered at mount on document capture, so it runs before the menu's own Tab close unmounts it.
- `src/lib/i18n/dict/reader.ts`: `holdToNote` (en, zh).
- `src/lib/i18n/dict/panes.ts` (package 4's file, two keys): `viewAnnotation`, `viewNote` without "Click to" (en, zh).
- `SPEC.md`: §6 the keyboard paragraph (line ~382), the quote by drag (~353), a note takes drops (~385), Link across texts (~390); §4 `DEFINE` (~274); §29 the right-click menu (~1170).

## Decisions
- Shift+F10 goes to the toolbox when the toolbox is open; with no toolbox the page editor's right-click menu keeps Shift+F10, and Ctrl+Shift+X / Ctrl+Shift+\ open the menu in every case.
- Define: the indicator with Stop, then the whole text; not one frame from the press, so Stop stays.
- The link banner wraps under the controls when the band is narrower than 24rem (phone, a narrow pane) rather than shrinking to an unreadable pill.
- The page editor's comment card keeps its grip: the card is package 5's file, and its head has no drag to share.
- A card's head row: a drag moves the card, a hold lifts the annotation, the same split as a note's header row in its editing mode. Mouse `HOLD_MS` (150 ms).
- SEL14-05 not changed: not reproduced on this machine.

## Needs
- Package 4 (nav), `src/components/tooltip.tsx`: `isLongPressControl` should exclude `mark` elements, so a long press on a mark shows no tip (the rest of SEL14-09).
- Package 4: the two `panes.ts` keys above are in their file; keep both en and zh.
- Package 5 (page): the `context-menu.tsx` effect above is in their file. Merge it next to their edits; it is one `useRef` and two `useEffect`s before `if (!place) return null`.
- Package 3 (notes) or 5: the page editor's comment card (`layer/comment-card.tsx`) could lift from its head on a hold as the reader's cards now do, and drop its grip.
- The touch decision (a hold lifts at 300 ms on a coarse pointer) lives in `lib/hold-drag.ts`; the card head uses `HOLD_MS` from there, so it follows whatever that file sets.
