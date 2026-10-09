# r9-safe9

**Intent:** Round 9's data-safety package: the offline queue keeps another account's records (REV9-01), an open reply or Note on this link box takes a dropped write's words at once (REV9-02), every dropped write keeps its words and a replayed comment whose words moved saves orphaned (REV9-03), the replies route takes a replay mark only as a whole number (REV9-07), the admin usage page counts cached tokens (REV9-06), and the reviewer's ui-graph-etag patch.

**Files:**
- `src/middleware.ts` — the 409 for another account carries `code: "accountChanged"` (PR #20's line) so the queue keeps the record.
- `src/lib/offline/queue.ts` — records of another account wait (`queuedForThisAccount`, `nextRecord`, `accountChanged` → "wait"; PR #20's lines without `held`); `keepDroppedWords` runs for every dropped write, PATCH too, with the record's queue time.
- `src/lib/note-drafts.ts` — `replyDraftKey`/`linkNoteDraftKey` exported, `DRAFT_KEPT_EVENT`, `subscribeDraftKept`; `keepDroppedWords(account, path, body, method, queuedAt)` announces the kept draft and sends every other write's words to the not-saved list.
- `src/lib/offline/not-saved.ts` — new: the per-account list of dropped writes' words in localStorage (`unitos-not-saved:<account>`), capped at 50.
- `src/components/collab/reply-thread.tsx`, `src/components/graph/link-note-composer.tsx` — the open box takes the kept draft on `DRAFT_KEPT_EVENT`.
- `src/components/offline-status.tsx` — the not-saved button ("1 offline change could not be saved · Copy its words") and the Copied line.
- `src/lib/i18n/dict/common.ts` — `offlineNotSavedOne`, `offlineNotSaved`, `offlineNotSavedTip`, `offlineNotSavedCopied`, en and zh.
- `src/lib/replay.ts` — new: `replayTime`, `replayedAt` (moved from `api/notes/route.ts`).
- `src/app/api/notes/route.ts`, `src/app/api/replies/route.ts` — read the replay mark through `lib/replay.ts`; a header that is not a whole number is no replay.
- `src/app/api/annotations/route.ts` — a replayed comment whose anchor does not resolve saves with an orphaned source (`createOrphanedComment`).
- `src/lib/usage.ts` — `CACHE_COUNTED_APART_SINCE`.
- `src/app/admin/usage/page.tsx` — the cached tokens of rows since that time are added into Input tokens and every Tokens sum.
- `SPEC.md` — §7 (REV9-06), §12 (REV9-07), §17 (REV9-01, REV9-02, REV9-03).
- `scripts/qa/ui-queue-account.mjs`, `ui-reply-kept.mjs`, `ui-dropped-words.mjs`, `ui-usage-cached.mjs`, `replay-drop-check.mjs` — new checks; `reply-drafts-check.ts` extended; `ui-graph-etag.mjs` — the reviewer's patch.

**Decisions:**
- A dropped write with no box of its own (a comment, a note's edit, a gathered note, a block's edit) keeps its words in a browser list the offline pill offers to copy, not as a new pending note: on a 403 the account can no longer write in the section, and on a 404 the section or note is gone.
- The reply and Note on this link drafts stay account-keyed in `lib/note-drafts.ts` (round 8); PR #20's card drafts for the reply box are not taken (see `.qa-tmp/stitch/r9/safe9/MERGE-PR20.md`).
- `CACHE_COUNTED_APART_SINCE` is 2026-10-08T00:00Z, the day of COST8-02; the integrator should set it to that fix's production deploy time.
- `note-drafts.ts` imports `./offline/not-saved` by a relative path so the reviewer's `drops9.mts` can import the module outside the path alias.
- `stitch-box.tsx` is untouched.
