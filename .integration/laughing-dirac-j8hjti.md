**Intent:** Block and unblock emails from the admin accounts page, so the operator can keep a block list.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260915140000_blocked_email/migration.sql`: the `BlockedEmail` table, one row per blocked email.
- `src/lib/block.ts`: `emailBlocked`, `blockedEmails`, `blockEmail` (adds the row, deletes the account's sessions and pending email links), `unblockEmail`.
- `src/lib/auth.ts`: `signIn`, `passwordLogin`, `startEmailConfirmation`, `startPasswordReset`, `resetPassword` refuse a blocked email.
- `src/app/api/auth/callback/route.ts`, `apple/callback/route.ts`, `email/confirm/route.ts`, `email/start/route.ts`, `password/login/route.ts`, `test-login/route.ts`: land on `/signin?error=This email is blocked` (the test door answers 403).
- `src/app/signin/page.tsx`, `src/lib/i18n/dict/signin.ts`: the error string in both languages.
- `src/app/api/admin/accounts/block/route.ts`: `POST { email, blocked }`, admin-gated.
- `src/components/admin/block-control.tsx`: `BlockButton` on each account card; `BlockList` above the accounts with every blocked email, Unblock, and a form to block an email with no account.
- `src/app/admin/accounts/page.tsx`: the block list, the Blocked chip, the button per account.
- `src/lib/i18n/dict/admin.ts`, `src/lib/i18n/dict/common.ts`: the strings and the zh glossary terms (block 封禁, unblock 解封, block list 封禁名单).
- `SPEC.md`, `README.md`: the block list in §2 and the admin accounts page paragraph.

**Decisions:**
- The block keys on the email, not the account: an email with no account can be blocked, and Reset account does not clear a block. Whitelist = not on the block list; there is no allowlist mode (only listed emails may sign in).
- No per-request check in `currentUser`: blocking deletes the sessions, and every sign-in door refuses the email, so a blocked account cannot hold a session.
- The blocked person sees "This email is blocked" on the sign-in page, rather than a generic failure.
