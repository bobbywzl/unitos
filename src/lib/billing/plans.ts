import type { Tier } from "@prisma/client";
import { priceIdOf, stripeConfigured, TIERS } from "@/lib/billing/config";
import { stripe } from "@/lib/billing/stripe";

// The plans (SPEC.md §24): what each tier sells at, read from the Stripe
// price STRIPE_PRICE_<TIER> names. The plan page, the review page, and the
// admin billing page show the same read. Cached per process for five
// minutes: a price change in Stripe shows within that.

export type Plan = {
  tier: Tier;
  priceId: string;
  // Minor units; null when the price has no fixed amount.
  amount: number | null;
  currency: string;
  // "month" or "year", and how many of them one payment covers.
  interval: string;
  intervalCount: number;
  // Why the price could not be read; "" when it could.
  error: string;
};

const TTL_MS = 5 * 60_000;
let cache: { at: number; plans: Plan[] } | null = null;

async function readPlan(tier: Tier): Promise<Plan> {
  const priceId = priceIdOf(tier);
  const empty: Plan = { tier, priceId, amount: null, currency: "usd", interval: "month", intervalCount: 1, error: "" };
  if (!priceId) return { ...empty, error: `STRIPE_PRICE_${tier} is not set` };
  if (!stripeConfigured()) return { ...empty, error: "STRIPE_SECRET_KEY is not set" };
  try {
    const price = await stripe().prices.retrieve(priceId);
    if (!price.active) return { ...empty, error: "The price is not active in Stripe" };
    if (!price.recurring) return { ...empty, error: "The price is not recurring" };
    return {
      tier,
      priceId,
      amount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring.interval,
      intervalCount: price.recurring.interval_count,
      error: "",
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function plans(): Promise<Plan[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.plans;
  const read = await Promise.all(TIERS.map(readPlan));
  // A failed read is not cached: the next request tries Stripe again.
  if (read.every((p) => p.error === "")) cache = { at: Date.now(), plans: read };
  return read;
}

export async function planOf(tier: Tier): Promise<Plan> {
  const all = await plans();
  return all.find((p) => p.tier === tier) ?? (await readPlan(tier));
}

/** Both prices read from Stripe: the switch may turn billing on. */
export async function plansReady(): Promise<boolean> {
  return (await plans()).every((p) => p.error === "" && p.amount !== null);
}
