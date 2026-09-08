**Intent:** Let every AI tool's card (Explain, Simplify, Analyze, Visualize) continue into a conversation — Explain+, Simplify+, … — with the turns saved on the tool's annotation and a plus on its mark, and show a condensed log of any anchored conversation (tool or assistant) when the reader hovers its mark (SPEC.md §21).

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260907160000_note_conversation_log/migration.sql` — `Note.conversation` (the turns after a tool's output) and `Note.log` (the condensed log).
- `src/lib/conversation.ts` — the one shape for both conversation forms: turns of a tool conversation (`Note.conversation`) and of an assistant conversation (the transcript in `content`), the transcript parser moved here from reader-interactions, the log type, the tool names.
- `src/lib/prompts/conversation-log.ts` — the log prompt (one line per message).
- `src/lib/notes/conversation-log.ts` — writes the log when missing or stale (by turn count), stores it on the note.
- `src/app/api/notes/[noteId]/log/route.ts` — `POST`: the log for the reader's hover.
- `src/app/api/assistant/act/route.ts` — `toolNoteId`: the turn continues from the tool's annotation (selection from its sources, output in the prompt), persists on `Note.conversation` instead of creating a conversation note.
- `src/app/n/[notebookId]/page.tsx`, `src/lib/types.ts` — `AnnotationItem.conversation` and `annotationBubbles[].conversation` carry the turns to the reader and the Annotations tab.
- `src/components/reader/block-view.tsx` — `Highlight.plus`, `ToolSymbol` (the tool's glyph with or without the plus), the chip and the figure side label carry `data-hover-source` for the hover.
- `src/components/reader/reader-interactions.tsx` — Continue button and box on the Explain and Simplify cards, the plus title, turns in the card's scroll body, a turn's send/stop, reopening with the turns, the plus on marks, the hover log card.
- `src/components/panels/annotations-panel.tsx` — the turns under a tool annotation, labeled Conversation.
- `src/lib/digest/build.ts` — the turns render after the output in the digest.
- `src/app/globals.css` — `.mark-chip-plus`, `.tool-plus`.
- `src/lib/i18n/dict/{reader,panes,panels}.ts` — en/zh keys.
- `SPEC.md` — §21.

**Decisions:**
- Tool turns go through `/api/assistant/act` (one assistant code path; a turn can still propose actions) rather than a new streaming derivation, so a tool conversation and an assistant conversation are the same thing differing only in what they start from. The reply is not streamed, as the assistant card's is not.
- Turns live on the tool's own note (`Note.conversation`), not in `content` and not as a separate SYNTHESIS note: the output stays intact for sentence mirroring, gists, and the Annotations tab, and deleting the annotation deletes the conversation.
- The log is written lazily on hover and cached on the note by turn count, like gists, rather than after every turn; the tool's output is the log's first message so an Explain+ log reads whole.
- The log card is not a side card: it takes no slot and never pushes a card, so the real card opens exactly where the log stood.
- No database in this environment: `tsc` and `eslint` pass on the changed files (the `LayoutProps` error in `src/app/layout.tsx` predates this branch); the reader was not run by hand.
