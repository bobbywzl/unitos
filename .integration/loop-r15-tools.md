# loop/r15-tools

## Intent

Fix round 15's tools findings (PACKAGES.md section 2): TOOL15-01 and 02 (blocking) first, then TOOL15-03 with EDGE15-13's Collapse half, 04, 05, 06, 07, 09, 10, 11, 12, 13, 14, 15, then PAGE15-16.

## Findings

Screenshots: `/mnt/project-files/interaction-loop/round-15/img/TOOL15-<NN>-before.png` and `-after.png`. Befores for 03 to 14 are the audit's own screenshots (`.qa-tmp/audit/r15/tools/tools-NN-*.png`); the numbers below say which run they come from. Scripts and logs: `.qa-tmp/tools/` in this worktree (`before/`, `after/`), against my server on :3142 and my own project "Fix r15 tools".

- **TOOL15-01 (blocking): fixed.** Delete on a stored match and on an extraction was final in one press.
  - Before (m02, 390 touch): the match card's Delete 36×16, no Undo, stored matches 1 → 0, History events 0. Extract (x02): extractions 1 → 0, no Undo.
  - After (m03, 390 touch): the pill "Match deleted · Undo" shows in 239–361 ms; during the pill the spans are gone (0) and the database still holds the match (1); Undo brings the 4 spans back and the database stays at 1, still 1 after 13 s. A reload while the pill shows sends the delete (keepalive, resent from sessionStorage after the reload): database 0, spans 0.
  - After (x03, 1440): the list's ✕ shows "Extraction deleted · Undo"; rows 2 → 1 with the database at 2; Undo gives 2 rows; Delete then the pill's 12 s gives database 1; a reload while the pill shows gives database 0, rows 0.
  - origin/main has the same loss: `deleteDistillations` and `removeExtraction` send the final PATCH at the press.
  - No History event: `NotebookEvent.kind` is read by the notes package's History list, which knows no extraction kind; the lead's rule says no new kind, so the pill alone is the fix.
- **TOOL15-02 (blocking): fixed.** Extract's question box keeps a draft (`unitos-extract-draft:doc:<documentId>`, the project's Extract `project:<notebookId>`), written at most every 300 ms, before a run starts, and on pagehide; it clears when the extraction for that question lands.
  - Before (x02): after a reload the box is empty, storage keys holding the question 0.
  - After (x03): the box holds "Unsent question kept 5522" after the reload; one key holds it. A failed question stays in the box.
  - origin/main has the same loss (the box is `useState("")`).
- **TOOL15-03 and EDGE15-13's Collapse half: fixed.** One failure line.
  - Explain in-band (f01, 1440): before "529 {"type":"error",…}" with "The passage says" dropped; after "The passage says" then "No answer: the assistant had a problem. Try again." Simplify and Visualize read the line.
  - Define in-band (d01): before the 529 JSON; after the plain line.
  - Extract in-band (x03): before the 529 JSON; after the plain line, question kept.
  - Collapse (c02, 390): a 500 with JSON, a 500 HTML page and an abort read "No answer: the assistant had a problem. Try again." / "No answer: Unitos could not reach the server. Try again." (was "The article could not be collapsed. 529 {…}", "Request failed (502)", "Failed to fetch").
  - Voice command (vc01, 390 touch): an abort reads "No answer: Unitos could not reach the server. Try again." (was "Failed to fetch"), a 500 with raw text "No answer: the assistant had a problem. Try again." (was "Groq 503: {…}"). My server has no transcription key, so the full run stops at "GROQ_API_KEY, … is not set" (a 503 the route words for the reader, kept); the plan-failure path (the three sentences) is fixed in the route (`ReaderLine(failureLine(…))`) and checked by reading, not in a browser.
