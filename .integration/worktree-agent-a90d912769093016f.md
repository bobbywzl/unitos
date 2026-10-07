**Intent:** Fix the Stitch box findings of package BOX (stitch round 1): citations that open a passage card in the graph, chips with a topic slot, a true header line, folded read rows, Review links, Save as note and rating, Esc in the box, failed commands kept, one Stop, client-side limits.

**Files:**
- `src/components/graph/stitch-box.tsx`: every box fix; new optional props `onShowRecommended`, `onCited`.
- `src/components/graph/stitch-passage-card.tsx` (new): the citation chip and the passage card.
- `src/components/markdown.tsx`: optional `renderBlockCitation` prop; unset or null keeps the ¶ chip.
- `src/components/assistant/save-as-note.tsx`: optional `onShow` prop; unset keeps the event.
- `src/lib/i18n/dict/stitch.ts`: new keys en and zh; `stitchHint` shortened, `stitchHintDetail` added; dead `stitchFailed` removed.
- `SPEC.md` §22: the box, citations, viewer line.

**Decisions:**
- A command joins `turns` only with its reply (a pending bubble until then), so failed and stopped commands never reach history or the stored conversation. PR #23's storage keeps working on the same `turns` array.
- Esc: the box registers a capture-phase window listener before the overlay's and calls preventDefault + stopImmediatePropagation when it handles the key.
- `cited` is read through a local `StitchReply` type, so this branch compiles with or without the engine's `StitchResult.cited`.
- Save as note passes no `documentId`, so the note belongs to no single document and its sources come from the cited blocks across documents.
- Added a question chip ("What do these documents say about…?") from the audit's design proposal 3.
