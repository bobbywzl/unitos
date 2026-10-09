# loop/r13-tools

**Intent:** fix round 13's tools package (TOOL13-01 blocking, 02, 03, 04, 06, 08, 09, 10, 11, 12, 13; EDGE13-03, EDGE13-09; SEL13-04, SEL13-05; PAGE13-03, PAGE13-10): keep every word the reader dictates, and make the assistant's surfaces denser and one shape, without adding controls.

Screenshots are under `.qa-tmp/fix/` in this worktree (`<ID>-before*.png`, `<ID>-after*.png`). Scripts are under `.qa-tmp/tools/` (the audit's scripts pointed at :3142, plus mine: `vt02-enter-db.mjs`, `f03-figure-click.mjs`, `p03-panel-phone.mjs`, `e09-plan-threads.mjs`, `e10-card-rows.mjs`) and `.qa-tmp/page/` (the page audit's `a02-bar-cover.mjs`, `f01-figure.mjs`). Logs: `.qa-tmp/tools/before/run.log`, `.qa-tmp/tools/after/run.log`, `.qa-tmp/tools/*.log`, `.qa-tmp/page/*.log`, `.qa-tmp/qa/*.log`. Project "Fix r13 tools" (copies of the memo and "How Reading Shapes Memory", two blank documents).

The machine ran out of memory through the session (the OOM killer took my dev server three times and many Chromium pages). Some befores could not be taken on :3142; for those the audit's own screenshot (same commit, :3111) is the before, named `-before-audit.png`.

Checks: full `npx tsc --noEmit` passes (exit 0) with the dev server stopped; eslint passes on every changed file. Regression runs after the change (`.qa-tmp/tools/regress/`): `e10-comment` (comment on an answer, Ask about this) PASS; `e14-focus2` (focus after answers, card and panel) PASS; `t01b 120` (keys typed during a run land in the card's box) PASS; `e12-save-expand` (Save as note sends the follow-up) PASS, its view look-up missed the conversation view, which the screenshot shows open; `p04-new-conv` (the + starts a new conversation) PASS; `e04` (the bar) and `e05` (the note assistant) PASS. `scripts/qa/ui-figure-words.mjs`: every check passes (one "no console errors" fail is the sandbox's certificate error on an outside resource). `scripts/qa/ui-figure-words-article.mjs`: every check passes when its waits are raised for this slow machine (20 s → 60 s; the script itself is unchanged but for the Accept wording).

## Findings

Counts are the audit's `controls()` at 1440x900 unless said.

