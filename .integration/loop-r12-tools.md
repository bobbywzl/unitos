# loop/r12-tools

**Intent:** fix round 12's tools package (TOOL12-01 to 12, 15, 16, 17; NOTE12-11; EDGE12-12): make the AI tools' cards and boxes denser and keep the reader's typed words, without adding controls.

Screenshots are under `.qa-tmp/fix/` in this worktree (`<ID>-before.png`, `<ID>-after*.png`). Scripts are under `.qa-tmp/tools/` (the audit's `e*.mjs` pointed at :3142, plus my `v*.mjs`), run on my project "Fix r12 tools" (copies of the memo and "How Reading Shapes Memory"), deleted at the end through the app. Counts use the audit's `controls()` (`.qa-tmp/tools/lib.mjs`), with one change: a control whose ancestor is at opacity 0 (shown on hover or focus only) is not counted at rest. Before counts are the audit's (`tools.md`, same commit 0c1d0af); after counts are mine on :3142.

Checks: full `npx tsc --noEmit` passes (exit 0); eslint passes on every changed file. My project "Fix r12 tools" and its 13 documents were deleted through the app (`cleanup.mjs`: 0 left); my dev server is stopped.

## Findings

Counts are `controls()` on the surface named, at 1440x900 unless said; "rows" are the box's own rows.

- **TOOL12-01 (blocking): fixed.** The box keeps or takes the focus after the first answer (card and panel), after Start side chat, after Ask about this, and after the bar moves to the card. Words typed while the answer runs are carried into the card. Before: focus `BODY` at each step, "so why" typed into nothing and a space scrolled the article 549px (`before-e09.log`). After: `TEXTAREA:Reply…`, the card's box holds "so why", the side chat and Ask about this put the focus in the box, the panel's first answer leaves it in "Ask a follow-up" (`v01.log`, `e03-1440.log`). No control added. `TOOL12-01-before.png`, `TOOL12-01-before-audit.png` / `TOOL12-01-after.png`, `-after-side-chat.png`, `-after-panel.png`.
- **TOOL12-02: fixed.** A card dropped under the window opens at its words instead; the older card above gives up height (CAP_MIN 160) and scrolls inside. Before: Simplify at 906-1062 on a 900 window, 0px in view. After: Explain capped to 383-545, Simplify at 557-707, 150px in view (`e11c.log`). `TOOL12-02-before.png` / `TOOL12-02-after.png`.
- **TOOL12-03: fixed.** A plan in a card is its action rows and Apply/Cancel; no title, no repeated reply, no "Ask first", no "Proposed N actions" when there is a reply. Assistant card, one answer with a plan: 19 → 17 (the plan's source chip and the second thinking chip). `TOOL12-03-before.png` / `TOOL12-03-after.png`.
- **TOOL12-04: fixed.** One thinking chip names the current choice and switches on a click; in the toolbar box the chips, the microphone, and Send share a wrapping row. Toolbar box: 6 controls in 4 rows → 5 in 3 rows at 1440 (the 164px box cannot hold all four on one row); 6 in 3 rows → 5 in 2 rows at 390. `TOOL12-04-before.png`, `-before-390.png` / `TOOL12-04-after.png`, `-after-390.png`.
- **TOOL12-05: fixed.** Continue is a word-only pill on the foot row. Explain 13 → 13 controls, foot 2 rows → 1; Simplify 8 → 8, 2 rows → 1; Visualize 10 → 8 (with TOOL12-06). A card whose output is not in view drops the full-width row. `TOOL12-05-before.png` / `TOOL12-05-after.png`, `-after-simplify.png`.
- **TOOL12-06: fixed.** Visualize's Open is gone (the picture opens the viewer); Expand shows only with a conversation. Header 6 → 4 controls; card 10 → 8. `TOOL12-06-before.png` / `TOOL12-06-after.png`.
- **TOOL12-07: fixed.** Save as note under a tool conversation sends the output and its turns. Before: `has follow-up turn: false`. After: `true` (`e12.log`). `TOOL12-07-before.png` / `TOOL12-07-after.png`.
- **TOOL12-08: fixed.** A side chat no longer folds the notes tray. Before: tray folded, the words moved 274px. After: tray open, the card stays at x 768, top 343 (`v01.log`). `TOOL12-08-before.png` / `TOOL12-08-after.png`.
- **TOOL12-09: fixed.** A side chat shows its quote once (the head), and only its own plan. Quote chips in a side chat: 1 → 0. `TOOL12-09-before.png` / `TOOL12-09-after.png`.
- **TOOL12-10: fixed.** Comment on an answer: Cancel dropped (the quote's ✕, labeled Cancel, and Escape stay); thinking and Web hidden while the comment box is open. Card with the comment box: 21 → 16; after Ask about this: 20 → 18 (`e10.log`). `TOOL12-10-before.png` / `TOOL12-10-after.png`.
- **TOOL12-11: fixed.** The panel's older answers show thumbs and Save as note on hover or focus; the newest keeps them. Panel with three answers: 32 → 25 at rest (`e03-1440.log`). `TOOL12-11-before.png` / `TOOL12-11-after.png`.
- **TOOL12-12: fixed.** The panel's foot: scope, thinking, and Web on one row, then the box; the hint line is gone; the scope tooltip says "extraction". At rest: 12 + a hint line → 11, foot 3 rows → 2; one answer 18 → 17. `TOOL12-12-before.png` / `TOOL12-12-after.png`.
- **TOOL12-15: fixed.** The note assistant's Web chip sits in the head row beside ✕; the box takes the row (135 → 164px wide). 5 / 7 → 5 / 7 controls (`e05.log`). `TOOL12-15-before.png` / `TOOL12-15-after.png`.
- **TOOL12-16: fixed** for my surfaces. Send names the send action in the toolbar box (was Run), the card, the panel (was Ask), and the note assistant (was ↑); Comment stays Comment (it posts a comment, not a message). Microphones: 28/32/38 → 32 everywhere but Stitch (38, `src/components/graph/**`, not mine).
- **TOOL12-17: fixed.** Phone: the assistant card is capped above the bottom bar, its box in view; card actions take a finger size on a coarse pointer. Card [8,356,382,938] → [8,295,382,774]; Expand/Delete/✕ 24 → 36px, thumbs 13 → 33px, thinking chip 21 → 29px, Web 20 → 28px (`e01b-390.log`); Save as note and Continue take the same coarse size (`pointer-coarse:py-1.5`, after that run). `TOOL12-17-before.png` / `TOOL12-17-after.png`.
- **NOTE12-11: fixed (the words).** A press outside the field and the button, or Escape, types the words still being heard first; when the typed words move the pressed button (Done drops a line), that button is clicked once the words are in. Done: `db has interim: false` → `db has final: true db has interim: true times: 1` (`v11-dbg.log`). Escape in the note editor is Cancel and reverts the sitting before and after this change (the audit's `09-escape.log` PATCH shows the revert too). The listening card's place over the bar is not done (Needs). `NOTE12-11-before.png` / `NOTE12-11-after.png`, `-after-listening.png`.
- **EDGE12-12: fixed.** A refused highlight or Add to notes shows the reason in the toolbar, under the row pressed, with the toolbar kept open. Before: "boom" 400px away at the article's top right. After: under Add to notes at [860,403,1024,425]; under the colors at [860,443,1024,469]; 0 copies elsewhere (`v12.log`). `EDGE12-12-before.png` / `EDGE12-12-after.png`, `-after-highlight.png`.
- **TOOL12-13, TOOL12-14:** the Stitch thread's, not done here.

## Where moved actions went

- Visualize's **Open** (header): the picture itself, a button that opens the viewer (unchanged; its tooltip "Open the picture large, with its caption").
- **Continue in a conversation** (full-width row): the Continue pill on the foot row; its tooltip and aria-label keep the whole name and the Ultra note. In the full conversation view the full-width row stays.
- **Cancel** in a comment on an answer: the quote chip's ✕ (its tooltip now says "Cancel") and Escape.
- **Fast Thinking / Deep Thinking**: one chip naming the current choice; a click switches; the tooltip says what the click does.
- The panel's **hint line** at rest ("This page: …"): the This page / Project chips' tooltips (they always carried it).
- The panel's older answers' **thumbs and Save as note**: on hover or focus of that answer (a tap focuses it on a touch screen); the newest answer keeps them at rest.
- The note assistant's **Web** chip: its head row, beside ✕.
- **"Proposed N actions"** and the plan's title/"Ask first" in a card: the plan's Apply N actions says the count; a plan with no reply keeps the line.
- Side chat's second **quote chip**: the side chat's head (quote and Back). Ask about this inside a side chat still shows its chip.

## Files

- `src/components/reader/reader-interactions.tsx`: focus after the first answer, the bar, Start side chat, Ask about this (`chatFocusTick`, `data-chat-box`); words typed during a run carried into the card; plan body in a card; side chat plan scope and quote chip; no tray fold for a side chat; comment chips hidden; toolbar box rows and Send; bar microphone size; Continue pill (`continuePill`); Visualize Open dropped, Expand gated; Save as note with turns (`savedQuestion`, `savedAnswer`); `claimSideSlot` opens a card at its words when the drop would put it under the window, and `settleSideCards` caps the older card above; phone caps in `layoutNarrowCards`; `CARD_ACTION` coarse size; `toolError` for a refused highlight or Add to notes.
- `src/components/assistant/assistant-panel.tsx`: focus kept through the first message, after Start side chat and Ask about this; scope, thinking and Web on one row; hint line dropped; Send label; microphone beside Send; older answers' rating row on hover or focus; side chat quote chip.
- `src/components/assistant/thinking-chips.tsx`: one switching chip.
- `src/components/assistant/answer-tools.tsx`: CommentBox without Cancel (the ✕ says Cancel), `QuoteChip.clearLabel`.
- `src/components/assistant/web-chip.tsx`, `src/components/rating-buttons.tsx`, `src/components/assistant/save-as-note.tsx`: finger sizes on a coarse pointer.
- `src/components/outline/note-assistant.tsx`: Web chip in the head row; Send.
- `src/components/voice/use-speech.ts`, `src/components/voice/voice-typing-button.tsx`: `flush()` types the heard words before the box closes; a press whose button the words moved is clicked once they are in.
- `src/lib/assistant/side-chat-open.ts`: the side chat opener removed; version history keeps its fold.
- `src/lib/i18n/dict/assistant.ts` (en and zh): thinking hints say what a click does; "extraction" in the scope hints (zh 提取); `continue`.
- `SPEC.md`: the lines these behaviors touch (§6/§7 chat card, side chats, comments on an answer, thinking, the panel's row, §20 viewer, §21 Continue, the note assistant, voice typing).

## Decisions

- TOOL12-05: Continue lost the tool's symbol so the thumbs, Save as note, and Continue fit one row of a 260px card; the tooltip and aria-label keep the whole name.
- TOOL12-02: the new card opens at its words only when the old drop would put it under the window; otherwise placement is as before. The older card keeps 160px at least and scrolls inside, its words untouched.
- NOTE12-11: after the heard words are typed at a press, a click that misses the pressed button (it moved) is replayed on that button once; a click that lands is left alone.
- TOOL12-06: only Visualize's Expand waits for a conversation; Explain and Analyze keep Expand at rest, since it is how a long output is read whole (rule zero 5). Visualize's Open is dropped because the picture already opens the viewer.
- TOOL12-11: the panel's older answers keep the room of their rating row (opacity, not display), so an answer does not jump when the pointer reaches it.
- TOOL12-03: the "Ask first" pill is dropped everywhere; the plan's own Apply N actions and Cancel already ask. The panel's floating plan keeps its title and reply, since it has no turns above it.
- TOOL12-01: words typed in the toolbar box while the answer ran are carried into the card's box; the toolbar draft is cleared only once the answer has a note id, so a failed run still keeps them.
- TOOL12-09: a side chat's plan shows only in its own thread; the main thread's plan stays in the main thread.
- TOOL12-04: the thinking switch keeps the export name `ThinkingChips` so no caller changes.
- EDGE12-12: a refused highlight or Add to notes shows its reason inline in the toolbar with no toast; when no toolbar is open (the request outlived it) the toast is kept.
- NOTE12-11: the heard words are typed on a press outside the button and the field and on Escape. Enter is left alone: a send in the same event would read the field before the words land.
- TOOL12-16: the panel's submit says Send always (it said Ask); Run became Send in the toolbar box, so the toolbar's box and the answer card both say Send, one word for one act.
- The scope hint line's text stays on the This page / Project chips' tooltips; no words are lost, only the line at rest.

## Needs (files I do not own)

- `src/lib/i18n/dict/reader.ts` (package 1): `reader.run`, `reader.runTitle`, `reader.askFirst`, and `reader.openVisualization` are no longer read anywhere; `reader.openVisualizationTitle` stays (the picture's own tooltip in `markdown.tsx`). Leaving them is harmless.
- `src/components/reader/workspace.tsx` (package 5): the comment at ~588 still says a side chat folds the tray; it no longer does (only version history, `readTrayFold`). Comment-only change.
- `src/lib/i18n/dict/assistant.ts`: `assistant.ask` is no longer read (the panel says Send); kept in case another surface wants it.
- TOOL12-13 and TOOL12-14 are the Stitch thread's (`src/components/graph/**`), not done here. Stitch's microphone (38px) is the one size left over from TOOL12-16.
- NOTE12-11's second half (the listening card over the note editor's bar): the card's place is computed from the button; the note editor (package 3) would have to tell it to open below. Not done.
- Package 3: Escape in the note editor is Cancel and reverts the sitting, typed or dictated words alike (`use-note-draft.ts` `cancel`). Not changed here.
