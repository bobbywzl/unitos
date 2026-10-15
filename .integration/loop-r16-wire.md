# loop/r16-wire

**Intent:** Round 16's wiring leftovers after the six packages merged: the account on the note's assistant draft (EDGE16-05), a highlight across blocks in the notes panels (SEL16-01's other half), the one failure line on the reader's remaining assistant paths (EDGE16-07, TOOL16-12), unused i18n keys, the note's assistant on a phone (TOOL16-09), the match chips (TOOL16-16, TOOL16-15's chip half), and PAGE16-06 if small. Each item is its own signed commit. The round is the last of the loop (Linda asked to stop after it), so items that need a design choice are left open below.

Screenshots: `.qa-tmp/fix/WIRE16-<n>-before.jpg` / `-after.jpg` in this worktree (`/mnt/project-files` failed with I/O errors, so nothing was copied there). Scripts: `.qa-tmp/wire/` (`item1.mjs`, `item2.mjs`, `item3.mjs`, `k11.mjs`, `desk5a.mjs`, `clearsize.mjs`, `item5b.mjs`, `item5b-tap.mjs`, `item5c.mjs`, `setup.mjs`, `m00-seed.mjs`). Numbers are from my dev server on :3147 (webpack dev build). Before runs for 5a used the base tree (the change reverted with `git checkout`, then applied again from `.qa-tmp/wire/item5a.patch`).

Data: the project "Fix r16 wire" in `dissect`, made through the app (`setup.mjs`). At the end its 3 documents went through `DELETE /api/documents/:id` (each held by this project only) and the project through `DELETE /api/notebooks/:id`: 0 rows left.

## Items

1. **EDGE16-05, the note's assistant half (ee2db7d1).** `note-assistant.tsx` keeps the box's unsent words with `readChatDraft`/`writeChatDraft` (`lib/kept-chat.ts`, key `note:<noteId>`), which name the account. Words under the old key (`unitos-note-assistant-draft:<note>`) move to the account that opens the note; the old key is removed only after the new copy reads back; words under the new key come first, old words after them.
   - Before: account B on the same browser saw A's unsent words in its box and could type over them.
   - After (`item1.mjs`, `item1-after.log`): A's box reads its old words and keeps what it types; B's box reads ""; A's box again reads its words; emptying the box removes the key.
   - Shots: `WIRE16-1-before.jpg`, `WIRE16-1-before-a.jpg`, `WIRE16-1-after.jpg`, `WIRE16-1-after-a.jpg`.
2. **A highlight across blocks in the notes panels (5ced0984).** The reader page, the annotations full page and `GET /api/annotations/[noteId]` give such an annotation its whole passage's quote (every source's quote, block order); one helper, `lib/annotations/passage.ts`, with the rule the select package used for the reader's cards.
   - Before: the annotation beside a note showed the quote and the passage again as a body; Add to a note landed the first paragraph as the quote and the whole passage again under the reference row.
   - After (`item2.mjs`, `item2-after.log`): the side panel shows each part once in the quote; Add to a note lands each part once.
   - Shots: `WIRE16-2-before.jpg`, `WIRE16-2-after.jpg`.
3. **The one failure line on the reader's last assistant paths (1c57e12b).** The toolbox's Assistant, the bar's command over a document, the chat card's and the tool card's follow-ups, and the media pane's Rewrite read `failureLine`; `failureLine` keeps an Error the app threw for the reader, and a TypeError, a SyntaxError or a script that did not load reads "No answer: the assistant had a problem. Try again." (the fault to the console). A TypeError is the connection line only when the browser says the network is down.
   - Before: an act answer with no actions list read "actions is not iterable" under the box. After: the one failure line (`item3.mjs`).
   - Shots: `WIRE16-3-before.jpg`, `WIRE16-3-after.jpg`.
4. **i18n keys no code reads (a5ce5caa).** Removed in en and zh: `assistant.clearConversationConfirm`, `panes.translateFailed`, `video.askFailed`, `reader.assistantFailed`, `video.assistantFailed`; each checked by a search for the full key and for templates that build keys in its namespace.
5a. **TOOL16-09, the note's assistant on a phone (8beb034b).** On a touch screen with the assistant open, the note editor's card scrolls as one column and the body does not shrink under its words; the assistant takes at most 55% of the card (its turns scroll inside it). Clear is 36px tall on a touch screen on every kept surface that draws it (`ClearConversation`). Every class is behind `pointer-coarse:`, so a mouse sees nothing new.
   - 390x844 (`k11.mjs`): before (audit numbers, `WIRE16-5a-before-844.jpg`), Done 505–529 over the title 496–516, the assistant 540–760 over the body 522–585, a tap on Clear landed in the body. After: title 367–387, body 393–523, Done 532–556, assistant 567–759; nothing overlaps; Clear 46x36, a tap hits it.
   - 360x780 (`W=360 k11.mjs 780`): before, Done 246–270 over the title 267–287, assistant 281–710 over the body 293–356, a tap on Clear hit the article's heading. After: title 362–382, body 388–519, Done 528–552, assistant 563–736; Clear and Done hit themselves.
   - 1440x900 (`desk5a.mjs`): every box the same before and after (editor 1055,139–1370,884; body 236–366; Done 375–399; assistant 410–870, max-height 460px; Clear 46x25).
   - Shots: `WIRE16-5a-before-844.jpg`, `WIRE16-5a-after-844.jpg`, `WIRE16-5a-before-360x780.jpg`, `WIRE16-5a-after-360x780.jpg`, `WIRE16-5a-before-1440.jpg`, `WIRE16-5a-after-1440.jpg`.