- **TOOL13-01 (blocking): fixed.** Enter in a box while words are still being heard types them first, then sends the whole box a frame later (the voice button's capture handler, as Escape already did). Where Enter does not send, it types its new line after the words; in a rich text box (the note editor) Enter goes on at once with the words already in. Before: toolbar box sent "What does this claim rest on", "and who measured it" lost; card box sent "Third question", " still heard words" lost (`before` run, `vt01`). After: "What does this claim rest on and who measured it" and "Third question still heard words". Proved in the database and after a reload (`vt02-enter-db.mjs`): the conversation note holds `**Reader:** Where does this figure come from and who heard 20550` and `**Reader:** Second question typed then spoken 20550`, and the reloaded card shows both. `TOOL13-01-before*.png` / `TOOL13-01-after*.png`.
- **TOOL13-02 / EDGE13-03: fixed.** The plan in the chat card scrolls with the turns, under its answer; when a plan lands, the turns show the answer from its start. Phone card: turns 39px (scrollHeight 148) → 234px (scrollHeight 363); the box is the card's last row, inside the card. `TOOL13-02-before.png` / `TOOL13-02-after.png`.
- **TOOL13-03: fixed.** A plan per thread: a new plan parks the one on screen under its thread's note id; the thread on screen gets its parked plan back. A side chat with no answer shows no plan. Side chat just started: 14 controls with Apply 2 actions → 10, no plan; after its answer, its own plan; Back: the conversation's plan shows again (before: gone). `TOOL13-03-before.png`, `-before-audit-back.png` / `TOOL13-03-after.png`, `-after-back.png` (`e09.log`).
- **TOOL13-04 / SEL13-04: fixed.** A click on a figure's picture in the block reader opens the figure's tools (before: nothing; the circle stays; a picture under a mark or a link opens what that opens). The toolbox's Assistant box on a figure has the bar's placeholder and its two chips (before: 0 chips, the reader typed the command); a chip runs at once. The words under the figure scroll into view: [70,816,742,887] in a 900 window (before: [70,855,742,926]). Steps on an article: hold + circle, Assistant, type the command, Enter, scroll, ✓ → click, Assistant, a chip, ✓. The answer card's sentence "Accept or reject it there" stays (the suggestion is now in view beside it); I did not move Accept and Reject into the card (Decisions). `TOOL13-04-before*.png` / `TOOL13-04-after*.png`.
- **SEL13-05: fixed.** The bar on an image: four chips → two, The text and The key points, each sending "Put the text / the key points under the image"; a question typed in the bar still answers in the chat. Bar on an image: 8 controls in 3 rows (107px) → 6 in 2 rows (83px). "Extract" no longer names this. `SEL13-05-before-audit.png` / `SEL13-05-after*.png`.
- **PAGE13-03: fixed.** The bar's keep-the-words-in-view scroll never ran in the page editor: it looked for the bar inside the scroller (the bar stands beside it) and took the words' bottom from the toolbox, which stands pulled up in the card column. Now the bar is found in the pane and the words' bottom is the selection's last line. Selected words 840-856 under the bar at 773 → 746-762 above it, scroll 193 → 287 (`a02`). `PAGE13-03-before.png` / `PAGE13-03-after.png`.
- **PAGE13-10: fixed.** The image toolbar's Assistant breathes and shines twice as the toolbar opens, then rests (animation iterations infinite → 2). The chip word: SEL13-05. I did not add a release for the New glow (Decisions). `PAGE13-10-before-audit.png` / `PAGE13-10-after.png`.
- **TOOL13-06: fixed.** Poor answer's line takes the focus; in a foot row it opens on its own row (and the thanks after it), so Save as note and Continue stay. Before: focus BODY, "too vague" lost (the ToolRating row's comment empty), the foot moved from y 730 to 662. After: focus in the line, Save as note and Continue at the same place, the row holds `comment = "too vague"`. A reason sent before the rating's row returns goes with the row. `TOOL13-06-before.png` / `TOOL13-06-after*.png`.
- **TOOL13-08 / EDGE13-09: fixed.** Conversations and New conversation stand in the tray's head row beside the title and ✕ (portal into a slot in `workspace.tsx`); New conversation is a + with its name in the tooltip and aria-label. Phone: nothing over the answers (a tap at the turns' top + 4 and + 20 lands in the turns; before it hit Conversations); the turns get 220px all visible (before ~230 with 24px of it under the pills; EDGE13-09 measured 193). At 1440 the panel's own head row is gone too. `TOOL13-08-before-audit.png` / `TOOL13-08-after.png`.
- **TOOL13-09: fixed.** On a coarse pointer the conversation's Delete shows at rest, 36px (before opacity 0, 24px). The confirm stays. `TOOL13-09-before-audit.png` / `TOOL13-09-after.png`.
- **TOOL13-10: partly fixed.** The chat card's composer takes the toolbar box's shape: the field on its own row (141 → 234px wide), then thinking and Web on the left, mic and Send on the right; one row fewer above the field, the same height. Send is 49x29 in the toolbar box, the card, and the bar (was 25 tall in the box and the bar). The quote chip's ✕ is 24x24 (was 10x17). Not done: the panel's chip row stays above its field (at 354px the scope, thinking, Web, attach, mic, and Send do not fit one row; moving the row under the field changes nothing in height), and the note assistant's violet Send stays. `TOOL13-10-before-audit.png` / `TOOL13-10-after.png`.
- **TOOL13-11: fixed.** Accept and Reject, in that order: a plan's Apply N actions / Cancel → Accept N actions / Reject; the note assistant's Apply to the note / Discard → Accept / Reject ("Applied." → "Accepted."); the bar's Reject / Accept → Accept / Reject. The figure suggestion's ✓ / ✕ were already in that order. `TOOL13-11-before.png` / `TOOL13-11-after.png`, `-after-bar.png`.
- **TOOL13-12: fixed.** The chat card's older answers show their rating row on hover, focus, or a tap (opacity 0 at rest), as the panel does; the newest shows it at rest. Card with two answers and a plan: 18 controls at rest, 3 fewer than the old rule gives (the older answer's two thumbs and Save as note) (`e10.log`: rows' opacity `["0","1"]`, hover the first `["1","1"]`). `TOOL13-12-before-audit.png` / `TOOL13-12-after*.png`.
- **TOOL13-13: fixed.** When the box sits above the microphone (the toolbar's box), the listening card opens above the box: card [829,415-476] over field [864,484] (before: card [829,500-561] over field [864,484-536]). `TOOL13-13-before.png` / `TOOL13-13-after.png`.
- Not mine this round: TOOL13-05 (page package), TOOL13-07 (select package), TOOL13-14 (waits on Linda).

## Where moved actions went

- **New conversation** (the panel's row under the head): the + beside Conversations in the tray's head row; its tooltip and aria-label say New conversation. The Conversations list keeps its own New conversation too.
- **Conversations**: the tray's head row, beside the title (was the panel's first row).
- The bar's **Extract the text** and **Summarize the key points** chips: type the question in the bar (it answers in the chat, as before); The text and The key points put the words under the image, where Reject drops them.
- The chat card's **Deep Thinking** and **Web**: the row under the field, left of the mic.
- The chat card's older answers' **thumbs and Save as note**: on hover, focus, or a tap of that answer.

## Files

- `src/components/voice/voice-typing-button.tsx`: Enter types the heard words first (TOOL13-01); the listening card's place (TOOL13-13).
- `src/components/rating-buttons.tsx`: the reason line's focus and row; `inRow` (TOOL13-06).
- `src/components/assistant/assistant-panel.tsx`: the head in the tray's head row; the + ; Delete on touch; `inRow` (TOOL13-06, 08, 09).
- `src/components/reader/workspace.tsx` (shared; nav owns): one slot span in the tray's head row (`data-tray-head-slot`, `ml-auto`), and ✕ loses its `ml-auto` (the slot pushes it). Two lines.
- `src/components/reader/reader-interactions.tsx` (shared): `FIGURE_CHIPS` (two chips with label and command); the figure chips in the toolbox box and its placeholder; a click on a figure's picture opens its tools (in the mouseup handler, beside the equation's case); plans per thread (`parkedPlansRef`, `parkPlan`, the swap effect, `planInCard`); the plan inside the turns' scroller and the scroll to the answer; the card's answer rows (`data-chat-answer`, `group/answer`); the card's composer; Send sizes; `openBar`'s words' bottom and the bar look-up in the scroll effect (PAGE13-03); `inRow` on three RatingButtons; Reject on the plan.
- `src/components/reader/figure-suggestion.tsx`: the suggestion scrolls into view (TOOL13-04).
- `src/components/assistant/suggestion-row.tsx`: the bar's Accept before Reject (TOOL13-11).
- `src/components/assistant/answer-tools.tsx`: the quote chip's ✕ target (TOOL13-10).
- `src/components/outline/note-assistant.tsx`: Accept / Reject (TOOL13-11).
- `src/components/docs/css/insert.css` (`.docs-img-assistant`, the figure assistant pill): two iterations (PAGE13-10).
- `src/lib/i18n/dict/reader.ts`: `figureText` (new), `figureKeyPoints` (now "The key points"), `figureChipTitle`, `applyActions` ("Accept {n} action{s}"), `discardPlanTitle`; `figureExtractText` removed. en and zh.
- `src/lib/i18n/dict/assistant.ts`: `noteAssistantApply` and `noteAssistantDiscard` removed (common.accept / common.reject), `noteAssistantApplied`. en and zh.
- `scripts/qa/ui-figure-words.mjs`, `scripts/qa/ui-figure-words-article.mjs`: the two chips and the Accept wording.
- `SPEC.md`: voice typing (Enter; the listening card's place), the figure's click, the rating line, the card's older answers, the panel's head, the plan in a card (scroll, Accept/Reject, side chats), the note assistant's Accept/Reject, the bar's order, words from a figure (two chips, the toolbox box, the scroll, the pill's motion).

## Decisions

- TOOL13-01: Enter re-dispatches a synthetic Enter on a text field a frame after the words land (the box's own handler sends from its state); if no handler takes it, the button does what Enter would (a textarea's new line, an input's form submit). A rich text box gets the words at the caret and the real Enter goes on: it reads its own DOM.
- TOOL13-03: plans are parked in a ref by the thread's note id, for the session; only the chat card's threads swap (a tool card's parked plan is not restored, as before). No storage, no schema.
- TOOL13-04: the click opens the tools only on the picture (img, svg, canvas, picture) of a FIGURE block, not a table and not a caption, so selecting words in a caption or a table works as before; a picture under a mark or a link keeps its click.
- SEL13-04: I kept the card's sentence and made the suggestion scroll into view instead of putting Accept and Reject in the card: two Accepts for one suggestion would be a duplicate.
- SEL13-05 over PAGE13-10's "Copy the text": two chips instead of four, so the word Extract goes with the chip.
- TOOL13-08: + instead of merging New conversation into a Conversations menu (EDGE13-09's proposal): one press stays one press, and the row fits at 390.
- PAGE13-10: no release for the New glow (a release posts an update notification to every account; that is the owner's call). The pill moves twice at each open, then rests.
- TOOL13-10: the panel's composer and the note assistant's Send color are left as they are (above).

## Needs

- `src/components/reader/workspace.tsx` (nav): the two-line slot in the tray's head row. If nav reshapes that row, keep a `data-tray-head-slot` element before ✕ that pushes it right; the assistant panel portals Conversations and + into it (and falls back to its own row when it finds none).
- `src/lib/i18n/dict/reader.ts` (select owns the selection keys): my keys are the figure and plan ones listed above.
- The lead: `scripts/qa/ui-figure-words.mjs` leaves its notebook behind after a pass (it deletes the document only); that was so before this change.

## Data

Made through the app on :3142: project "Fix r13 tools" (documents: two block copies by `copydoc.mjs`, two blank documents "Page r13 tools" and "Figure r13 tools", a note), and three "QA figure words …" projects left by `scripts/qa/ui-figure-words.mjs`. Deleted at the end through the app (`.qa-tmp/tools/cleanup2.mjs`, `cleanup2.log`): 4 projects and 7 documents, 200 each, `keptDocuments: []`; 0 left. My dev server is stopped. One ToolRating row ("too vague") stays: the app removes a rating only on its open card.
