# r5-engine5

**Intent:** Fix Stitch's answers (round 5 package ENGINE5): Chinese quotes checked, every proposed link numbered in the record, opening parts routable, a page keeps a passage two links share and the server states its counts, existing links the answer is about lit with their state, record links scoped to the project, the keyed skeleton form on with a coverage log, and the four measured prompt changes.

**Files:**
- `src/lib/graph/stitch.ts` — QUOTE_SPAN (CJK, 「」『』, before `[block`); recordText (status per link, "Proposed by" header only when a status is present); loadRecords (link's two documents in the project, REV5-05); skeletonView (exported; opening part); routeSystem / skeletonSystem / cutLines (one line each for the opening part); selectedSections (heading in the gap line); existingPairs (state suffix); nameHits (cap scaled by documents); stitch() (existing links with id/recommended/hiddenIn, every proposal recorded, one reply line per state, existingLinkIds, page count note); new duplicateOf / existingState / existingNamed / pageCountNote; materializeGenerated (immediate-repeat dedupe, returns counts).
- `src/lib/prompts/stitch.ts` — translation rule, cannot-remove rule, page count rule, existing-links sentence with states, asksEvery and the list sentence gated by it.
- `src/lib/types.ts` — `StitchResult.existingLinkIds`, `StitchRecord.links[].status`, `StitchRecordLinkStatus`.
- `src/app/api/notebooks/[notebookId]/stitch/route.ts` — record link id may be "" (unstored), optional status, cap 48 (the answer's own link cap).
- `src/components/graph/stitch-box.tsx` — one line: onProposed gets linkIds plus existingLinkIds.
- `src/lib/i18n/dict/stitch.ts` — waiting / removed reply lines and the page count line, en and zh.
- `src/lib/prompts/skeleton.ts`, `src/lib/graph/skeleton.ts` — SKELETON_KEYED on; logSkeletonCoverage for the first 50 builds.
- `scripts/qa/stitch-budget-check.ts` — round 5 checks; two round-4 expectations follow the changed rule text.
- `SPEC.md` §22 — each behaviour above.

**Decisions:**
- Existing links are lit through a new `existingLinkIds` field plus a one-line box change, not by mixing them into `linkIds`: the box's "N links proposed / waiting" count reads `linkIds`, and mixing would inflate it.
- A links command lights every listed (both blocks shown) existing link that is not removed — the reply's "N other links are already in the graph" names them without tags; any other command lights an existing link only when the reply cites its two blocks side by side. Removed links are never lit (not drawn).
- A proposal past the 24-link cap or one that did not resolve is recorded as "unstored" with id "" so numbering holds; the route accepts id "" and up to 48 record links.
- The opening part is titled "(opening lines)" in the route pass, has no summary, and is not drawn in the select pass (its bytes there are unchanged).
- Page counts count parts (quote parts, headings, text parts), not blocks, and the model is told never to count them.
- ANS5-07 (heading in the gap line) kept: +41 tokens per answer pass on average, one fact recovered (P2-1). ANS5-09 kept: P2-4's 9 Darwin blocks hinted; its answer drops an unsupported claim. ANS5-10 kept: the list sentence leaves 63 of 92 answer prompts. ANS5-11 kept, shortened to 45 cached tokens.
