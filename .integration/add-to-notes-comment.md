# add-to-notes-comment

**Intent:** When the reader presses Add to notes, let them type a comment on the quote and either make a new note in a section or append the quote and the comment to a note they pick.

**Files:**
- `src/components/reader/reader-interactions.tsx` — the Add to notes bubble: the comment field (Enter = new note in the first section; `data-tip` says so), the "New note in" label over the section rows, the Add to a note… row that swaps the sections for `NotePicker` behind a "Which note?" back row. `addToNotesText` builds the quote plus the comment after a blank line; `addToSection` uses it; new `addToNote` sends `PATCH /api/notes/[noteId]` with `append` and `addSource`, then closes, refreshes, and dispatches `dissect:show-note` (the workspace handles it in the block reader too: it opens the tray on the note and flashes it). The draft is keyed to the selection (`addDraft.key === popoverAnchorKey`), so a new selection starts the bubble over without an effect. The panel drops down over the tools when the visible room above the toolbox is under 400px (`yTop - scrollTop`), as it already did beside the page editor's page. New optional prop `sections?: SectionView[]` (default `[]`): the Add to a note… row shows only when a section holds an accepted note.
- `src/components/reader/note-picker.tsx` — a stub with the agreed interface (`sections`, `onPick(note, sectionLabel)`, `disabled`), committed on its own as "stub: note-picker (replaced on merge)". Drop it in favor of the other worker's file.
- `src/app/n/[notebookId]/page.tsx` — passes `sections={top}` (the server's section tree, the same one `view.sections` carries) to both `ReaderInteractions` and `VideoPane`. The task named workspace.tsx, but the main `<ReaderInteractions>` is rendered here.
- `src/components/video/video-pane.tsx` — carries `sections` through to `ReaderInteractions`.
- `src/lib/i18n/dict/reader.ts` — `addCommentTitle`, `addNewNoteIn`, `addToExistingNote`, `addToExistingNoteTitle`, `addPickNote` in en and zh. The placeholder reuses the existing `reader.addCommentPlaceholder` ("Add a comment" / "添加评论").

**Decisions:**
- The comment is a one-line `<input>`, not a textarea: one short remark, Enter sends. A longer comment belongs in the note's editor after it lands.
- The field autofocuses only on a fine pointer; on a coarse pointer a keyboard popping up over the toolbox would hide the rows.
- Enter with an empty field still makes the note (the plain quote), so the fastest path has no extra condition.
- `sections` comes from the server tree on the page, not the tray's optimistic tree: it is one prop on a server-rendered component, and every tray action refreshes the route. A note accepted a moment ago in the tray shows in the picker after that refresh.
- The Add to a note… row is hidden when no accepted note exists, rather than opening an empty picker.
- The dropdown threshold (400px) is an estimate of the open panel's tallest state (the picker with a full list) plus the 52px slot above the toolbox. The old list was one row and never ran off the top; the new panel did in testing, so the page editor's existing dropdown path now also serves the block reader.
- Until the other worker's `append` lands in the PATCH schema, zod strips `append`: the call returns 200, the source is added, and the text is not. Tested against that state; the text path needs the merged schema.
- A QA note (`#ogcu4l`, "tudents interleaving…") was made and left in the local project cmuryv6oc00007dpbl3k6sjo7 so the picker had an accepted note to list.
