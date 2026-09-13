**Intent:** The assistant's scopes become This page and Project (the scope across projects is gone), the assistant page gets History at its top right — a page listing every assistant conversation of the project, each linking back to the highlighted text it started from — and the recommended-links scan reads whole documents with project context and checks every link before storing it.

**Files:**
- `src/app/api/assistant/route.ts`: scopes `document` (This page, `documentId` required) and `notebook` (Project); the corpora scope removed.
- `src/lib/digest/render.ts`: `renderDocumentDigest` and `documentSystem` — one document from the project's digest, with its layers and the notes that cite it.
- `src/components/assistant/assistant-panel.tsx`: the two pills, This page default while a document is open, `documentId` sent at document scope.
- `src/components/reader/workspace.tsx`: History at the top right of the assistant page.
- `src/app/n/[notebookId]/assistant/page.tsx`, `src/components/assistant/assistant-history.tsx`: the assistant history page.
- `src/lib/connect.ts`, `src/lib/prompts/connect.ts`, `src/lib/derive/config.ts`, `src/app/api/documents/[documentId]/connect/route.ts`: whole documents, the reader's notes and background as context, the check pass, `CONNECT_EFFORT`, 300 s on demand.
- `src/lib/i18n/dict/assistant.ts`, `panes.ts`, `api.ts`: strings.
- `SPEC.md`: §7 and §13.

**Decisions:** This page reads the document from the digest (text, layers, citing notes), not the bare document prefix, so both scopes cite the same tags. The history page lists the reader's own conversations once sign-in is on, and tool conversations (Explain+ and the rest) beside the assistant's. The check keeps a pair's candidates when its call fails to answer: a failed call is no evidence against a link. Both connect passes stay at the default effort; "max" over a whole project outruns the request.
