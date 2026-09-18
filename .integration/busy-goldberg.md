# busy-goldberg

**Intent:** Review the Stripe billing integration against Stripe's current best practices (the Stripe plugin's skills) and close the gaps: Stripe Tax at checkout, the missing lifecycle events, and account resolution by the Stripe customer first.

**Files:**
- `src/lib/billing/config.ts` — `taxEnabled()`: `STRIPE_TAX="on"` turns Stripe Tax on at checkout.
- `src/lib/billing/checkout.ts` — with tax on, the session passes `automatic_tax`, collects the billing address and a tax id, and saves both on the customer; every session carries an `integration_identifier` for the Dashboard.
- `src/lib/billing/events.ts` — the account resolves by the Stripe customer first, then metadata; the tier by the price first, then metadata. Handles `checkout.session.async_payment_succeeded` (same path as completed), and logs `checkout.session.async_payment_failed` and `invoice.payment_failed`.
- `src/app/admin/billing/page.tsx`, `src/lib/i18n/dict/admin.ts` — the admin billing page shows `STRIPE_TAX`; the webhook line names the new events.
- `.env.example`, `README.md`, `SPEC.md` §24, `TIERS.md` — the new variable, the restricted-key advice, and the events.

**Decisions:**
- Tax is behind its own flag, not tied to the billing switch: `automatic_tax` on an account without Stripe Tax active makes Checkout fail, and on an account without registrations it collects nothing silently. The operator turns it on after the Dashboard setup.
- Failed payments are logged and change no tier: the subscription's own status event (past_due holds, unpaid/canceled ends) already does the right thing, and Stripe's retries and emails are Dashboard settings.
