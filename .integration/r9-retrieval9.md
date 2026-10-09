# r9-retrieval9

**Intent:** ship the RETRIEVAL9 package of round 9 — the text-match channel for Stitch's select pass (the matches line, the fused cut, the retry and the cap, the intent rule, the `Block.search` index, warm by rev), on by default and off with `STITCH_INDEX=0`, with the cut fixes of the answers audit that live in the cut (ANS9-01 dated lines and the named document, ANS9-05 function words and the routed fill).

**Files:**
- `prisma/migrations/20261009120000_block_search/migration.sql` — adds the generated `tsvector` column `Block.search` and its GIN index; additive, drops nothing.
- `prisma/schema.prisma` — `Block.search Unsupported("tsvector")?` with the comment that forbids an automatic drift fix (Prisma does not model GENERATED).
- `src/lib/derive/config.ts` — `STITCH_INDEX` (on unless `STITCH_INDEX=0`), `STITCH_INDEX_TOP`, `STITCH_INDEX_PREFILTER_BLOCKS`, `STITCH_INDEX_NOMATCH_CAP`, `STITCH_CUT_NAMED_MAX`, `STITCH_CUT_NAMED_DOCS`.
- `src/lib/graph/intent.ts` — `commandIntent`: fact / holistic / links / page / followup / meta, a rule on the command's words.
- `src/lib/graph/rank.ts` — `RankOptions` (`stop`, `extra`), `STOP_WORDS`, `YEAR_TERM`, `fuseRanks`.
- `src/lib/graph/search.ts` — `searchQuery`, `searchBlocks`, `searchAvailable` (one probe per process; a missing column or a failed query falls back to the in-memory rank and logs once).
- `src/lib/graph/skeleton.ts` — `warmSkeletons` checks the stored rev first (quiet when nothing changed).
- `src/lib/graph/stitch.ts` — `textMatches`, `asksDates`, `CutOptions` (`matches`, `retry`, `cap`, `stop`, `withinRouted`, `terms`, `named`), `cutLines` (the fused order, the matches' lines first, the named documents, the routed fill, one count per line), `pickBlocks` (the intent, the prefilter, the matches per select group, the whole read's matches with the expansion).
- `src/lib/prompts/stitch.ts` — `StitchSelectCtx.matches` and the matches line in the select prompt's user message.
- `scripts/qa/stitch-budget-check.ts` — 28 cases for the above (the byte-identical prompt without matches, the empty-options cut, the stop words, the routed fill and its order, YEAR_TERM, asksDates, the named document).
- `scripts/qa/stitch-retrieval-eval.ts` — the evaluation script (recall@K per retriever; `--ab 1` runs the real `cutLines` with and without the channel).
- `SPEC.md` §22 — the matches line, the fused cut, the retry and the cap, the intent rule, the index and what turns it off, the cut's ANS9-01/05 rules, ANS9-07 not built.

**Decisions:**
- Default on. `STITCH_INDEX=0` gives the round 8 reading byte for byte (checked: the select prompt without matches equals the old one; a cut with empty options equals a cut with none).
- The index is optional at runtime: the prefilter runs only when `Block.search` exists (probed once per process); a failed query turns it off for the process with one log line. A failed search never fails a command. The migration stays in the package; production applies it in the production build only (`scripts/deploy-build.mjs`: `prisma migrate deploy` when `VERCEL_ENV` is production, previews skip it). The rewrite takes an ACCESS EXCLUSIVE lock for about 3.5 s per 54k blocks plus 1.3 s for the index.
- The holistic class stays in `commandIntent` and reads as today (ENGINE9 judges the cached whole read for it). The cut's ANS9-01/05 rules apply to every intent class when `STITCH_INDEX` is on, since R9-26 (the 200-document case of ANS9-05) is holistic.
- ANS9-05 (a) as the audit wrote it (the routed documents only past the shares) filled 13.3k of a 20k cut with lines sharing no word and lost a needed block; the shipped order is the routed documents' lines that share a word, then the other documents' lines that share one, then the routed documents' lines that share none.
- ANS9-01: `YEAR_TERM` is added only for a contradictions or date command (`asksContradictions || asksDates`), not to the text matches; the named document rule uses titles only (no gists) and gives up when more than 3 documents match (a word common to the project).
- ANS9-07 not built: a 20k ranked cut of R9-19's six-document pick loses 2 to 3 of 14 needed blocks on the first command, and the command is holistic.
- The stop list lives in `rank.ts` (`STOP_WORDS`, "when" and "not" kept) and `search.ts` adds "when" for the index query.
- Expected conflicts: ENGINE9 branched from ddb1f21b and edits `src/lib/graph/stitch.ts` and `src/lib/prompts/stitch.ts` (the answer rules, `overEvery`); my later commits touch `cutLines`, `pickBlocks`' cut options, `asksDates` and the imports in `stitch.ts`, nothing in `prompts/stitch.ts` after ddb1f21b. LISTS9 is nowhere near; COST9 touched `graph-data.tsx` and `ui-graph-etag.mjs` only.
