# loop/r16-tools

## Intent

Fix round 16's tools findings (PACKAGES.md section 2): TOOL16-01, 02, 03 (blocking) first, then TOOL16-10, 12, 13, 14, 15, 17, 18, 19 and EDGE16-13; TOOL16-04, 05, 07, 11 and NOTE16-08 moved to the edge package mid-round.

## Findings

Screenshots: `/mnt/project-files/interaction-loop/round-16/img/TOOL16-<NN>-before.png` and `-after.png` (01, 02, 03, 10, 12, 13, 15, 18; 14 has a before only). Befores for 10, 12, 14, 15 and 18 are the audit's own screenshots at 552f638 (`.qa-tmp/audit/r16/tools/tools-NN-*.png`); I changed those before rerunning them, so their before numbers are the audit's run, same commit. Scripts and logs: `.qa-tmp/t/` (the audit's scripts, pointed at :3142 and my project "Fix r16 tools"), `.qa-tmp/before/`, `.qa-tmp/after/` in this worktree. The machine ran at load 15–34 and my dev server restarted itself at its memory threshold several times; a run that hit a restart was run again and is not counted.

- **TOOL16-01 (blocking): fixed.** Two tabs on one project's panel conversation.
  - Before (k01b, my server): tab A sends A, tab B (opened before A's save) sends B: the conversation note holds seed 1, A 0, B 1. A's turn is gone from the database and from tab A after a reload.
  - After (k01b): seed 1, A 1, B 1, in that order; tab B shows A after its own send; tab A after a reload shows A and B.
  - The panel's save names its base (the note's `updatedAt`); `POST /api/assistant/conversation` answers 409 with the server's turns when the note moved; the panel merges (server turns, then its own turns past what it loaded) and saves again, up to 4 times. The message stays held in the browser's draft until a save lands.
  - `POST /api/assistant/act` (the selection chat and a tool continued into a conversation) appended its exchange by rewriting the whole transcript from the client's history: a stale tab wrote over turns, and a conversation over 12 turns lost its first ones (history is cut to the last 20, then to 12). It now appends the two new turns to the stored transcript under a row lock (`SELECT … FOR UPDATE`). act-append: before (by the code) 7 of 8 questions kept after a stale writer; after 8 of 8, the stale writer keeps all and adds its own.
  - origin/main has the same loss: the panel posts the whole thread with no base, and the act route writes `priorTurns` from the client.
- **TOOL16-02 (blocking): fixed.** The note's assistant: Undo on an accepted change after the note moved on.
  - Before (k02b): Undo shows after the reader typed later words (1); Undo takes them out of the editor (0 on screen) and, after Done, out of the database (false).
  - After (k02b, run e): Undo shows right after Accept; after typing, the row reads Accepted alone (Undo 0); the later words stay in the editor, in the database after Done (true), and after a reload (true).
  - Undo shows only while the note's text still reads as the change left it (whitespace aside).
  - origin/main has the same loss: `settle("open")` writes `proposal.before` whatever the note holds.
- **TOOL16-03 (blocking): fixed.** ✕ on a comment on an answer.
  - Before (k09b): no pill, no Undo; the row is deleted at the press (database rows 2 → 1), gone after a reload.
  - After (k09b, run g): after ✕ the pill "Comment deleted · Undo ✕" shows, the comment is off the screen (0) and the database keeps it (1); Undo puts it back (on screen 1, database 1); ✕ again and 14 s: database 0; after a reload 0 on screen, 0 in the database.
  - The panel and the reader's chat card go through `deleteCommentWithUndo` (`answer-tools.tsx`) → `deleteWithUndo`: the comment leaves the list, the pill "Comment deleted · Undo" puts it back in its place, the DELETE waits for the pill (keepalive on page close, resent after a reload, the row hidden until then).
  - origin/main has the same loss: `deleteComment` sends the DELETE at the press.
- **TOOL16-10: fixed.** A side chat's unsent words stay with that side chat.
  - Before (the audit's k09 at 552f638): after Back the side chat's unsent words are in the conversation's box (inBox 1).
  - After (k09, run i): after Back the side chat's unsent words are not in the conversation's box (inBox 0); the side chat reopened holds them (inBox 1); after a reload the conversation's box is empty of them (0) and the side chat holds them (1). The comment ✕ in the same run shows "Comment deleted · Undo ✕".
- **TOOL16-12: fixed.** Translation's failure lines.
  - Before (the audit's t01 at 552f638): "Failed to fetch", "Request failed (502)", "DeepL 456: Quota exceeded…".
  - After (t01, run j): a dropped network, a 502 HTML page and a 500 with DeepL's text each read "Not loaded. Try again."; a translation still lands (4 blocks), hides, shows, and survives a reload.
- **TOOL16-13: fixed.** The note's assistant shows the sent message once while it runs.
  - Before (k02b): while running inBox 1, onScreen 1.
  - After (k02b): while running inBox 0, onScreen 1. A send that fails or is stopped puts the message back in the box; the browser keeps it until the server answers.
- **TOOL16-14: fixed.** An answer Unitos could not read (the voice command's plan among them) reads "No answer: the assistant had a problem. Try again."; the reason goes to the server log. `wordedReason` keeps only "the answer ran out of room".
  - Before (the audit's vc01): "The answer came back in a form Unitos could not read. Try again."
  - After: my server has no transcription key, so vc01 stops at the 503 the route words for the reader (kept, as in round 15); the abort and the 500 read the plain lines as before. The plan-failure path was checked by calling `failureLine` with the reason (`.qa-tmp/t/fl-check.ts`): en "No answer: the assistant had a problem. Try again.", zh "没有回答：助手出了问题。请重试。"; "the output budget ran out" keeps its words in both. No after screenshot.
- **TOOL16-15: half fixed.** Under 380 px Collapse at rest is its icon (the label for screen readers), so Contents, Collapse and Extract keep one row; the NEW pill stays on it.
  - Before (the audit's b01, 360): band rows 3, Collapse 132×28 at y 118.
  - After (b01, 360, run k): Contents [16,84], Collapse (icon and NEW) [176,85 81×27], Extract [263,84]: one row over the article (the script's third "row" is the floating Extract at y 737, in the before run too). 390 unchanged (Collapse 132×28 with its label).
  - The M1 chips off the screen are drawn by `block-view.tsx` (select's): not changed.
- **TOOL16-17: half fixed.** A new animation or simulation plays its loop three times and rests (`repeatCount="indefinite"` → `"3"`, `repeatDur="indefinite"` removed, in `renderVisual` after the reduction). Checked by the code and by the reduction on a sample SVG, not in a browser: the audit's v03 answers the image route with its own SVG, so it never reads the stored one. Visualizations stored before keep looping (no rewrite of stored data). Still under reduced motion: not done, it is in `markdown.tsx` and the viewer (not this package's).
- **TOOL16-18: fixed for the note's assistant's Web and ✕.** k02b head row: before Web 38×20, Clear 46×25, ✕ 24×20; after Web 38×24, ✕ 24×24 (36 px on a coarse pointer). Clear is `clear-conversation.tsx` (edge's): its height is left to edge. The media and Ask ✕ are edge's files.
- **TOOL16-19: fixed.** SPEC.md §21 says the panel's message is held in the box's draft until its turn saves.
- **EDGE16-13: fixed.** "AI is off while offline…" in the note's assistant clears on the `online` event (only that line; any other error stays).
- **TOOL16-09, TOOL16-16: not done.** TOOL16-09 (Clear on a phone under the note's body) is in `note-card.tsx`, the notes package's; TOOL16-16 (one M1 chip per passage) is in `block-view.tsx`, select's.

## Files

- `src/app/api/assistant/conversation/route.ts`: GET returns `updatedAt`; POST takes `base`, answers 409 with the server's turns when the note moved, writes with `updateMany where updatedAt` and returns the new `updatedAt`.
- `src/app/api/assistant/act/route.ts`: `appendExchange` appends the new two turns under a row lock instead of rewriting the transcript.
- `src/components/assistant/assistant-panel.tsx`: the base and the 409 merge (01); comments deleted with Undo (03); one box per thread (10).
- `src/components/assistant/answer-tools.tsx`: `deleteCommentWithUndo`, `shownComments`.
- `src/components/reader/reader-interactions.tsx` (shared): the chat card's comment delete (03, two small hunks in the chat card region); Collapse's label under 380 px (15, one class in `collapseButton`).
- `src/components/outline/note-assistant.tsx`: Undo only while the note reads as the change left it (02); the box empties at send (13); head row sizes (18); the offline line clears on `online` (EDGE16-13). The Clear line and the `useKeptChat` call are untouched.
- `src/app/api/assistant/failure-line.ts`: `wordedReason` (14).
- `src/lib/derive/visualize.ts`: `restAfterLoops` (17).
- `src/components/reader/translation-bar.tsx`, `src/app/api/documents/[documentId]/translate/route.ts`, `src/lib/i18n/dict/api.ts`: one failure line for translation (12).
- `SPEC.md`: §6 (the note's assistant: Undo while the note reads as the change left it; the message leaves the box at Send), §7 (the comment's ✕ with the Undo pill; an unreadable answer is a plain failure), §19 (translation's 502 line), §20 (an animation plays three times), §21 (the panel's held message and the 409 merge), §28 (Collapse under 380 px).

## Decisions

- TOOL16-01's act route: a server-side append under a row lock instead of base + 409. The act route writes only the new exchange, so it has nothing to merge; the lock keeps two appends in order.
- The panel's merge keeps the server's turns, then its own turns past the count it loaded; a turn both sides changed is not possible (turns are append-only on this note).
- TOOL16-02: Undo is hidden (not disabled) once the note moved on; the row reads Accepted alone, as the audit proposed. No new control.
- TOOL16-10: the side chat's words live in a separate localStorage record (`unitos-assistant-side-drafts:<projectId>`) by the side chat's note id; a side chat never saved has no note, so on the next load its words join the conversation's box rather than being dropped.
- TOOL16-12: translation's 502 line uses the existing `api.translateFailed` key with new words (no `{reason}`), en and zh together; the bar's own fallback is `common.notLoaded`.
- TOOL16-17: three loops; stored pictures are left as they are (rule zero: no rewrite of stored data).

## Needs

- Scope change: the coordinator moved TOOL16-04, 05, 07, 11 and NOTE16-08 to edge. No hunk in edge's files (`kept-chat.ts`, `api/assistant/kept/**`, `clear-conversation.tsx`, `video/ask-panel.tsx`, `video/assistant-card.tsx`, `deferred-delete.ts`) was committed on this branch.
- Merge order with edge: `note-assistant.tsx` here does not change the Clear line or the `useKeptChat` call; if edge changes `ClearConversation`'s props, that line follows edge.
- `panes.translateFailed` (`src/lib/i18n/dict/panes.ts`, nav's) is no longer used by the translation bar; nav or the lead may remove it.
- TOOL16-09 → notes (`note-card.tsx`); TOOL16-15's chips and TOOL16-16 → select (`block-view.tsx`); TOOL16-17 under reduced motion → whoever owns `markdown.tsx` and `visualization-viewer.tsx`; TOOL16-18's Clear height → edge.
- Test data: my project "Fix r16 tools" (account mem) stays. During setup a duplicate upload of the webm matched another worker's document (`cmv0mu6fb002n7do8yql4vxx6` in "Audit r16 selection"), and my setup pasted `transcript.srt` onto it: its 5 TRANSCRIPT blocks were recreated with the same text and new block ids. The document has 0 Source rows now and none point at a missing block (checked 09:3x); the select worker should know its block ids changed.

## Checks

- `npx tsc --noEmit` (dev server stopped): no errors. `npx eslint` on the 11 changed .ts/.tsx files: no errors, no warnings.
