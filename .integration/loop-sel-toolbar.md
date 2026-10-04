# loop/sel-toolbar

**Intent:** Fix the selection audit's toolbar placement and pending link findings (S2, S3, S4, S8, S10, S11, S12, S15) in the block reader, without touching `offersDefine`, `block-view.tsx`, `table-marks.ts`, `lib/anchors`, or `lib/define.ts`.

## Findings

Screenshots are under `.qa-tmp/fix/` in this worktree (git-excluded); the full replays are under `.qa-tmp/sel/before/`, `.qa-tmp/sel/after2/` and `.qa-tmp/sel/after3/`, run by `.qa-tmp/sel/run.sh <run> <dir>` (the audit's `sel.mjs` step lists, rebuilt from the audit's logs by `recon.py`, pointed at :3122).

- **S2 fixed.** Escape cancels a pending link in one press (it also closes whatever toolbar or card is open), and the next selection opens the toolbar as before. With a link pending, a selection opens the whole toolbar beside the words, with Close link as its first row in Link's place; the Close link chip over the words is gone. The banner sits under the Collapse and Extract buttons, beside the toast: both chips take their clicks (`underChip: chip, chip`), the ✕ is 28×28, its tip reads "Cancel the link (Esc)". Close link still makes the link and opens the link card (run Z). Before/after: `S2-before.png` / `S2-after.png` (the selection with a link pending), `S2-banner-before.png` / `S2-banner-after.png`, `S2-escape-after.png`.
- **S3 fixed.** The comment field, the assistant's command box and a definition no longer widen the toolbox over the words: beside the words it stays at its rest left edge and grows into the margin as far as the margin goes (tray open at 1440: stays 854–1030 and the field wraps; tray closed: grows to 1064–1312, as before). Before/after: `S3-before.png` / `S3-after.png` (comment, G4), `S3-assistant-*.png` (D13), `S3-define-*.png` (S1b).
- **S4 fixed.** Under the words (and on a coarse pointer) the toolbox is compact: the colors and the voice are its first row, Add to notes its second, nothing hangs above or below it. At 1000 the stack is 254px (was 324). A selection low in the pane opens the toolbox above the words when the room above holds it, and the pane no longer scrolls (Q1: scroll stays 1921, toolbox 558–812 over a selection at 820; before: the pane scrolled 1892 → 2198). The wide layout is unchanged. Before/after: `S4-before.png` / `S4-after.png` (W1000-4), `S4-low-before.png` / `S4-low-after.png` (Q1).
- **S8 fixed.** Figure tools from the hold-and-circle gesture stand beside the block by the text toolbox's rule (right, else left, else under the block), level with the block's top or the pane's top for a tall figure. **Not verified in a browser** (see Needs): before is `S8-before.png` (H2-H1); no after shot.
- **S10 fixed.** Pressing Collapse, either way, closes the toolbar and the browser's selection, also while the cores are being written. **Not verified in a browser** (see Needs): before is `S10-before.png` (P8b); no after shot.
- **S11 fixed.** The edit hint hides (visibility) while a toolbar is open; its fade keeps running. **Not verified in a browser** (see Needs): before is `S11-before.png` (N1); no after shot.
- **S12 fixed.** The toolbox's place is measured from the range's lines inside the blocks the passage reads, so a drag from the title puts it level with the first tinted line. **Not verified in a browser** (see Needs): before is `S12-before.png` (A3); no after shot.
- **S15 fixed.** Ctrl/Cmd+A in the reader (the pane last pressed in, out of edit mode and out of any field) selects the article's blocks and opens the toolbar on them; a selection the keys change (Shift with the arrows from a drag's selection) moves the toolbar to it once Shift, Ctrl or Cmd is let go. A click then Shift+arrows still selects nothing: the block reader has no caret. Before/after: `S15-before.png` / `S15-after.png` (Ctrl+A), `S15-shift-before.png` / `S15-shift-after.png`.
- **S7** not touched (the owner's spec choice).

## Files

- `src/components/reader/reader-interactions.tsx`
  - The Close link chip's state (`closeLink`, `completeCloseLink`) and `Popover.endLeft`/`endTop` are gone; `showTools` and the coarse `selectionchange` path open the toolbar with a link pending; the toolbox's Close link row is `order-first`, shows a spinner while saving, and Link leaves `has()` while a link is pending or in a core.
  - Escape cancels the pending link (`broadcastPendingLink(null)`).
  - The banner moved from `fixed top-24` into the sticky column under the chips, before the toast (`data-link-banner`), hidden in an embedded layer.
  - `restWidth` and `popoverBox`: the widened box grows away from the words up to the margin's room, on the right and on the left.
  - `compact` (coarse or `side === "below"`): colors row with the voice (`voiceButton`), Add to notes second, Define third, the Add panel inline; the 48px left above a below toolbox is gone (`captureSelection`, `openFigureTools`).
  - `Popover.wordsTop` / `above`: the lift effect opens a below toolbox above the words when the room above (to the page editor's header, else 48px under the pane's top for the chips) holds it; `popoverBox` draws it with `translate: 0 -100%` so a field it opens grows upward.
  - `toolboxSide()` (module level): one rule for the selection, key terms and figure tools; `openFigureTools` places the block reader's figure toolbox by it.
  - `toggleCollapse` closes the toolbar; the edit hint gets `invisible` while `popover` is open.
  - `captureSelection` cuts the range's rects to the segment blocks (`segmentEls`) for `rect`, `firstLine`, `yTop`.
  - `onReaderKeyUp` and `onSelectAll` (document listeners in the selection effect), `lastPressInside`.
- `src/lib/i18n/dict/reader.ts` — `cancelLink` names Esc (en, zh).
- `SPEC.md` §6 (Copy, Link across texts, the selection popover, Voice, Highlight colors, figures, the tint, edit mode's keyboard selection, the edit hint) and §28 (Collapse closes the toolbar).

## Decisions

- **S2, Close link as the toolbar's first row**, not a chip in the margin. It costs the reader least: the reader keeps every tool on the second selection (one who changes their mind highlights or comments instead of linking), Close link is where the toolbar always is, so there is one place to look and nothing new to find, and it is never on the words. A margin chip needs its own placement rules and has no margin at 1000px or in a split pane. Link across texts leaves the toolbar while a link waits, so there is one link action at a time.
- **The banner** went under the chips, in the toast's column, not to the bottom of the window (the Stop reading control, the plan card and a low toolbox live there). It sits in the sticky z-10 layer, so the toolbar (z-40) covers it, never the reverse. In a split view each pane shows it: either pane can take the other end.
- **Escape** cancels the pending link and closes the open toolbar or card in the same press, rather than taking two presses.
- **S3** keeps the toolbox at 176 and lets the field wrap when the margin is short, rather than dropping the widened box under the words: the box does not jump while the reader types. The assistant's Thinking and Web chips wrap onto two lines at 176.
- **S4** makes every toolbox under the words compact, including the page editor's under-its-page case (a split pane), since it is the same popover code; the voice went into the colors row (not a row of its own) to save a row; the room above counts up to the page editor's header or 48px under the pane's top for the chips.
- **S8** puts the figure toolbox level with the block's top (not the press), clamped into view for a tall figure; key terms now use the same `toolboxSide`, so a key term's toolbox in a narrow pane goes under the words instead of onto them.
- **S11** hides the hint while any toolbar is open, not only one near it: the hint lives 6 seconds and a nearness test would be more code than it is worth.
- **S15** scopes Ctrl+A to the pane the reader last pressed in (`closest("[data-reader-root]") === container`, so the video pane's embedded article and the transcript do not both take it).

## Needs (files this package does not own)

- `block-view.tsx` (S5's owner): a drag that starts on a link mark (`a.link-mark`) starts the browser's link drag, so Playwright's mouse hangs and the reader gets no selection. This branch's own test links (block 10, 11, 12 of How Reading Shapes Memory) made it show in the replays; the same skip-on-drag fix as S5 should cover link marks.
- The page editor audit: the toolbox under the page (a split pane) is now compact too; worth a look there.
- Verification ran on an overloaded machine (load 60–160 on 4 cores, two OOM kills of this worker's dev server). After the last restart the reader page compiled for over an hour without finishing, so these runs did not finish on the final code and need a rerun (`.qa-tmp/sel/run.sh <run> <dir>`, `hint.mjs`, `coarse.mjs`, `prior.sh`):
  - S8 (run H2), S10 (run V), S11 (`hint.mjs`), S12 (run A): typecheck and lint pass, no after screenshot.
  - The regression replays B, C, D, E, F, H, T, W820, Q8 and the coarse run, and the round 1–8 replays (`r8.mjs`, `dragx.mjs`, `r5.mjs`, `qdrag2.mjs` via `prior.sh`): they passed on the baseline (`.qa-tmp/sel/before/`), not rerun after the change.
  - Runs X, Y, P, G, D2, S, W1000, Q (part) and Z did run after the S2–S4 changes (`.qa-tmp/sel/after2/`).
