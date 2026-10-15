# r10-retrieval10

**Intent:** Stitch's targeted path reads the text of its best matches beside a cut, the index query returns candidates without ranking and with a capped query, a "when was X printed" command is a date question, and a footnote line gets no year term in a dates cut (COST10-01 step 1, COST10-06, REV10-07, ANS10-07, ANS10-08, REV10-06).

**Files:**
- `src/lib/derive/config.ts` — `STITCH_INDEX_TEXTS` (20), `STITCH_INDEX_TEXT_CHARS` (600), `STITCH_INDEX_QUERY_TOKENS` (200) after `STITCH_INDEX_TOP`.
- `src/lib/graph/search.ts` — `searchBlocks` selects ids and document ids alone (no `ts_rank_cd`, no `ORDER BY`; the caller ranks); `searchQuery` keeps the last 200 tokens; header comment on the parser's `-10`/`3.14` tokens.
- `src/lib/graph/stitch.ts` — `matchTexts` (the first 600 characters of the top-20 matches when a cut ran and the intent is targeted); `skeletonSystem` takes the texts as its 6th argument and ends the system message with their section; `pickBlocks` builds the texts after `shown.add(matches)` and passes them; `asksDates` matches "when … printed/published/written/born/died/made/founded" and zh 何年.
- `src/lib/graph/rank.ts` — `FOOTNOTE`: a footnote line gets no `#year` term.
- `prisma/migrations/20261009120000_block_search/migration.sql` — comment only: the measured lock (2.3 s at 20,343 blocks, 6.1 s at 53,744), deploy in a quiet hour. SQL unchanged; `prisma migrate deploy` on a database that applied the old text reports no pending migration.
- `scripts/qa/stitch-budget-check.ts` — cases under `// [retrieval10]`.
- `SPEC.md` §22 — the index's unranked candidates and query cap; the texts beside a cut; the footnote rule; `asksDates`.

**Decisions:**
- The texts go into the select system message only when a cut ran and the intent is targeted: under the threshold every line is already shown, and a holistic command reads the whole skeleton. `STITCH_INDEX=0` stays byte for byte the round 8 reading.
- 20 texts of 600 characters (+1.8–2.8k tokens per command with a cut), not 25 of the full text: the audit's cases needed the first sentences, and the matches past 20 were false in every judged prompt.
- `searchQuery` keeps the last 200 tokens, not the first: the ranker's query puts the command and its expansion last, after the earlier turns.
- ANS10-08 (b) (named-document year lines above bare-year lines) not built: `named` is empty for the audit's commands and a named document's lines already go before the shares.
- The migration comment is edited in place rather than a new migration: a comment changes no checksum behavior that matters to `prisma migrate deploy`, and a new migration file for a comment would be noise.
- No user data is touched: every change reads blocks and writes prompts; no row is written, moved, or deleted.
