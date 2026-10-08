# r7-cost7

**Intent:** COST7-01, a cut select prompt prints part titles without summaries except for parts the route pass named; close ANS6-09, ANS6-08 and COST6-07 in SPEC.md with their numbers.

**Files:**
- `src/lib/graph/stitch.ts`: `skeletonSystem` takes `routed` (5th argument, default null) and prints a part's summary only when every line is shown or the route pass named the part; `pickBlocks` keeps the route pass's parts in `routedParts` and passes them to `skeletonSystem`. Its doc comment says so.
- `scripts/qa/stitch-budget-check.ts`: the round 6 cut-layout case now builds its cut with A3 routed (same assertion); 4 new cases (unrouted cut: title, no summary; routed and unrouted in one cut; the cut is the same but for the summaries; the whole read keeps every summary). 336 ok.
- `SPEC.md`: §22 the cut sentence (COST7-01), one sentence on duplicate lines (ANS6-08), one on pages keeping the groups (ANS6-09); §13 Coverage: no version key and no compact form (COST6-07, COST7-05).

**Decisions:**
- Routed parts keep their summaries (the auditor's recommendation): at (i) dropping them too would save 8 more points (−46% against −38%), but the route pass chose those parts by their summaries.
- The Jev select path (`jevSelectLines`) is unchanged: it reads one part at a time with its title and summary.
- COST7-05's polish (coverage reading only the part start ids) is skipped: the start ids come from the same skeleton parts, contents and heading fallback (`headingContents` reads heading text), so a start-id-only path is a second copy of `projectPartTitles`' rule to keep in step, not a small change.
