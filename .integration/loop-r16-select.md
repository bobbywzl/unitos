# loop/r16-select

**Intent:** fix round 16's selection findings SEL16-01, 02, 03, 05, 06, 07, 09 and measure SEL16-10, in the toolbox, mark, card, chooser and figure regions of the readers.

No finding in this package is blocking; no user data is read differently except SEL16-01's comparison, and nothing is written.

## Findings

Screenshots: `.qa-tmp/fix/<ID>-before.png` and `-after.png` in this worktree, copied to `/mnt/project-files/interaction-loop/round-16/img/`. Scripts: the audit's, copied to `.qa-tmp/sel16/` and pointed at :3141, against my own project "Audit r16 selection" (`cmv0mte9j00007do89msfu6o8`).

- **SEL16-01 fixed.** A highlight across a paragraph and a heading (`multiblock2.mjs`): before, 2 "Open the comment" chips at its two parts and the card's field filled with `" highlight memory recall slow highlight.\n\nConclusion"`; after, 0 chips at it and the field empty. The page now sends the whole passage's quote (every source's quote in block order, joined by a blank line, as the create route stores it) as the highlight's `quotedText` in `annotationsBySource`; a content equal to that, to its 5000-character cut, or to one source's quote is a pure highlight. The chips, the card's field, the chooser's row and Clear-the-comment (which now saves the whole quote, not the first part's) read it. Page editor: a highlight across the image opens with an empty field (`peundo.mjs`); transcript: a highlight across two lines has 0 chips after a reload (`transcript16.mjs`). On origin/main the card field's comparison is the same (first source only); the chips are this branch's.
- **SEL16-02 fixed.** Page editor, 390 touch (`phonetaps.mjs KEY=blank`): before, the chooser stayed after tap 2, tap 3, a tap on other words and a scroll; after, tap 2 closes it, tap 3 opens it, a tap elsewhere closes it. A press outside the chooser closes it in the page editor and the edit mode (the block reader's click path already did). Block reader unchanged (`phonetaps.mjs KEY=doc`).
- **SEL16-03 fixed.** PDF import, 390 touch, a tap on the figure (`figtap.mjs`): before, the figure tools showed 95 → 286 ms and closed; after, they show from 116 ms and stay; a tap on words then closes them. The release that came before the figure opened its tools (`figureToolsAtRef`) no longer runs the selection check over them. Desktop figure click unchanged (`imgclick.mjs KEY=pdf`).
- **SEL16-05 fixed (within what an image can anchor).** Blank document (`imgclick.mjs`, `imgbar.mjs`): before, Viewing: a click opened nothing; Editing: the image bar led with Assistant (14 controls). After, a click opens the figure tools in both modes, as an import's figure does; the image bar has 13 controls. An image has no words (its paragraph-index row's text is empty) and an annotation needs a quote, so the figure tools on an image hold the Assistant alone; it opens the assistant's bar under the image with The text and The key points, and moves the caret past a selected image, exactly as the image bar's button did. A caption-less import figure in the page editor opens the same tools in place of the "no caption" toast.
- **SEL16-06 fixed.** Transcript (`transcript16.mjs`): before, after a double click and Escape the line had focus with a 2 px ring, Space did nothing; after, the focus is on the player (no ring on the line), Space plays (t 0 → 1.16). The player draws its own focus ring after a key, as after a click that seeks.
- **SEL16-07 fixed.** Card heads at 1440 (`cardhead.mjs`): highlight card before trash 965 / ✕ 991 (2 px gap); after trash 853 / link 965 / ✕ 991. Comment card before trash 961 / ✕ 987; after trash 870 / ✓ 961 / ✕ 987. The trash stands right after the kind; nothing added. Delete then Undo in the page editor still restores the mark (`peundo.mjs`).
- **SEL16-09 fixed.** `book.xlsx`, Explain on A2:B2 (`officecards.mjs KEY=book`): before, the card at 60,395 over columns A–D rows 3–7; after, at 668,372, right of the grid, level with the words. A card over a sheet compares right of the grid with under the words and takes the place that covers fewer filled cells (overflowing text included), with a fixed card height so it never flips while an answer streams. Here it covers the overflow of the H notes in rows 3–5.
- **SEL16-10 measured, nothing to cut.** Before (`tbprof.mjs KEY=blank`, load 16–18): release → toolbox 101, 111, 150, 398, 452 ms; the profiler counts ReaderInteractions twice per release. A render trace (`trace10.mjs`) and the commit roots (`roots10.mjs`) show ReaderInteractions renders once per release (+16 to +109 ms); the second commit is the page editor's `LiveSlot` alone, and the profiler counts ReaderInteractions there because its fiber is on the path (a bail-out, no render). The trace's apparent second render was StrictMode's double call. I also tried guarding `useAnswerSelection`'s setState on every mouseup (answer-tools.tsx): no change, reverted. Speed is unchanged; the slow numbers are load and the dev build's jsxDEV.

