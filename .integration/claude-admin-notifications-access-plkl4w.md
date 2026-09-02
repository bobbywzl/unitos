# claude/admin-notifications-access-plkl4w

**Intent:** Admin page change 3 — a notifications tab where the admin sends a notification (an update to Unitos, or a change made to an account) to every account or to chosen ones; it shows on each recipient's dashboard until dismissed. The admin picks recipients from names and emails and cannot open or change an account.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260902120000_notifications/migration.sql` — `Notification` (one per send: kind, title, body) and `NotificationRecipient` (one per account it went to: `dismissedAt`), cascade on delete.
- `src/lib/notifications.ts` — `recipientAccounts()`: the admin's whole view of accounts (id, name, email); the local reader when sign-in is off.
- `src/app/api/admin/notifications/route.ts` — POST sends (Zod: kind, title, body, recipients "all" or ids; unknown ids drop, none left = 400), DELETE removes a send for every recipient. Admin-gated; never reads a session or writes a User row.
- `src/app/api/notifications/[notificationId]/route.ts` — PATCH `{dismissed: true}` stamps `dismissedAt` on the signed-in account's own row; another account's answers 404.
- `src/app/admin/notifications/page.tsx`, `src/components/admin/notifications.tsx` — the page: composer (kind chips, title, body, Every account / Chosen accounts with a filter and checkboxes, Send), then every send newest first with its recipient count, dismissed count, recipient names, and Delete.
- `src/components/admin/admin-nav.tsx` — the fourth tab.
- `src/components/notification-kind.tsx` — the kind chip and its label map, shared by the admin page and the dashboard.
- `src/app/page.tsx`, `src/components/works/notifications.tsx` — the dashboard lists the account's open notifications above Projects (kind, date, title, markdown body, Dismiss).
- `src/lib/i18n/dict/admin.ts`, `works.ts`, `common.ts`, `api.ts` — en and zh strings; the glossary gains account 账户, notification 通知, recipient 收件人, dismiss 关闭, update 更新, account change 账户变更.
- `SPEC.md` (§18 Notifications, one sentence in the §2 Auth bullet), `README.md` (feature bullet).

**Decisions:**
- Two tables (send + recipient) instead of one row per recipient: the admin list needs per-send counts and Delete needs one id; the recipient row keeps its own `dismissedAt`.
- Dismissed rows stay so the admin's dismissed count holds; only the admin's Delete removes rows. No cron cleanup.
- In-app only, no email copy: Resend is configured for sign-in links, and a per-recipient send loop would hit request timeouts on large lists.
- Notifications show on the dashboard only, not inside a project; a reader who opens a project link directly sees them on the next dashboard visit.
- The body is markdown (the existing `Markdown` component), so a notification can link to Settings or the guide.
- The kind is fixed to `update` | `account`, mirroring the two purposes in the request; both render as a chip.
- With sign-in off the local reader is the one recipient, labeled "Local reader" like the digest page.
- Verified against a local Postgres 16 + pgvector: all 38 migrations apply on a fresh database, `prisma migrate diff` from the database to the schema is empty, `next build` and lint pass, and two curl smoke runs (sign-in off: 22 checks; sign-in on with two accounts: 19 checks) pass — send, dashboard render, recipient-only dismiss (401 signed out, 404 other account), counts, delete, validation, zh, and the User table untouched.
