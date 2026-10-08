# r8-safe8

**Intent:** Fix REV8-01 (a queued note or reply on a link lost when the link is removed meanwhile), REV8-02 (a removed link proposed back once its quote is orphaned) and COST8-02 (UsageEvent.costUsd charges cached input twice).

**Files:**
- src/app/api/notes/route.ts: a replayed note (x-unitos-replay) on a removed link saves with the link's sources; on a link of the project whose documents left it, the quotes as plain text (x-unitos-quotes-kept); on a gone or foreign link, the words alone. Online: 404 as before. `replayedAt`/`quotesKept` moved above the fromLinkId block.
- src/app/api/replies/route.ts, src/lib/collab.ts: `linkAccess(link, min, scope, { removed })`; a replayed reply on a link hidden in the project saves on the kept row.
- src/lib/note-drafts.ts (`keepDroppedWords`), src/lib/offline/queue.ts (sendWrite): a reply or Note on this link the queue drops on a 4xx (or the last 5xx) goes back into its box's draft, appended after words typed since.
- src/lib/graph/stitch.ts: `liveLinks` keeps links hidden in the project (reviewer's diff).
- src/lib/usage.ts: `sdkTokens` stores noCacheTokens (else total − cacheRead − cacheWrite) as inputTokens. src/lib/video/gemini.ts: promptTokenCount − cachedContentTokenCount.
- SPEC.md: §7 usage telemetry (old rows overstate cached calls), §17 sync (REV8-01), §22 links (REV8-02).
- scripts/qa: link-replay-check.mjs (new, 14), ui-link-drop.mjs (new, Chromium), reply-drafts-check.ts (+6), usage-pass-check.ts (+7: cached usage per pass through the real Moonshot provider), stitch-budget-check.ts (REV8-02 case).

**Decisions:**
- A replayed note on a removed link keeps real sources (its ends are still in the project), not plain text: the quotes stay anchored. Plain text only when an end left the project.
- Quotes are copied as text only from a link of this project (notebookId) or one hidden in it, so a forged replay header cannot pull another project's quotes; otherwise the words alone.
- No replay dedupe added for link notes (unchanged from before; REV6-06's dedupe covers gathered notes only).
- The draft floor covers replies and Note on this link only: a plain or gathered note dropped on a 4xx has lost its section, so there is no box to open on the words.
- No admin-page note on old usage rows (SPEC and commit say it); no UsageEvent row rewritten.
