# intelligent-hopper

**Intent:** Track the onboarding funnel — which step each new visitor reaches on the way from the sign-in page to a subscription, and where they stop — and show it on an admin page as the app goes live.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260920100000_funnel_event/migration.sql` — `FunnelEvent`: one row per step a visitor reaches (visitor, account, step, time).
- `src/lib/funnel.ts` — the vocabulary: the eight steps in order, the five page steps, the retention.
- `src/lib/funnel-record.ts` — `recordFunnelStep`: writes one row with the request's visitor cookie; never throws.
- `src/lib/constants.ts`, `src/middleware.ts` — the visitor cookie (`dissect-visitor`, httpOnly, one year), set on the first page a browser opens; `/api/funnel` is a public door so the sign-in page posts signed out.
- `src/components/funnel-step.tsx`, `src/app/api/funnel/route.ts` — the page steps: the browser posts the step once per page open; the route validates it and refuses the server steps.
- `src/app/signin/page.tsx`, `src/app/page.tsx`, `src/components/reader/workspace.tsx`, `src/app/plans/page.tsx`, `src/app/billing/page.tsx`, `src/app/billing/order/[tier]/page.tsx` — mount the step mark: signin, dashboard, reader, plans (both pages), order.
- `src/lib/auth.ts` (account, when the email is new), `src/app/api/billing/checkout/route.ts` (checkout, when the Stripe session opens), `src/lib/billing/events.ts` (subscribed, when a subscription lands on an account that did not hold it) — the server steps.
- `src/app/admin/funnel/page.tsx`, `src/components/admin/admin-nav.tsx`, `src/lib/i18n/dict/admin.ts` — the admin funnel page: tiles, the waterfall, the furthest step reached, new visitors by day stacked by furthest step, the latest visitors; en and zh.
- `src/app/api/cron/cleanup/route.ts` — deletes funnel rows older than 365 days.
- `SPEC.md` §7, `README.md`, `CLAUDE.md`, `src/lib/i18n/dict/common.ts` — the funnel, step, and visitor terms.

**Decisions:**
- A visitor is a browser cookie, not a session: the sign-in page is visited signed out, and the cookie is what ties that visit to the account made later. The admin page joins the two from rows that carry both, so a visitor who signs in on a second device still counts once.
- The cohort is the visitors first seen in the window, all time considered, so a returning subscriber does not read as a visitor who stopped at the dashboard. Returning visitors are one tile.
- The page steps record from the browser, not from the server render: a prefetch or a crawler renders the page without running the effect, and the sign-in page is the one crawlers hit most.
- Subscribed records on the subscription's first landing, not on every event: the confirmation page and the webhook both apply the session, and renewals apply it again.
- The plan page (`/billing`) and the plans page (`/plans`) are one step: they do the same job in the funnel.
