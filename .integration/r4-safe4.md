# r4-safe4

**Intent:** Fix round 4 review findings REV4-01 to REV4-08: rule zero first (no-project link removals, restore of hide rows, draft sweeps), then stale passages, the skeleton build lock, reply quote checks, the first-pick cap, and the kind rule.

**Files:**
- `src/lib/collab.ts` — `linkAccess` with no project answers 404 on a change to a link hidden in a project the caller edits; `linkHideProjects` with no project hides in every project of any account the caller edits that holds both documents (`editableHolders`). (REV4-01)
- `src/app/api/links/[linkId]/route.ts` — DELETE refuses (409 `api.linkRemoveReload`) when the row must stay and no project to hide it in is found. (REV4-01)
- `src/lib/i18n/dict/api.ts` — `linkRemoveReload`, en and zh. (REV4-01)
- `scripts/qa/link-scope-check.ts` — section 4, no project named. (REV4-01)
- `scripts/recover/restore-account.mjs` — restores DocLinkHidden rows of restored links in restored projects; dry run counts them. (REV4-04)
- `src/lib/note-drafts.ts`, `scripts/qa/reply-drafts-check.ts` — reply and Note on this link drafts are never swept by age. (REV4-06)
- `src/components/graph/graph-generation.ts` (new), `graph-data.tsx`, `link-passages.ts`, `documents-list.tsx`, `scripts/qa/ui-graph-passages-fresh.mjs` (new) — passages and part titles read again after a rev move, even on a 304. (REV4-02)
- `src/lib/graph/skeleton.ts`, `src/lib/derive/config.ts`, `scripts/qa/skeleton-lock-check.ts` (new) — lock heartbeat, 45 s dead lock, 5 s command wait, Stop stops builds. (REV4-03)
- `src/lib/graph/stitch.ts`, `scripts/qa/stitch-budget-check.ts` — checkReplyQuotes folds, firstsFirst cap, commandKind edges. (REV4-05, 07, 08)
- `SPEC.md` — §6 replies (drafts), §13 (links, passages, part titles, restore), §22 (passes, kind rule, quotes, skeleton lock).

**Decisions:**
- With no project named, a removal hides the link in every project the caller edits that holds both documents, of any owner (the closest match to the old delete that keeps the row); 409 only when there is none.
- The no-project hide check in `linkAccess` applies to editor-level calls only (changes); reads and a viewer's own reply delete are unchanged.
- REV4-06: reply and link note drafts are kept forever rather than for 180 days; a confirmed send or Cancel clears them.
- REV4-02: instead of clearing kept passages, a per-project generation marks them stale; the old passage shows until the new one lands (no flash), and a failed call keeps it.
- REV4-03: Stop aborts a shared build only when every waiter had a signal; a warm or edit refresh keeps it running. A command waits 5 s, not 60 s as the review proposed, per the task.
- REV4-07: a long first pick goes to the select order and its document gets no first pick in front (the review's one-line fix), rather than promoting its next block.
- REV4-08: "List the reasons each author gives for pity" stays a page (the review marked the wanted kind uncertain).
