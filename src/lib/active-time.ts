import { checkoutTrialEnd } from "@/lib/billing/trial";
import type { TierFields } from "@/lib/tiers";

// Active time (SPEC.md §24): how long an account has used the app — the tab
// visible and the reader acting in it. The active time clock
// (components/active-time-clock.tsx) counts it in the browser and posts it
// to POST /api/active-time in ticks; the route adds each tick to
// User.activeSeconds.
// The billing ask reads it: once the account has used the app for
// ASK_AFTER_SECONDS, the app asks for a card to keep Unitos Premium after
// the trial. No server imports: the clock and the route read one rule.

/** Active time before the billing ask opens: 30 minutes. */
export const ASK_AFTER_SECONDS = 30 * 60;

/** How long a dismissed ask waits before it opens again: one day. */
export const ASK_AGAIN_MS = 24 * 3600_000;

/** The clock posts one tick per this much active time. */
export const TICK_SECONDS = 60;

/** The most one tick may add: a tick past this is a forged one. */
export const MAX_TICK_SECONDS = 120;

/** The reader is idle after this long with no input; idle time is not active. */
export const IDLE_MS = 60_000;

/** The fields the ask reads off the user row. */
export type AskFields = TierFields & {
  subscriptionId: string;
  activeSeconds: number;
  billingAskedAt: Date | null;
};

/** The billing ask is due: the account has used the app for
    ASK_AFTER_SECONDS, holds no subscription, a checkout today starts free
    (the trial runs and ends at least two days out — the ask promises
    nothing charged until then), and the ask has not opened in ASK_AGAIN_MS.
    The billing switch and the beta are the route's checks, not this one's. */
export function askDue(user: AskFields, now = new Date()): boolean {
  if (user.subscriptionId !== "") return false;
  if (user.activeSeconds < ASK_AFTER_SECONDS) return false;
  if (checkoutTrialEnd(user, now) === null) return false;
  if (user.billingAskedAt && now.getTime() - user.billingAskedAt.getTime() < ASK_AGAIN_MS) return false;
  return true;
}
