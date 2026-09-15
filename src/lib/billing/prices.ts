import { priceIdFor, stripeClient, stripeConfigured, type Interval } from "@/lib/billing/stripe";
import type { PaidTier } from "@/lib/tiers";

// Live Stripe prices for the reader-facing pricing display (SPEC.md §20). The
// Stripe price carries the number — this file never hardcodes an amount — so
// a price changed in the Stripe dashboard shows up here on its own, no
// redeploy. A short in-memory cache keeps repeat Settings loads off the
// Stripe API; it is process-local and fine to lose on a redeploy or restart.

export type IntervalPrice = { amountCents: number; currency: string };
// savingsPercent: the yearly price against twelve months at the monthly
// price, rounded down so the badge never claims more than it delivers.
export type YearPrice = IntervalPrice & { savingsPercent: number };
export type TierPrices = { month: IntervalPrice | null; year: YearPrice | null };
export type BillingPrices = Record<PaidTier, TierPrices>;

const TIERS: PaidTier[] = ["PREMIUM", "ULTRA"];
const TTL_MS = 5 * 60_000;

let cache: { at: number; value: BillingPrices } | null = null;

async function fetchPrice(priceId: string | null): Promise<IntervalPrice | null> {
  if (!priceId) return null;
  try {
    const price = await stripeClient().prices.retrieve(priceId);
    if (price.unit_amount == null) return null;
    return { amountCents: price.unit_amount, currency: price.currency };
  } catch (err) {
    console.warn(`[billing] price ${priceId} could not be read`, err);
    return null;
  }
}

export async function loadPrices(): Promise<BillingPrices | null> {
  if (!stripeConfigured()) return null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const value = {} as BillingPrices;
  for (const tier of TIERS) {
    const month = await fetchPrice(priceIdFor(tier, "month" satisfies Interval));
    const yearRaw = await fetchPrice(priceIdFor(tier, "year" satisfies Interval));
    const year =
      yearRaw && month && month.amountCents > 0
        ? {
            ...yearRaw,
            savingsPercent: Math.max(
              0,
              Math.floor((1 - yearRaw.amountCents / (month.amountCents * 12)) * 100),
            ),
          }
        : null;
    value[tier] = { month, year };
  }
  cache = { at: Date.now(), value };
  return value;
}
