**Intent:** The note editor gets the tools the reader asked for — dash list, checklist, quote, image picker with resizing — on the notes full page, with the tray's editor pointing there; every note shows its author, its replies, and its own edit history; the color bug is fixed; every bar tool's tooltip names its key; the extraction prompt reads the question first and never repeats a quote.

**Files:**
- `src/lib/note-markup.ts`, `src/lib/note-doc.ts`: the grammar gains "+ " dash lists, "- [ ] " checklists, and an image width carried in the url; the innermost color paints.
- `src/lib/note-editable.ts`: colors are style commands (selection or typing intent, line by line — the fix for "sometimes unable to change color"); a task box ticks on click; an image's corner handle sets its width; pasted images upload; "[ ] " typed at a line start becomes a task; insertBlock.
- `src/components/outline/note-editor.tsx`: two bars (core in the tray with a link to the notes full page; all tools on the page), tooltips with keys, image picker.
- `src/components/markdown.tsx`: dash lists, clickable task boxes, image width.
- `src/components/outline/note-card.tsx`, `note-history.tsx`: author on every note of a shared project, reply count on collapsed rows, task toggle without opening the editor, History under the note.
- `src/components/collab/reply-thread.tsx`: Reply for any editor once sign-in is on.
- `prisma/schema.prisma`, `prisma/migrations/20260909150000_note_edits`, `src/lib/notes/edits.ts`, `src/app/api/notes/[noteId]/edits/route.ts`, `src/app/api/notes/[noteId]/route.ts`, `src/app/api/notes/merge/route.ts`: NoteEdit rows, recorded per sitting.
- `src/app/globals.css`, `src/lib/i18n/dict/outline.ts`, `src/lib/i18n/dict/common.ts`, `SPEC.md`, `CLAUDE.md`: styles, strings, spec, vocabulary.
- `src/lib/prompts/distill.ts`: the extraction prompt.

**Decisions:** "Full screen mode" is the notes full page. The tray keeps the core tools rather than growing to three rows. Replies open to any editor (the spec's "once shared" rule is relaxed). A note's author shows on shared projects only, one's own notes included; annotations keep the lighter rule. Edits coalesce per ten-minute sitting.
