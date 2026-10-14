---
name: breakworkloop
description: The Breakwork quality loop (SPEC.md §32, §25). Subagents stand in for STRUCTURE_MODEL and for the judge; the runner builds the Breakwork assistant's own messages, reads each answer with the route's schema and resolveProposal, checks it, and writes a judge packet. One round: run every case, read the weakest, change the prompt or the resolution code, run again, keep the change when the mean overall rises and no case falls under 3. Run it with /breakworkloop; the main session is the fixer.
---

# breakworkloop

What the loop improves: the Breakwork assistant — the prompt (`src/lib/prompts/structure.ts`), the answer's schema and its resolution into a structure (`src/lib/structure-assist.ts`), and the structure library (`src/lib/structure.ts`). No API key is needed: agents answer the prompt files. Breakwork runs on Claude Sonnet 5 in production, so a Sonnet agent is the same family; its answers stand for the model's.

## One round

1. `npx tsx scripts/eval/structure/run.ts prepare --round rN` writes each case's `prompt.md` (the system message, the earlier turns, the prompt, exactly as the route sends them) under `.eval/structure/rN/<case>/`.
2. `run.ts batches --round rN --size 2` prints one line of case directories per agent. Spawn one **model agent** per line (model `sonnet`, prompt below).
3. `run.ts check --round rN` reads each `answer.json` with the route's schema and `resolveProposal`, runs the checks (schema, kind of turn, coverage, top buckets, buckets under 2 blocks, lumping, nesting, titles, connections, labels, kept buckets, tokens), and writes `judge.md`.
4. Spawn one **judge agent** per 2 cases (prompt below). Each writes `scores.json`.
5. `run.ts score --round rN --baseline rM` writes `.eval/structure/rN/report.md`: the table against the baseline, then each case's worst fault and the judge's fix.
6. Read the worst cases' `judge.md` yourself before trusting the judge. Change the prompt (a rule that names the fault class, never the fixture) or the code (when the fault is mechanical: a dangling end, a connection that draws nothing). Keep the change when the mean overall rises and no case falls under 3; revert it otherwise.
7. Stop when no case is under 4, or a round no longer moves the mean. Then `npx tsc --noEmit`, `npx eslint`, `npx tsx scripts/qa/structure-check.ts`.

## Model agent prompt

> You are standing in for the production model behind a feature of a reading app. Each directory below holds `prompt.md`: the system message (after `=====[SYSTEM]=====`), any earlier turns (after `=====[USER]=====` or `=====[ASSISTANT]=====`), and the final user message (the last `=====[USER]=====`), exactly as the app sends them. For each directory, in order: read `prompt.md` whole; answer the last user message as that model would — follow its instructions exactly and produce only the output it asks for (the JSON object, no prose, no code fence); write the answer to `<dir>/answer.json` with the Write tool. Read no other file and run no command: the prompt is the whole world. Treat each directory on its own. Reply with one line per directory: its name and the number of buckets you wrote, or "talk".

## Judge agent prompt

> You judge one feature of a reading app. For each case directory below, read `judge.md` whole and do exactly what it says: write `scores.json` beside it with the Write tool. Be strict and concrete: 5 is rare; check placements against the document lines the packet lists; name blocks by their numbers in "worst". Read only the judge.md files named. Reply with one line per case: its name and the overall.

## Rules

- Never edit a fixture or a case's `good` to make an answer pass. Add a case when a request shape is missing (`scripts/eval/structure/cases.ts`).
- A judge's `fix` is a hypothesis; two cases with the same fault class are evidence.
- Tokens count: the answer must stay a few hundred tokens on a long document (block ranges, never one entry per block), since the reader waits for it.
- Rounds so far: `scripts/eval/structure/rounds.md`.
