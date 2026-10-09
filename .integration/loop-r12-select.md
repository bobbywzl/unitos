# loop/r12-select

**Intent:** fix round 12's selection package (SEL12-01 to -05, -07 to -13; EDGE12-02, -03, -11; TOOL12-18) for density: fewer controls at rest, fewer presses, nothing unreachable.

## Findings

Counts are before → after, measured with the audit's scripts against :3111 (before, commit 0c1d0af) and :3141 (after). Screenshots are under `.qa-tmp/fix/` in this worktree.

- **SEL12-01: fixed.** One card at every width: the colors and the voice in its first row, Add to notes, then the tools. The three floating bubbles and `popoverNearTop` are gone. 1440, block document: 4 cards, 176×354 (one word) / 176×324 (a passage) → 1 card, 176×284 / 176×254. Controls 13 / 12 → 14 / 13: the one added control is Add to notes' ▾ (SEL12-03). The same at 1440 in the blank document (176×284, 14). At 1000: the same height as before (284 / 254), the same +1. `SEL12-01-before.png` / `SEL12-01-after.png`.
- **SEL12-02: fixed.**
  - Chips in the line: block reader chips (comment, tool, extract, chain) stand in the right margin of the line their mark ends on (`[data-margin-chip]`, `layMarginChips` in block-view.tsx; several chips on one line sit side by side and wrap). Chips inside the words: 3 → 0.
  - Link chips on highlights: 2 → 0. Link from a highlight moved into the highlight card's footer, beside Delete; it starts the same pending link (`SEL12-02d-link-from-card.png`).
  - A highlight that holds a comment: no sign → the comment chip.
  - Page editor, Editing: a click on a highlight's margin chip opened nothing (the chip started a link; only Ctrl+click opened the card) → the chip is a hue dot that opens the card in 1 click (`pemark.mjs`: `chips [["highlight-chip",…]]`, `chip click → HIGHLIGHT card`). Ctrl+click on the words still opens it.
  - Screenshots: `SEL12-02-before.png` / `-after.png` (words split by chips / chips in the margin), `SEL12-02b-*` (a highlight with a comment), `SEL12-02c-*` (page editor chip).
