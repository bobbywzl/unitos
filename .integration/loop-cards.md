# loop/cards

**Intent:** Fix the "cards, layers and Escape" package of the reader audit in `reader-interactions.tsx` and `block-view.tsx`, and take in the other packages' Needs that live in those two files.

## Findings

Every screenshot is in `.qa-tmp/fix/` of this worktree (git-excluded): `<id>-before.png` on the base code (475db33), `<id>-after.png` on the final code (5a51e95) from one full pass (`.qa-tmp/fix/last.sh`, logs in `.qa-tmp/fix/logs/last-*.log`, every shot of the pass in `.qa-tmp/fix/shots/last/`).

- **T2: fixed.** Every Explain, Analyze, Visualize and Simplify run has its own controller (`toolRunsRef`, by run number). A card carries the run that writes into it, and a run writes only into its own card. Stop and ✕ stop their own card's run; no run stops another. A run whose card a newer run took lands its annotation, and a toast ("Visualization ready", Show) scrolls to its words and opens its card beside them. Check: t12 stores both the VISUALIZE and the EXPLAIN annotation. `T2-before.png`, `T2-first-before.png`; `T2-after.png`, `T2-first-after.png`, `T2-both-after.png`.
- **T3, T4, S16, E-05, E-06, nav-N3: fixed.** Cards are opaque (`bg-card`, no blur). A side card keeps 12px from the words and 8px from the pane's edge (`cardRoom`, `dockSideCard`). When neither margin holds a 260px card, the column moves left by the missing room (`--cards-room` on the pane, a rule in `globals.css`) while a card is open. When even that leaves no room (the narrow reader), the card opens under the paragraph that ends its passage, and that paragraph's bottom margin grows by the card's height (`layoutNarrowCards`), so the text below moves down; a card the reader dragged keeps its place. The highlight and comment card on a mark docks the same way. Check: t11 at 1000 and 1440, 0% of the words under the card; e18's "coversTheWords" at 820 and 1024 compares the selection before the pane scrolled to the card, and the screenshot shows the card under the paragraph. `T3`, `T4`, `E-05`, `E-06`, `nav-N3` before and after.
- **T10, E-09, nav-N13 (Escape): fixed in the reader.** Escape closes the newest layer only (toolbar, pending link, the chooser, a card) and stops no run. A still click on the pane outside every card closes the cards that are idle (no run, nothing typed). Words typed in a card's box come back when it is reopened from its mark. Check: e07 and e23 close toolbar, chooser, Simplify, Explain with four Escapes; t13's typed words come back. Escape across the document bar, History and Contents is in Needs. `T10-before.png`, `T10-open-before.png`; `T10-after.png`, `T10-open-after.png`.
- **T11: fixed.** The answer closes only the toolbar that sent the question; a new selection and its toolbar stay. The card opens at its words when they are in view, else a toast ("Answer ready", Show) scrolls to the words and opens the card beside them. Check: t17b. `T11-before.png`, `T11-toolbar-before.png`; `T11-after.png` (the toast), `T11-shown-after.png`, `T11-toolbar-after.png`.
- **T6, E-10, P4, P7: fixed.** A card that opens tall is lifted into the pane, not only one that grows; a lifted card stops under the article's band and under the card above it. The toolbox is fitted again whenever its box changes size (a field opens, Define lands, the Collapse animation moves the words), so it stays inside the pane. The page editor's assistant bar scrolls the pane so the words' last line stands 16px above it. Check: t06 (the card's foot and its box in the pane after five turns), e01 at 600px tall (the assistant card and its plan inside the pane, under Collapse and Extract), q16, q15d. `T6`, `E-10`, `P4`, `P7` before and after.
- **E-11: fixed.** A growing card that reaches the card under it stops above it (at least 160px tall) and scrolls inside; the card under it keeps its place. Check: e08b, e07 (Simplify opens at 737, under Explain's foot at 725). `E-11-before.png`; `E-11-after.png`, `E-11-cards-after.png`.
- **E-07, nav-N4: fixed.** A band of the paper color under Contents, Collapse and Extract (`data-article-band`, sticky, no room taken): the text scrolls under it, so the pills never sit on a word. `E-07` before and after.
- **E-08: fixed.** A width change measures the selection again and moves the toolbar to it, keeping the same anchor. Check: e13. `E-08` before and after.
- **E-20: fixed.** The sent question leaves the field for a line above it (`data-assistant-sent`); the field is free for the next one. A stopped or failed question comes back to the field unless the reader typed a new one. Check: e08b. `E-20-before.png`; `E-20-after.png`, `E-20-typed-after.png`.
- **E-14: fixed.** The assistant's error shows in the box that asked ("Model unavailable"); with that box closed, as a toast as before. Check: e09. `E-14` before and after.
- **T5: fixed.** While the conversation view is open, the cards under it are hidden, so none covers the view. Check: t06 step 4. `T5` before and after.
- **T7: fixed.** A plan the selection's chat proposed shows inside that chat card under the answer. Check: t03 (Apply 2 actions, then applied) and e01. `T7-before.png`; `T7-after.png` (e01's card with its plan; t03's own shot is taken while the answer is still thinking).
- **T8: fixed.** Collapse on or off, or a block read whole or folded, closes the idle cards whose words are no longer drawn, and the log card. Check: t14 step 0. `T8` before and after.
- **T9: fixed.** A click on a core reads its block whole. Check: t14 step 1, navigation collapse. `T9` before and after. (t14 then stops on its own step 2, which looks for the core it just opened; the same on the base code.)
- **T12: fixed.** A fresh run's mark is drawn as its tool's mark, not as a clay highlight. Check: t11's tint lines. `T12` before and after.
- **T14: not fixed.** The tooltip over a new card's answer is `tooltip.tsx` (Needs).
- **T15: fixed.** The other thumb changes a rating (PATCH), the same thumb takes it back (DELETE of the reader's own row). Check: cx t15 (down, then up, then up again: both thumbs off; the "db: down" on the last line is t10's own rating from a minute earlier). `T15-before.png`; `T15-after.png`, `T15-takeback-after.png`.
- **T17: fixed.** The page editor's selection collapses to its end when a command is sent, so the passage keeps only the thin mark. Check: q16. `T17` before and after.
- **P2: fixed.** In the page editor, a toolbox under the words opens above them when the room above holds it, and the pane does not scroll for it. Check: q12 at 1000 and 820, 0px over the words. `P2` before and after.
- **T16 (Need from loop/sel-anchors): fixed.** The Define row shows `defineWord(...)`, and `src/lib/prompts/define.ts` asks about the bare word. Check: t04, q15d. `T16` before and after.
- **notes N2, N13, N14 (Needs from loop/notes): fixed.** Add to notes shows the new note on every document; a quote that lands in a note closes the toolbar and the selection; the note picker's Escape goes back to the sections. Check: cx n2 (before: no note card; after: the card at y 699), n13, n14. `N2`, `notes-N13`, `N14` before and after.
- **nav-N19: fixed.** The comment card's ✓ is a "Resolve" button. `nav-N19` before and after.
- **nav-N20:** the reader's highlight card already names its kind ("Highlight"); nothing to change here.
- **nav-N21: fixed.** A click on stacked annotations opens a chooser at the click (`data-stack-chooser`) that lists each one by its kind name, in its kind color, with its quote; the one picked opens. Check: cx n21. `N21` before and after. (navigation/resolve.mjs clicks on stacked words and now gets the chooser, so it stops before its Resolve step; cx n21 picks the comment and finds Resolve.)
- **Link marks (Need from loop/sel-toolbar): fixed.** A link mark is not draggable and takes the mark press; a drag that starts on it selects its words (Chromium starts no selection on a link, so `pressLink` places the caret and extends it), and the click that ends a drag follows no link. Check: cx link. `link-drag` before and after.
- **nav-N10, E-18: jump fixed.** A Contents jump puts the part's heading at the reading line (80px). The missing Part 1 is in `contents-menu` (Needs). `E-18` before and after.

Regressions the area's other scripts found on this branch, fixed here:
- t18: a card dragged by its grip closed on release (the release counted as a click outside the cards). Now a click whose press started more than 4px away closes nothing. Before: `.qa-tmp/fix/logs/regress-t18-drag.log` (the card is gone at step 3); after: `card-grip-drag-after.png`, `last-t18.log`.
- t16 at 1000: the Simplify card covered the middle of the selection toolbox. The open toolbox is now one layer over the cards (`TOOLBOX_LAYER`, z-41). `narrow-toolbox-before.png`, `narrow-toolbox-after.png`.
- e07: a new card lifted into the pane covered the foot of the card above it; e01: a card lifted to the pane's top covered Collapse and Extract. Both fixed in `keepCardInPane`.

## Files

- `src/components/reader/reader-interactions.tsx`: everything above. Main pieces: `drawnBlock`, `passageBox`, `columnAtRest`, `cardRoom`, `dockSideCard` (module level); `toolRunsRef`, `startToolRun`, `abortToolRun`, `landedAway`; the layer stack (`layerKeys`, `closeLayer`, `openLayersRef`, the Escape effect), `closeIdleCards` and the pane's click listener (a click that ends a drag is ignored); `cardDraftsRef`; `claimSideSlot(kind, top, anchor)`; `cardsRoom`; `cardCaps` in `settleSideCards`; `keepCardInPane` (the band and the card above); `layoutNarrowCards`; the card resize observer; `fitToolbox` and its ResizeObserver; `runAssistant` (`aiSent`, `aiError`); `planBody`/`planInCard`; `stackChooser`; the band; `TOOLBOX_LAYER`.
- `src/components/reader/block-view.tsx`: link marks take the mark press (`pressLink`, `caretAt`) and are not draggable; a click on stacked marks sends every source id under it.
- `src/app/globals.css`: `[data-cards-room] .reader-column` moves the column left by `--cards-room`.
- `src/lib/i18n/dict/reader.ts`: explanationReady, analysisReady, visualizationReady, simplifiedReady, answerReady, showCard (en, zh).
- `src/lib/i18n/dict/common.ts`: rateTakeBack (en, zh).
- `src/components/rating-buttons.tsx`, `src/app/api/ratings/route.ts`: T15.
- `src/lib/prompts/define.ts`: T16, the bare word after "Selected word:". **Define prompt change:** the assistant eval does not need to run for Define.
- `SPEC.md`: §6 (cards beside the words, the column's room, the narrow reader, opaque cards, caps, the band, Escape one layer, idle cards and drags, one card per run with the ready toast, the assistant box's sent line and error, the answer that lands, the stacked chooser, link drag, Resolve, the toolbox over the cards), §21 (the view hides the cards; a tall card is lifted, under the band and the card above), §25 (a rating changes or is taken back), §26 (a jump lands at the reading line), §28 (a click on a core reads it whole; Collapse closes cards whose words are not drawn).

## Decisions

- A run whose card a newer run took keeps running and lands with a toast, rather than being stopped (the reader asked for it) or getting a second card in the same slot (one card per kind stays).
- A ready toast's Show scrolls the pane at once, then opens the card, so the card opens beside its words rather than at the window's foot.
- When the margin is too narrow, the column moves left to make room, rather than shrinking the card under 260px.
- In the narrow reader, the card opens in a gap made under its paragraph, rather than over the next lines.
- A growing card stops above the card under it and scrolls, rather than pushing that card down; a card lifted into the pane stops under the card above it and runs on below the pane's edge, rather than covering it.
- The pills get an opaque band that takes no room (`h-12 -mb-12`), rather than fading the text under them or moving the article down.
- A drag that starts on a link mark selects words (`pressLink`), rather than dragging the link.
- The open toolbox stands over the cards (z-41), rather than moving the toolbox off a card in the narrow reader (placement belongs to the toolbar package).
- A rating's take-back deletes the reader's own ToolRating row (the reader asked for exactly that); a change updates it and clears the comment that explained the old rating.
- Escape stops no run; Stop stops a run.

## Needs (files this package does not own)

- `src/components/tooltip.tsx` (T14): no tip on a pointerover that has no pointermove after it, so a card that opens under the pointer does not get its button's tip over the answer.
- `document-bar`, `history-control`, `contents-menu` (nav-N13): a shared Escape stack, or skip an Escape that is `defaultPrevented`, so one Escape closes one layer across the page (navigation/escape.mjs: History, Contents and the guide still take no Escape after a card).
- `contents-menu` (E-18, e19): Part 1 is missing from the contents, and the 200-paragraph document shows no parts.
- nav-N20: the panels' kind colors are the notes and navigation packages'.
- Merge note for loop/safety: `runAssistant` here clears the field at send time and puts the question back on a stop or failure. The safety branch keeps drafts in `src/lib/toolbar-drafts.ts`; keep the assistant draft's clear on a landed answer, not at send time, so a failed question's draft survives (t04's "5b box text after reopen" is the comment draft, which the safety package owns). This branch adds no `setCommentDraft("")` line.

## Checks

- `npx tsc --noEmit` (full project): exit 0. `npx eslint` on every changed .ts/.tsx file: clean.
- The findings' scripts on the final code (`last.sh`): every one exits 0 except t14, which stops at its own step 2 after the T8 and T9 checks (the same on the base code).
- The areas' other scripts (`lastreg.sh`): exit 0 for t01, t05, t08, t09, t13, t15, t16, t18, e00, e02, e03, e13b, e23, navigation escape, overlap, collapse, q07, q08, q09, q11, p07b; p07 exits 0 on a rerun after the page document's reset. Not this package: t07 (the page editor's Undo is disabled once the two undos are spent, and the script presses it again), e19 (no contents parts), navigation resolve (the chooser, above). e13 shows a card closing on a width change, as on the base code.
- The round 1-8 checks (`r8.mjs` at 1440, scrolled and 1000, `dragx.mjs`, `r5.mjs`, `qdrag2.mjs`) with the document at the top: the same results as the earlier pass on this branch (`.qa-tmp/prior/last2/`).
- Seen on the base code too, not changed here: t10's pane jumps from 495 to 63 when the Explain card closes, when the document opens at a remembered position of 138.
