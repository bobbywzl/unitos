# r6-cost6

**Intent:** Round 6 cost fixes for Stitch: REV6-03 + COST6-06 (graph open honors the skeleton's quiet period; a deferred command waits for a running build), REV6-04 (no 10-minute timer), COST6-04 (name-hit fallback), COST6-05 (older answers trimmed after the picks), COST6-02 A+B (cached select headers, `(…)` gaps).

**Files:**
- `src/lib/graph/skeleton.ts`: `warmSkeletons` passes `needed` instead of `force`; `refreshSkeleton` gains `needed`; `refreshAfterQuiet` and its map removed; new `runningBuild`; `ensureSkeleton`'s defer branch waits for it; `skeletonAction` doc.
- `src/lib/derive/config.ts`: the `SKELETON_QUIET_MS` comment.
- `src/lib/graph/stitch.ts`: `answerMessages` (the pick layout reads `trimmedHistory`), new `trimmedHistory` + `HISTORY_FULL_ANSWERS`, `HISTORY_SHORT_LEAD`, `RECORD_START`; `skeletonSystem` rewritten and exported; `pickBlocks`' no-pick fallback (`namePicks`, `NAME_FALLBACK`).
- `src/lib/prompts/stitch.ts`: `stitchSelectPrompt`'s partial note names `(…)`.
- `scripts/qa/skeleton-quiet-check.ts`: queued-rebuild cases 3–4 replaced by the warm and the wait cases.
- `scripts/qa/stitch-budget-check.ts`: Round 6 (COST6) block, 13 checks.
- `SPEC.md` §22: the quiet period at the warm, no queue, the wait; the cut's layout; the name-hit fallback; the history trim.

**Decisions:**
- The history trim runs only where the blocks picked precede the history (nothing behind them caches). The whole read and the history-first layout keep every answer whole: there the history is a cached prefix, and a sliding trim would break it every turn and cost more than it saves.
- A cut's lines header keeps the document's title (`[document X] "<title>": N of M …`), which the audit's layout A dropped: ~1.5k tokens at 200 documents, so the model never looks a letter up 20k tokens back.
- `force` stays on `refreshSkeleton` for checks that start a build; no app code passes it now.
- The defer branch's wait costs one small row read per deferred document.
- COST6-02 C (summaries for routed parts only) held, as the audit advised.
