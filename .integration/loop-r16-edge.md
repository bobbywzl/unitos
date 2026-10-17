# loop/r16-edge

**Intent:** fix round 16's edge package: kept conversations under failure (two tabs, two accounts, offline), Clear in the one delete shape, offline deletes of a match or an extraction, and Transcribe for a viewer.

## Findings

Screenshots: `.qa-tmp/fix/<ID>-before.png` / `-after*.png` in this worktree, copied to `/mnt/project-files/interaction-loop/round-16/img/`. The store checks: `npx tsx scripts/qa/kept-chat-check.mts` (KEPT_CHAT=<old copy> runs them on the old store): before 7 PASS 5 FAIL (`.qa-tmp/fix/kept-chat-check-before.txt`), after 12 of 12 PASS (`-after.txt`). The browser runs used the audit's scripts against :3146 (`.qa-tmp/edge/`); the two-account runs used my own server on :3146 with sign-in on against a copy of the database (`dissect_r16edgefix`, dropped after), the recipe in `edge.md`.

| id | result | before | after |
|---|---|---|---|
| EDGE16-01 (blocking) | fixed | two tabs, saves failing, B closes: the row and a new page hold A's exchange only (2 turns; the store check FAIL) | 4 of 4 turns on the server 40 s later, before any reload; local copies dropped; the store check PASS (`kc-note twotabsfail`) |
| EDGE16-02 (blocking) | fixed | a failed ask leaves the row `[question 2, ""]`, a stopped ask deletes the row (`[]`) | afail, astop, aoffline: the row keeps the first exchange; the plain line under the box; the question stays in the box |
| EDGE16-03 (blocking), TOOL16-04 | fixed | Ask's typed question gone after a reload (no key); a queued media message gone after a reload or a closed card | Ask's box shows the typed words after a reload; the queue is kept (`media-queue:` draft) and sent after the reload and after close + open |
| EDGE16-05 (blocking) | fixed | the editor's card showed the owner's private exchange and saved it into the editor's row; the box held the owner's words | the editor's card shows nothing of the owner's; the editor's row holds only the editor's turns; the owner's copy stays and lands in the owner's row when the owner signs in again; the editor's box is empty |
| EDGE16-06 (blocking), TOOL16-05 | fixed | "boom raw server text" / "Failed to fetch" stored as the answer, Save as note under it | nothing stored (row `[]`), the message back in the box, "No answer: the assistant had a problem. Try again." (offline: the offline line) |
| EDGE16-07 | fixed on Ask and the media assistant | raw server text | the one failure line (`failureLine`, `modelFetch`); Stitch and translation are not mine (Needs) |
| EDGE16-08, TOOL16-07, NOTE16-08 | fixed | Clear: the browser's confirm, no way back | no ask; "Conversation cleared · Undo ✕"; the row stays until the pill goes; Undo puts the turns back; the row goes 12 s later (`kc-note clearundo`) |
| EDGE16-09 | fixed | offline or a 500: the spans come back with Not saved; stored 1 | spans stay hidden; the header reads "1 saved for sync" / "Syncing 1 change…"; stored 0 once back |
| EDGE16-11 | fixed | the viewer's bar: Detect speakers, Transcribe again | viewer: play, mute, fullscreen, Ask about a range; the owner keeps both (`sa16 viewerbar`) |
| EDGE16-12 | fixed | tab A shows only its own turns until a reload | A shows B's turns without a reload (storage event, tab shown, surface opened); `kc-note twotabs` and the store check |
| TOOL16-11 | fixed | after a reload the answer shows without its question | the box shows the kept question (`kc-media abasic`) |

Same loss on `origin/main`: yes for EDGE16-01, 02, 03, 05, 06 (`kept-chat.ts`, `ask-panel.tsx`, `assistant-card.tsx`, `api/assistant/kept/route.ts`, `clear-conversation.tsx` are byte-identical there, checked with `git show origin/main:<path>`). `lib/deferred-delete.ts` does not exist on origin/main (EDGE16-09 is this branch's).

Not run: `kc-stitch` (the Stitch box did not open on my one-document project; Stitch uses the store API unchanged). Speed (EDGE16-10) is not in this package.

## Files
- `src/lib/kept-chat.ts`: one local copy per page (`<project>|<place>|<page id>`), naming the account; a load and every save take in the other pages' unsaved copies of the same account and drop them once saved; turn ids and merge by id; a failed load adopts only the tab account's copies; refresh on the storage event, on visibility, and when a surface opens; Clear with the Undo pill (`clearEntry`); box drafts under the account; `keptStore().open()` for scripts. The API is only added to (`KeptTurn.id?`, `open`).
- `src/app/api/assistant/kept/route.ts`: a turn may carry `id`.
- `src/components/assistant/clear-conversation.tsx`: the confirm goes.
- `src/components/video/ask-panel.tsx`: the new ask lives beside the kept exchange until its first words; failure line; draft; the box shows the kept question.
- `src/components/video/assistant-card.tsx`: no stored failure; message back in the box; the line; the queue kept and held after a failure.
- `src/components/video/transcript.tsx`: Detect speakers, Transcribe again, Retry and Paste transcript hidden from a viewer.
- `src/lib/deferred-delete.ts`: offline or a 5xx: the PATCH/DELETE goes in the queue (`queue: true`); the pending record stays until it lands.
- `src/lib/i18n/dict/common.ts`: `conversationCleared` (en, zh).
- `scripts/qa/kept-chat-check.mts`: each tab is its own module copy (a query-string import was one module, so the old two-tab checks ran one store); five new checks.
- `SPEC.md`: §21 kept conversations, Ask about a range, the media assistant, the two delete lines (extractions and the reader's cards).

## Decisions
- A turn that fails on the media assistant comes out of the conversation and goes back into the box, also when the failure is the page unloading mid-answer; after a reload the reader finds the question in the box rather than a question with no answer.
- After a failed send the media queue waits for the reader's next send instead of draining (each would fail the same way offline).
- Another tab's unsaved turns are appended after this tab's turns (time order across tabs is not kept); turns are never lost or doubled.
- With sign-in off (one account), a local copy with no named writer is adopted; the old store parked such copies forever.
- Box drafts written before this change move to the first account that reads them (they named no account).
- A queued match/extraction delete keeps its sessionStorage record, so a reload still hides the rows until it lands; the queue holds an identical write once.
- Clear's pill message is a new key in `common.ts` (`common.conversationCleared`), not in `assistant.ts` (tools package).

## Needs (files I do not own)
- `src/components/outline/note-assistant.tsx` (tools): its box draft `unitos-note-assistant-draft:<note>` names no account (EDGE16-05, the note's assistant half). Replace `readTyped`/`writeTyped` with `readChatDraft`/`writeChatDraft` from `lib/kept-chat.ts` (key `note:<noteId>`), which name the account; one-line change each.
- `src/lib/i18n/dict/assistant.ts` (tools): `clearConversationConfirm` (en, zh) is now unused; remove it.
- `src/components/reader/translation-bar.tsx` (tools): EDGE16-07's raw text; use "Not translated. Try again." style plain line and log the rest.
- `src/components/graph/stitch-box.tsx` (graph thread): EDGE16-07 / TOOL16-06, the same shape as the media assistant now has.
- Data: the audit's projects "Audit r16 edge…" on the shared database were already gone partway through my runs (not deleted by me; my scripts only clear their own kept rows and set a match on their block copy). My own test project "Audit r16 edge fix" was deleted through the app at the end (see below).
