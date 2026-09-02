# claude/feedback-replies-notifications-md0rlm

**Intent:** Let the admin reply to feedback and deliver the reply to the account that sent it as a notification; give the admin digest page one scroller per account; make the admin clicks page report the AI tools, notes functions, and annotation types instead of every control; and render the guide's side panel tabs as cards like the tools (the last three added mid-round).

**Files:**

Replies to feedback (SPEC.md §18)
- `prisma/schema.prisma`, `prisma/migrations/20260902140000_feedback_reply/migration.sql` — `Feedback.userId` (the account that sent it, null = signed out), `Feedback.replies`; `Notification.feedbackId` with an index and a SetNull relation; kind `"feedback"` in the Notification comment.
- `src/app/api/feedback/route.ts` — records `userId` from `currentUser()`.
- `src/app/api/admin/feedback/route.ts` — `POST` = Reply: one Notification of kind `feedback` (title the feedback's message on one line, body the reply, `feedbackId`) with one recipient; 400 when the feedback has no account or one the recipient list does not know; new feedback turns seen.
- `src/lib/notifications.ts` — `TITLE_MAX`, `feedbackReplyTitle`.
- `src/app/api/admin/notifications/route.ts` — the title cap reads `TITLE_MAX`; the composed kinds stay `update | account`.
- `src/app/admin/page.tsx`, `src/components/admin/feedback-inbox.tsx` — each feedback names the account that sent it, lists its replies with whether the account dismissed each, and carries Reply with an inline form; "No account to notify." replaces Reply where there is none.
- `src/app/page.tsx`, `src/components/works/notifications.tsx` — the dashboard card of a kind `feedback` notification reads "Reply to your feedback", the feedback's message (from the Feedback row; the title stands in when the row is gone), then the reply.
- `src/components/notification-kind.tsx`, `src/components/admin/notifications.tsx` — `NOTIFICATION_KINDS` holds every kind, `COMPOSED_KINDS` the two the notifications page composes; the chip shows "Feedback".
- `src/lib/auth.ts` — the first account to sign in adopts the local reader's feedback and notification recipient rows with the rest of its data.
- `src/lib/i18n/dict/admin.ts`, `api.ts`, `common.ts`, `works.ts` — the reply strings, en and zh.
- `SPEC.md` §18, `README.md`.

Digest page
- `src/components/admin/digest-store.tsx` — each account is one scroller (`max-h-[75vh]`, its own scrollbar, header pinned at the top); an account with no projects says so inside its box. `SPEC.md` §7.

Clicks page (SPEC.md §7)
- `src/lib/clicks.ts` — `CLICK_GROUPS` (`ai`, `notes`, `annotations`), the control ids of each, `clickGroupOf`.
- `src/app/admin/clicks/page.tsx` — tiles per group, daily uses by group, one list per group, a table of every function, uses per account by group; general controls stay off the page.
- `src/components/reader/reader-interactions.tsx`, `src/components/reader/page-block.tsx`, `src/components/assistant/assistant-panel.tsx` — ids carry the type or source: `highlight:<color>`, `annotation-recolor:<color>`, `page-highlight:<color>`, `assistant-ask:<scope>`.
- `src/lib/i18n/dict/admin.ts` — the clicks page strings; the surface labels and the per-surface strings are gone with their last caller.

Guide dialog
- `src/components/guide-dialog.tsx`, `src/lib/i18n/dict/works.ts` — the side panel section is one card per tab (Notes, Assistant, Distill, Summary, Annotations, Edits), the same card as the tools; the body strings stand alone.

**Decisions:**
- A reply is a Notification, not a new table: delivery, the dashboard card, Dismiss, the sent list, and Delete come with it, and the reply points back at the feedback through `feedbackId`. The notifications page cannot compose kind `feedback`; only Reply makes one.
- Feedback filed signed out (or before this change) has no account, so it cannot be replied to; the inbox says so instead of hiding the fact.
- Replying marks new feedback seen; Resolve stays a separate step.
- The digest page keeps every account on one page (boxes stacked) rather than a per-account picker: "per user scroller" read as one scroll box per account.
- The clicks page filters at display time; every control still records, so the vocabulary can widen later without losing history. Ids that meant navigation (opening a tab, a composer, a dialog) count as general; the saves and runs count as uses. `close-link` is the click that completes a link, so it counts as an annotation.
- The vocabulary lives in `lib/clicks.ts` next to the surfaces, one place for the client, the route, and the page.
- Highlight, recolor, page-highlight, and the assistant's Ask now carry the color or scope in the id. Older rows keep the bare id and still fall in their group by prefix match only where the id had a colon; a bare `highlight` row from before this change does not match and stays off the page.
