# r5-cost5

**Intent:** Make Stitch spend fewer tokens and less waiting (round 5 cost audit COST5-01, -02, -03, -04, -08, -09), measured before and after on the audit's harness.

**Files:**
- `src/lib/graph/stitch.ts` — `groupMaxBlocks` (new) and its use in `pickBlocks` (the select call's `maxBlocks`); `selectedSections` (new `command` parameter, the short "No block shown" line and the gist rule past 20 documents), `titleMatches` (new), `TITLE_STOP`, constants `SELECT_GROUP_MIN`, `SHORT_LISTS_PAST`, `GIST_MIN_SHOWN`; `answerMessages` passes the command to `selectedSections`; `pass` on the usage of `expandWords`, the route and select calls in `pickBlocks`, and the answer call in `stitch`. The import of `tokenize` from rank.ts.
- `src/lib/graph/stitch-jev.ts` — `pass` on Jev's route and select usage.
- `src/lib/usage.ts` — `TokenCounts.reasoningTokens`, `UsageMeta.pass`, `UsagePass`; `sdkTokens`, `addTokens`, `recordUsage` write them.
- `prisma/schema.prisma`, `prisma/migrations/20261007160000_usage_reasoning_pass/` — `UsageEvent.reasoningTokens Int?`, `UsageEvent.pass String?` (additive, nullable).
- `src/lib/graph/skeleton.ts` — `skeletonAction` (new), `refreshAfterQuiet` (new), `ensureSkeleton` (defers under the quiet period), the skeleton build's usage `pass`, the header comment.
- `src/lib/derive/config.ts` — `STITCH_QUESTION_BUDGET` (15,000, one constant), the `SKELETON_QUIET_MS` comment.
- `src/lib/graph/find.ts`, `src/app/api/notebooks/[notebookId]/find/route.ts` — `caseless`; LIKE for a CJK query with no cased letter.
- `src/lib/etag.ts` (new), `.../graph/coverage/route.ts`, `.../outline/route.ts` — body-hash ETag and 304 (coverage, and `?parts=titles` only).
- `SPEC.md` — §2 usage telemetry, §13 Find and Coverage, §22 the skeleton, the select groups, the answer pass's lists, the question budget.
- `scripts/qa/stitch-budget-check.ts` (13 new checks), `skeleton-quiet-check.ts`, `usage-pass-check.ts`, `graph-etag-check.ts`, `ui-graph-etag.mjs` (new).

**Decisions:**
- The select cap is the audit's formula, capped at the kind's cap so one or two groups behave as before. The prompt's "up to N" takes it; ids past it are not cut in code (the measured saving is from the prompt).
- COST5-04: the gist is also kept for a document whose title holds a word of the command (found on the replay: "On Noise", 3 of 10 blocks shown). "Past 20" counts the documents read (generated pages left out). Title words: Latin 3+ letters off NAME_STOP plus a short list (document, project, passage, …); CJK two characters in a row.
- COST5-08: the deferred rebuild is an in-process timer (unref'd); a process that ends first loses it, and the next command past the quiet period builds then, as round 4 did. warmSkeletons (`force`) is unchanged: a graph open still builds a stale skeleton inside the quiet period.
- COST5-09: the ETag is the body's hash, not a version key: the body is still built (no server time saved), the transfer and parse are. No compact coverage form (the client would need to treat a missing entry as zero; not in this package).
- COST5-03: reasoningTokens is stored when the provider reports a number; Moonshot's adapter reports 0 when it sends none, so 0 can mean "not reported". The question budget is not cut.
- COST5-07 (history trim) not built: no 8-conversation replay was done.
