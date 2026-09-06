# google-drive-import-connector-1h5tdi

**Intent:** Fix the Google Drive import of Docs, Sheets, and Slides ("This Drive file did not load"), give the Drive link full read access to the account's Drive, show the account's connections and stored data in Settings, let an add run on behind a hidden upload box with a running pill in the header, and open a document only once its scans and visuals are done.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260906140000_drive_scope/migration.sql` — `User.driveScope`: the scope Google granted with the refresh token; existing links backfilled as drive.file.
- `src/lib/drive/types.ts` — `DriveAccess` (all | picked), `DRIVE_SCOPES`, `driveGrant(scope)`, `driveAppId(clientId)` (the Cloud project number the Picker needs).
- `src/lib/drive/config.ts` — `GOOGLE_DRIVE_ACCESS` (default all); `DriveConfig` carries `access` and `grant`.
- `src/lib/drive/link.ts` — the link asks the configured scope, stores refresh token + granted scope, `clearDriveLink`; a grant without a Drive scope fails the link.
- `src/lib/drive/fetch.ts` — every fetch takes the grant; a picked-files grant refusing a file reports `api.driveNotPicked`.
- `src/lib/drive/picker-client.ts` — `setAppId` (the fix for the 404 behind "did not load"), scope by access, shared drives shown.
- `src/app/api/drive/import|token|link/route.ts` — grant-aware errors; unlink and revoke clear the scope too; `scans` flag.
- `src/lib/auth.ts`, `src/lib/account-reset.ts` — the new column on the local reader and on reset.
- `src/lib/account-data.ts`, `src/app/settings/page.tsx`, `src/components/settings-form.tsx`, `src/lib/i18n/dict/settings.ts` — Settings: Connections (sign-in, Google Drive with link / Link again for all files / Unlink) and Your data (every stored field and count).
- `src/components/reader/add-document-dialog.tsx`, `src/components/reader/document-bar.tsx`, `src/lib/i18n/dict/panes.ts` — the Drive tab says what the grant reaches; the running pill for a hidden upload box.
- `src/components/reader/upload-assistant.tsx` — hide while an add runs (✕, Escape, backdrop), come back on a failure; the finishing step (glossary, links, visuals) before the document opens; ingest requests carry `scans: "client"`.
- `src/app/api/documents/[documentId]/finish/route.ts`, `src/lib/finish.ts` — the finish plan (who runs the scans, which visuals to load) and the browser cache warming.
- `src/app/api/documents/route.ts`, `src/app/api/uploads/complete/route.ts` — the `scans` flag: the server skips its after() glossary and recommended-links scans when the box runs them.
- `src/lib/i18n/dict/api.ts`, `src/lib/i18n/dict/legal.ts`, `src/lib/legal.ts` — new messages; the privacy policy names the Drive token and the usage telemetry.
- `SPEC.md` (§6, §14, §15), `README.md`, `.env.example`, `.env.local.example` — docs for the scope choice, the settings sections, and the finishing step.

**Decisions:**
- Default access is `all` (drive.readonly), as asked; `GOOGLE_DRIVE_ACCESS=picked` narrows it. drive.readonly is a Google restricted scope: the consent screen must list it, and an unverified app shows Google's warning (100-user lifetime cap; Testing status expires grants after 7 days).
- The Picker's app id is derived from the OAuth client id's numeric prefix instead of a new env var.
- Old drive.file grants keep working for picked files; Settings and the Drive tab offer Link again for all files rather than treating them as unlinked.
- The finishing step runs the scans from the client (sequential calls to the existing glossary and connect routes) instead of lengthening the ingest request; conversion and transcription keep their server chains and the open does not wait on them.
- Visuals are warmed in the browser cache (6 at a time, 30 s each, 3 min budget) rather than stored server-side.
- The first-open reveal animation (SPEC.md §6) is unchanged.
- No tests exist in the repo; verified with `tsc --noEmit` (only the pre-existing generated `LayoutProps` error remains) and `eslint`.
