# r8-style8

**Intent:** One text-size scale for the graph (VIEW7-08), the reader header at 390 signed in (pill over Share), LISTS8's new pieces on round 7's floors, and two denser lines (VIEW8-03, VIEW8-04), with no new control.

**Files:**
- `src/components/graph/graph-ui.ts`: `TEXT_META` 11 / `TEXT_BODY` 12.5 / `TEXT_NAME` 13.5 / `TEXT_TITLE` 16; SECTION_HEAD, ACTION_BASE, LEAD (12 -> 12.5), DOC_CHIP, CLOSE use them; `TEXT_HIT` 6 px a side (VIEW8-02).
- `src/components/graph/*.tsx` (16 files): every `text-[Npx]` / `text-xs` / `text-sm` class goes through the four constants (179 sites; a "..." class string became a template literal where it holds one). No structure change except below.
- `coverage.tsx`: counts nowrap in the Documents head (VIEW8-03); comment row 44 px under a finger (VIEW8-02); `NodeCommentsLine` takes optional `facts` and draws them before its press, in one line (VIEW8-04).
- `node-card.tsx`: passes `facts` to `NodeCommentsLine` (a generated document keeps its own facts line).
- `documents-list.tsx`: an opened row's head 40 px under a finger.
- `graph-view.tsx`: the key's text on TEXT_META (keeps VIEW6-10's 420 / 600 px budgets).
- `reader/document-bar.tsx`, `reader/workspace.tsx`, `notebook-title.tsx`, `collab/share-control.tsx`: the reader header at 390 (pill shrinks, holds 112 px; title gives way; Share and Save for offline px-2.5 on a phone). sm and up unchanged.
- `SPEC.md` §13 "One look per action": the four sizes.

**Decisions:**
- The key is 11 px (META), not 12.5: on BODY it broke VIEW6-10's budgets (430 > 420 at 1440).
- Header pills 13 -> 12.5 (BODY), not 13.5: denser, and the 1440 header keeps its room.
- stitch-box.tsx (PR #23), ReplyThread (the reader's), PersonBadge, and the page title (18) keep their sizes.
- On a phone the project title shrinks (to 48 px) before the document pill: the pill names what is being read.
