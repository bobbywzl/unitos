# r3-engine3

**Intent:** Fix Stitch's answers and cost from the round 3 audits: ANS3-01 to ANS3-07, COST3-01, COST3-02, COST3-06, COST3-07, REV3-06 and REV3-07.

**Files:**
- `src/lib/graph/stitch.ts`:
  - commandKind reads polite openings, idiom verbs, and Chinese page and links words (ANS3-02, REV3-06).
  - New exports: `commandNames` and `nameHits` find the command's rare names and the blocks that name them (ANS3-01). `checkReplyQuotes` takes the quote marks off a span that no block holds (ANS3-05). `replyLanguage` is the reply language switch (ANS3-04).
  - `firstsFirst` takes an optional `cap`, so first picks stop at a third of the kind's budget (COST3-01).
  - `cutLines` is exported, with a fallback for when no line scores (ANS3-03).
  - `answerMessages` takes `names`, and builds the history-first layout when `STITCH_HISTORY_FIRST` is on (COST3-06).
- `src/lib/prompts/stitch.ts`:
  - The select prompt and the answer prompt list the blocks that name a rare name, and the answer is told whether a "which documents" list is partial (ANS3-01).
  - The expansion is written in the documents' language (ANS3-03).
  - The answer prompt asks for no padding and a single partial-read sentence (ANS3-06), and lets a later dated note replace an earlier one (ANS3-07).
  - Quotes are copied exactly (ANS3-05).
- `src/lib/prompts/skeleton.ts`: every proper name goes in the skeleton line (ANS3-01).
- `src/lib/derive/config.ts`: `STITCH_REPLY_LANGUAGE` ("ui"), `STITCH_HISTORY_FIRST` (false).
- `src/lib/graph/skeleton.ts`:
  - The build lock: claim, release only our own stamp, and one build per document in the process. buildSkeleton no longer clears the lock (REV3-07).
  - New export `staleSkeletonDocuments` finds drift in SQL. warmSkeletons throttles, then refreshes only the stale documents, so it no longer reads every block's text (COST3-07).
  - refreshSkeleton skips generated pages (COST3-07).
- `src/app/api/notebooks/[notebookId]/stitch/route.ts`: no background skeleton for a generated page unless STITCH_READS_GENERATED (COST3-07).
- `scripts/qa/stitch-budget-check.ts`: checks for every change above.
- `scripts/qa/stitch-context-check.ts`: the audit's version, with scenarios (h) and (i), the output price, and DUMP_DIR.
- `SPEC.md` §22 (Stitch): the skeleton name rule, the cap, the names lines, the quote check, the reply language switch, the build lock, and the history layout switch.

**Decisions:**
- STITCH_CUT_OVER stays at 100k. Groups raise recall, but the focused select costs +48–53%, outside the +5% limit.
- STITCH_HISTORY_FIRST ships off. It saves 0.6–1.1%, and the blind run showed some detail dropped.
- A picked generated page still gets a skeleton on demand from ensureSkeleton. Only the background and warm builds skip generated pages.
- The checkReplyQuotes misquote fallback strips the quote marks and keeps the words. It does not drop the sentence.
- The reply language default stays "ui". The owner (Linda) has the call.
