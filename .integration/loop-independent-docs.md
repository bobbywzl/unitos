# loop/independent-docs

**Intent:** Make every new document added to any project its own entity (Linda, 2026-10-07): no add reuses a stored document; a repeat add of the same file or source asks first and points at Re-parse document; the Library lists only documents in no project; the attach route takes only a Library document or an Add back.

## Migration

`prisma/migrations/20261007100000_youtube_id_not_unique` — must run in production before the deploy (`prisma migrate deploy`). It drops only the unique index `VideoAsset_youtubeId_key` and creates the plain index `VideoAsset_youtubeId_idx` (`IF EXISTS` / `IF NOT EXISTS`). No column or row changes. Without it a second YouTube add of the same video fails on the unique index.

## Files

- `src/lib/parse/ingest.ts` — removed `dedupeByHash`, `UNEDITED`, `heldByOtherAccount`, the five hash lookups (PDF, Markdown, Word, slides, sheets), and `ingestUrl`'s sourceUrl reuse, split-part reuse, and stale in-place re-parse. Comments only otherwise. No parser behavior changes. `deduped: false` stays in the returns so the routes' answers keep their shape.
- `src/lib/video/ingest-youtube.ts`, `src/lib/video/ingest-media-url.ts` — removed the youtubeId, sourceUrl, and fileHash reuse.
- `prisma/schema.prisma` — `VideoAsset.youtubeId` loses `@unique`, gains `@@index([youtubeId])`; fileHash / pdfPages comments.
- `prisma/migrations/20261007100000_youtube_id_not_unique/migration.sql` — the index swap above.
- `src/lib/documents/duplicates.ts` (new) — the one "already has" check: the account's documents (in a project it owns or collaborates on, or in no project with its trace via `ownTrace`; sign-in off: every document) with the same fileHash (+ a PDF's chosen pages), sourceUrl (+ split parts), or YouTube id. `duplicateAnswer` (the 409) and `assertNotDuplicate` (in-stream throw).
- `src/lib/documents/duplicate-answer.ts` (new) — shared, client-safe: `DuplicateMatch`, `duplicateOf` (Zod parse of a 409 body or a stream's last line), `DuplicateDocumentError`.
- `src/lib/ingest-response.ts` — a `DuplicateDocumentError` thrown in the stream ends it with `{error, duplicate}`.
- `src/app/api/documents/route.ts` — `confirmDuplicate` (form field "1" / JSON boolean); the ask before multipart files (after an image wraps to its PDF), YouTube, media URL, and page URL. GET (the Library) lists only `ownTrace` documents (sign-in off: documents in no project).
- `src/app/api/uploads/complete/route.ts` — `confirmDuplicate`; the ask for chunked PDFs/files (after assembly and image wrap) and chunked video; the 409 keeps the staged chunks so the confirmed retry completes the same uploadId; the old video reuse (attach existing) removed.
- `src/app/api/drive/import/route.ts` — `confirmDuplicate`; Drive media asks before the download (409, sourceUrl = the download URL); every other Drive file asks once its bytes are here (stream's last line).
- `src/app/api/notebooks/[notebookId]/documents/route.ts` — attach allows only a document in no project with the caller's trace, or a document this project held before (DOCUMENT_DETACH event); a document already here is a no-op; in another project → 409, else 403.
- `src/lib/i18n/dict/api.ts` — `duplicateDocument`, `attachNotInLibrary` (en, zh).
- `src/lib/i18n/dict/panes.ts` — the ask's copy (`duplicateTitle`, `duplicateWhere`, `duplicateWhereMore`, `duplicateInLibrary`, `duplicateAsk`, `duplicateAddAgain`, `duplicateOpen`) and `libraryEmpty` (replaces `noOtherDocuments`), en and zh per the zh glossary.
- `src/components/reader/duplicate-ask.tsx` (new) — the one ask: `DuplicateAsk` (words and buttons), `DuplicateAskDialog` (modal, Escape/outside = Cancel), `useDuplicateAsk` (promise), `throwIfDuplicate`, `readDuplicate`.
- `src/components/reader/upload-assistant.tsx` — phase `duplicate` shows the ask in the box; `addAsking` wraps every add (files, links, Drive picks); chunked uploads split into `stageChunks` + `completeChunked` so Add again re-posts only the completion; one-request files resend from the browser's File; `OpenTarget.notebookId` for Open the one I have; an add whose ask ended in Cancel/Open counts as neither added nor failed.
- `src/components/reader/document-bar.tsx` — the ask for a pasted link (`ingestFromUrl`, the `dissect:add-document-url` event) and a pasted Drive link (`importDriveLink`); `openTarget` opens a match here, in its project, or (in no project) attaches it like a Library pick.
- `src/components/share-add.tsx` — the share page asks too (URL and staged file).
- `src/lib/offline/queue.ts` — a queued add answered 409 duplicate is kept, marked `held`, and skipped by the drain; `heldAdds`, `answerHeld`, `QUEUE_HELD_EVENT`.
- `src/components/offline/queue-sync.tsx` — shows the ask for held queued adds on any page (and on every page load until answered).
- `src/components/reader/add-document-dialog.tsx` — the Library's empty state key.
- `SPEC.md` — §2 Markdown/stale-parse lines, §3 fileHash and youtubeId comments, §8 Phase 3 "Done when", §11 YouTube and "Done when", §14 provenance, §15 Library button, the new "Every add is its own document" paragraph, the range step line, Remove from this project, History's Add back, the image line, §27 slides/sheets, §27 QA line, §30 shared imports and the dedupe bullet, §30 re-parse silent runs.
- `scripts/qa/ui-office.mjs`, `scripts/qa/ui-imports.mjs` (R9), `scripts/qa/import-compare.mjs` — the dedupe checks become ask-then-confirm checks; import-compare always confirms.

## Decisions

- **`deduped` kept, always false.** The ingest functions and routes still return `deduped: false` (and the routes' `if (!deduped)` guards stay) to keep `lib/parse` edits minimal and the answer shape stable. Removing the field is a follow-up.
- **PDF chosen pages count.** The ask matches a PDF by its bytes and its chosen pages (§30's rule that the same file with other pages is another document): a different page range adds without asking.
- **Image adds** hash the wrapped one-page PDF (what is stored), so a re-added image asks too.
- **Drive non-media files ask at the end of the stream** (`{error, duplicate}` on the last line), since the hash is known only after the download; Add again downloads again. A Google Doc's export may differ byte for byte between exports, so a re-picked Doc may not be recognized. Drive media asks before the download (its sourceUrl is stable).
- **Media URL** is matched by sourceUrl only (before download); the old after-download fileHash reuse is gone, not turned into an ask (it would cost a second download).
- **Open the one I have on a document in no project** attaches it to this project (a Library pick), since a document in no project cannot open otherwise.
- **Which match is named:** a match in this project first, then the newest; it names this project when it holds it, else one project the account can open, else "your Library". "and N more" counts the other matches.
- **In the upload box the ask replaces the progress** (one component, the same copy as the dialog); ✕/outside hide the box and the ask waits, like the range step. Elsewhere it is a dialog over the page.
- **Cancel in the box** after Continue: the queued link/file leaves the dialog's queue (the reader chose Cancel). A pasted Drive link's Cancel leaves the add dialog open with the link in its box.
- **Offline: keep the queued item and ask on the page** (not invasive): the record stays in IndexedDB marked `held`, the drain passes over it, QueueSync shows the ask after the drain and on every page load until answered. Add again re-queues it with confirmDuplicate (uploads replay from their stored bytes; staged chunks of the 409 are not reused). Cancel and Open take it out. Held records still count in the offline pill.
- **Abandoned staged chunks** (a chunked add whose ask ended in Cancel/Open) are left to the existing one-day sweep in `/api/uploads`.
- **Attach status codes:** 409 when the document is in another project, 403 when it is in no project without the caller's trace. A document already in this project answers 201 and changes nothing (idempotent, as before).
- **Library with sign-in off** lists every document in no project (the single reader).
- **`importShared`** (Viewing-only shared imports) is unchanged: it still applies to documents linked to several accounts' projects before this change.
- **`scripts/recover/diagnose-account.mjs`** keeps its comment about the old dedupe (it diagnoses rows made under the old rule).

## Checks

- `npx tsc --noEmit`: clean outside `.next/`.
- `npx eslint` on every changed .ts/.tsx: 0 errors; 1 warning in document-bar.tsx (`closeList` dependency at the list's pointerdown effect) that predates this branch.
- Browser (headless Chromium, own dev server on :3142, migration applied to the local DB), projects made through the app: "Indep docs check" (A), "Indep docs check 2" (B), "Indep docs check 3" (C). Screenshots in `.qa-tmp/indep/` (not committed):
  - a. `a1-ask-markdown-in-B.png` (the ask in B), `a2-B-own-document.png` (Add again: a second Document, own id and 4 blocks), `a3-A-note-and-highlight.png`, `a5-B-delete-confirm.png` ("It is in this project only."), `a6-A-intact-after-B-delete.png` (A's document, note, and highlight intact; 2 sources kept).
  - b. `b1-url-ask.png`, `b2-url-cancel-nothing-added.png` (count stays 1), `b3-url-open-the-one-i-have.png`.
  - c. `c1-pdf-chunked-ask.png`, `c2-pdf-second-document.png`: a 5 MB PDF through the chunked path; the 409 kept 2 staged chunks, Add again posted only `/api/uploads/complete` with confirmDuplicate, 2 documents with the same hash, 0 chunks left.
  - d. `d1-different-file-no-ask.png`; `d2-two-files-asks-for-the-repeat-only.png`, `d3-two-files-third-added.png` (two files dropped together: one ask for the repeated file, Cancel, the new file added).
  - e. `e0-library-before.png` (empty state), `e1-delete-project-B-confirm.png`, `e2-library-lists-documents-in-no-project.png`, `e3-library-pick-attached.png`, `e4-library-in-C-without-A-documents.png`; the attach route answered 409 for A's PDF and A's page into C; GET /api/documents listed 0 documents that are in a project.
  - f. `f1-shared-doc-opens-in-A.png`, `f1-shared-doc-menu-in-A.png`, `f2-shared-doc-opens-in-C.png`, `f2-shared-doc-menu-in-C.png` (a document linked to A and C by SQL opens in both; Remove from this project enabled in both), `f3-history-add-back.png`, `f4-added-back-in-C.png` (Remove in C, then History's Add back: the attach route allowed it).
  - g. `g1-offline-add-held-asks.png`, `g2-offline-held-ask-after-reload.png`: a URL add queued offline came back 409, stayed queued (held), the ask showed after the drain and again after a reload; Add again added it and emptied the queue.
- Cleanup: deleted through the app's routes the 7 documents and projects A and C (B was deleted from the dashboard during e.); none of them remain, and no document in no project is left.
