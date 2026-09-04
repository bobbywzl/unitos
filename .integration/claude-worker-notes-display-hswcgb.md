# claude/worker-notes-display-hswcgb

**Intent:** Give every note one structure on display and in the editor, collapse notes and annotations to one summarizing line by default with a button that shows them all whole, put a jump-to-position on every note and edit like annotations have, and add a compare view on the notes full page that shows chosen notes side by side or stacked.

**Files:**
- `src/components/use-collapsed-view.ts` — new. The collapsed view model shared by notes and annotations: view "collapsed" (default) or "expanded", per-card exceptions, persisted per browser under a caller-given key.
- `src/components/collapsed-view-toggle.tsx` — new. The one button that switches a list's view: Expand all / Collapse all.
- `src/components/outline/note-id.tsx` — new. `shortNoteId` (`#` + the cuid's last six characters) and the id chip; click copies the short form, the title carries the full id.
- `src/components/outline/note-card.tsx` — rewritten around one header row (handle, chevron, id at the left; jump, pin, select at the right), then the body, then the actions; collapsed the header row is the whole card; the editor keeps the header and the padding; Save became Done; a `pane` variant for the compare view; a jump button to the first source; opens itself on `dissect:open-note`.
- `src/components/outline/note-editor.tsx` — the textarea grows with the text (an invisible copy in the same grid cell sets the height), at the display's size and line height (`.note-text`), no inner scroll and no resize handle.
- `src/components/markdown.tsx` — `breaks` prop: single newlines render as line breaks (two trailing spaces; fences and marked breaks untouched). Notes pass it; AI bubbles do not.
- `src/app/globals.css` — `.note-text`: the size and line height prose-sm gives the display, so the editor matches.
- `src/components/outline/use-outline.ts` — `notesView`, `isCollapsed`, `toggleCollapsed`, `setNotesView` on the actions (key `unitos-notes-view:<notebookId>`); `noteMatches` so search matches `#id`.
- `src/components/outline/notes-tray.tsx`, `src/components/outline/outline.tsx` — the view toggle beside the search; the page wires Compare into the selection bar and renders the compare view.
- `src/components/outline/selection-bar.tsx` — Compare button when two or more notes are selected and the caller passes `onCompare` (the notes full page only).
- `src/components/outline/compare-view.tsx` — new. The compare view: one pane per note, each its own scroller holding the whole card; Side by side (columns) or Stacked (rows), the choice persisted (`unitos-compare-layout`); Add note… select, ✕ per pane, Esc closes.
- `src/components/panels/annotations-panel.tsx` — every annotation card takes the note structure (chevron, color dot, id) and the same collapsed view (key `unitos-annotations-view:<notebookId>`) with its own toggle; the assistant conversation card lost its inner scroll and the highlight its line clamp; a card opens on `dissect:open-annotation`. Link cards unchanged.
- `src/components/panels/edits-panel.tsx` — a jump button on every edit row whose block is still in the document (`dissect:flash-block`).
- `src/components/reader/workspace.tsx` — the show-note and focus-annotation jumps dispatch `dissect:open-note` / `dissect:open-annotation` before scrolling, so a collapsed card opens first and the scroll centers on the opened card.
- `src/lib/clicks.ts` — new controls in the notes and annotations groups: `note-collapse`, `notes-view:`, `note-id-copy`, `notes-compare`, `note-jump`, `annotation-collapse`, `annotations-view:`.
- `src/lib/i18n/dict/outline.ts` — the new strings, en and zh.
- `SPEC.md` §6, `README.md` — the note structure, the two views, jumps, and the compare view.

**Decisions:**
- The collapsed view and the per-card exceptions live in localStorage per browser and per project, not in the database: they are how one person looks at a shared project, and no schema change was needed. The tray and the notes full page share the notes key; annotations have their own key.
- Collapsed is the default view, per the user's mid-round instruction. A note's chevron makes it the exception against the view; switching the view clears the exceptions. Pending notes never collapse (they are read before they are accepted); compare panes never collapse.
- The summary line is the note's first words (`markdownPreview`), not an AI summary: nothing new runs, and the line is the same every time.
- The id shown is the cuid's last six characters; the click copies that short form (what a person would type or say); the full id is in the tooltip and search matches either.
- Line breaks: a single newline typed in a note renders as a line break only in notes (`breaks` prop), so AI bubbles and chat keep standard markdown.
- "Save" became "Done" on the note editor: with auto-save the button only closes the editor, and the user called it Done. Cancel and Esc still restore the content from before the edit.
- Compare lives only on the notes full page, opened from the selection bar; its note set is component state (not the URL), its layout persists. Panes read from the live tree, so an edit in one pane shows at once.
- The jump on an edit row shows only while the edited block is still in the document; a note's jump goes to its first source that still resolves (each source chip still jumps to its own quote).
- Verified in a browser against a local Postgres (pgvector installed via apt) with a seeded project: collapsed default, Expand all, editor shape, search by `#id`, compare in both layouts with a third pane added, annotations collapsed and expanded, the edit jump flashing its paragraph, the note jump landing on its source. `tsc`, `eslint` on the changed files, and `next build` pass. No new dependencies.
- Pre-existing, not fixed: a React "unique key" warning from a child NotebookPage passes to Workspace (`src/app/n/[notebookId]/page.tsx`), outside this branch's files.
