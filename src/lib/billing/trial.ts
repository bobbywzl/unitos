import type { Interval } from "@/lib/billing/config";
import { tierState, type TierFields } from "@/lib/tiers";

// The trial at checkout (SPEC.md §24): an account on its Unitos Premium
// trial starts a subscription free. Nothing is charged today; Stripe takes
// the card now and the first charge lands when the trial ends. Stripe needs
// a trial end at least two days out, so a trial that ends sooner charges
// today. No server imports: the plan page, the order page, the checkout, and
// the confirmation page read one rule.
const MIN_TRIAL_MS = 48 * 3600_000;

/** When the account's trial ends, if a checkout today starts free; null
    when the checkout charges today. */
export function checkoutTrialEnd(user: TierFields, now = new Date()): Date | null {
  if (tierState(user, now) !== "trial" || !user.trialEndsAt) return null;
  return user.trialEndsAt.getTime() - now.getTime() >= MIN_TRIAL_MS ? user.trialEndsAt : null;
}

/** When a subscription that starts at `from` renews: one interval later. */
export function nextRenewal(from: Date, interval: Interval, intervalCount = 1): Date {
  const next = new Date(from);
  if (interval === "year") next.setFullYear(next.getFullYear() + intervalCount);
  else next.setMonth(next.getMonth() + intervalCount);
  return next;
}
