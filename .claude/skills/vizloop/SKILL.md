---
name: vizloop
description: The Visualize quality loop (SPEC.md §20, §25). Subagents stand in for VISUALIZE_MODEL and for the judge; the runner builds the route's own prompts, renders each answer with the route's own code, draws it in Chromium at the card's width, lints it, and scores it. One round: run the base and a candidate on every case, judge them blind side by side, keep the candidate when it wins. Run it with /vizloop; the main session is the fixer.
---

# vizloop

What the loop improves: Visualize — the draw prompt (`src/lib/prompts/visualize.ts`), the check prompt (`src/lib/prompts/visualize-check.ts`), what the check sees, and the server's rendering (`src/lib/derive/visualize.ts`, `simulate.ts`). A candidate lives in `scripts/eval/visualize/variants.ts` until it wins; then it moves into `src/` and becomes `base`.

No API key is needed: agents answer the prompt files. Visualize runs on Claude Opus 5.5 in production, so an Opus 5.5 agent is the same model; its answers stand for the model's, at the agent's own effort.

## One round

1. `npx tsx scripts/eval/visualize/run.ts prepare --round rN --variant <v>` for each variant in the round.
2. Draw pass. `run.ts batches --round rN --variant <v> --file prompt.md --size 4` prints one line of case directories per agent. Spawn one **model agent** per line (prompt below, file `prompt.md`, answer `draw.json`).
3. `run.ts draw --round rN --variant <v>`: validates each answer against the route's schema, renders it, draws it, lints it, writes `check-prompt.md`.
4. Check pass. `run.ts batches … --file check-prompt.md`; one **model agent** per line (file `check-prompt.md`, answer `check.json`).
5. `run.ts final --round rN --variant <v>`: applies the check (keep, replace, withdraw) as the route does; writes `final.svg`, `final.png`, `frames.png` for a picture that moves, `result.json` with the lint and the token estimate.
6. `run.ts judge --round rN --variants base,<cand>`: one packet per case, the variants as X and Y in a shuffled order. One **judge agent** per 4 cases (prompt below).
7. `run.ts score --round rN --variants base,<cand>`: the table (`.eval/viz/rN/report.md`). Read the weakest cases' pictures yourself before trusting the judge.
8. `npx tsx scripts/eval/visualize/gallery.ts --round rN --variants base,<cand>`, then republish the gallery (`scripts/eval/visualize/gallery.html` with `data/index.json` and `data/rN.json` from `.eval/viz/gallery/data/`). Read the ratings people left on it (`ArtifactData` list of `feedback`) before the next round: a thumbs down with a comment is a case to fix.
9. Write `scripts/eval/visualize/rounds/rN.md`: the table, what changed, what the pictures show, the decision. Keep the candidate when its overall mean rises and it wins more pairwise preferences than it loses; otherwise revert it.

## A renderer change

The server's drawing (diagram layout, simulation) changes no model answer, so it is judged on the answers a round already has: copy each case's `prompt.md`, `case.json`, `draw.json` into `rN/before` and `rN/after`, run `run.ts draw --round rN --variant base --dir before` with the old code and `--dir after` with the new (a git worktree holds one of them), delete the `check-prompt.md` files, `run.ts final --dir …`, then `run.ts judge --round rN --variants before,after --differing`. `scripts/eval/visualize/rerender.ts` re-renders stored answers into a scratch directory and lints them, for a quick look before a full round.

## Practicalities

- At most 20 subagents run at once; batch 4 cases a model agent, 4 a judge agent.
- The judge's packets copy each picture under the candidate's letter (`X-final.png`), so no path names the variant.
- Lint (`raster.ts`): text overlapping text, anything outside the frame, text under 9 px at the card's width, lines past 36 characters, colors off the palette. Server-drawn kinds carried nearly all of round 0's faults.

## Model agent prompt

> You are standing in for the production model behind a feature of a reading app. Each directory below holds `<file>`: the system message (after `=====[SYSTEM]=====`) and the user message(s) (after each `=====[USER]=====`) exactly as the app sends them. A line `=====[IMAGE: <path>]=====` is an image attached to the last user message: open it with the Read tool. For each directory, in order: read `<file>` whole; answer it as that model would — follow its instructions exactly, reason as carefully as the highest effort allows, and produce only the output it asks for (the JSON object, no prose, no code fence); write the answer to `<dir>/<answer>` with the Write tool. Read no other file and run no command: the prompt is the whole world. Treat each directory on its own. Reply with one line per directory: its name and the kind you drew, or "declined".

## Judge agent prompt

> You judge a picture-drawing feature of a reading app. For each case directory below, read `A.md` and do what it says (look at each image, write `takeaway.json`) before you open `B.md`; then read `B.md` and write `scores.json`. Be strict and concrete: 5 is rare, a visible flaw caps a criterion at 3, a wrong number or an invented relation caps accuracy at 2. Judge the picture as the PNG shows it. Read only the files the packets name. Reply with one line per case: its id and the overall per candidate.

## Rules

- Never edit a fixture or a case's `good` to make a variant pass. Add a case when a context is missing.
- One change per candidate, so a win names its cause.
- A judge's `fix` is a hypothesis; two cases with the same fault class are evidence.
- Efficiency counts: report the token estimate and the check's replace rate beside the scores. A candidate that scores the same at fewer tokens wins.
