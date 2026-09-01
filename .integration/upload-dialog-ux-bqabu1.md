# upload-dialog-ux-bqabu1

**Intent:** Replace the small menu under the + button with a dedicated centered dialog: the upload types span the top panel as tabs, the upload space sits under them, and an assistant conversation option sits at the bottom (the assistant's purpose ships in a future commit).

**Files:**

- `src/components/reader/add-document-dialog.tsx` — new: the centered dialog. Tab row spanning the top (Upload PDF, Upload video or audio, Add URL, Library); the upload space for the chosen type under it — a dashed choose area for PDF and video plus the YouTube-link form, the URL form with a hint, the library list; the progress card replaces the space while an ingest runs; the assistant section at the bottom with a disabled composer. Escape, backdrop click, and ✕ close it. Owns the `LibraryDocument` type (moved from document-bar).
- `src/components/reader/document-bar.tsx` — the + opens the dialog instead of the dropdown; the dropdown JSX, `menu` state, its outside-click effect, and the `url`/`videoUrl` state moved into the dialog. `ingestFromUrl`, `uploadFiles`, and `attach` close the dialog when the document lands. The bar's floating progress card and error line render only while the dialog is closed — open, the dialog shows both. `openLibrary` only fetches (the dialog's Library tab calls it); `panes.back` and its Back buttons are gone (tabs replace them).
- `src/components/reader/ingest-progress.tsx` — `inline` prop: same card rendered in flow instead of floating fixed, for the dialog's upload space. Callers without the prop are unchanged (`share-add.tsx`, the bar).
- `src/lib/i18n/dict/panes.ts` — new keys en+zh: `choosePdf`, `pdfHint`, `urlHint`, `uploadAssistantHint`, `uploadAssistantSoon`; removed the now-unused `back`.

**Decisions:**

- The assistant conversation option renders as a real composer (input + Send) that is disabled, with the hint "Talk with the assistant about the documents you add." and placeholder "Coming soon". The task says the assistant's purpose is specified in future commits, so the space is reserved without inventing behavior; a dead-looking enabled input or a fake reply seemed worse. Not wired to `/api/assistant`.
- While an ingest runs with the dialog open, the progress card renders inline inside the dialog's upload space (the dialog is the dedicated upload window); drag-drop, re-parse, and share-target ingests with the dialog closed keep the floating card.
- Choosing files keeps the dialog open (progress then shows inside it); the old menu closed before the picker. Success closes the dialog and opens the document; failure keeps it open with the error line and the typed URL intact.
- Tabs use `flex-auto` so the row spans the top panel without truncating "Upload video or audio".
- Errors raised while the dialog is open (invalid video link, upload failure) show inside the dialog; the bar's error line is suppressed while it is open to avoid the same message twice.
- Verified in the running app (local Postgres + Playwright): open/close, all four tabs, a PDF upload end-to-end with the inline progress card, the invalid-video-link error, Escape.