- **TOOL15-04: fixed.** v02: at 1440 the picture is 1100×413 in the view (was 191×72; 226×85 in the card); at 390 touch 342×128 in the view (was about 190 wide; 340×128 in the card).
- **TOOL15-05: fixed.** d01: Add to notes after Define writes "> encoding" then "Mock definition of encoding: …" (database, newest note). Before: "> encoding".
- **TOOL15-06: fixed.** x01: the pending note reads "> Students interleaving practice …" then the caption (database). Before: the caption alone.
- **TOOL15-07: fixed.** p01, 390 touch, a selection near the top of the screen (block 6). Before (`BLK=6 W0=12 W1=18`): card y 473–773, Accept at y 803 out of view, the turns in a 164 px scroll window scrolled 37 px. After (`W0=1 W1=7`; words 12–18 carry the before run's conversation now): card y 269–774, Accept at y 636 in view, no scroll window inside the card.
- **TOOL15-09: fixed.** k03, 1440: the head holds "Expand the conversation" and "Close" only (was Delete 2 px from ✕); ⋯ (24×24, tip "Regenerate · Delete") at the end of the foot row opens Regenerate and Delete (31 px rows). Delete: the pill in 218–476 ms, the card closes, the database keeps the note during the pill (1); Undo: mark back, database 1, still 1 after 13 s and after a reload. Delete then a reload while the pill shows: database 0, mark 0, NOTE_REMOVE in History.
- **TOOL15-10: fixed.** c02, 390 touch: whole → collapsed keeps "Spacing and retrieval" at the reading line, offset 0 (was: block 14's core at −58). Collapsed → whole keeps it too. The running button is 104×33 in the band's first row (was 175×33 wrapped to a second row at y 120).
- **TOOL15-11: fixed.** c01, 390 touch: the fold button beside a block read whole is 36×36 at x 330–366, full strength (was 24×24 at x 374–398, past the 390 screen, opacity 0.4).
- **TOOL15-12: fixed.** 390 touch, before → after:
  - The voice command's discard ✕ 9×17 → 36×36; Command 33×21 → 33×36; Send again 90×25 → 90×36 (vc01).
  - The match card's ✕ 25×24 → 36×36; Delete 36×16 → 56×36 (m01).
  - The Extract page's Regenerate and Delete 16 px tall text → 63×36 and 36×36; ✕ 32×32 → 36×36 (t12).
  - The plan's checkboxes 13×13 → 20×20, inside a 314×70 label row that takes the tap (p01, t12).
  - The ¶ chip draws 18×18 in the line; a tap 15 px off its center on any side lands on it (t12: 5 of 5 points).
  - The M1 chips (24×16) are drawn by `block-view.tsx`, the select package's file: not changed.
- **TOOL15-13: fixed.** The assistant card and a tool card continued into a conversation read "Message the assistant…" (p01 screenshot); "Queue a message" stays for the running state.
- **TOOL15-14: fixed.** m01, 1440: the match card is at x 768–1028, beside the article's right edge (was x 282–582, y 326–562, over three lines). At 390 it docks under the paragraph, full width (x 8–382), as the other cards do.
- **TOOL15-15: not done.** The section's Note and Command row lives in `notes-tray.tsx`, the notes package's file (the audit says so too). Making that row stay at the sheet's top is a notes layout change; left for the notes package or the lead.
- **PAGE15-16: not done.** One box at the words in Editing needs three packages' code at once: the toolbox (select's region) has to host the Editing chips and the bar's status row; the figure's Assistant button, Search the menus and the right-click menu live in `src/components/docs/**` (page's) and open the bar by event; and the bar's follow-up replaces the edit still pending (`replacing`), which the toolbox box does not. In a round where all three packages edit `reader-interactions.tsx`, that is not a small in-place hunk, and a partial move would leave Editing with two boxes. The round 14 verdict stands.

## Files

- `src/lib/deferred-delete.ts` (was `src/components/reader/attachment-delete.ts`): one deferred delete for a PATCH or a DELETE: the pending request kept in sessionStorage, resent after a reload (`resumeDeletes`), a 404 on DELETE counts as landed.
- `src/components/assistant/conversation-delete.ts`: the card deletes go through `deleteWithUndo` with DELETE.
- `src/components/reader/extract-draft.ts` (new): Extract's question draft.
- `src/components/reader/card-more.tsx` (new): the tool card's ⋯ with Regenerate and Delete.
- `src/components/reader/reader-interactions.tsx` (shared): extraction and match deletes with Undo, resumed deletes; the cards' heads and ⋯; failure lines and kept words on the cards; Define in Add to notes; the Extract quote note; the phone card's rise; Collapse's place and busy label; the plan checkbox size; the card box placeholder; the match card as a side card (`extract` added to the side card kind lists).
- `src/components/reader/distill-page.tsx`, `corpus-distill-page.tsx`: the draft, deletes with Undo, the quote in the note, touch sizes.
- `src/components/reader/visualization-viewer.tsx`: the picture fills the view's width.
- `src/components/reader/core-block.tsx`: the fold button on touch.
- `src/components/markdown.tsx`: the ¶ and ✎ chips' 36 px touch band.
- `src/app/api/derive/route.ts`, `src/lib/derive/config.ts`, `src/app/api/documents/[documentId]/collapse/route.ts`: the plain failure line.
- `src/app/api/notes/voice/route.ts`, `src/components/outline/voice-note.tsx` (notes package paths, see Needs): the voice command's failure line and touch sizes.
- `src/lib/i18n/dict/api.ts`, `assistant.ts`, `reader.ts`: keys below.
- `SPEC.md`: §4 (Extract's draft, the match card's place and Undo), §6 (the ⋯, deferred deletes, the phone card's rise, touch targets, Define in Add to notes), §21 (the card box placeholder), §28 (Collapse).

## Decisions

- Extraction and match deletes have the pill and no History event (no event kind the History list can show, no new enum).
- A pending delete lives in sessionStorage, so a reload while the pill shows still deletes, and the deleted mark or row stays hidden after the reload.
- Every card delete (explanation, simplification, visualization, conversation, and the highlight and comment deletes that share `deleteWithPill`) now waits for the pill's commit instead of deleting at the press. Undo then sends nothing.
- A card with no foot row (failed, declined) gets the ⋯ in a row of its own; the assistant card's ⋯ sits after Send in the box row.
- A raw in-band reason that still reaches the client turns into the plain line (a server or proxy from before); the derive route's own reader lines (compare found no points) keep their words.
- The picture view's "The picture could not be drawn" became the plain failure line.
- On a phone a card short of room rises over the paragraph's words after the passage, never over the selected words, before its body gives up height.
- The busy Collapse button hides its label under the sm breakpoint (screen readers keep it).
- The ¶/✎ chips keep their 18 px in the line and take a transparent band, so a line of text does not grow.
- The match card in the page editor keeps its old place (no card column there for it).

## Needs (the lead, at merge)

- Files outside the package: `src/components/outline/voice-note.tsx` and `src/app/api/notes/voice/route.ts` (notes package paths; the voice command's failure line and touch sizes, TOOL15-03 and 12); `src/components/markdown.tsx` (the chips); `deleteWithPill` in reader-interactions also defers the highlight and comment deletes (select's region).
- i18n: new `assistant.messagePlaceholder`; `reader.extractionDeleted`, `reader.extractionsDeleted`, and `reader.extractionRemoved` changed to "Match deleted" (reader.ts is select's file); removed `reader.replyPlaceholder`, `reader.continuePlaceholder`, `reader.collapseFailed`, and `api.compareFailed`, `visualizeFailed`, `visualizeNotRendered`, `formalizeFailed`, `collapseFailed`, `voiceNoteFailed`, `voiceCommandPlanFailed` (en and zh).
- Now unused, in files I do not own: `common.modelCallFailed` (common.ts), `outline.voiceNoteFailed` (outline.ts).
- `note-card.tsx:698`: the stale comment about chips under the note (TOOL15-06's proposal) is the notes package's file; not touched.
- TOOL15-15 and PAGE15-16 are open (above).
- On a 390 screen with a stored extraction, the band's "Extract (1)" pushes "Collapse NEW" to a second row at rest (c01: [234,120]); not from this branch.
