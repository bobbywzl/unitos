# claude/unitos-premium-stripe-setup-ka04xi

**Intent:** Make the three tiers real in the data model (`User.tier`: Free, Premium, Ultra, replacing the premium boolean), add a Stripe payment layer connected to the backend, show the money as Financials in the admin, and — added mid-round at the owner's request — a live pricing section in Settings with a monthly/yearly toggle and a flashy yearly-savings badge.

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
- `src/lib/billing/prices.ts` — live Stripe prices for the two paid tiers, cached five minutes; computes each tier's yearly saving against twelve months at its monthly price. Never hardcodes an amount, so a price changed in the Stripe dashboard shows up with no redeploy.
- `src/app/api/billing/route.ts` — extended to also answer `hasCustomer` and `prices`, both the Settings pricing section reads.
- `src/app/settings/page.tsx`, `src/components/settings-form.tsx` — a Billing section: signed-in accounts on Free see a Monthly/Yearly toggle (the toggle carries the largest saving among the tiers as a badge; each tier card carries its own) and two upgrade cards that call `/api/billing/checkout`; accounts already on Premium or Ultra see their plan, price, and renewal or cancellation date, with Manage billing opening the customer portal. Sign-in off, or Stripe not configured, falls back to the old plain Unitos Premium status line.
- `src/lib/i18n/dict/settings.ts` — the billing section's strings in en and zh.
- `SPEC.md` (§17 flag line, §7 admin line, new §20 Billing, the Settings pricing section, the note that the beta notice's "free and unlimited" now sits beside real pricing), `TIERS.md` (the tier column and the billing layer, now partly visible, recorded as facts), `README.md`, `.env.example` — the six Stripe variables and the webhook endpoint.
- `package.json`, `package-lock.json` — `stripe` 22.6.1.

**Decisions:**

- The tier is a Prisma enum column replacing the boolean, not a second column beside it. The migration converts premium=true to PREMIUM and drops the boolean; every reader was switched in the same commit.
- Stripe is the only writer of `User.tier` (plus the migration's one-time conversion). The admin gets no toggle, per SPEC.md §18. A tier the operator set by hand is overwritten to FREE the first time that account gets a subscription event or a reset.
- Access statuses: `active`, `trialing`, and `past_due` grant the tier; `canceled`, `unpaid`, `incomplete`, and `paused` do not. Highest tier among the account's access-granting subscriptions wins.
- Refunds are recorded from `charge.refunded` by listing the charge's refunds, each as its own negative Payment row, rather than by linking the refund to its invoice (the invoice → charge link changed in recent Stripe API versions).
- The webhook records the StripeEvent id after the handler finishes, not before, so a failed handler is retried by Stripe. Every handler upserts by Stripe's id, so a concurrent duplicate is harmless.
- Billing routes are gated only by the Stripe key being set. There is no separate "billing open" flag: keeping the key in test mode, or unset, keeps billing off, and nothing in the reader's UI links to the routes.
- Margin on the Financials page subtracts USD AI cost estimates from Stripe revenue in the subscription's currency, read as the same unit. Correct for USD prices; a non-USD price would need conversion.
- Tier quotas are not implemented or recorded: TIERS.md holds decisions only, and the owner has not made those. Usage quotas were proposed in chat, not decided.
- Prices are decided and recorded in TIERS.md (2026-09-15): Unitos Premium $19.99/month, $220/year (about 8% under twelve months at the monthly price); Unitos Ultra $39.99/month, $400/year (about 17% under). Code never hardcodes these numbers — the Settings pricing section and its discount badges read them live from Stripe (`lib/billing/prices.ts`); TIERS.md is the record if a price ever needs recreating.
- Ultra has no feature of its own yet (TIERS.md, unchanged this round). The owner was told this plainly when asked for Stripe product copy: the placeholder description says "Everything in Unitos Premium" rather than overclaiming. Worth a decision before this goes live to real customers — paying double for an identical product is a hard sell.
- Billing went from backend-only to partly visible this round, at the owner's explicit request ("reflect the discount rates in flashy way in billing URL"). The beta notice at `/signin` still promises every beta account free and unlimited access, which now sits beside a real pricing page in Settings for the same account — flagged in SPEC.md §20 as a decision the owner still needs to make, not resolved here.
- The pricing section's checkout and portal redirects use `window.location.assign(url)`, not `window.location.href = url`: the React Compiler's eslint rule (`react-hooks` package) flagged the assignment form as a disallowed external mutation in this file; `.assign()` is the same navigation, written as a method call instead.
- Not verified against a database: this environment had no DATABASE_URL, so the migration did not run and the webhook was not exercised. `next build`, `tsc`, and `eslint` pass.
