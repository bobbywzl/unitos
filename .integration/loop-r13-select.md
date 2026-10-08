# loop/r13-select

**Intent:** fix round 13's selection package (SEL13-01, 02, 03, 06, 07, 08, 09, 11, 12; TOOL13-07): marks, the cards a mark opens, the toolbox, Add to notes and links, for the keyboard, the phone and density, without a new visible control.

Before numbers come from the audit's own scripts run against the base code (63104a8, the :3111 server, on this package's own project "Fix r13 select"); after numbers from the same scripts against this branch (:3141). Scripts and logs: `.qa-tmp/sel/` (`before/`, `after1/`, `reg/`), screenshots `.qa-tmp/fix/<id>-before.png` / `-after.png`. New scripts: `kbmark.mjs` (Tab to a highlight, Enter, Escape; Explain by the keys), `kbpe2.mjs` (page editor: Tab, Shift+Tab, Enter on a color, Escape), `sel11.mjs` (margin card while selecting), `addpick.mjs` / `addrc.mjs` (Add to a note and right-click Add to notes, read back from the database), `marks2.mjs` / `marks3.mjs` (seeding).

## Findings

| id | status | before → after |
|---|---|---|
| SEL13-01 | fixed | Phone, page editor in Editing: tap on a highlight opened nothing (`[]`), only a 6x6 px chip → the tap opens the card (`["HIGHLIGHT ✕"]`); a second tap on the same mark or a tap off the marks places the caret; a tap within 12 px of a chip is the chip's; every chip is a 24 px target on a coarse pointer (CSS hit area). `fix/SEL13-01-*.png` |
| SEL13-02 | fixed | Tab never reached a highlight; Enter on a comment chip left the focus on the chip; Escape dropped it on a link end → a mark takes the focus at its first words (role button, its tip as name); Enter opens its card with the focus in the card's field; Escape closes it and the focus is back on the mark (`kbmark.mjs`: `MARK.hl-gold` → `[card annotation]TEXTAREA` → `MARK.hl-gold`). Chips leave the Tab order (`tabIndex=-1`), they stay for the pointer. `fix/SEL13-02-*.png` |
| SEL13-03 | fixed | Tab order Assistant first, Add to notes 12th → the drawn order: 4 colors, voice, Add to notes (6th), ▾, Assistant… Page editor: Tab closed the toolbox, nothing highlighted by keyboard → Tab enters the toolbox, Shift+Tab goes back to the words with the selection kept (12 chars), Enter on a color highlights, Escape from the toolbox gives the focus back to the editor with the selection kept. Escape from the picker: picker → panel → closed (a layer skipped) → picker → toolbox → closed. `fix/SEL13-03-*.png`, `fix/SEL13-03b-*.png` |
| TOOL13-07 | fixed | Tab presses from a fresh selection to the toolbox's first row: 8 (`kbtab1.mjs`) → 1. Explain by Enter: the focus fell to the page → the card takes it (first control past the grip; kept while the answer lands); Escape → the focus on the new mark (`MARK.tool-mark`). `fix/TOOL13-07-*.png` |
| SEL13-06 | fixed in the reader; the rest is Needs | Highlight card: Delete a red word and Link a bare chain at the foot → one head for both reader cards: kind, ✓ (comment), Link across texts (highlight), trash, ✕. The foot (mic, Save) shows only while writing, so the card at rest lost a row (390: 163 → 151 px tall). The page editor's comment card and the Annotations tab are other packages' files (Needs). `fix/SEL13-06-*.png` |
| SEL13-07 | fixed | Link's tip "Link to other texts" → its name is Link across texts (aria-label) and its tip the toolbox row's tip (`reader.linkTitle`). On a phone the 36 px button stands in the head next to Delete; a long press shows the tip once package 4's tooltip change lands. `fix/SEL13-07-*.png` |
| SEL13-08 | fixed | "press Close link ✕" → "press Link here"; the row says Link here. After the link: card + toast "Link created" + Saved → card + Saved (no toast). Skip removed: ✕ / Escape keep the link, as Skip did. `fix/SEL13-08-*.png`, `fix/SEL13-08b-*.png` |
| SEL13-09 | fixed | Existing note: drag + ▾ + Add to a note… + the note = 4 → drag + ▾ + the note = 3. Toolbox with the picker 352–839 (487 px, 18 controls) → 378–680 (302 px, 11 controls): the tools fold away while the panel is open. Proved in the database: the picked note ends with the quote and the typed words (`addpick.mjs`); the one-press add after a kept ▾ draft writes the words and clears the draft (`draftadd.mjs`). Page editor right-click Add to notes opened the panel → adds in one press (notes 2 → 3, `addrc.mjs`). `fix/SEL13-09-*.png` |
| SEL13-11 | fixed | Margin comment card y 368 at rest → 579 with the toolbox open (211 px jump) → 368 (holds still; the toolbox, already on a higher layer, stands over it). `fix/SEL13-11-*.png` |
| SEL13-12 | fixed | Phone cards: ✕ 25x24, dots 20x20, Delete 36x16, Link 24x24, comment ✓/trash/✕ 24x24 → every head button 36x36, dots 28x28; chips 24 px hit area. `fix/SEL13-12-*.png` |

