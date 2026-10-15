# r10-style10

**Intent:** Round 10 STYLE10: the view audit's prototype (the docked note's rows as presses, the Documents head in two groups, the key once per mark, the folded box's command as the unfold press, curve contrast, the zoom stack at 40 px under a finger) and the audit's remaining view items (WALK10-08, WALK10-03, VIEW10-05, VIEW10-09, VIEW10-10, VIEW10-07, REV10-08, VIEW10-08, REV10-11), plus the coordinator's TOOL16-06 (one failure line in the Stitch box).

**Files:**
- `SPEC.md` — §13: the far-zoom band (0.68 on, 0.73 off), the waiting node's comments chip under a finger, the fromLinkId rule (one link's ends, one or two); §22: the box's head row (Read every document, Clear for the conversation, the command's words as the unfold press).
- `src/app/globals.css` — the prototype's opacities (0.85 / 0.7 / 0.9) and the zoom stack at 40 px under a finger; `--graph-ring-grow` (the chips clear the ring as it grows, VIEW10-05); the waiting node's comments chip drawn at a far zoom under `(pointer: coarse)` (WALK10-03).
- `src/components/collab/reply-thread.tsx` — the dates, Resolve, and ✕ at 11 px (VIEW10-07); Resolve's coarse padding (VIEW10-09).
- `src/components/graph/coverage.tsx` — the prototype: the Documents head in two groups, the comments count as a chip-form press; `NodeComments` carries `data-waits` (WALK10-03). The listing order and `useDocumentCoverage` are untouched.
- `src/components/graph/graph-find.tsx` — the placeholder reads Find under 768 px; the label 40 px under a finger (VIEW10-09).
- `src/components/graph/graph-notes-list.tsx` — the Notes pill, the section select, and the expand button at 40 px under a finger (three one-line class edits; LISTS10's file).
- `src/components/graph/graph-notes.tsx` — the prototype: the note curve at sage-600.
- `src/components/graph/graph-overlay.tsx` — the prototype's `onOpenLink`; the header's pills, the Recommended reason press, and ✕ at 40 px under a finger (VIEW10-09).
- `src/components/graph/graph-ui.ts` — `DOC_CHIP` at 40 px under a finger; the size comment (the box and the reply thread take the four steps).
- `src/components/graph/graph-view.tsx` — the prototype's key rows and gestures line; the far-zoom band and the chips' offset by the ring's growth (VIEW10-05); the key's far line under a finger (WALK10-03).
- `src/components/graph/link-note-composer.tsx` — `useLinkInNote` (VIEW10-10).
- `src/components/graph/link-panel.tsx` — the title at TEXT_NAME under 768 px, and under the head row whole when the step ("‹ 1/2 ›") is in it; Note on this link reads In the note and is not a press while both ends are in the new note (VIEW10-10); Tab from it goes to the dock, `aria-flowto` (VIEW10-08).
- `src/components/graph/note-gather.tsx` — the prototype's rows; `fromLinkId` for one link's ends, one or two (REV10-08); `id="graph-note-gather"` and Shift+Tab from the fold press back to Note on this link (VIEW10-08). The draft's keys and shape are unchanged.
- `src/components/graph/stitch-box.tsx` — the prototype: the last command as the unfold press, the fold button only when there is something to fold; the failure line `assistant.failedServer` with Retry (TOOL16-06); the text at the four steps (VIEW10-07). Head row, status line, and class names only; storage, turns, and the draft untouched (PR #23).
- `src/lib/i18n/dict/assistant.ts` — `failedServer` (en, zh); orphans `sideChatOpened`, `noteAssistantStop` removed.
- `src/lib/i18n/dict/graphCover.ts` — the prototype's keys (`keyWaiting`, `keyNodeNotes`, `composerLinkPair`, `composerLinkPairTitle`).
- `src/lib/i18n/dict/graphNotes.ts` — `keyFar` reworded, `keyFarTouch`, `noteOnLinkInNoteTitle`; orphan `keyPending` removed.
- `src/lib/i18n/dict/graphView.ts` — the prototype's gestures keys, `findPlaceholderShort`; orphans `partsMoreOne`, `findPick` removed.
- `src/lib/i18n/dict/stitch.ts` — `stitchPickClear` reads Read every document, `stitchPickOneMore` names it; orphan `generatedToggleTitle` removed.
- `scripts/qa/ui-graph-style7.mjs` — the link panel's title check expects 13.5 px under 768 px (VIEW10-10), 16 px above.

**Decisions:**
- VIEW10-08: a Tab handler and `aria-flowto` from Note on this link to the dock's fold press (and Shift+Tab back), not the dock moved before the lists in the DOM: moving it would put the dock ahead of the panel's own controls for every Tab walk, not only from the press that opened it.
- VIEW10-10: the in-state press is `aria-disabled`, not `disabled`, so it stays a Tab stop (VIEW10-08's Tab starts there); its label borrows `graphCover.addedToNote` (the passages' word) rather than a new key.
- WALK10-03: the waiting node's comments chip at a far zoom is CSS under `(pointer: coarse)` only, scaled by 1/zoom (capped at 3.5); under a mouse the far canvas stays quiet as before.
- VIEW10-05: the band is a ref in `LabelScale` (on under 0.68, off over 0.73); the ring's growth is one CSS variable (`--graph-ring-grow`) the chips' left offset adds, so no JS measures the ring.
- TOOL16-06: the failure line is the one key `assistant.failedServer`; the box's `error` state (write-only once the raw text was dropped) is removed. `ClearConversation`, `clear-conversation.tsx`, and `lib/kept-chat.ts` untouched (the interaction loop branch owns them).
- VIEW10-07: every `text-xs` in the box went to 11 px (the status, viewer, and key lines too), so the box carries only the four sizes.
- REV10-08: `words &&` stays in the fromLinkId test, since the route's fromLinkId body requires `content`.
- REV10-11: orphans removed only from the dictionary files this branch touched; `panes.ts` and `panels.ts` (nine more orphans) are left for a branch that touches them.
- WALK10-09 (the one-pick line before typing) was already met on the base (w8b-before: the line is visible before typing in all four combos); no change.
- VIEW10-10 at 390: with the step in the head row, the row wraps and the title takes the second row whole (two lines at 13.5 px); without the step nothing changes. The alternative, a smaller step, would have put its two presses under 40 px (VIEW10-09).
- WALK10-04 (the docked note under the keyboard) was not built: at 390×508 the open dock already sits above the viewport's edge (bottom 444), so only the folding of the quotes into the head remains (RESULT.md §3.10).