## Files
- `src/app/n/[notebookId]/page.tsx`: SEL16-01, `passageQuoteByNote`, the quote sent with `annotationsBySource`.
- `src/components/reader/reader-interactions.tsx`: SEL16-02 (chooser press outside, in the pane click effect), SEL16-03 (`figureToolsAtRef`), SEL16-05 (`has`, `openFigureTools` in the page editor, `openFigureBar` in place of the image bar's event listener, the Assistant row), SEL16-07 (the two card heads), SEL16-09 (`sheetCardSlot`, used by `claimSideSlot` and `layoutNarrowCards`).
- `src/components/reader/reader.tsx`: SEL16-06, the transcript list gives the player the focus after a selecting click.
- `src/components/docs/insert/image.ts`: SEL16-05, a click on the picture fires `DOCS_EVENT.figureTools`.
- `src/components/docs/insert/image-controls.tsx`, `src/components/docs/css/insert.css`: SEL16-05, the image bar's Assistant button and its CSS go.
- `src/components/reader/figure-suggestion.tsx`: SEL16-05, the unused `FIGURE_ASSISTANT_EVENT` goes.
- `scripts/qa/ui-figure-words.mjs`: SEL16-05, presses the figure tools' Assistant in place of the image bar's button.
- `SPEC.md`: §6 (a highlight across blocks holds a comment only when its content is not the passage's quote; the card head), §7 words from a figure, the Images line in §29, the page editor's chooser in §29, the transcript's focus, a sheet's card.

## Decisions
- SEL16-01 compares on the server side by sending the passage quote as `quotedText`; I did not add a new field. Legacy rows whose cleared comment saved only the first part's quote still read as pure.
- SEL16-05: the audit asked for "the import's figure tools on every image". An image has no words, so Comment, Explain, Add to notes and the colors cannot anchor (the create route needs a quote); the figure tools show the Assistant alone. Giving images words (the alt text as the row's text in `lib/docs/blocks.ts`) would change the paragraph index for every document and is not this round's.
- SEL16-05: in Editing a click on an image now shows the figure tools beside the page and the image bar under the image at once (two layers; the bar is one control shorter).
- SEL16-07: the audit's shape (KIND · trash … link · ✕), not Delete in ⋯ as on tool cards: Delete stays one press.
- SEL16-09: the measure is the count of filled cells covered (one box per cell, overflow included), not the area.
- SEL16-03: a timestamp guard, not keeping the suppress flag to the next pointerdown, so a later release is never swallowed.

## Needs (files I do not own)
- `src/components/docs/layer/comment-card.tsx` (page): for one shape with the block reader cards, the trash would stand first after the name, away from ✓ and ⋯. Its card has no ✕, so Delete is never beside ✕ there today.
- `src/components/outline/annotation-side.tsx:180` (notes) and `src/components/panels/annotation-card.tsx` (notes) compare a highlight's content with its first source's quote (`AnnotationItem.quotedText`); a highlight across blocks shows its quote as a body there. `page.tsx`'s `passageQuoteByNote` holds the passage quote if they want it.
- `src/lib/i18n/dict/docs*.ts` (page): `docsInsert.imageAssistant` and `docsInsert.imageAssistantTitle` are unused now; remove them in en and zh.
- No migration, no new i18n key.
