# SAFE (round 2): users never lose data or typed words

**Intent:** Fix REV2-01/02/03/04/06/07/08 and WALK2-01/08/10/12 from the round-2 audits: links with no project stay inside the accounts that own them, a deleted project's links stay hidden, the backfill hides no one's reply, and typed words and decisions on the graph are kept, shown at once, and undoable.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20261007120000_doclink_former_notebook/` — `DocLink.formerNotebookId` (nullable, index) and a BEFORE DELETE trigger on `Notebook` that copies the project id into it. Additive.
- `src/lib/collab.ts` — `linkAccess` (scoped legacy link: role in the scope + both ends attached; deleted project's link 404), `crossAccountLinks` / `crossAccountLink` / `linkOfOtherAccount` (the cross-account rule), `legacyLinkSharedAcrossAccounts` now goes through it; `withoutOtherProjectLinkEdits` reads `formerNotebookId`.
- `src/lib/link-scope.ts`, `src/lib/graph/stitch.ts` — reads skip `formerNotebookId` links.
- `src/app/api/replies/route.ts`, `src/app/api/replies/[replyId]/route.ts`, `src/app/api/links/[linkId]/route.ts`, `src/app/api/notes/route.ts` — the gates.
- `src/lib/types.ts`, `src/lib/graph/view.ts`, `src/app/n/[notebookId]/page.tsx` — `crossAccount` on link views; `documentsGraph(…, viewer)`.
- `src/components/collab/reply-thread.tsx` — reply drafts in localStorage, optimistic resolve/delete with rollback, `crossAccount` prop, `?notebookId=` on reply PATCH/DELETE for links.
- `src/lib/note-drafts.ts` — `readReplyDraft` / `writeReplyDraft`.
- `src/components/panels/annotations-panel.tsx`, `graph-overlay.tsx`, `graph-view.tsx`, `link-replies.tsx` — hide what an outside viewer may not change; optimistic Accept/Dismiss.
- `src/components/graph/graph-notes.tsx` (`restoreNote`, `findNote`), `graph-notes-list.tsx` (errors, Undo, Notes on the project, section-id keys), `src/lib/graph/notes.ts` (`projectNotes`), `link-note-composer.tsx` (queued line).
- `src/components/graph/stitch-box.tsx` — Retry keeps a newer command (one line); Show via the graph's `showNote`; `savedNote` on the turn.
- `src/components/assistant/save-as-note.tsx` — `saved` / `onSaved` props.
- `src/app/api/notes/organize/route.ts` — whole-block sources for a Stitch save with no resolved quote. `src/lib/notes/write-planned.ts`, `src/lib/prompts/organize.ts` — quotes cut to 30 (ENGINE2's report).
- `src/lib/i18n/dict/api.ts`, `graphNotes.ts` — en + zh strings. `SPEC.md` §6 replies, §13, §22.
- `scripts/backfill-doclink-notebook.mjs` — "kept for others" rule, skips deleted projects' links.
- `scripts/qa/link-cross-account-check.mjs`, `scripts/qa/ui-graph-safe.mjs` — verification.

**Decisions:**
- REV2-01 rule: a link with no project shared across accounts answers to its maker's projects (maker + editors of a maker's project holding both documents). Outsiders read it and keep control of their own replies; new replies from outsiders are refused (403). A null-maker link counts the owners of projects created before the link, only when that is one account; otherwise the link reads only for everyone. Single-account documents keep the old rules.
- REV2-02: a trigger instead of app code, so every delete path (account reset too) is covered.
- REV2-07: Show after a queued note finds the note by section + text + time once the page refreshes (no client id on POST /api/notes).
- REV2-08: Undo uses a direct PATCH status PENDING through the graph provider (`restoreNote`), not the tray's single-slot `undoReject`.
- WALK2-01: the whole-block fallback only for `origin: "stitch"`.
- stitch-box.tsx kept minimal for PR #23: the `savedNote` field on `Turn` and the Show change must survive its storage rewrite (map `savedNote` into its kept turn `data`).
