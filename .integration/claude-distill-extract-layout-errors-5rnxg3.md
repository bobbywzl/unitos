# claude/distill-extract-layout-errors-5rnxg3

**Intent:** The Distill and Extract buttons float over the article instead of taking their own column, and the article's errors show under them with a Dismiss.

**Files:**
- `src/components/reader/reader-interactions.tsx` — the controls at the top right are a sticky block with no height plus an absolute row, not a float, so the text runs under them. `ArticleErrors` renders under the row in Normal view and under the pane header's buttons in a split view. `showError` toasts and logs a failure on the document; Distill and Extract run failures log too.
- `src/components/reader/article-errors.tsx` — new: the red triangle under the buttons while the document has errors; click lists them; Dismiss drops them.
- `src/lib/error-log.ts` — entries carry a `documentId`; `dismissErrors(documentId)` drops one document's entries.
- `src/components/reader/document-bar.tsx` — reports its errors on the open document, and re-parse errors on the re-parsed document.
- `src/components/reader/workspace.tsx` — the rail's error button is gone; the reader shows errors now.
- `src/lib/i18n/dict/panes.ts` — `errorsTitle` names the article; `errorsClear` is `errorsDismiss` ("Dismiss" / "关闭").

**Decisions:**
- Errors are per document. Errors with no document (none today) show nowhere; the rail button was removed rather than kept for that empty case.
- Reader failures that were toast-only now also land in the log, so the icon shows for every failure with the article, not only for parse and re-parse failures.
- Dismiss drops the entries; Clear-all is kept in the module for callers but no UI uses it.
