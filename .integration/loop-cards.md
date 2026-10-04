# loop/cards

**Intent:** Fix the "cards, layers and Escape" package of the reader audit in `reader-interactions.tsx` and `block-view.tsx`, and take in the other packages' Needs that live in those two files.

## Findings

Screenshots go under `.qa-tmp/fix/` in this worktree (git-excluded). The machine ran at a load of 40 to 160 on 4 cores with 14 of 15 GB used through this round; the dev server took over two hours to compile the reader page, the database stopped answering for minutes at a time, and the coordinator asked every worker to stop its dev server. So the code was written, typechecked (full `tsc --noEmit`: exit 0) and linted (clean), and the browser checks wait for one pass when the machine is free. Before screenshots taken on the base code so far: `T2-before.png`, `T2-first-before.png` (t12: the second run empties the first card), `T3-before.png` (t11 at 1000: the Explain card sits on the passage's lines), `T11-before.png`, `T11-toolbar-before.png` (t17: the answer takes the new selection away). Every after screenshot is pending.

- **T2: fixed, browser check pending.** Every Explain, Analyze, Visualize and Simplify run has its own controller (`toolRunsRef`, by run number). A card carries the run that writes into it, and a run writes only into its own card. Stop and ✕ stop their own card's run; no run stops another. A run whose card a newer run took lands its annotation, and a toast ("Explanation ready", Show) opens its card at its words.
- **T3, T4, S16, E-05, E-06, nav-N3: fixed, browser check pending.** Cards are opaque (`bg-card`, no blur). A side card keeps 12px from the words and 8px from the pane's edge (`cardRoom`, `dockSideCard`). When neither margin holds a 260px card, the column moves left by the missing room (`--cards-room` on the pane, a rule in `globals.css`) while a card is open. When even that leaves no room (the narrow reader), the card opens under the paragraph that ends its passage and that paragraph's bottom margin grows by the card's height (`layoutNarrowCards`), so the text below moves down; a card the reader dragged keeps its place. The highlight and comment card on a mark docks the same way in the block reader (`claimSideSlot("annotation")`).
- **T10, E-09, nav-N13 (Escape): fixed, browser check pending.** Escape closes the newest layer only (toolbar, pending link, a card, the chooser) and stops no run. A click on the pane outside every card closes the cards that are idle (no run, nothing typed). Words typed in a card's box come back when it is reopened from its mark. The field-level Escape of the annotation, comment and link cards stops the event, so it closes that card only.
- **T11: fixed, browser check pending.** The answer closes only the toolbar that sent the question; a new selection and its toolbar stay. The card opens at its words when they are in view, else a toast ("Answer ready", Show) brings the card and the words.
- **T6, E-10, P4, P7: fixed, browser check pending.** A card that opens tall is lifted into the pane (not only one that grows). The toolbox is measured again when a field opens (the assistant box, Comment, Define), so it stays inside the pane. The page editor's assistant bar scrolls the pane so the words' last line stands 16px above it.
- **E-11: fixed, browser check pending.** A growing card that reaches the card under it stops above it (at least 160px tall) and scrolls inside; the card under it keeps its place.
- **E-07, nav-N4: fixed, browser check pending.** A sticky band (`data-article-band`, the paper color) under Contents, Collapse and Extract: the text scrolls under it, so the pills never sit on a word.
- **E-08: fixed, browser check pending.** A width change measures the selection again and moves the toolbar to it (the same anchor, so a run sent from it still knows it); with no live selection under it (a figure, a key term) it closes as before.
- **E-20: fixed, browser check pending.** The sent question leaves the field for a line above it (`data-assistant-sent`); the field is free for the next one. A stopped or failed question comes back to the field unless the reader typed a new one.
- **E-14: fixed, browser check pending.** The assistant's error shows in the box that asked (`data-assistant-error`); with that box closed, as a toast as before.
- **T5: fixed, browser check pending.** While the conversation view is open, the cards under it are hidden (`invisible`), so none covers the view.
- **T7: fixed, browser check pending.** A plan the selection's chat proposed shows inside that chat card under the answer; the panel's plan keeps the card at the window's foot.
- **T8: fixed, browser check pending.** Collapse on or off, or a block read whole or folded, closes the idle cards whose words are no longer drawn, and the log card.
- **T9: fixed, browser check pending.** A click on a core reads its block whole.
- **T12: fixed, browser check pending.** A fresh run's mark is drawn as its tool's mark (`addLocalAnchor(anchor, kind)`), not as a clay highlight.
- **T14: not fixed.** The tooltip that covers a new card's answer is `tooltip.tsx` (Needs).
- **T15: fixed, browser check pending.** The other thumb changes a rating (PATCH), the same thumb takes it back (DELETE of the reader's own row); `aria-pressed`, disabled while sending.
- **T17: fixed, browser check pending.** The page editor's selection collapses to its end when a command is sent, so the passage keeps only the thin mark.
- **P2: fixed, browser check pending.** In the page editor, a toolbox under the words opens above them when the room above holds it, and the pane does not scroll for it.
- **T16 (Need from loop/sel-anchors): fixed, browser check pending.** The Define row shows `defineWord(...)`, and `src/lib/prompts/define.ts` asks about the bare word.
- **notes N2, N13, N14 (Needs from loop/notes): fixed, browser check pending.** Add to notes sends `dissect:show-note` on every document; a quote that lands in a note (`QUOTE_LANDED_EVENT`) closes the toolbar and the selection; the reader's note picker gets `onEscape` (back to the sections).
- **nav-N19: fixed, browser check pending.** The comment card's ✓ is a "Resolve" button.
- **nav-N20:** the reader's highlight card already names its kind ("Highlight"); nothing to change here.
- **nav-N21: fixed, browser check pending.** A click on stacked annotations opens a chooser at the click (`data-stack-chooser`) that lists each one by its kind name, in its kind color, with its quote; the one picked opens.
- **Link marks (Need from loop/sel-toolbar): fixed, browser check pending.** A link mark is `draggable={false}` and takes the mark press, so a drag that starts on it selects words; the click that ends a drag follows no link.
- **nav-N10, E-18: jump fixed, browser check pending.** A Contents jump puts the part's heading at the reading line (80px). The missing Part 1 is in `contents-menu` (Needs).

## Files

- `src/components/reader/reader-interactions.tsx`: everything above. Main pieces: `drawnBlock`, `passageBox`, `columnAtRest`, `cardRoom`, `dockSideCard` (module level); `toolRunsRef`, `startToolRun`, `abortToolRun`, `landedAway`; the layer stack (`layerKeys`, `closeLayer`, `openLayersRef`, the Escape effect), `closeIdleCards` and the pane's click listener; `cardDraftsRef`; `claimSideSlot(kind, top, anchor)`; `cardsRoom`; `cardCaps` in `settleSideCards`; `layoutNarrowCards`; the resize observer; `runAssistant` (`aiSent`, `aiError`); `planBody`/`planInCard`; `stackChooser`; the band.
- `src/components/reader/block-view.tsx`: link marks take the mark press and are not draggable; a click on stacked marks sends every source id under it.
- `src/app/globals.css`: `[data-cards-room] .reader-column` moves the column left by `--cards-room`.
- `src/lib/i18n/dict/reader.ts`: explanationReady, analysisReady, visualizationReady, simplifiedReady, answerReady, showCard (en, zh).
- `src/lib/i18n/dict/common.ts`: rateTakeBack (en, zh).
- `src/components/rating-buttons.tsx`, `src/app/api/ratings/route.ts`: T15.
- `src/lib/prompts/define.ts`: T16, the bare word after "Selected word:". The assistant eval does not need to run for Define.
- `SPEC.md`: §6 (cards beside the words, the column's room, the narrow reader, opaque cards, caps, the band, Escape one layer, idle cards, one card per run with the ready toast, the assistant box's sent line and error, the answer that lands, stacked chooser, link drag, Resolve), §21 (the view hides the cards; a tall card is lifted), §25 (a rating changes or is taken back), §26 (a jump lands at the reading line), §28 (a click on a core reads it whole; Collapse closes cards whose words are not drawn).

## Decisions

- A run whose card a newer run took keeps running and lands with a toast, rather than being stopped (the reader asked for it) or getting a second card in the same slot (one card per kind stays).
- When the margin is too narrow, the column moves left to make room, rather than shrinking the card under 260px.
- In the narrow reader, the card opens in a gap made under its paragraph, rather than over the next lines.
- A growing card stops above the card under it and scrolls, rather than pushing that card down.
- The pills get an opaque band, rather than fading the text under them.
- A rating's take-back deletes the reader's own ToolRating row (the reader asked for exactly that); a change updates it and clears the comment that explained the old rating.
- Escape stops no run; Stop stops a run.

## Needs (files this package does not own)

- `src/components/tooltip.tsx` (T14): no tip on a pointerover that has no pointermove after it, so a card that opens under the pointer does not get its button's tip over the answer.
- `document-bar`, `history-control`, `contents-menu` (nav-N13): a shared Escape stack, or skip an Escape that is `defaultPrevented`, so one Escape closes one layer across the page.
- `contents-menu` (E-18): Part 1 is missing from the contents.
- Merge note for the data-safety package (loop/safety): `runAssistant` here clears the field at send time (`setAiCommand("")` moved up) and puts the question back on a stop or failure; the safety branch adds `clearToolbarDraft("assistant", …)` next to the old `setAiCommand("")`. Keep the draft clear on a landed answer, not at send time, so a failed question's draft survives.

## Checks

- `tsc --noEmit` (full project): exit 0. `eslint` on every changed file: clean.
- Browser checks: pending (see Findings). The scripts are ready: the audit's tools, edge, navigation and page scripts copied under `.qa-tmp/audit/` and pointed at :3122, the before batches `.qa-tmp/fix/before.sh` and `before2.sh`, and `.qa-tmp/fix/cx.mjs` for N21, nav-N19, T15, link drag, N2, N14 and N13.
