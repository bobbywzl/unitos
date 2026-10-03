# loop/sel-anchors

**Intent:** Fix the selection audit's anchor and mark findings S1, S9, S5, and S14 (words across table cells, highlights on table cells, a drag inside a highlight, Define on pieces of words), and the tools audit's T16 (Define keeps the punctuation) where it falls in these files.

## Findings

- **S1 (blocking): fixed.** A selection across two cells of a gapless table now captures "Pages\t2" (offsets 11..18) and the highlight is stored; no "Anchor does not resolve". Define is not offered on it. Screenshots: `.qa-tmp/fix/S1-before.png`, `.qa-tmp/fix/S1-after.png`.
- **S9 (friction): fixed.** A highlight on one cell marks the cell; the table no longer rings. The two highlights made on the memo's table before the change (sage Pages 11..16, gold Notes 19..24) paint on their cells. Figures and equations keep the ring and the side label. Screenshots: `.qa-tmp/fix/S9-before.png`, `.qa-tmp/fix/S9-after.png`.
- **S5 (friction): fixed.** A drag inside an existing highlight opens the toolbar on the selected words, not the card; a plain click on a mark still opens its card, in a paragraph and in a table. Screenshots: `.qa-tmp/fix/S5-before.png`, `.qa-tmp/fix/S5-after.png`, `.qa-tmp/fix/S5-after-plain-click.png`, `.qa-tmp/fix/S5-after-table-drag.png`.
- **S14 (polish): fixed.** Define shows only when the selection's edges are word boundaries in the block text ("g" of "Reading" and "Note" of "Notes" get no Define; "interleaving" does). Screenshots: `.qa-tmp/fix/S14-before.png`, `.qa-tmp/fix/S14-after.png`.

- **T16 (polish, tools audit): fixed in part.** `defineWord` in `lib/define.ts` gives the bare word ("earned;" → "earned"; an abbreviation keeps its last dot, "U.S."), and `defineKey` is built on it, so the glossary lookup and the session's definition cache take "earned;" and "earned" as one word. The bold word under the Define row and the word the prompt asks about still carry the punctuation: those lines are in files I do not own (see Needs). No screenshot: nothing the reader sees changes until the Needs land; `scripts/qa/anchors-dom-check.ts` checks `defineWord` and `defineKey`.

## Files

- `src/lib/anchors/dom.ts`: one walk (`anchorablePieces`) for a block's anchorable text. A table without `.cell-gap` gets the separators its stored text has (tab between cells, newline between rows, colspan blanks, rowspan repeats, as `lib/parse/url.ts` tableText writes them); blank text between table tags is dropped. `anchorableText` and `anchorableOffset` read the walk. Tables with gaps are walked as before.
- `src/components/reader/table-marks.ts`: the painter reads the html through the same walk, so a gapless table paints; a blank-tolerant map (`blankTolerantMap`) lands stored offsets on the words when a cell keeps blank text the block text does not; `pressMark` and `clickEndsDrag` skip a mark's click that ends a drag.
- `src/components/reader/block-view.tsx`: the `<mark>`'s click is skipped when it ends a drag (`onMouseDown={pressMark}`, `clickEndsDrag`); comments say a table is text, not a figure.
- `src/lib/define.ts`: `definableSelection(quote, prefix, suffix)`: one word whose edges are word boundaries; `definable` doc names tab and newline as breaks; `defineWord` (the bare word) and `defineKey` on it (T16).
- `src/components/reader/reader-interactions.tsx`: only `offersDefine` (uses `definableSelection` with the anchor's prefix and suffix) and its import line.
- `SPEC.md`: §5 a paragraph on the table separators; §6 Define's whole-word rule.
- `scripts/qa/anchors-dom-check.ts`: 32 checks with jsdom (run `npx tsx scripts/qa/anchors-dom-check.ts`): the table separator case, offsets, gapped tables unchanged, skip controls, the painter on gapless and blank-padded tables, the pre-change anchors, Define's word boundaries.

## Decisions

- The separators are added in the reader's walk, not by rewriting stored table html: no re-parse and no data change, and old documents work at once.
- A table that holds any `.cell-gap` is walked exactly as before (docx, PDF, slides, sheets, handwritten tables), so their offsets cannot move.
- The selection tint's offsets stay in the html's walk coordinates; stored marks map through the blank-tolerant map only when the html's text and the block text differ in blanks. Where the words themselves differ (a caption the stored text lacks, math), the table still rings as before.
- S5's guard is on the mark's click only (paragraph `<mark>` and table marks), not on citation, contents, or link anchors: the browser drags a link instead of selecting in it.
- A selection whose ends sit beside an apostrophe or a hyphen counts as a whole word ("Buddha" of "Buddha's"); only letters, digits, and combining marks continue a word.

## Needs (files I do not own)

- `src/components/reader/reader-interactions.tsx` `captureSelection`: nothing required. If a table's html and block text differ only in blanks, the selection offsets are html-walk offsets; the server re-finds the quote with its blank-tolerant rung, so the stored anchor is right. Taking the offsets from `blankTolerantMap` there would make the tint and the stored offsets agree in that rare case.
- T16, `src/components/reader/reader-interactions.tsx` near line 8354 (the bold word under the Define row): show `defineWord(popover.anchor.quotedText)` instead of `popover.anchor.quotedText.trim()`.
- T16, `src/lib/prompts/define.ts` (or `src/app/api/derive/route.ts` where it builds the DEFINE context): put `defineWord(ctx.anchoredText)` after "Selected word:", so the model is asked about "earned", not "earned;". The sentence context stays as it is.
- `src/app/api/derive/route.ts`: Define's server check could call `definableSelection(anchoredText, prefix, suffix)` too; today it checks `definable`, which already refuses tabs and newlines.