- **SEL12-03: fixed.** Add to notes makes the note in the first section in one press; its ▾ half opens the panel (the note's words, the sections, Add to a note…). A new note: drag + Add + section = 3 (4 taps) → drag + Add = 2 (3 taps). An existing note: still 4 (drag, ▾, Add to a note…, the note). `SEL12-03-before.png` / `-after.png`, `SEL12-03-panel-after.png`.
- **SEL12-04 / EDGE12-03: fixed.** On a coarse pointer, Explain | Simplify and Visualize | Comment share a row (two labeled halves, each one tap). Phone, block document: 220×400, 9 rows → 220×314, 7 rows (one word); 220×357 → 220×271 (a passage). The import's passage: 357 → 271. Controls are the same as SEL12-01 (14 / 13). `SEL12-04-before/after.png`, `EDGE12-03-before/after.png`.
- **EDGE12-02: fixed.** `fitToolbox` measures the overflow to the phone bar's top (`nav[data-nudge="rail"]`), not the pane's foot. In the page editor, when the toolbox fits neither above nor below, the pane scrolls by the overflow, as in the block reader. When a field (Assistant, Comment) grows a toolbox that flipped above past the header, it drops back below and the pane scrolls. Import, selection at y 500: toolbox 531–888, 3 rows past the bar or the screen → above the words, 222–493, 0 rows out of reach. With Assistant open: 531–1011 → the pane scrolls 155 px, 376–770, every row on screen (`EDGE12-02-ai-3111.png` / `EDGE12-02-ai-3141.png`). `phone.mjs` over the block document, the import and the blank document: 0 rows out of reach. `EDGE12-02-before/after.png`.
- **SEL12-05: fixed.** The Add to notes field says "Write the note (optional)"; the Comment field says "Comment"; the colors' tooltip says "Highlight in {color} with the comment". Fields named "comment" near a selection: 3 → 2 (the toolbar's Comment and the highlight card's comment, which now gets the comment chip). `SEL12-03-panel-after.png`, `SEL12-08-after.png`.
- **SEL12-07: fixed.** In Editing the row reads "Edit with the assistant"; elsewhere "Assistant". `SEL12-07-before/after.png`.
- **SEL12-08: fixed.** The Comment placeholder: 3 lines, cut → "Comment", one line. `SEL12-08-before/after.png`.
- **SEL12-09: fixed.**
  - RECOMMENDED on the lead row: 1 → 0; the row keeps its tint, and its tooltip ends with "Recommended".
  - The tier mark on Visualize for a Unitos Ultra account: 1 → 0; an account without Unitos Ultra still sees it.
  - The quote on the block reader's comment card: 1 → 0.
  - Chooser rows show what each mark holds: the comment's words, a tool's answer, a highlight's hue dot (and its comment when it has one), a note's title. Before, every row showed the quote. `SEL12-09b-before/after.png`.
- **SEL12-10: fixed.** A phone tap on a mark keeps the words below the Contents / Collapse / Extract row (`[data-article-band]`'s height plus 16 px). Tap on a first-line highlight: scrolled 88 px, words under the row → scrolled 40–55 px, words in view (`touch.mjs` tap-gold). `SEL12-10-before/after.png`.
- **SEL12-11: fixed.** A card's Save shows "Saved" once (the header); the toast shows only for a conflict ("outline.savedBoth"). The highlight card, the comment card, and the link card. Signals: 2 → 1. `SEL12-11-before/after.png`.
- **SEL12-12: fixed.** The highlight card's comment field is one line that grows on focus and with its words; the mic and Save show when the field has focus or the words differ from the saved comment. 260×206 with 9 controls at rest → 260×163 with 8 (the 4 colors, ✕, the field, Delete, Link). `SEL12-12-before/after.png`.
- **SEL12-13: fixed in the block reader.** The comment card: ✓ (resolve) and a trash icon (Delete) beside ✕ in its header, a one-line field, the mic and Save on focus or change, no quote. 6 controls and the quote, 260×160 → 4 controls at rest, 260×102. The page editor's comment card dropping the person's name when open is in a file this package does not own (Needs). `SEL12-13-before/after.png`.
- **TOOL12-18: fixed.** The ⤢ on a collapsed block shows on hover or keyboard focus, as with Collapse off; the fold chip on a block read whole stays. ⤢ at rest with Collapse on: 7 visible (15 in the DOM) → 0. `TOOL12-18-before/after.png`.
- **EDGE12-11: half fixed.** The first press on Add to notes adds (no second press that folds the box). The phone's notes sheet still opens after each add: keeping it closed and blooming the Notes button is in workspace.tsx (Needs). `SEL12-03-after.png`.

Whole script set re-run on :3141 at the end: `count.mjs` (1440, 1000, 390 touch), `pemark.mjs`, `restclick.mjs` (every press opens the card, rest or not), `touch.mjs`, `phone.mjs`, `phonelow.mjs` (import at y 500: toolbox 222–493), and `drafts.mjs` (typed words survive: the Add to notes field after Escape and the same selection again; the highlight card's comment after a click elsewhere and a reopen; the comment card's edit after ✕ and a reopen). Double click (S7) and the mark click that slides the column (SEL11-06) are unchanged. `npx tsc --noEmit` clean; eslint clean on every changed .ts/.tsx file.

## Files

- `src/components/reader/reader-interactions.tsx` (the toolbar, toolbox, `fitToolbox`, Add to notes, chooser, highlight card and comment card regions): the one-card toolbox, `pairRow`, Add to notes' split button, `fitToolbox`'s page editor branch and the bar-top measure, `CARD_WORDS_GAP` 12 → 26 (side cards keep clear of the margin chips), `layoutNarrowCards`' band offset, the Saved toasts, the comment chip on a highlight with a comment, the chooser rows, the highlight card and the comment card.
- `src/components/reader/block-view.tsx`: chips carry `data-margin-chip`; `layMarginChips` sets each chip's place in the margin; the in-line link chip is gone.
- `src/components/reader/core-block.tsx`: `layMarginChips` on a collapsed block; the ⤢ hides at rest with Collapse on.
- `src/components/docs/annotation-marks.tsx`: the page editor's highlight chip opens the card (it started a link); a highlight with a comment gets the comment chip.
- `src/lib/i18n/dict/reader.ts`: `editWithAssistant`, `addToNotesTitle`, `addToNotesMoreTitle`, `addNotePlaceholder`; `commentPlaceholder`, `addCommentTitle` and `highlightInWithNote` reworded; en and zh.
- `src/app/globals.css` (outside the owned list, small hunks): the `[data-margin-chip]` rule, the chips hidden in print, the `.mark-chip` comment.
- `SPEC.md` (outside the owned list, only the lines these findings change): margin chips, the highlight chip and Link in the highlight card, the chooser rows, the ⤢ rule, Add to notes in one press with its ▾, the one-card toolbox and its coarse-pointer pairs, the page editor's fit, the voice in the colors row, Recommended in the tooltip, the highlight card and comment card, the Saved toast, the Visualize tier mark, "Edit with the assistant".

## Decisions

- A trash icon for Delete in the block comment card's header, not the page editor's ⋮ menu: one press, as before, and no menu.
- `CARD_WORDS_GAP` 26 so a side card never covers a margin chip; the column slides about 14 px more at 1440 when a card opens.
- The paired rows only on a coarse pointer: with a mouse the card is already narrow, and two short labels in 176 px read worse.
- Margin chips for every chip kind (comment, tool, extract, chain), not only the comment chip, so no chip enters the words.
- A plain highlight has no chip in the block reader (its hue is the sign, a click opens its card). In the page editor, where a click places the caret, it keeps a hue dot chip that opens the card.
- Add to notes' ▾ is the one control added: it replaces the forced section pick and the panel's own opener.
- The card's Link button reuses `data-track="link-chip"`, so a press on it counts with the old chip's presses.
- The pairs are Explain | Simplify and Visualize | Comment; Assistant and Link across texts keep full rows (their labels are long).

## Needs

- **Package 5 (`src/components/reader/workspace.tsx`), EDGE12-11:** on a phone, keep the notes sheet closed after Add to notes (`show("notes")` on add) and bloom the bar's Notes button with its count; the note flashes when the sheet opens.
- **Package 4 (page editor):** the page editor's comment card drops the person's name once it opens (it reads `written.by` from `/api/notes/:id/edits`), the rest of SEL12-13. SEL12-06 (Background color) is theirs.

## Data

Existing data: none touched. No schema change, no migration. Add to notes writes the same note the panel's first section wrote; words typed in its field go into that note, as Enter did, and stay a toolbar draft until the save lands. Highlight, comment and link cards save the same fields as before.

Test project "Fix r12 select" (a copy of How Reading Shapes Memory, a blank document, an import), made through the app. Deleted at the end through the app (`DELETE /api/documents/:id` for its three documents, then `DELETE /api/notebooks/:id`, after a check that the three were the only documents in it).