5b. **TOOL16-16 and TOOL16-15's chip half (75b9f2da, SPEC a9092ea2).** A block with several passages of one match draws the match's chip once, after its last passage, in the block reader (`block-view.tsx` `markedText`) and in the page editor (`annotation-marks.tsx` `build`). A margin chip wider than the margin moves left until it ends inside the screen (`layMarginChips`; beside a block's Collapse button it drops a row first). On a touch screen the match chip's target is 33x25 (`globals.css`, as the other margin chips). Every passage keeps its tint and opens the card.
   - A stored match, origin + 12 passages (`item5b.mjs`): 1440x900, 13 chips over 5 blocks (3 per block) → 5, one per block, at the same x 860–884. 390x844 touch, 13 chips all past the screen's edge (x 372–396) → 5, none past (364–388). 360x780 touch, 13 all past (342–366) → 5, none past (334–358). A tap on a chip at 390 opens the match card with its 13 jumps (`item5b-tap.mjs`).
   - Shots: `WIRE16-5b-before-{1440,390,360}.jpg`, `WIRE16-5b-after-{1440,390,360}.jpg`, `WIRE16-5b-after-390-card.jpg`.
   - The page editor's line was type-checked, not driven in a browser (no match in a blank document in this project).

## Files

- `src/components/outline/note-assistant.tsx`: the account-keyed draft (1); `data-note-assistant` and the touch-only max height (5a).
- `src/lib/annotations/passage.ts` (new), `src/app/n/[notebookId]/page.tsx`, `src/app/n/[notebookId]/annotations/page.tsx`, `src/app/api/annotations/[noteId]/route.ts`: the whole passage's quote (2).
- `src/components/assistant/failure.ts`, `src/components/reader/reader-interactions.tsx`, `src/components/video/assistant-card.tsx`: `failureLine` on the last paths (3).
- `src/lib/i18n/dict/assistant.ts`, `panes.ts`, `reader.ts`, `video.ts`: unused keys (4).
- `src/components/outline/note-card.tsx`: the card scrolls as one column on touch with the assistant open; `--note-edit-limit` for the assistant (5a).
- `src/components/assistant/clear-conversation.tsx`: Clear 36px on touch (5a).
- `src/components/reader/block-view.tsx`, `src/components/docs/annotation-marks.tsx`, `src/app/globals.css`: one match chip per block, chips inside the screen, touch target (5b).
- `SPEC.md`: §6 lines for items 2, 3 and 5b.

## Decisions

- 5a: the earlier worker's change capped the assistant at 55% of the card on every screen, which moved the tray's assistant at 1440 (460px → about 435px). I put that cap and Clear's new size behind `pointer-coarse:`, so 1440 is unchanged to the pixel.
- 5a: the card scrolls to show the opened assistant, so the title sits above the card's visible top until the reader scrolls the card up; nothing overlaps and nothing shrinks. At 360x780 the card's foot can sit 41px under the tray's bottom edge until the tray scrolls (the card's one-time `scrollIntoView` runs before the assistant opens); left as it was.
- 5b: one chip per block, not one on the origin only: a block of passages far from the origin still says a match is there. The chip that stays is the block's last of that match, so the chip still ends the marks it labels.
- 5b: a chip that does not fit the margin moves into the column's edge (2px at 390 and 360) rather than to a row inside the column; no chip that fits moves, so wide screens are unchanged.
- Clear's touch size (5a) is in `clear-conversation.tsx`, the edge package's file; it is a hit area, not a new control.

## Left open

- **PAGE16-06** (a settled bar conversation draws its chip alone): not done. Which suggestions belong to a conversation is known only in the reader's memory (`suggestRunsRef` in `reader-interactions.tsx`, keyed by run, not by the conversation's note, and gone after a reload), and a bar conversation's mark looks the same as a plain-answer conversation's in `Highlight`. Doing it needs a stored link from the conversation note to its suggestion ids (or a rule that reads assistant suggestion marks inside the anchor), plus a rebuild of the decorations when a suggestion settles. That is a design choice for Linda, not a small change. Before shots from the earlier worker: `WIRE16-5c-before.jpg`, `WIRE16-5c-before-reload.jpg` (`item5c.mjs`).
- **TOOL16-15's band half** (Collapse on one row at 360) is not this branch's; the 360 screenshots here show Collapse as its icon on one row already.
