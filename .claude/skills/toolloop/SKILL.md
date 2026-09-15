---
name: toolloop
description: The tool quality loop (SPEC.md §25). Run every AI tool's prompt template on a fixed set of documents and reader contexts, judge each output against the tool's rubric, read the weakest cases, change the one template, run again, keep the change when the score rises. The ratings readers leave in the app feed new cases. Run it with /toolloop; the main session is the fixer.
---

# toolloop

What the loop improves: the prompt templates in `src/lib/prompts/` (one per tool) and the rubrics in `scripts/eval/rubrics.ts`. Nothing else changes in a round unless a check exposes a route bug.

What the loop needs: `MOONSHOT_API_KEY` (the tools run on Kimi K3 as in production) and `ANTHROPIC_API_KEY` (Claude Fable 5.1 judges; without it Kimi judges its own output, which is weaker). `DATABASE_URL` only for `import-ratings`. Without any key, `MOONSHOT_API_KEY=mock MOONSHOT_BASE_URL=http://localhost:3399/v1 node scripts/qa/mock-kimi.mjs &` gives a dry run of the wiring with `--judge none`.

One round:

1. **Pull the readers' signal.** `npx tsx scripts/eval/import-ratings.ts --days 30` reads the thumbs down (`ToolRating`, written by the 👍👎 on every card, page, and answer) and writes each as a fixture plus a case in `scripts/eval/cases/from-ratings.json`, the reader's comment as what a good answer must fix. Skip when there is no database.
2. **Baseline.** `npx tsx scripts/eval/run.ts` runs every case: the tool's real template on the real model, the mechanical checks (word caps, block tags that resolve, verbatim spans, Simplify's markers, the answer's language, no banned opener), then the judge's scores against the tool's rubric. Read `.eval/runs/<stamp>/report.md`: the table per tool (mean, min, checks failed), then the eight weakest cases, each with the failed checks, the worst criterion, the evidence, and the judge's one-sentence fix.
3. **Read the weakest cases whole.** `results.json` holds every prompt and output. Read the output as the reader would, beside the fixture, before trusting the judge: a judge is right about the fault more often than about the fix.
4. **Change one template.** Edit the one file in `src/lib/prompts/` the weakest tool uses. Fix the rule, not the case: a rule that names the fault class ("state the claim itself, never that a claim is made"), never a rule that names the fixture. Keep CLAUDE.md's rules: one term per concept, parallel structure, blunt ordered instructions, `STYLE_RULE`, `GROUNDING_RULE`, `SPECIFICITY_RULE` where the template speaks in the assistant's voice. When the fault is in what the judge asks for, edit the rubric instead, and say so in the commit.
5. **Run again against the baseline.** `npx tsx scripts/eval/run.ts --tools <tool> --baseline latest --gate`. The gate fails on a mean drop of 0.5 or a check that newly fails. Keep the change when the tool's mean rises and no other case in that tool fell below 3; revert it otherwise. One template per commit, the report's table in the commit message.
6. **Iterate.** Next weakest tool. Stop the round when no tool has a case under 3 and the checks all pass, or when a change to a template no longer moves its mean. Then `npx eslint`, `npx tsc --noEmit`, and ship on the branch the round runs on.

Rules:
- Never edit a fixture to make a case pass. A fixture is the world; the template adapts.
- Never drop a case because it scores low. A case from a rating stays until its tool scores 4 or more on it in two rounds.
- Add a case when a new context appears (a document kind, a reader, a language, a question shape the set lacks): the set in `scripts/eval/cases.ts` is the contract for "across every context".
- The judge's `fix` is a hypothesis. Two cases with the same fault class are evidence; one is not.
- Cost: a full run is about 30 model calls plus 30 judge calls. Run one tool at a time while iterating (`--tools`), the whole set before shipping.

Files: `scripts/eval/run.ts` (the runner), `scripts/eval/lib.ts` (fixtures, prompt context, model calls, judge), `scripts/eval/cases.ts` (the cases and reader contexts), `scripts/eval/rubrics.ts` (what valuable means per tool), `scripts/eval/fixtures/*.md` (the documents), `scripts/eval/import-ratings.ts` (ratings → cases), `.eval/` (runs, gitignored; `latest.json` is the last run).
