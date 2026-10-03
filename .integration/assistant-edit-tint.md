# assistant-edit-tint

**Intent:** When the reader sends a command to the assistant on a selected passage, the passage stops being a block of color while the assistant runs and while its suggestions are pending; a plain answer brings the fill back.

**Files:**
- `src/components/reader/reader-interactions.tsx`
  - `assistantEditing`, `chatSpans`, `thinAssistantMark` before `highlightsByBlock`: the assistant is changing the chat's passage when a message is in flight or the last answer carries a `suggestKey`. While it holds, the passage keeps the thin mark a closed conversation has (`tool-mark tool-mark-assistant`: the underline, no fill) instead of the anchor fill, on the stored mark (`open` false), on the local mark, and on the live card anchor. The connector line is unchanged (it reads the block, not the mark).
  - The toolbar's selection tint: while the toolbar's command box runs (`aiBusy`), the passage keeps the thin mark instead of the "selection" tint. A figure keeps the tint (its tint is a ring, not a fill).
  - `addLocalAnchor(anchor, tool?)` and `localAnchors[].tool`: the assistant's three call sites pass `"assistant"`, so the optimistic mark is the assistant's from the first paint (violet; filled only while its card is open and the assistant is not editing), never a clay fill over a passage with pending suggestions.
  - `collapseSelectionAfterLanding(key)`, called from `assistantTurn` when a command on a selection landed suggestions in the page editor: the page editor's selection collapses to its end so the passage is not drawn blue over the suggestions when the page takes the focus back. An empty selection (a caret) and a plain answer move nothing; the panel's command over the document never comes here.

**Decisions:**
- "The assistant is changing the passage" reads the last message's `suggestKey`, not the run's live count: the count lives in a ref and does not re-render the reader, and a settled run's turn still shows its row. Accepting or rejecting every suggestion does not bring the fill back until the next plain answer.
- The thin mark rather than no mark at all: the reader still sees which passage the assistant is working on, in the assistant's color, and the card's connector line has a visible end. The page editor paints it as a decoration like every mark.
- The collapse goes to the selection's end, by `setTextSelection`, without focusing the editor: the focus stays in the bar or the card, nothing scrolls, and the caret is after the passage when the page takes the focus back.
- The collapse applies to any non-empty selection in the page editor at landing time, not only one that covers the chat's passage; a selection elsewhere while a chat follow-up lands is rare and collapsing it is harmless.
- SPEC.md §6 says the toolbar's selection tint stays "while the assistant runs"; this change replaces that with the thin mark. SPEC.md was left to the main session, as the task asked for changes inside reader-interactions.tsx.
- Verified in Chromium against a dev server with the act route held and answered by a script (no AI key): the thin mark while running from the toolbar and from the card, the fill after a plain answer, the suggestions landing with the selection collapsed, the thin mark with the bar open and in the chat card after suggestions, the violet fill with a persisted conversation. The QA runs' suggestions in the blank document were rejected afterwards.
