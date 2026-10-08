**Intent:** Round 6 PANEL6: make the graph's link panel, node card and Links list denser and easier (WALK6-03, -05, -06, -08 card and confirm, -09, -11; VIEW6-07) without new features.

**Files:**
- `src/components/graph/link-panel.tsx`: one action row under Why (Reply, Note on this link, Remove); Remove with the reader's hide path and an Undo line; order: row, boxes, replies, notes, passages; touch sizes.
- `src/components/graph/link-detail.tsx`: passages folded to ~4 lines around the quote, a click reads the block whole; Open in reader touch size.
- `src/components/graph/link-replies.tsx`, `src/components/collab/reply-thread.tsx`: optional `openRequest`/`composerFirst` so the panel draws Reply in its row.
- `src/components/graph/link-note-composer.tsx`: optional `openRequest`/`opener` so the panel draws Note on this link in its row.
- `src/components/graph/graph-overlay.tsx`: the link panel stays up on a removed link (Undo line).
- `src/components/collab/confirm-link-removal.ts`, `src/components/panels/annotations-panel.tsx`: Remove asks only when another person replied or made the link.
- `src/components/graph/links-list.tsx`: Waiting on you sorting and the waiting reply on the row; intro paragraph removed; ✕ on the filter row.
- `src/components/graph/coverage.tsx`, `src/lib/graph/coverage-view.ts` (`waitingReply`), `src/lib/i18n/dict/graphCover.ts`: coverage head as text; Waiting on you words; touch sizes.
- `src/components/graph/node-card.tsx`: sized to its content; touch sizes.
- `src/components/graph/graph-notes.tsx`, `src/components/graph/note-gather.tsx`: touch sizes only.
- `src/app/n/[notebookId]/page.tsx`: History link rows name both ends.
- `src/lib/i18n/dict/panes.ts`: confirm words, passage fold tooltips (en, zh).
- `scripts/qa/panel6-check.ts` (new), `scripts/qa/ui-graph-cover4.mjs` (zh head regex).
- `SPEC.md` §13.

**Decisions:**
- Remove sits at the right end of the new action row, not in a row of its own where Dismiss sits for a recommended link: one row instead of two.
- After Remove the panel stays up, shrunk to its title and the Undo line; it closes with ✕ (it does not close itself after 10 s; the line then reads without Undo).
- Passages come after the replies and the notes: what the reader writes first, what they read in full last, each passage folded.
- The waiting reply shows on its row whether or not the filter is on.
- The asker's badge comes from the people map (no badge for an unknown author), not `useAuthor`, which names unknown authors "You" with sign-in off.
- Touch sizes: 24 px under a mouse; 44 px for the action row and Accept/Dismiss, 40 px for inline chips, 24 px for note rows (40 spread the notes too far).
- Folding an undone removal into one History row is left out: it needs SAFE6's hide routes.
