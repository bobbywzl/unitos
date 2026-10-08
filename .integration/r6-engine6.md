# r6-engine6

**Intent:** Fix the round 6 answers audit's Stitch answer findings (ANS6-01 to -07, -10, the part of -11 that falls in them) in `lib/graph/stitch.ts` and its prompts: unpicked documents, gist matches, back-reference follow-ups, lit links, copy links, and shorter replies.

**Files:**
- `src/lib/graph/stitch.ts`: `titleMatches` reads title + gist (+ the expansion's words for a CJK command); `selectedSections` names up to 8 not-shown documents and writes a repeated gist once ("gist: as [document G]"); new `notPickedOf` (one raw query: titles and stored gists of the unpicked documents); new `backSelection` and its call in `stitch()`; new `copyPair`/`copyOriginals` and the copy check in the links loop; `existingNamed` pairs tags inside one sentence; `recordText` reads status "copy"; `Reading.words`; `answerMessages` takes `notPicked` and passes `words` to `selectedSections`; `pickBlocks` stores the expansion's words on the reading (one line in `rankQuery`).
- `src/lib/prompts/stitch.ts`: `refersBack`; the not-picked line in `stitchPrompt`; "out of every document picked"; the list hedge skipped on back-reference follow-ups; the reply rule (one-sentence lead, one line per new piece of evidence, no closer), the page reply rule, the text-part rule, "no bold label on a line of its own".
- `src/lib/types.ts`: `StitchResult.notPicked`, `StitchRecordLinkStatus` "copy".
- `src/app/api/notebooks/[notebookId]/stitch/route.ts`: the record status enum accepts "copy".
- `src/components/graph/stitch-box.tsx`: `DocumentsRead` takes `notPicked` and uses one other string.
- `src/lib/i18n/dict/stitch.ts`: `stitchDocumentsReadPicked`, `stitchLinksCopy1/N` (en, zh).
- `SPEC.md` §22: the behaviour above.
- `scripts/qa/stitch-budget-check.ts`: round 6 checks; 3 round 5 strings updated to the new wording. `scripts/qa/ui-graph-picked6.mjs`: the box line after a pick.

**Decisions:**
- ANS6-02's line goes to the answer prompt only, not the select prompt: the select pass cannot act on it.
- Up to 8 unpicked documents are all named (Linda's 7-document project names all 5); past 8, only title/gist matches.
- ANS6-03 skips the select pass only when the last answer came back with its record, the cited blocks cost at most 6,000 tokens (the answer model is ~9x the select model's price and uncached), and every rare name is cited. "Back to the first answer" and "both of them" go to the select pass.
- ANS6-06 pairs within one sentence, or across two sentences of one paragraph when one of them cites a single block (the audit's "dash or and only" lost H4/N03/S1-2/S1-4's correct lights).
- ANS6-07 drops a copy link and re-points an end on a copy to the original (non-generated, earlier document); containment counts only past 40 folded characters.
- ANS6-10 not built: the rule changes no link of F1, L2 or Z1; a server cap would drop sound links.
- Touches `answerMessages` (one parameter) and one line of `pickBlocks`, which COST6 also edits; see RESULT.md.
