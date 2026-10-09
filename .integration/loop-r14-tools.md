# loop/r14-tools

## Intent

Fix round 14's tools findings: TOOL14-01 (blocking) first, then TOOL14-02 with SEL14-03 and EDGE14-03 as one change, TOOL14-04 to TOOL14-11 (03 is package 1's), and PAGE14-15; then the lead's ask that the assistant's failure lines carry no raw server text or status.

## Findings

Screenshots: `/mnt/project-files/interaction-loop/round-14/img/TOOL14-<NN>-before.png` and `-after.png` (befores for 02 and 04-11 are the audit's). Logs: `.qa-tmp/fix/` in this worktree.

- **TOOL14-01 (blocking): fixed.** A failed or stopped question in the assistant panel went nowhere. Before: the box was empty, 0 storage keys and 0 database notes held the question, and it was gone after a reload. After: the question goes back into the box, with its quote chip and attachments. The box keeps a draft per project (`unitos-assistant-panel-draft:<notebookId>`, written at most every 300 ms and on pagehide), so the question survives a reload. A resend saves it: database count 1, and the draft clears. origin/main has the same loss. Screenshots: `TOOL14-01-before.png`, `-before-reload.png`, `-after.png`, `-after-reload.png`.
- **TOOL14-02, SEL14-03, EDGE14-03: fixed.** Each box keeps its own words in `KeptTextarea`/`KeptInput` (`components/kept-field.tsx`): the toolbox's Comment, the ▾ panel field, the Assistant box, the tool card and chat card boxes, the highlight card's comment, the comment card, and the panel box. A box hands its words over at most every 300 ms, at once when it turns empty or not empty, and on Enter, Escape, blur, pagehide and unmount. Answer rows are memoized (`AnswerMarkdown`). A card drag moves by `style.translate` and saves on the drop. Long tasks per 60 keys, before → after:
  - Comment: 56 → 3.
  - Assistant box: 30 → 9.
  - Card with one answer: 118 → 33.
  - Panel: 8 → 0.
  - The notes search, as a baseline: 1–2.
  - Drag: frame gaps over 50 ms 60 → 4, long tasks 59 → 2.
  - Words survive an instant reload (kf-reload) and Escape, a click away, and a reload (tdrafts).
  - Logs: `t14-before.log`, `t14-after.log`, `d14-*.log`.
- **TOOL14-04: fixed.** A card with at least 160 px (`CAP_MIN`) under its top keeps its top, stops at the pane's foot and scrolls inside. Measured at 1440 (`j14-after.log`):
  - The follow-up card's top stays at 350 (was 350 → 228).
  - Save as note no longer moves it (was 228 → 196).
  - An Explain card stays at 626 (was 626 → 501).
- **TOOL14-05: fixed.** The card's trash and the panel list's bin delete with no ask. The notes' Undo pill offers Undo for 12 s. The DELETE to `/api/notes/:id` waits for the pill's commit and is keepalive, and it writes NOTE_REMOVE with the kept note for History's Restore. Measured (`del-after.log`):
  - Dialogs: 0.
  - Undo brings back the mark, or the list's row and the thread.
  - After the commit: database 0 and NOTE_REMOVE kept=true. Before, the panel's delete erased the conversation with no History event.
- **TOOL14-06: fixed.** The view draws the card's own turns through one renderer, `assistantTurns`: the plan, the rating and Save as note. Measured (`v14-view.mjs`):
  - The view's controls went from 7 to 11, all of them the card's.
  - The focus stays in the box: card box → the view's box on Expand, and back on Close (was BODY).
- **TOOL14-07: fixed.** One failure line under the box that sent it: "No answer: Unitos could not reach the server. Try again." or "No answer: the assistant had a problem. Try again." The toolbox's line no longer also lands in the article's error log. Typed words are kept after a reload. Logs: `err14-500-after.log`, `err14-abort-after.log`.
  - Lead's follow-up: the assistant routes (`/api/assistant`, `/api/assistant/act`) now answer a thrown model call with the plain line, and the raw text goes to the server log (`api/assistant/failure-line.ts`). On the client, a model call answered with no words for the reader reads as the plain line in place of "Request failed (N)", and a 503 the route worded for the reader keeps its words.
  - Checked (`err14-{413,503,500raw}-final.log`): a 413 HTML page gives the plain line; a 503 with words keeps those words; a 500 with raw text gives the plain line and shows no raw text.
- **TOOL14-08: fixed.** On a phone the image bar's summary keeps 10rem and the row wraps under it: 162 px of 162 (was 3 px). Accept is 66×30 and Reject 61×30 (`f14-390-after.log`).
- **TOOL14-09: fixed.** One class each for Send, Accept and Reject (`decision-classes.ts`), used by the plan, the note assistant, the bar, the cards, the toolbox and the panel. Phone sizes after: Accept 118×30 (was 124×28), Reject 61×30 (was 61×26), Send 49×33 (was 49×29), grip 36×36 (was 18×18) (`p14-phone.mjs`).
- **TOOL14-10: fixed.** The plan's toast reads "2 actions accepted · Undo" and shows for 12.3 s (was "2 actions applied", 8 s; `u14b-plan.mjs`). The note assistant shows "Accepted" beside Undo, and Undo brings back Accept and Reject (`u14c-note.mjs`).
- **TOOL14-11: fixed.** The hint reads "Click a figure, or hold and draw a small circle on a table, for its tools." On touch it starts "Tap a figure, …". zh changed with it. The hint's dismissal on a phone is unchanged; that is the owner's call.
- **PAGE14-15: partly done.** One wording is done: the field reads "Tell the assistant what to do with the selected words…" in both the box and the bar, en and zh. **The structural move is not done**, that is, putting the bar into the toolbox box in Editing. It is too risky for this round:
  - The bar's follow-up replaces the edit still pending (`replacing`); the chat card's path does not.
  - The figure's Assistant, Ctrl+Alt+G, Search the menus and the right-click menu open the bar with no toolbox.
  - Moving Editing to the box would drop one of those workflows or rework the suggestion lifecycle that the page package shares.

## Files

- `src/components/assistant/assistant-panel.tsx`:
  - TOOL14-01: the draft and putting a failed question back.
  - TOOL14-02: the kept box.
  - TOOL14-05: delete through the pill.
  - TOOL14-07: modelFetch, failureLine, noReason, and the error line under the box.
  - TOOL14-09: SEND_CLASS.
- `src/components/kept-field.tsx` (new): the box that keeps its own words (02).
- `src/components/assistant/answer-markdown.tsx` (new): memoized Markdown (02).
- `src/components/assistant/conversation-delete.ts` (new): the inline pill post and the deferred keepalive DELETE (05).
- `src/components/assistant/failure.ts` (new): modelFetch, failureLine and noReason (07).
- `src/components/assistant/decision-classes.ts` (new): the Send, Accept and Reject classes (09).
- `src/components/assistant/suggestion-row.tsx`: the bar's pair classes (09) and the summary's minimum width (08).
- `src/components/outline/note-assistant.tsx`:
  - TOOL14-07: the failure line under the box.
  - TOOL14-09: the classes.
  - TOOL14-10: Undo beside "Accepted".
- `src/components/reader/reader-interactions.tsx`:
  - TOOL14-02: the kept boxes and the style-only drag.
  - TOOL14-04: keepCardInPane caps instead of lifting.
  - TOOL14-05: the card's trash.
  - TOOL14-06: assistantTurns, and the focus on Expand and Close.
  - TOOL14-07: fetchWithModel → modelFetch and noReason; no second report in the error log.
  - TOOL14-09: the classes and the grip's coarse size.
  - TOOL14-10: UNDO_MS 12000.
- `src/components/reader/conversation-view.tsx`: a `turns` prop, `data-conversation-view`, and a Close press that keeps the focus (06).
- `src/app/api/assistant/failure-line.ts` (new), `route.ts`, `act/route.ts`: the plain line for a failed model call (07, lead's ask).
- `src/lib/i18n/dict/assistant.ts`:
  - Added: conversationDeleted, conversationDeleteFailed, failedConnection, failedServer.
  - Changed: noteAssistantApplied.
  - Removed: conversationDeleteConfirm.
  - en and zh together.
- `src/lib/i18n/dict/reader.ts`: actionsApplied, editHint, touchHint, assistantPlaceholder and barPlaceholder, en and zh.
- `SPEC.md`:
  - §6/§7: the panel draft, kept boxes, the conversations bin, failure lines and decision classes.
  - The plan's Undo.
  - §21: Expand.
  - How tall a card gets.
  - §29: the bar's field wording.

## Decisions

- The Undo pill is dispatched inline in `conversation-delete.ts` with the lead's contract: "dissect:undo-pill", cancelable, `{message, undo, commit}`. The DELETE is deferred to commit and is keepalive. My own key is `assistant.conversationDeleted`. At merge the lead may switch it to the notes' `postUndoPill` and `outline.conversationDeleted`; the shapes are identical.
- A page with no pill on it deletes at once, through the same route.
- A failed commit puts the conversation back on screen and says "Not deleted. The conversation is back; try again."
- The panel draft is one per project. With two tabs open, the last writer wins.
- The drag connector lags until the drop. During the drag the card moves by style alone, so nothing re-renders.
- On a short room, TOOL14-04's cap puts the plan's Accept below the fold inside the card's scroll; the box stays in view. This is the audit's proposal as written.
- In the expanded view the plan shows in the view only, so there is no duplicate under the hidden card. The rating buttons are drawn in both the view and the card, so a rating given in one is not lit in the other.
- A 5xx the route worded (not 500) keeps its words, so the 503 "needs a key" lines stay.
- A 4xx with an error keeps its words. The assistant routes now word their 422s for a thrown model call as the plain line.
- TOOL14-03 (focus after a mouse action) is package 1's and was not touched. TOOL14-06's focus move covers only Expand and Close, through `onMouseDown` preventDefault on those two buttons.

## Needs

- `reader.conversationRemoved` is now unused. The panel no longer calls `DELETE /api/assistant/conversation`; the route is left in place. Remove either only with the owner's approval.
- The reader.ts keys actionsApplied, editHint, touchHint and assistantPlaceholder are also read by the selection package. Check for conflicts at merge.
- With edge's merge, the panel's non-model failure lines could take `common.notSaved`; they were left as they are here:
  - list and load conversations;
  - attachments;
  - the comment post.
- Not in my files, and they still word a failed model call with raw provider text:
  - `api/derive/route.ts`: the stream's DeriveFailure, which shows on Explain while it streams;
  - `api/documents/[documentId]/suggest/route.ts`: window and stream errors;
  - `act/route.ts`: the order pass's warning, `modelErrorMessage(order)`, kept because "No answer" is wrong beside edits that landed;
  - `corpus-distill-page.tsx`: "Request failed (N)".
- `src/app/signin/deck/reader.tsx:349` still shows the old box placeholder ("…with this selection…"). It is a marketing replica, not my file.
- PAGE14-15's structural move needs its own change. Either the chat card learns `replacing` for a follow-up, or the bar stays as the follow-up surface after the box sends.
- The model routes' new plain line was checked by type check and code reading. The mock model cannot be made to throw, so the browser checks cover the client side only.
