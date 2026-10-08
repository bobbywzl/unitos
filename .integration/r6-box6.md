# r6-box6

**Intent:** Fix the Stitch box layout: on screen beside the new note in a production build (WALK6-01), two short rows at rest with the suggestions on focus (WALK6-02, VIEW6-01), and Review on an answer that re-proposed a waiting link (WALK6-04).

**Files:**
- `src/app/globals.css`: the data-gather rule for `[data-stitch-slot]` sets only `translate: none` (lightningcss folded `transform: none; translate: none` into one `transform` and dropped the translate); under 1000 px `[data-stitch-suggestions]` hides while the new note is up.
- `src/components/graph/stitch-box.tsx`: one head row (title with the description as tooltip + sr-only hint, scope, picks, Pick documents, New, fold); the suggestions as a card over the box while the empty text box (or a chip) has the focus; ResultLine draws Review when `record.links` has an `existing` link still in Recommended links. Layout only: no storage, drafts, turns.
- `SPEC.md` §22 "The box": the rest layout, when the suggestions show, Review on a re-proposed link.
- `scripts/qa/ui-graph-gather5.mjs`: WALK6-01 check (box on screen, left of the note, no list) at 1440 en/zh.
- `scripts/qa/ui-graph-lists4.mjs`: WALK6-02 checks (rest height ≤ 100, no chips at rest, 5 on focus, same height, Shift+Tab, typing, Esc); the Esc-to-title check reads the attribute list with `includes` (the title now carries `data-tip`).
- `scripts/qa/ui-graph-view.mjs`: focuses the field before pressing a chip.

**Decisions:**
- Two rows (head + field), not one: the title, New and the fold need a row; the task allowed 64–96 px (measured 94 at 1440, 98 on a phone).
- Suggestions sit over the box (absolute, above it), not in it, so the graph does not refit on focus. They may cover up to 2 nodes while focused at 1440.
- The fold is 24 px on a fine pointer, 28 px on touch (`pointer-coarse:size-7`).
- Re-proposed waiting links come from `record.links` (status `existing`) ∩ the graph's recommended ids, not from `existingLinkIds`, so a question that merely cites a waiting link gets no Review.
- Expect a textual conflict with PR #23 in stitch-box.tsx near the head of the render (the old title row and scope row are replaced) and in ResultLine.
