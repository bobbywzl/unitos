# claude/fervent-cerf-37ghyf

**Intent:** Let the reader start a blank document from the add-document dialog, opened straight into edit mode with the edit toolbar, so a document can be written in Unitos as in a Google Doc.

**Files:**
- `src/app/api/documents/blank/route.ts` (new): `POST {notebookId, title}` (editor) creates a document with no file and no source, one empty PARAGRAPH block with `originalText: ""`, attaches it, bumps the project, answers `{id, title}`.
- `src/components/reader/add-document-dialog.tsx`: `onCreateBlank` prop and the Blank document button, first in the row under the queue.
- `src/components/reader/document-bar.tsx`: `createBlank()` calls the route, closes the dialog, opens the document with `edit=1`; offline shows the read-only message.
- `src/components/reader/reader-interactions.tsx`: `edit=1` seeds edit mode on mount (editors only, never a transcript or an embedded layer) and focuses the first block.
- `src/components/reader/block-view.tsx`: an empty paragraph keeps a line's height in reading mode, so a double-click finds it.
- `src/lib/i18n/dict/panes.ts`: `blankDocument`, `blankDocumentTitle`, `untitledDocument`, en and zh.
- `SPEC.md` §15: the blank document.

**Decisions:**
- No upload box for a blank document: nothing to import or finish, so the dialog closes and the document opens at once.
- The title is "Untitled document" and edits in place through the existing document title; the dialog asks for nothing first.
- Edit mode from the URL instead of a new prop: `open()` rebuilds the query from scratch, so the flag does not follow the reader to the next document.
- Not verified in a running app: this container has no Postgres and no Docker. Typecheck and eslint pass.
