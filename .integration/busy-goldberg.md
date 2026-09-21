# busy-goldberg

**Intent:** Review the Stripe billing integration against Stripe's current best practices (the Stripe plugin's skills) and close the gaps: Stripe Tax at checkout, the missing lifecycle events, and account resolution by the Stripe customer first. Then the beta: `BETA=on` gives every account Unitos Ultra in the app while billing runs beside it, disconnected, so the plan pages can go up for ads now.

**Files:**
- `src/lib/billing/config.ts` — `taxEnabled()`: `STRIPE_TAX="on"` turns Stripe Tax on at checkout.
- `src/lib/billing/checkout.ts` — with tax on, the session passes `automatic_tax`, collects the billing address and a tax id, and saves both on the customer; every session carries an `integration_identifier` for the Dashboard.
- `src/lib/billing/events.ts` — the account resolves by the Stripe customer first, then metadata; the tier by the price first, then metadata. Handles `checkout.session.async_payment_succeeded` (same path as completed), and logs `checkout.session.async_payment_failed` and `invoice.payment_failed`.
- `src/app/admin/billing/page.tsx`, `src/lib/i18n/dict/admin.ts` — the admin billing page shows `STRIPE_TAX`; the webhook line names the new events.
- `.env.example`, `README.md`, `SPEC.md` §24, `TIERS.md` — the new variables, the restricted-key advice, the events, and the beta.
- `src/lib/tiers.ts` — `betaOn()`; `accountTier`, `ultraActive`, and `premiumActive` answer Ultra during the beta. `tierState` stays the record.
- `src/lib/person.ts`, `src/app/settings/page.tsx` — the badge's tier mark and the Settings plan card read `accountTier`, like the dashboard and the reader.
- `src/middleware.ts` — `/plans` is a public door like `/billing`, so a visitor from an ad reaches it signed out.
- `src/components/billing/plan-choice.tsx`, `src/lib/i18n/dict/billing.ts` — during the beta the state line says first that the tier chosen takes effect when the beta ends.
- `src/app/admin/billing/page.tsx` — a `BETA` row above the Stripe values.
- `src/app/billing/confirmed/page.tsx`, `src/middleware.ts` — without a session id the confirmation page says there is no order to confirm and points at the plans page; that state is public, so the URL an ads tool checks answers 200.
- `src/components/markdown.tsx` — the element overrides are defined once at module level and read the note's data from a context. Inline overrides were new component types on every render, so a re-render during a press (the hold's pending state on pointerdown) remounted the pressed node and the browser fired no click: an annotation reference in a note could not be opened.
- `scripts/stripe-setup.mjs` — configures a Stripe account by API, idempotently: products, prices, the webhook endpoint, the customer portal; prints the env lines. Tested against a sandbox with a trial checkout, a paid checkout, a refund, and a cancellation, all through the webhook.

**Decisions:**
- Tax is behind its own flag, not tied to the billing switch: `automatic_tax` on an account without Stripe Tax active makes Checkout fail, and on an account without registrations it collects nothing silently. The operator turns it on after the Dashboard setup.
- Failed payments are logged and change no tier: the subscription's own status event (past_due holds, unpaid/canceled ends) already does the right thing, and Stripe's retries and emails are Dashboard settings.
- The beta is an environment variable, not an admin switch: the gates are pure functions read on every request and in `personOf`, and ending the beta is a deploy-level event anyway. The billing pages read the record on purpose: with the app's reading, every account would hold Ultra and nothing could be bought.
