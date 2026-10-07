# r2-engine2

**Intent:** Improve how much of what an answer needs reaches Stitch's reading passes (recall) and what those passes cost (ENGINE2: ANS2-01..10, COST2-04/05/06, caching, the skeleton build gate, STITCH_READS_GENERATED = false).

**Files:**
- src/lib/graph/stitch.ts: kind rule (`commandKind`), query expansion (`expandWords`, Flash, falls back to the command's own words on failure), ranked cut past STITCH_CUT_OVER for questions and links, groups that close at document ends, pick order (`firstsFirst` after `interleave`), answer sections list only documents with a block shown plus one line for the rest, a partial-read note per case, split list tags in `replyWithIds`, Anthropic cacheControl on system messages, loadDocuments tiebreak by documentId.
- src/lib/prompts/stitch.ts: expand prompt; select prompt puts the best block first; answer prompt has one partial-read sentence per case, never for a document with no block shown; one block per citation tag.
- src/lib/prompts/skeleton.ts: line cap scales with block length (40 words, or one word in ten past 400 words).
- src/lib/graph/skeleton.ts: line, gist, and summary are trimmed instead of failing validation; `built` timestamp; `skeletonNeeded` gate (one SQL query); `refreshSkeleton` waits out SKELETON_QUIET_MS unless forced; `warmSkeletons`; part fallback titles "Blocks 1–40"; a part never starts its title on a footnote; prefix cacheControl.
- src/app/api/notebooks/[notebookId]/stitch/warm/route.ts (new): POST, editor role, builds stale skeletons after the response, 202.
- src/lib/derive/config.ts: STITCH_CUT_OVER, STITCH_LINKS_SKELETON, STITCH_EXPAND_*, SKELETON_QUIET_MS, SKELETON_BUILD_CONCURRENCY; STITCH_READS_GENERATED = false.
- src/components/graph/stitch-box.tsx: warm POST on open (editors), `generatedIds` prop so "Every document (N)" leaves generated documents out.
- src/components/graph/graph-overlay.tsx: passes `generatedIds`.
- src/lib/assistant/project-reading.ts: the Project-scope assistant passes the kind.
- scripts/qa/stitch-budget-check.ts, stitch-context-check.ts, mock-kimi.mjs: checks for all of the above; context check has an expand pass; mock answers the expand prompt.
- SPEC.md §2, §7, §22: describe what was built.

**Decisions:**
- Groups stay the path for skeletons up to 100k (STITCH_CUT_OVER); the ranked cut runs past it. Cutting everywhere past 50k cost more on the mixed conversation ($0.2582 vs $0.2459).
- ANS2-08 (run lines) is skipped. Keeping every claim saves about 9k of P2's 142k.
- SKELETON_QUIET_MS = 10 min: an edited document's skeleton rebuilds at most once per 10 minutes on a read. A forced warm on graph open rebuilds regardless. A stale skeleton is still read in the meantime (SPEC §22 tenth-changed rule unchanged).
- The expansion call reuses the stitch-select feature model (Flash) at low effort. Its tokens go to the run's usage.
- The 30-quote save-as-note cap is in write-planned.ts, which SAFE owns. SAFE fixed it there.

**Rule zero:** No user data is written or removed. Skeletons are a derived cache on Document. The warm route only rebuilds them. STITCH_READS_GENERATED = false changes what Stitch reads, not what is stored. Generated documents stay in the graph and in the project.
