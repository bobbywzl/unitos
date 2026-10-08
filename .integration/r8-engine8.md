# r8-engine8

**Intent:** Fix ANS8-01 to ANS8-07 (Stitch answers) and the round 8 cost note on edited long paragraphs, with the model's passes answered and judged by hand on the audit's set.

**Files:**
- `src/lib/prompts/stitch.ts`: `asksMore` (more words, "different" dropped), `asksEvery` (每个, 各个, 各自, 各文档, 分别), one sentence in `stitchRules` (a document of the reader's own notes), the back sentence in `stitchPrompt` (new wording in italics).
- `src/lib/graph/stitch.ts`: new `asksContradictions` (used by `commandKind` and the lit links), `expandedNames`, `nameRx`, `overEvery`, `byDocument`, `cjkExpansion`; `nameHits` (4th argument `words`, 24 blocks for `asksWhere`); `backSelection` (7th argument `words`; a name in no cited block); `pickBlocks` (reuses `reading.words`, `byDocument` for an every-document command); `stitch()` (the CJK expansion before the back selection, the command's own names for it, `existingNamed` all only when not a contradictions command); the two answer system lines.
- `src/lib/graph/skeleton.ts`: `changedLine`, used by `currentSkeleton`.
- `scripts/qa/stitch-budget-check.ts`: "Round 8 (ENGINE8)" block (23 cases), one case after the answer-sections checks, the ANS7 back-sentence check updated to the new wording.
- `SPEC.md` §22: sentence edits for each of the above.

**Decisions:**
- The CJK expansion runs for every CJK command over documents with no CJK title (about 260 to 580 tokens), not only when the command names something: there is no way to tell a CJK name without it.
- The back selection reads the expansion's words only for the title check, never as names: a model's guessed name (Mitleid) would send a follow-up about the answer to the select pass.
- `byDocument` shares the cut by tokens, not by count: by count the same 48 blocks were kept on K05, because the documents with the most picks lose their tails either way.
- A contradictions command still lights the existing links its reply cites side by side, agreements it names included (K16: 2).
- An edited block over 600 characters reads as its first and last 300 characters; an edit in the middle of a long paragraph is still missed.
