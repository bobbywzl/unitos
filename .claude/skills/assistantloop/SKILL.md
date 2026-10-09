---
name: assistantloop
description: The assistant quality loop (SPEC.md §7, §25). Subagents stand in for the assistant's model and for the judge; the runner builds the sidebar assistant's own prompts, reads each answer the way the route does (the actions fence, the plan module), runs the edit passes through their own code, applies the plan to the fixture as the plan card would, checks what counts, and scores the judges' answers. One round: run every case, read the weakest families, change one rule or one piece of the plan's code, run again, keep the change when the family mean rises and no case falls under 3. Run it with /assistantloop; the main session is the fixer.
---

# assistantloop

What the loop improves: the sidebar assistant at This page scope — the answer prompt (`src/lib/prompts/synthesis.ts`), the action lines and the plan's validation (`src/lib/assistant/plan.ts`), the edit passes (`src/lib/assistant/revise.ts`, `one-pass.ts`, `reorder-run.ts`, `target.ts`, `src/lib/derive/suggest.ts`, their prompts under `src/lib/prompts/`), and what the reader sees of a plan (the plan card in `components/reader/reader-interactions.tsx`, the suggestions row). The families: answer (from the source), edit (an article's blocks), suggest (a document with rich text), section (notes, sections, documents), annotate (marks on the passages), transcript (a recording's lines and voices), confirm (a change carried through a conversation), scope (where a change runs).

No API key is needed: agents answer the prompt files. The assistant runs on Gemini 3.8 Flash in production and the edit passes on Claude Sonnet 5; a Sonnet agent stands in for both, at the agent's own effort. Each case's directory is the whole world of one turn.

## One round

1. `npx tsx scripts/eval/assistant/run.ts prepare --round rN` writes `prompt.md` and `case.json` per case under `.eval/assistant/rN/<case>/`.
2. Answer pass. `run.ts batches --round rN --stage answer --size 4` prints one line of case directories per agent. Spawn one **model agent** per line (prompt below, file `prompt.md`, answer `answer.md`).
3. `run.ts score --round rN`: splits the fence, reads the actions, enriches them against the fixture, runs a revise action's passes on the external model (`lib/derive/external-call.ts`: each pass's prompt lands under `calls/`), simulates the plan, checks, writes `result.json` and, once no call is pending, `judge-prompt.md`.
4. Calls pass, while `score` reports pending calls: `run.ts batches --round rN --stage calls --size 6` prints the pending `calls/<name>.prompt.md` files; one **model agent** per line answers each with `<name>.answer.md` beside it (only the JSON the prompt asks for). Then `score` again. A revise action takes one or two passes (the one pass or the windows, then the check), each a call.
5. Judge pass. `run.ts batches --round rN --stage judge --size 4`; one **judge agent** per line (prompt below, file `judge-prompt.md`, answer `judge.json`).
6. `run.ts report --round rN [--baseline rM]`: the table per family, the checks that fail most, the weakest cases (`.eval/assistant/rN/report.md`). Read the weakest cases' `answer.md` and `result.json` yourself before trusting the judge: a judge is right about the fault more often than about the fix.
7. Change one thing: a rule in the prompt for the fault class (never for the case), a validation or a tolerance in the plan module, an action the plan lacks, or what the plan card shows. One change per round, so a win names its cause.
8. Write `scripts/eval/assistant/rounds/rN.md`: the table, what changed, what the answers show, the decision. Keep the change when the family's mean rises (or its failed checks fall) and no case of the family drops under 3; revert it otherwise. Commit with the table in the message.

## Practicalities

- At most 20 subagents run at once; batch 4 cases a model agent, 6 calls a calls agent, 4 cases a judge agent.
- `run.ts prepare` never overwrites an answer: a new round is a new directory. To re-run one case, delete its `answer.md`.
- The checks are the contract: a check that fails on a correct answer is a bug in the check or in the plan module, which the round fixes first.
- `scripts/eval/assistant/blocks.ts` and `show.ts` print a fixture's blocks by number, for writing cases.
- A recording's fixture names voices with `@Name` after the times; `lib.ts` reads them as the line's speaker.

## Model agent prompt

> You are standing in for the production model behind the sidebar assistant of a reading app. Each directory below holds `prompt.md`: the system message (after `=====[SYSTEM]=====`), the conversation so far (`=====[USER]=====` and `=====[ASSISTANT]=====` turns, when any), and the reader's current message with the rules (the last `=====[USER]=====` section), exactly as the app sends them. For each directory, in order: read `prompt.md` whole; answer it as that model would — follow its instructions exactly, reason as carefully as you can, and produce only the assistant's answer: the markdown text, and when the rules call for it, the ```actions fence at the end with nothing after it; write the answer to `<dir>/answer.md` with the Write tool. Read no other file and run no command: the prompt is the whole world. Treat each directory on its own. Reply with one line per directory: its name and whether you wrote an actions block.

## Calls agent prompt

> You are standing in for the production model behind an edit pass of a reading app's assistant. Each file below is one call: the system message (after `=====[SYSTEM]=====`) and the user message (after `=====[USER]=====`) exactly as the app sends them. For each file, in order: read it whole; answer as that model would — follow its instructions exactly and produce only what it asks for (the JSON object, no prose, no code fence); write the answer to the file named like it with `.answer.md` in place of `.prompt.md`, with the Write tool. Read no other file and run no command. Reply with one line per file: its name and the number of ops or edits you wrote.

## Judge agent prompt

> You judge one turn of a reading app's sidebar assistant. For each directory below, read `judge-prompt.md` whole and do what it says; write the JSON it asks for to `judge.json` in the same directory with the Write tool. Be strict and concrete: 5 is rare, a visible flaw caps a criterion at 3, a plan that would change what the reader did not ask to change caps the overall at 2. Read only the files named. Reply with one line per directory: its id and the overall.

## Rules

- Never edit a fixture or a case's `expect` or `good` to make a round pass. Add a case when a context is missing: a document kind, a reader, a language, a message shape.
- Never drop a case because it scores low. A case stays until its family scores 4 or more on it in two rounds.
- A judge's `fix` is a hypothesis; two cases with the same fault class are evidence, one is not.
- A feature the cases need and the plan lacks (an action, a tolerance) is a change of the loop like any other: it ships when its family rises and nothing else falls, with the rule-zero note in the commit.
