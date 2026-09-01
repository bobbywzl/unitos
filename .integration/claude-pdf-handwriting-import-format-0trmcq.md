# claude/pdf-handwriting-import-format-0trmcq

**Intent:** Let a rough handwriting PDF import as its pages instead of forced computer text (instructions saying "do not convert" are honored), integrate Google Drive deeply (picks through the upload assistant, a durable Link Google Drive grant, pasted Drive links), and add the first-visit welcome flow, the Circle & ask guide emphasis, and the lasso highlight on pages.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260901150000_pages_import_drive_link/` — `ConversionStatus.OFF` (conversion deliberately off) and `User.driveRefreshToken` (the linked Drive grant).
- `src/lib/handwritten/classify.ts`, `src/lib/prompts/classify.ts` — a junk text layer (garbled handwriting-app output; ≥15% of characters in unbroken 25+ ASCII alphanumeric runs) no longer short-circuits to article; the vision judgment runs, keyless fallback says handwritten.
- `src/lib/parse/ingest.ts` — `IngestOptions.pages` (force the handwritten shape, no judgment) and `convert` (false stores OFF).
- `src/lib/upload-assistant.ts`, `src/lib/prompts/upload-instructions.ts` — the PDF instruction check returns `pdf: {pages, convert}` read out of the instructions; defaults on every fallback.
- `src/app/api/documents/route.ts`, `src/app/api/uploads/complete/route.ts` — accept the directives; conversion starts only on `conversionStatus NONE`; glossary/connections skip a handwritten document without converted text; pasted Drive links answer with a pointer instead of a parse failure.
- `src/app/api/drive/import/route.ts` — accepts instructions + directives, starts conversion for handwritten PDFs (was missing entirely), takes a bare `fileId` (metadata from Drive), and mints a token from the linked grant when no bearer token rides the request.
- `src/lib/drive/types.ts` — Drawings exportable; `parseDriveFileId` for pasted links. `src/lib/drive/fetch.ts` — metadata fetch.
- `src/lib/drive/link.ts`, `src/app/api/drive/link/`, `src/app/api/drive/token/`, `src/lib/constants.ts`, `src/lib/auth.ts`, `src/lib/drive/config.ts`, `src/lib/drive/picker-client.ts` — the Link Google Drive code flow, mint/revoke, state cookies, linked-aware config and picker.
- `src/components/reader/upload-assistant.tsx` — the `drive` request kind (Drive picks open the box; instructions + directives ride each import) and directive threading on every PDF add.
- `src/components/reader/document-bar.tsx`, `src/components/reader/add-document-dialog.tsx` — Drive picks hand off to the box; pasted Drive links import through the linked grant or point at the Drive tab; the Link Google Drive affordance.
- `src/app/settings/page.tsx`, `src/components/settings-form.tsx` — the Google Drive section (link / unlink).
- `src/components/reader/conversion-strip.tsx` — OFF renders the Convert to text offer, no auto-fire.
- `src/app/api/annotations/route.ts`, `src/components/reader/page-block.tsx`, `src/components/reader/hues.ts`, `src/app/n/[notebookId]/page.tsx`, `src/components/reader/reader-interactions.tsx` — the lasso highlight: color dots on the Circle & ask card, page highlights stored as colored notes, marks painted in their color; the highlight hues moved to one shared module.
- `src/components/works/welcome-flow.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/components/reader/workspace.tsx`, `src/components/guide-dialog.tsx` — the welcome screen (fade in/out), the first-steps card, the pulsing ? nudge, the emphasized Circle & ask guide section.
- `src/components/logo.tsx`, `src/app/signin/page.tsx` — the mark takes a CSS size and cover fit; the /signin watermark covers the whole page.
- `src/lib/i18n/dict/*` — en/zh strings for all of the above; glossary comment extended.
- `SPEC.md` — §6, §14, §15, §16 amended.

**Decisions:**
- The "do not convert" state is a `ConversionStatus` value (OFF), not a new column — one state machine, and the strip's auto-fire keys off NONE alone.
- Junk detection counts only unbroken ASCII alphanumeric runs, so spaceless CJK text never trips it; threshold 15%.
- The PDF directives travel as typed fields set by the instruction check (deterministic at ingest), rather than ingest re-reading the instructions — keyless fallbacks keep today's behavior.
- Drive linking stores a `drive.file` refresh token on the account (same OAuth client as sign-in); the local reader keeps the per-visit grant since it has no account row.
- A pasted Drive link on an unlinked account gets a pointer to the Drive tab, not an auto-opened picker — the token request needs a user gesture.
- The welcome flow gates on "no project yet" plus localStorage, so existing accounts never see it; storage-unavailable browsers skip it rather than loop it.