Regression (area scripts on this branch): toolbox counts 14 / 13 rows at 1440 and 390 in all three documents (unchanged), phone rows reachable top / middle / foot (0 covered), drafts kept (Add to notes field after Escape, highlight comment, comment card), kept ▾ draft rides into the one-press add, click on a mark after rest 0 / 300 / 1200 ms opens it, tables (cell mark, cross-cell add), no toast after highlight / comment / add, selcheck (chips in the margin, chooser, comment card, one-press add). The memory pressure on the machine made several first runs crash or time out; each was rerun.

## Moved actions (every action stays reachable)
- Highlight card: Delete (foot, word) → head, trash icon; Link (foot, icon) → head, same icon, named Link across texts.
- Add to notes ▾: "Add to a note…" row removed; its picker is in the panel directly under "Which note?". "New note in" rows show only with two sections or more; with one, the one-press Add to notes (and Enter in the field) is that row.
- Link card: Skip removed; ✕ and Escape do what it did.
- The "Link created" toast removed; the link card says it.

## Files
- `src/components/reader/reader-interactions.tsx`: toolbox rows in drawn order (the colors and Add to notes blocks moved above Define / Assistant, their `order-*` classes kept so nothing moves on screen); Add to notes panel; right-click Add to notes one press (`pendingAdd`); the Tab handler; the layer focus tracking (`CARD_OF_LAYER`, `layerOpenerRef`, the after-render effect); highlight card head; coarse sizes (`cardIcon`); Link here, no toast, no Skip; `data-extract-card`.
- `src/components/reader/block-view.tsx`: focusable marks (Enter / Space open), chips out of the Tab order.
- `src/components/reader/note-picker.tsx`: `autoFocus` and `listClassName` props (defaults unchanged for the annotation menu).
- `src/components/docs/annotation-marks.tsx`: `tapMark` (tap on a mark in Editing on a coarse pointer; chip reach 12 px).
- `src/app/globals.css`: the coarse 24 px hit area for `.mark-chip` (`::after`).
- `src/components/docs/suggest/layer.tsx` (package 5's file, one line): `[data-layer-toolbar]` out of `FIXED`, so margin cards no longer flow around the toolbox (SEL13-11 named this file).
- `src/lib/i18n/dict/reader.ts`: closeLink → Link here / 链接到这里, linkingBanner (en, zh); removed linkCreated, linkSkip, linkSkipTitle (en, zh).
- `SPEC.md` §6 (Add to notes, comment / card head + touch sizes, the keyboard paragraph, link card) and §29 (tap in Editing, margin cards hold still).

## Decisions
- Kept the `order-first` / `-order-*` classes on the moved toolbox blocks: the DOM order of every control now equals the drawn order, and the classes keep the non-focusable labels (Key term, Figure, the truncation note) where they were drawn. Dropping them would move those labels to the top.
- Escape from the toolbox in the block reader still closes it and drops the selection (as before); only the page editor keeps the selection (as before) and now gets the focus back.
- A card opened from the keys focuses its field, else its first control past the grip. On a running Explain that is Stop.
- Chips stay focusable by script but leave the Tab order (the mark replaces them for the keyboard); the extraction chip stays in the Tab order because its mark is not focusable.
- The chip hit area is CSS (`::after`) at full zoom; on the zoomed-out phone page a tap within 12 px of a chip's center counts (JS), so the 24 px target holds at any zoom.
- No new control anywhere; Add to a note… row and Skip are removed.

## Needs (files outside this package)
- SEL13-06, page editor comment card (`src/components/docs/layer/comment-card.tsx`, package 5): Delete out of ⋮ into the head as a trash icon (2 presses → 1), Edit as a click on the words, ⋮ keeps Get link to this comment. Head order: kind, ✓, trash, ✕.
- SEL13-06, Annotations tab and annotations full page (`src/components/panels/annotation-card.tsx`, `annotation-menu.tsx`, package 3): the expanded row's Jump and Delete buttons duplicate ⋯'s items; keep them in ⋯ only.
- `src/lib/i18n/dict/panes.ts` (package 4): `linkToOtherTexts` is unused now; remove it (en and zh) when convenient.
- Package 4's tooltip long press makes the head icons' names readable on a phone.

## Data
Existing data: none touched. Everything written lived in my own project "Fix r13 select" (block copies by `copydoc.mjs`, a blank and an import through the app); it is left in place for the merge's verification and can be deleted through the app.
