# r8-cost8

**Intent:** Cut Stitch's uncached prompt text without changing picks or answers: cache the answer pass's first-read paragraph (COST8-03), name each document once in a cut select prompt (COST8-04), and close COST4-09, the whole threshold, the history trim and COST8-05 in SPEC §22.

**Files:**
- `src/lib/prompts/stitch.ts`: new `firstReadParagraph(picked, where)` holds the paragraph's words (unchanged but "above"/"below"); `StitchCtx.firstReadInSystem`; `stitchPrompt` leaves the paragraph out when it is set.
- `src/lib/graph/stitch.ts`: `answerMessages` computes `historyFirst` before `stitchPrompt` and puts the paragraph after "The blocks a first read picked for the command follow." in the system message (not for history-first, a back selection, or the whole read); `skeletonSystem` cut line `[document X]: N of M skeleton lines shown` and its intro sentence.
- `scripts/qa/stitch-budget-check.ts`: 6 COST8-03 cases, the cut-line case updated for COST8-04 (356 → 362 ok).
- `SPEC.md` §22: the two changes and four closures with numbers.

**Decisions:**
- The paragraph's words live in one function so ENGINE8's rewording lands in one place; "above"/"below" is a parameter, "picked" stays a boolean.
- History-first keeps the paragraph in the user message ("above"), since its blocks are in that message; history-first is off by default.
- COST8-05 not done: judged as the select model, a routed part whose only shown line is its heading ("7." of The Antichrist on "differ on suffering") is picked by its summary alone.
