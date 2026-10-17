# loop/r10-open

**Intent:** Fix the round 10 open reader findings S6, S13, E-12, E-13, nav-N6, E-19, T14, and the rest of nav-N13, without touching S7.

## Findings

Screenshots are in `.qa-tmp/fix/` of this worktree (git-excluded), `<id>-before.png` on the base (e0ad625) and `<id>-after.png` on this branch. The checks I wrote are in `.qa-tmp/fix/scripts/`.

- **S6: fixed.** A drag that starts on the article's words and lets go over the notes tray or the header now selects the article's words up to the point in the pane nearest the release, and the toolbar opens on them (`clipSelectionToPane`). A drag that starts in a card keeps the browser's own selection. Check: selection `B` group (`.qa-tmp/audit/selection/runB.sh`): B1 (tray) 68 characters and the toolbar, B2 (header) the words from the pane's top to the press and the toolbar; B3 to B5 as before. `S6-before.png`, `S6-header-before.png`; `S6-after.png`, `S6-header-after.png`.
- **S13: fixed.** With no prediction from the rating service, the kind's first tool after the assistant leads: Explain on text and equations, Analyze on a figure (`kindLead`). A late prediction still takes the lead look; the rows never move. Check: the `lead` field of the selection probe reads `["explain"]`. `S13-before.png`, `S13-after.png`.
- **E-13: fixed.** Every model call from the reader that skipped `api()` (Define, Explain, Analyze, Simplify, Visualize, the assistant, the page editor's suggestions) goes through `fetchWithModel`: offline it fails at once with `common.offlineAi`. While the browser is offline, the toolbar's AI rows are dimmed, carry `aria-disabled`, and their tooltip is the same message; a press still shows the message in the card. Check: e17 (offline toolbar rows `(off)`; the Explain card says "AI is off while offline. …"). Playwright refuses to click an `aria-disabled` row, so my copy of e17 clicks Explain with `force`. `E-13-before.png`, `E-13-toolbar-before.png`; `E-13-after.png`, `E-13-toolbar-after.png`.
- **T14: fixed in `tooltip.tsx`.** A control that comes up under a pointer that has not moved shows no tooltip until the pointer moves on it. Check: t01 simplify logs "tooltip at landed: null" (before: the Save as note tooltip over the answer); `.qa-tmp/audit/tools/t14-move.mjs`: a 3px move then shows the tip, and a hover on Collapse shows its tip. `T14-before.png`, `T14-after.png`.
- **nav-N13 (rest): fixed.** One Escape stack for the page (`src/lib/escape-layers.ts`): the document list, History, and Contents register as layers while open, and the reader offers its newest layer from the same counter, so Escape closes the newest of all of them only. Check: `scripts/esc2.mjs` (card then list, History, Contents: Esc1 leaves the card, Esc2 closes it), the audit's navigation `escape.mjs` (each case closes one layer), e23. `nav-N13-before.png`, `nav-N13-before-open.png`; `nav-N13-after.png`, `nav-N13-after-open.png`.
- **nav-N6: fixed.** The Collapse memory is also a cookie (`unitos-collapse`, the 40 newest document ids, `src/lib/collapse-memory.ts`); the page reads it and sends the stored cores of a remembered document to `ReaderInteractions` (`collapsedCores`), which starts collapsed. Check: `scripts/n6.mjs`: the server's HTML carries 15 cores, and the article is "Collapsed" with 15 cores at the first paint after a reload (before: whole until +4s); the audit's `collapse-reload.mjs`: Collapsed at +500ms. `nav-N6-before.png`, `nav-N6-after.png`.
- **E-19: fixed.** Where the article's right margin cannot hold the hint card, the hint is a row under the pane (a sibling of the scroller), so the pane gives up that height at its foot: no word covered, no line moved. Check: e03 at 1024 coarse. `E-19-before.png`, `E-19-after.png`.
- **E-12: fixed.** A new selection's toolbar closes the stacked-annotations chooser and an on-mark card with no typed words, on a touch screen too (`yieldToSelection`). On a phone's reader the Feedback pill is hidden and is the last row of the Reader view menu (`FEEDBACK_OPEN_EVENT`). Check: e02 (word selection after a tap on stacked marks: one box), `scripts/e12b.mjs` (chooser closed; no Feedback pill; the menu row opens the form). `E-12-before.png`, `E-12-card-before.png`, `E-12-feedback-before.png`; `E-12-after.png`, `E-12-card-after.png`, `E-12-feedback-after.png`.
- **S7:** not touched (the owner decides).

## Files

- `src/components/reader/reader-interactions.tsx`: S6 (`clipSelectionToPane`, called from the mouseup when the press began inside), S13 (`kindLead`), E-13 (`fetchWithModel`, `aiFetch`, `online`, `aiTip`, `aiDim`, the AI rows), nav-N13 (the reader's layers are an Escape source; `nextLayerSeq`), nav-N6 (`collapsedCores` prop, initial state, a document switch), E-19 (`hintBeside`, the hint row under the pane), E-12 (`yieldToSelection`).
- `src/components/tooltip.tsx`: T14.
- `src/lib/escape-layers.ts` (new): the page's Escape stack.
- `src/components/reader/document-bar.tsx`, `src/components/collab/history-control.tsx`, `src/components/reader/contents-menu.tsx`: their own Escape listeners replaced by `useEscapeLayer`.
- `src/lib/collapse-memory.ts` (new): the Collapse cookie.
- `src/app/n/[notebookId]/page.tsx`: reads the cookie and passes `collapsedCores` (stored cores only; no write).
- `src/components/feedback-button.tsx`: hidden in a phone's reader; opens on `FEEDBACK_OPEN_EVENT`.
- `src/components/reader/reader-panes.tsx`: the Feedback row in the Reader view menu below md.
- `SPEC.md`: §6 (a drag that lets go outside the pane; the lead without a prediction; tooltips under a still pointer; Escape across the page's menus; a selection replaces the chooser and an idle on-mark card; the hint row under the pane), §17 (the reader's own streams offline, the dimmed rows), §18 (where Feedback is), §28 (the Collapse cookie).

## Decisions

- S6: the outside end of the selection moves to the words nearest the release point inside the pane (as if the drag stopped at the pane's edge), rather than to the end of the last block the browser's selection crossed, which would select the rest of the article.
- S13: the lead defaults in the client; Jev's answer, when it lands, takes the look over (the row may change look once, never place).
- E-13: the offline AI rows stay pressable (`aria-disabled`, not `disabled`), so a press shows the plain message where the tool shows its errors.
- T14: "the pointer has not moved" is read from the coordinates: a pointerover at the last pointermove's point is the page changing under a still pointer.
- nav-N13: one counter for menus and reader layers, rather than each component skipping a `defaultPrevented` Escape, so a card opened after a menu closes first too.
- nav-N6: a cookie the server reads, rather than hiding the article until the cores load or sending every document's cores with every page. The localStorage memory stays and is still written.
- E-19: a row under the pane, rather than a card over the first lines or in the flow above the title (which would move the article after load).
- E-12: Feedback moves into the Reader view menu on a phone's reader, as the audit proposed. The Reader view button itself still floats at the bottom left (31px) on a phone.

## Needs

- E-12: the Reader view button (`reader-panes.tsx`) still floats over the bottom-left of the last line on a phone; moving it into the header needs a layout decision.
- Seen, not changed: on a phone, a selection low in the pane opens the toolbox past the bottom bar (e12b: toolbox [85,636,305,1036] in an 844px window; on the base [142,328,382,962]). Placement belongs to the toolbar package.
- e21-phone stops on a fixed text offset in its own script (the document's marks split the text node), and navigation `header.mjs` waits on Save for offline, which stays disabled while the dev server saves pages slowly: both are the rigs, not this branch.
- `src/app/api/ratings/route.ts` (on the base since 79d6bce, not this branch): the route exports `RATING_TOOLS`, and Next's route type check rejects any export a route may not have (`.next/dev/types/app/api/ratings/route.ts`: "Property 'RATING_TOOLS' is incompatible with index signature"). This is the one error of a full `npx tsc --noEmit` once a dev server has written `.next/dev/types`, and `next build` would fail on it. Move the list to a lib file.

## Checks

- `npx tsc --noEmit` (full project): one error, the ratings route above (base code, generated types); none in this branch's files.
- `npx eslint` on every changed .ts/.tsx file: no errors; one warning in `document-bar.tsx` (`closeList` missing from an effect's deps), the same warning as on the base.
- The findings' scripts, before and after: selection `B` group, the selection probe's `lead`, e17, t01 simplify and `t14-move.mjs`, `esc2.mjs` and navigation `escape.mjs`, `n6.mjs` and navigation `collapse-reload.mjs`, e03, e02 and `e12b.mjs`.
- The areas' scripts (`.qa-tmp/fix/reg.sh`, logs in `.qa-tmp/fix/reg/`): exit 0 for t01 (explain, simplify, visualize, link at 1440; explain at 1000), t02, t03, t04, t05, t06, t09, t13, t16 at 1000, t18, e00, e01, e03, e07, e13b, e15b, e18, navigation escape, collapse, collapse-reload, contents2, contents3, docbar2, history2, leftoff, tab, overlap, roundtrip. t10 and e23 timed out once under a load of 60+ and pass on a rerun. t14 stops at its own step 2 and e19 finds no contents parts, both as on the base (loop-cards notes). e21 and navigation header stop in their rigs (Needs).
- Selection groups A to G replayed from the audit's logs (`.qa-tmp/fix/sel/replay.mjs`, step by step against the audit's probe): every difference is a fixed finding (S6 B1/B2, Ctrl+A, Define on fragments, Escape closing one layer) or the document's newer marks (a click on stacked marks opens the chooser).
- Not verified: a real phone's long press (e02 selects the word in script, as the audit did); the Collapse cookie in a production build.

