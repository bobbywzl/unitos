# claude/zen-goodall-i7r803

**Intent:** Build the payment pipeline for Unitos Premium and Unitos Ultra through Stripe, on its own pages under `/billing` (plan page, order page, Stripe Checkout, confirmation page, receipts), off until the admin billing page turns it on; the app's links to it stay hidden until then.

**Files:**

- `prisma/schema.prisma`, `prisma/migrations/20260912120000_billing/migration.sql` — `User.stripeCustomerId`, `subscriptionId`, `subscriptionTier`, `subscriptionEndsAt`; the `Purchase` model (one row per paid invoice); the `AppSetting` model (the switch row `billing`; no row = off).
- `src/lib/settings.ts` — read and write one `AppSetting` row.
- `src/lib/billing/config.ts` — the four `STRIPE_*` values, tier slugs, price-to-tier lookup.
- `src/lib/billing/stripe.ts` — the Stripe client, once per process.
- `src/lib/billing/switch.ts` — `billingOn`, `setBillingOn`, `billingView` (404 unless on or admin preview), `billingUsable`, `billingLinks`.
- `src/lib/billing/plans.ts` — the two prices read from Stripe, cached five minutes.
- `src/lib/billing/checkout.ts` — the Stripe customer, Checkout session, billing portal session.
- `src/lib/billing/events.ts` — what a Stripe event does to an account; one idempotent path for the webhook and the confirmation page.
- `src/lib/billing/format.ts` — money, dates, the price line, the renewal line.
- `src/app/api/billing/checkout/route.ts`, `portal/route.ts`, `webhook/route.ts` — Pay, Manage subscription, the Stripe webhook.
- `src/app/api/admin/billing/route.ts` — the switch; On refused with the reason until Stripe is ready.
- `src/app/billing/layout.tsx`, `page.tsx`, `order/[tier]/page.tsx`, `confirmed/page.tsx`, `receipts/page.tsx`, `receipts/[id]/page.tsx` — the billing pages.
- `src/app/admin/billing/page.tsx`, `src/components/admin/billing-switch.tsx`, `src/components/admin/admin-nav.tsx` — the admin billing page and its tab.
- `src/components/billing/plan-card.tsx`, `pay-button.tsx`, `portal-button.tsx`, `print-button.tsx` — the shared pieces of the billing pages.
- `src/app/page.tsx`, `src/app/settings/page.tsx`, `src/components/settings-form.tsx` — the Plans, Receipts, and Manage subscription links, shown only while billing is on.
- `src/components/collab/collab-context.tsx`, `src/app/n/[notebookId]/page.tsx`, `notes/page.tsx`, `multi/[multiId]/page.tsx`, `src/components/reader/reader-interactions.tsx` — `CollabState.billing`; the Ultra message in the reader carries a Plans action while billing is on.
- `src/middleware.ts` — `/billing` and `/api/billing/webhook` are public doors.
- `src/lib/auth.ts` — the local reader's new columns.
- `src/lib/i18n/dict/billing.ts`, `dictionaries.ts`, `dict/admin.ts`, `dict/api.ts`, `dict/common.ts` — the strings, en and zh, and the glossary terms.
- `package.json`, `package-lock.json` — `stripe`.
- `SPEC.md` (§24), `TIERS.md` (Billing section, the 2026-09-12 decision), `.env.example`, `README.md` — the docs.

**Decisions:**

- Subscriptions, not one-time payments: a tier is ongoing. One Stripe price per tier; the interval is whatever the price says, so monthly or yearly is a Stripe setting, not code.
- Prices live in Stripe only. The pages read them; nothing is priced in code or docs.
- The switch is a database row, not an env var, so the operator turns billing on from the admin page without a deploy. Off, the pages 404 and the links vanish; the admin cookie sees the pages as a preview with a banner.
- The tier gates keep reading `User.tier` and `User.trialEndsAt`; the Stripe events write them. An ended subscription writes Premium until the paid period's end, expired after — whatever the operator granted before. The operator's Tier control still works and wins until the next Stripe event.
- The confirmation page records the purchase itself through the same code as the webhook, so the tier is on the moment Stripe returns, even if the webhook is late.
- A signed-out visitor sees the public plan page and Sign in to choose a tier; sign-in lands on the dashboard, where the Plans link is. No return-path was added to sign-in.
- The step before Stripe is called the order page (`/billing/order/<tier>`), not "review": review already names the upload review.
- The pipeline runs against the tiers as they are today. Refunds mark the receipt refunded and change no tier; Stripe's cancellation does that.
