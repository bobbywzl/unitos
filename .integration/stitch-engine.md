**Intent:** Stitch's server side (round 1, package ENGINE): fix the answers audit (ANS) and the context cost audit (COST) in the engine, prompts, and route.

**Files:**
- `src/lib/graph/stitch.ts`: commandKind, token budgets by kind, question ranking before the select pass, commands-only history for the reading passes, history aliases (stitchHistory), cited blocks, no opening for a document the select pass read, rules-first system messages (answerMessages), forgiving output schema, abort checks, empty-answer failure, generatedCommand of a follow-up, STITCH_READS_GENERATED.
- `src/lib/prompts/stitch.ts`: rules split from the command's half; the answer, select, and route prompt changes of ANS-03/04/05/07/08/09/11/18.
- `src/lib/graph/skeleton.ts`, `src/lib/prompts/skeleton.ts`: no contents call in the build (COST-07); window blocks numbered 1..n (COST-10).
- `src/lib/derive/config.ts`: STITCH_* in tokens, STITCH_SELECTED_BUDGET/BLOCKS by kind, STITCH_QUESTION_SKELETON, STITCH_READS_GENERATED, route limits; ASSISTANT_WHOLE_THRESHOLD made its own 120,000-char constant.
- `src/lib/tokens.ts` (new): estTokens.
- `src/lib/types.ts`: StitchResult.cited, StitchDocument.shown, StitchCommandKind.
- `src/app/api/notebooks/[notebookId]/stitch/route.ts`: localized too-long command, history cut not refused, empty answer message, skeleton refresh for a generated page.
- `src/lib/i18n/dict/api.ts`: stitchCommandTooLong, stitchEmptyAnswer (en, zh).
- `SPEC.md` §22 (and §7's threshold line).
- `scripts/qa/stitch-budget-check.ts` (new), `scripts/qa/stitch-context-check.ts` (the cost audit's harness, committed, pass detection updated), `scripts/qa/project-reading-check.ts` (group sizes in tokens).

**Decisions:**
- The command's kind comes from a deterministic rule, not the select pass: it is needed before the select pass (question ranking) and on the whole read.
- The question skeleton cut is 20,000 tokens, between the audit's 15,000 and the 50,000 budget.
- The reading passes get the earlier commands inside the user prompt, not as turns, and the cited aliases listed; the answer pass keeps all 20 turns.
- When the select pass picks nothing in any document, every document reads as its opening.
- ANS-10 (answer language) is left for Linda; proposal 8 sits behind STITCH_READS_GENERATED = true.
