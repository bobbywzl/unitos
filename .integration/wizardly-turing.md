# claude/wizardly-turing-tgv5vh

**Intent:** Put the designed billing pages (Unitos_Billing.html) into the app at their URLs: /billing, /billing/order/premium, /billing/order/ultra, the Stripe hand-off overlay, and /billing/confirmed.

**Files:**
- `src/components/billing/frame.tsx`: the billing frame (ground, back link, language switcher, the page column), the floating tier watermark, and `emphasize` (one bold value in a translated line). `src/app/billing/layout.tsx`: only the gate now; each page draws its own frame, light or night.
- `src/components/billing/plan-card.tsx`: the redesigned card (monthly rate, the other interval's rate and saving, the gold trial line, full or short feature list, stars and watermark). `src/components/billing/plan-button.ts`: the clay/gold button class, a plain module so server pages can call it.
- `src/components/billing/pay-button.tsx`: Pay with Stripe with the lock icon and the Stripe hand-off overlay while the checkout URL comes.
- `src/app/billing/page.tsx`, `src/app/billing/order/[tier]/page.tsx`, `src/app/billing/confirmed/page.tsx`: the three pages per the design. `src/app/billing/receipts/*`, `src/components/billing/print-button.tsx`: the same frame and colors.
- `src/lib/billing/trial.ts`: `checkoutTrialEnd` (a checkout on a running trial starts free; Stripe's two-day floor) and `nextRenewal`. `src/lib/billing/checkout.ts`: passes `trial_end` to Stripe. `src/lib/billing/events.ts`: a $0 invoice makes no receipt.
- `src/lib/billing/format.ts`: `perMonth`, `savingsPercent`, `everyInterval`; `renewsLine` removed. `src/lib/billing/plans.ts`: `yearlySavingsPercent` uses `savingsPercent`.
- `src/components/lang-switcher.tsx`: a `tone="billing"` look (pills on a track in the page's colors).
- `src/lib/i18n/dict/billing.ts`: the design's copy in en and zh; the feature lines per the design.
- `src/app/globals.css`: the billing section (colors, grounds, stars, materials, gold text, overlay, animations, reduced motion off).
- `SPEC.md` §24, `TIERS.md` (the trial at checkout).

**Decisions:**
- Start Free / Get the tier on the plan page still goes to the order page, not straight to Stripe: the order page carries the Terms consent line and Pay.
- The design's Ultra order sheet shows the free trial too, so on a running trial either tier starts free until the trial ends (Stripe `trial_end`). A trial ending within two days charges at once.
- The design's feature lines are used as written, except "Offline work" under Ultra became "Offline copies" (TIERS.md: offline work is Premium, offline copies are Ultra). The run limits and storage multiples are copy only; nothing in code enforces them.
- "Back to plans" goes to /billing; the marketing /plans page (Plans.dc.html) is not in the repo and was not part of this upload.
- The confirmation page keeps a small See the receipt link when a payment made one; the design omits receipts.
- Dates keep the app's existing format (en-GB, UTC) rather than the prototype's en-US.
