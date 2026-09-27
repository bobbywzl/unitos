# claude/kind-ramanujan-g9cu3t

**Intent:** Make the admin cookie unforgeable: sign it with an HMAC keyed by `SESSION_SECRET` (when set) and `ADMIN_PASSWORD`, and verify it in constant time in the middleware, `isAdmin()`, and `adminApiGuard()`, so a forged `admin-auth=true` no longer opens `/admin`.

**Files:**
- `src/lib/admin-cookie.ts` (new): the admin cookie's name, its 24-hour lifetime, `signAdminCookie`, and `verifyAdminCookie` (HMAC-SHA-256 over the expiry with Web Crypto, a constant-time compare, the expiry check; `ADMIN_PASSWORD` unset: false). Web Crypto only, so the edge middleware can import it.
- `src/lib/admin-auth.ts`: `isAdmin()` verifies the cookie; `adminApiGuard()` calls `isAdmin()`. `ADMIN_COOKIE` moved to `lib/admin-cookie.ts`.
- `src/middleware.ts`: the admin gate verifies the cookie instead of comparing it to `"true"`; `middleware` and `gate` are async.
- `src/app/api/admin/auth/route.ts`: sign-in sets the signed value; the password compare is constant time (SHA-256 of both sides, `timingSafeEqual`). The flags, the 503 when the password is unset, and `DELETE` are unchanged.
- `scripts/qa/admin-gate.ts` (new): the gate's checks against a running app (forged, made-up, stale, expired, and changed values refused; a real sign-in opens `/admin` and `/api/admin/feedback`; sign-out clears the cookie).
- `SPEC.md` §2: the admin cookie.

**Decisions:**
- The key is `SESSION_SECRET` (empty when unset) and `ADMIN_PASSWORD` joined, not `SESSION_SECRET` alone: a new password must make old cookies fail, and `SESSION_SECRET` keeps a leaked cookie value from being used to guess a weak password offline. A new `SESSION_SECRET` also signs the admin out.
- One check for both runtimes (Web Crypto and a hand-written constant-time compare), not `node:crypto` on the server and Web Crypto in the middleware, so the two cannot drift apart.
- Stateless: sign-out clears the browser's cookie, but a copied value stays valid until its 24-hour expiry or a password change. Revoking one value on the server would need a stored list; not done.
- The login's password compare was `!==`; it is now constant time. Not asked for, but the password is the one way in once the cookie is signed.
- No QA script set `admin-auth=true`. `scripts/qa/ui-clicks.mjs` already signs in through the login form with `ADMIN_PASSWORD`, so it is unchanged.
- `src/middleware.ts` keeps its name. Next 16 warns that the file convention is deprecated in favor of `proxy.ts`; that rename is a separate change.
