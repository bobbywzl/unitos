# r7-engine7

**Intent:** Fix the round 7 answers audit's ANS7-01 to ANS7-06 in Stitch: the follow-up select-pass skip, edited lines and orphaned links, contradiction-only links, quote parts and mixed sections on pages, reply lines, and the links note.

**Files:**
- `src/lib/prompts/stitch.ts` — `asksMore` (new, ANS7-01); `StitchCtx.back` and the back-selection line in `stitchPrompt`; three rule sentences in `stitchRules` (ANS7-03/04/05, +98 cached tokens).
- `src/lib/graph/stitch.ts` — `backSelection` (asksMore and title guard, new `docs` argument), `answerMessages` (`back` input), `stitch()` (passes `read` and `back`; `fromOrphaned`/`toOrphaned` in the `existingRows` select through `liveLinks`; `linksNote` lead), `liveLinks` (new), `quoteBlocks` (new), `materializeGenerated` (one line: quote chunks go through `quoteBlocks`). `skeletonSystem` is not touched (COST7 owns it).
- `src/lib/graph/skeleton.ts` — `CHANGED_LINE`, `CHANGED_LINES_MAX`; `fallbackLine(text, max)`; `currentSkeleton` draws a changed block up to 600 characters beside a stored skeleton.
- `src/lib/i18n/dict/stitch.ts` — `stitchLinksAddedNone/Of1/OfN`, en and zh (ANS7-06).
- `scripts/qa/stitch-budget-check.ts` — 18 round 7 cases (350 ok); `scripts/qa/ui-graph-quote7.mjs` (new, screenshots and checks of a page's quote paragraphs).
- `SPEC.md` §22 — the back-selection guard, changed lines, orphaned links, quote paragraphs, contradiction-only links, reply lines, the links note.

**Decisions:**
- The title guard is per word of the command (titles only, no gists): "Nietzsche" with a Nietzsche document cited still skips; "Schopenhauer" with no Schopenhauer block cited runs the select pass.
- The 600-character line applies only beside a stored skeleton; with none, every line stays at 200 (a document with no skeleton would otherwise pay up to 2k tokens).
- A link with either end orphaned is left out of the answer pass's existing links, the duplicates and the lit links; the row is never changed.
- The optional server drop of a "do not contradict" link is not built: it needs a new record status, and PR #23 stores records.
- Quote parts of a paragraph or heading keep a leading marker as written and parse the rest as markdown (inline italics kept), all in italic. Quotes of lists, tables, transcript lines parse as before.
- ANS7-06's direction dedupe of lit links is not built: two rows are two drawn curves.
