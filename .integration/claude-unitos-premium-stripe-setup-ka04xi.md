# claude/unitos-premium-stripe-setup-ka04xi

**Intent:** Make the three tiers real in the data model (`User.tier`: Free, Premium, Ultra, replacing the premium boolean), add a Stripe payment layer that is connected to the backend but not visible to readers, and show the money as Financials in the admin.

**Files:**

- `prisma/schema.prisma` — `Tier` enum; `User.tier` and `User.stripeCustomerId` replace `User.premium`; new `Subscription`, `Payment`, and `StripeEvent` models.
- `prisma/migrations/20260906140000_tiers_billing/migration.sql` — the migration: adds the tier column, converts operator-set premium accounts to PREMIUM, drops the boolean, creates the three tables.
- `src/lib/tiers.ts` — the one place tiers are compared (`hasPremium`, `tierAtLeast`, labels). No server imports, so client components can read it.
- `src/lib/billing/stripe.ts` — Stripe client, configured checks, the env price map (`STRIPE_PRICE_*`), price id → tier.
- `src/lib/billing/sync.ts` — Stripe → database: customer creation, subscription upsert, tier recompute, invoice and refund rows, the webhook event switch, `HANDLED_EVENTS`.
- `src/lib/billing/financials.ts` — the admin Financials queries: MRR, revenue, refunds, failed payments, AI cost, unit economics, per-subscription rows.
- `src/app/api/stripe/webhook/route.ts` — signature-checked webhook; StripeEvent rows skip redeliveries; a thrown handler answers 500 so Stripe retries.
- `src/app/api/billing/route.ts`, `src/app/api/billing/checkout/route.ts`, `src/app/api/billing/portal/route.ts` — the account's tier, hosted Checkout URL, customer portal URL. No UI calls them yet.
- `src/middleware.ts` — `/api/stripe/webhook` is a public door (no session cookie).
- `src/app/admin/financials/page.tsx`, `src/components/admin/admin-nav.tsx` — the Financials tab and page.
- `src/app/admin/page.tsx` — Stripe key and webhook secret rows in the services list.
- `src/app/admin/accounts/page.tsx` — Premium or Ultra chip from `tier`.
- `src/lib/auth.ts`, `src/app/api/images/route.ts`, `src/app/settings/page.tsx`, `src/app/n/[notebookId]/page.tsx`, `src/app/n/[notebookId]/notes/page.tsx` — readers of the old boolean now call `hasPremium(user.tier)`; the local reader is Ultra.
- `src/lib/account-reset.ts` — reset no longer clears a flag; it recomputes the tier from subscriptions, so a paid tier survives a reset.
- `src/lib/i18n/dict/admin.ts`, `src/lib/i18n/dict/api.ts`, `src/lib/i18n/dict/common.ts` — Financials and billing strings in en and zh; billing terms added to the zh glossary.
- `SPEC.md` (§17 flag line, §7 admin line, new §20 Billing), `TIERS.md` (the tier column and the hidden billing layer recorded as facts), `README.md`, `.env.example` — the six Stripe variables and the webhook endpoint.
- `package.json`, `package-lock.json` — `stripe` 22.6.1.

**Decisions:**

- The tier is a Prisma enum column replacing the boolean, not a second column beside it. The migration converts premium=true to PREMIUM and drops the boolean; every reader was switched in the same commit.
- Stripe is the only writer of `User.tier` (plus the migration's one-time conversion). The admin gets no toggle, per SPEC.md §18. A tier the operator set by hand is overwritten to FREE the first time that account gets a subscription event or a reset.
- Access statuses: `active`, `trialing`, and `past_due` grant the tier; `canceled`, `unpaid`, `incomplete`, and `paused` do not. Highest tier among the account's access-granting subscriptions wins.
- Refunds are recorded from `charge.refunded` by listing the charge's refunds, each as its own negative Payment row, rather than by linking the refund to its invoice (the invoice → charge link changed in recent Stripe API versions).
- The webhook records the StripeEvent id after the handler finishes, not before, so a failed handler is retried by Stripe. Every handler upserts by Stripe's id, so a concurrent duplicate is harmless.
- Billing routes are gated only by the Stripe key being set. There is no separate "billing open" flag: keeping the key in test mode, or unset, keeps billing off, and nothing in the reader's UI links to the routes.
- Margin on the Financials page subtracts USD AI cost estimates from Stripe revenue in the subscription's currency, read as the same unit. Correct for USD prices; a non-USD price would need conversion.
- Tier quotas and prices are not implemented or recorded: TIERS.md holds decisions only, and the owner has not made those. They were proposed in chat.
- Not verified against a database: this environment had no DATABASE_URL, so the migration did not run and the webhook was not exercised. `next build`, `tsc`, and `eslint` pass.
