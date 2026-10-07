# r3-safe3

**Intent:** Fix round 3's data-safety findings: a link's Remove or Dismiss never deletes another account's replies or takes the link from another account's project (REV3-02), restore puts a restored project's links back (REV3-01), Dismiss and Remove hide where the server refuses (REV3-03), reply drafts are keyed by account (REV3-04), Show on a note with no document keeps the graph behind Back (WALK3-05), and each recommended card decides on its own (REV3-12).

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20261007140000_doclink_hidden/migration.sql`: new table `DocLinkHidden (docLinkId, notebookId, userId, createdAt)`, additive. FK to DocLink with cascade from the link to its hide rows only; `notebookId` has no FK, so a hide survives a project delete and restore.
- `src/app/api/links/[linkId]/route.ts`: DELETE deletes the row only when no other account replied and the link is not cross-account; otherwise it writes `DocLinkHidden` rows (`linkHideProjects`). LINK_REMOVE carries `meta.notebookId` = the asking project for a hidden link with no project.
- `src/lib/link-scope.ts`: `projectLinks(nb, { withHidden? })` leaves out links hidden in the project.
- `src/lib/collab.ts`: `linkAccess` answers 404 for a link hidden in the asking project (needs `id` on the link now); `linkHideProjects`; `CrossAccountLink.removable`.
- `src/lib/connect.ts`, `src/lib/graph/stitch.ts`: duplicate checks use `withHidden` so a removed link is not proposed again.
- `src/app/api/notes/route.ts`: Note on this link is 404 on a link hidden in the project.
- `src/lib/digest/fingerprint.ts`: hashes a project's hidden links only when it has some (no other fingerprint changes).
- `src/lib/types.ts`, `src/app/n/[notebookId]/page.tsx`, `src/lib/graph/view.ts`: `CrossAccountView.removable`.
- `src/components/collab/confirm-link-removal.ts` (new): the confirm on a link with replies, and `linkRemovable`.
- `src/components/graph/graph-overlay.tsx`, `graph-view.tsx`, `link-panel.tsx`, `src/components/panels/annotations-panel.tsx`: confirm before Remove/Dismiss on a link with replies; Dismiss/Remove hidden when not removable; per-card busy state (REV3-12).
- `src/lib/i18n/dict/panes.ts`: four confirm strings, en and zh.
- `src/lib/note-drafts.ts`, `src/components/collab/reply-thread.tsx`, `src/components/graph/link-note-composer.tsx`, `src/components/settings-form.tsx`: drafts keyed by account, legacy keys claimed, sweep covers reply and link-note drafts.
- `src/components/graph/graph-notes.tsx`: Show on a note with no document pushes the page without graph params and calls the leave path.
- `scripts/recover/restore-account.mjs`, `diagnose-account.mjs`: relink formerNotebookId links; report them and hidden links.
- `scripts/qa/ui-graph-safe3.mjs`: the UI checks.
- `SPEC.md` §12, §13, §22.

**Decisions:**
- REV3-02: hide instead of refuse. A refusal would stop the maker removing their own legacy link from their own project; hiding keeps every row and every other project's view, and the remover's workflow still works. The audit's 409 was the alternative.
- A link with no project is hidden in every project of the asking project's owner that holds both documents and that the caller edits (the projects a delete used to take it from, minus other accounts').
- A link with only the caller's own replies, not cross-account, is still deleted (after the confirm), with those replies.
- The server keeps the maker-only rule on a cross-account link (REV3-03 hides the buttons instead of relaxing the server).
- REV3-04: a legacy draft (no account in the key) is adopted by the first account that reads it, or by the account that signs out. A legacy draft left by a session that expired without Sign out can still be adopted by the next account once; there is no way to tell its owner.
- Note drafts and compose drafts (`unitos-note-draft:`, `unitos-note-compose:`) are not keyed by account in this change (older, outside the package).
