# claude/admin-account-reset-kkbp5p

**Intent:** Give admins a Reset account control on the admin pages that deletes an account's data and puts it back at onboarding, like a new account.

**Files:**
- `src/lib/account-reset.ts` — new. `resetAccount(userId)`: deletes the account's projects with everything under them, the documents only its projects held, its profile, digests, presence, memberships on other accounts' shared projects (those projects' rev bumps), sessions, pending email links, and Drive link (revoked at Google); clears picture, symbol, color, premium, and driveRefreshToken; stamps createdAt and lastSeenAt anew. Answers the counts of what went.
- `src/app/api/admin/accounts/reset/route.ts` — new. `POST /api/admin/accounts/reset` `{userId, confirm}`, admin-gated. confirm must equal the account's email (the local reader's id when sign-in is off): 404 for an unknown account, 400 for a mismatch.
- `src/app/admin/accounts/page.tsx` — new. The Accounts tab: every account (the local reader when sign-in is off) with picture, name, email, created and last seen dates, project, document, and note counts, Unitos Premium and Google Drive chips, and the Reset account control.
- `src/components/admin/account-reset.tsx` — new. Client control: Reset account opens a confirm panel (what the reset does, the email to type, Cancel, Reset enabled only when the typed email matches); the status line shows the counts; `router.refresh()` redraws the row.
- `src/components/admin/admin-nav.tsx` — the Accounts tab.
- `src/lib/i18n/dict/admin.ts`, `src/lib/i18n/dict/api.ts` — the page's strings and two error strings, en and zh.
- `src/components/works/welcome-flow.tsx`, `src/app/page.tsx` — the welcome splash's localStorage value is now `welcomeKey`, the account's id and createdAt (was "1"); the splash shows when the stored value differs. A reset account has a new createdAt, so it is welcomed again and the nudges restart.
- `SPEC.md` §6 and §7, `README.md` — the accounts page, and what the reset deletes and keeps.

**Decisions:**
- The account row stays: email, name, and password are kept, so the person signs in again the same way. Clearing the password would lock an email account out until a password reset. Picture, symbol, color, premium, and the Drive link clear; Google sign-in refills name and picture only when empty, so a cleared picture behaves like a new account's.
- Sessions are deleted: the account is signed out everywhere and comes back through /signin like a new account. Open tabs freeze with the account guard's notice.
- Documents: only a document that no other account's project holds and that no remaining note cites is deleted — the document DELETE route's rule. Others stay in the library.
- The account's work inside other accounts' projects (notes, replies, edits, links carrying its id) stays: it is the other project's record. Its memberships on those projects are removed, so the dashboard reads as new (the welcome splash needs zero shared projects).
- Usage telemetry (UsageEvent) is kept: cost accounting is the operator's record, not account data.
- Onboarding state lives in localStorage, which the server cannot clear. So the welcome splash keys on the account's id and createdAt, and the reset stamps createdAt anew. Side effect after deploy: an existing account with no project, whose browser holds the old "1" value, sees the splash and the nudges once more; accounts with a project see nothing. The per-browser hints (unitos-guide-seen, unitos-edit-hint) stay as they are — browser hints, not account state.
- The local reader (sign-in off) lists as the one account and can be reset (its data; there is no row). Its createdAt is constant, so its splash does not return after a reset — a limit of single-reader mode.
- No schema change: createdAt doubles as the onboarding key, so no migration this round.
- Verified on a local Postgres 16 (pgvector unavailable, so the vector column ran as bytea): seeded two accounts with a shared document, a document cited by the other account's note, video bytes, replies, edits, links, collaborator rows, sessions, digests, and usage; ran the route through next dev (401, 400, 404 paths, then the reset with the counts 2/1/3) and 36 database assertions; Playwright checks of the accounts page (confirm panel, disabled states, status line, dark theme) and of the welcome splash key on the dashboard. `tsc --noEmit`, `eslint`, and `next build` pass.
