# r6-safe6

**Intent:** Fix REV6-01, REV6-02, REV6-05, REV6-06 and COST6-08: a Remove or Dismiss hides a link only in the project it was pressed in and always leaves a History row with Restore; the new-replies marks behave across tabs; the offline replay header only applies to a real queued replay; the page carries one document list.

**Files:**
- `src/lib/collab.ts`: `linkHideProjects` answers `[scope]` for a scoped removal of a link with no project (REV6-01); `editableHolders` loses its now-unused owner filter; `withoutOtherProjectLinkEdits` reads `meta.hiddenIn` before `meta.notebookId`.
- `src/app/api/links/[linkId]/route.ts`: a Dismiss that hides (not deletes) writes the LINK_REMOVE record with `meta.dismissed: true` (REV6-02).
- `src/app/n/[notebookId]/page.tsx`: History entries carry `dismissed`; one compact document list (`compactDocument`) passed to every prop that lists documents (COST6-08).
- `src/lib/types.ts`: `HistoryEntry.dismissed`.
- `src/components/collab/history-control.tsx`: row text "dismissed a recommended link" for a dismissed record; no new control.
- `src/lib/i18n/dict/panes.ts`: `historyLinkDismiss` en/zh.
- `src/components/graph/link-replies.tsx`: the link-seen store is written from effects only, re-read on the `storage` event, and pruned (`usePruneLinkSeen`) (REV6-05).
- `src/components/graph/graph-data.tsx`: calls `usePruneLinkSeen` with the graph answer's link ids.
- `src/lib/constants.ts`, `src/lib/offline/queue.ts`, `src/app/api/notes/route.ts`: the replay header carries the record's `queuedAt`; the server takes the keeping path only for a time in the last 30 days and answers a second replay of the same gathered note with the saved note (REV6-06).
- `src/lib/attached-document.ts` (new): the `AttachedDocument` type (moved from document-bar.tsx, re-exported there), `compactDocument`, `withDocumentDefaults`.
- `src/components/reader/workspace.tsx`: takes the compact rows and expands them once (useMemo).
- `src/components/reader/document-bar.tsx`: re-exports the type.
- `SPEC.md` §13 (Remove, Dismiss, History, new replies), §17 (replay header).
- Checks: `scripts/qa/link-remove-check.ts` (§6 REV6-01, §7 REV6-02), `link-scope-check.ts` (one-project hides), `gather-replay-check.mjs` (header forms, second replay), new `ui-link-seen.mjs`, new `attached-rows-check.ts`.

**Decisions:**
- A scoped Remove/Dismiss hides in the asking project alone (linkAccess already checked the caller edits it and it holds both documents). The owner's other projects keep the link; each project removes it on its own.
- History lists a removal in every project of `hiddenIn`, so round 5 rows that hid in two projects get a Restore in each.
- The restore of a dismissed link keeps it recommended (it comes back under Recommended links); its LINK_ADD says `restored` only, as for any Restore. The Edits panel still says "Link removed" for a dismissed record (left as is).
- REV6-05 prune: every mark of a link not in the graph answer when the answer is whole (holds the provenance links); otherwise only marks older than 90 days, since the lighter answer leaves out provenance links. The client-clock note in the review is not addressed.
- REV6-06: the header carries `queuedAt` (ms). "1" no longer counts: production never sent it (the header ships with PR #24). A client can still forge a recent time; the change makes the keeping path match a real queued record and makes replays idempotent, not unforgeable. Dedupe matches the account's note in the section with the same final content created at or after `queuedAt` (gathered notes only).
- COST6-08: rows leave out fields at their default and the workspace re-expands them, so no consumer changes how it reads a field (`=== null` checks stay correct).
