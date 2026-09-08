# claude/notes-autosave-7de2fi

**Intent:** Notes auto-save that survives a closed tab, a page change, or a lost machine, with a save state on every note being edited; every current account Unitos Ultra; the tier chip out of the reader; the AI toolbar on the article card of a video or audio document; the section's actions as visible pills; a new note at the top of its section; the grip drags a note out of the tray sideways.

**Files:**
- `src/lib/note-drafts.ts` — new: localStorage drafts for note editors and section composers, written with the keystroke, cleared when the server confirms.
- `src/components/outline/use-note-draft.ts` — the local draft beside the debounced save and the flush; the save state (confirmed and failed content).
- `src/components/outline/use-note-compose.ts` — new: the composer's auto-save; creates the note after the last keystroke, saves later edits to it, hides it from the list while it owns it; Save releases, Cancel deletes, Esc keeps a note with text.
- `src/components/outline/save-state.tsx` — new: the "Saving…" / "Saved" / "Not saved" line.
- `src/components/outline/use-outline.ts` — on load, replays local drafts the server did not get; sweeps stale ones.
- `src/components/outline/note-card.tsx`, `floating-note-editor.tsx` — the save state in the header; confirm the Done save.
- `src/components/outline/notes-tray.tsx`, `section-item.tsx` — the composers on the compose hook, with the save state.
- `src/lib/types.ts`, `src/app/n/[notebookId]/page.tsx`, `src/app/n/[notebookId]/notes/page.tsx` — `NoteView.updatedAt`, so a draft older than an edit made elsewhere is dropped, not replayed.
- `src/lib/i18n/dict/outline.ts` — saving, saved, saveFailed (en, zh).
- `prisma/migrations/20260908160000_all_accounts_ultra/migration.sql` — every account ULTRA, trial end cleared.
- `src/components/reader/workspace.tsx` — the tier chip and band leave the reader header.
- `src/components/reader/reader-interactions.tsx`, `reader.tsx` — `embedded`: the layer inside another reader's scroller; selection capture scoped to the layer's own root.
- `src/components/video/video-pane.tsx`, `assistant-card.tsx` — the article card renders the article document's blocks through the reader layer; markdown fallback for an article without a document.
- `src/app/n/[notebookId]/page.tsx` — the article document's pane data for the video pane.
- `src/components/outline/section-action.ts` — new: the pill class for "+ note", Speak, "+ Add section", always visible; `notes-tray.tsx`, `section-item.tsx`, `add-section.tsx` use it, and the composer sits above the section's notes.
- `src/app/api/notes/route.ts` — `top: true` lands the note at order 0 (order -1, then normalize); `use-outline.ts` and `use-note-compose.ts` send it.
- `src/components/sortable.tsx` — `axis="y"`: the reorder starts on a vertical move and lets go past 12px sideways; the grip carries `data-drag-handle`.
- `src/components/outline/note-card.tsx` — the grip is visible (70%) and drags out sideways (12px) or reorders (6px), whichever first; the floating card lands whole on screen.
- `src/components/outline/floating-note-editor.tsx` — `floatingWidth`, `landingLeft`; a released card settles whole on screen.
- `SPEC.md`, `TIERS.md` — §6 auto-save, save state, the composer at the top, the pills, the grip; §11 the article card; tier decisions.

**Decisions:**
- A new note is created on the server after the first debounce, not on Save; the composer hides it until Save so the list never shows it twice. Cancel deletes it; Esc keeps it when it has text.
- The local draft replays only when the server's `updatedAt` is older than the draft; an edit made elsewhere wins.
- The article card embeds a second `ReaderInteractions` (the reader already runs two in split view) rather than rendering the article's blocks in the transcript layer, so anchors carry the article document's id.
- The reader header's tier chip and band are removed; the Ultra marks on Visualize and Continue stay, since they are gates, not the rank.
- Only the composer's note lands at the top; notes from Find, distill, voice, and the assistant still land at the end, so the pending queue's order is unchanged.
- The section's Delete button stays hover-only: it is destructive, not a main action.
