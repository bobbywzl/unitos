import type { Tier } from "@prisma/client";
import { INTERVALS, type Interval, priceEnvName, priceIdOf, stripeConfigured, TIERS } from "@/lib/billing/config";
import { savingsPercent } from "@/lib/billing/format";
import { stripe } from "@/lib/billing/stripe";

// The plans (SPEC.md §24): what each tier sells at, at each interval, read
// from the Stripe prices STRIPE_PRICE_<TIER>_MONTHLY / _YEARLY name. The
// plan page, the order page, and the admin billing page show the same read.
// Cached per process for five minutes: a price change in Stripe shows
// within that.

export type Plan = {
  tier: Tier;
  interval: Interval;
  priceId: string;
  // Minor units; null when the price has no fixed amount.
  amount: number | null;
  currency: string;
  // Stripe's own interval count, for display ("$80.00 / 12 months" if a
  // price is ever set up that way instead of a plain yearly price).
  intervalCount: number;
  // Why the price could not be read; "" when it could.
  error: string;
};

const TTL_MS = 5 * 60_000;
let cache: { at: number; plans: Plan[] } | null = null;

// A Stripe SDK error carries more than .message: .type names the class
// (StripeConnectionError, StripeAuthenticationError, StripeInvalidRequestError,
// …) and .code and .statusCode narrow it further. None of that reaches the
// page (the reader sees only the plain error string on Plan), but it belongs
// in the server log — the difference between "Stripe is unreachable" and
// "the key is wrong" is exactly what a plain message like "An error
// occurred with our connection to Stripe" hides.
function describeStripeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & { type?: string; code?: string; statusCode?: number };
  const parts = [e.type, e.code, e.statusCode != null ? `HTTP ${e.statusCode}` : null].filter(Boolean);
  return parts.length > 0 ? `${e.message} (${parts.join(", ")})` : e.message;
}

async function readPlan(tier: Tier, interval: Interval): Promise<Plan> {
  const priceId = priceIdOf(tier, interval);
  const empty: Plan = { tier, interval, priceId, amount: null, currency: "usd", intervalCount: 1, error: "" };
  if (!priceId) return { ...empty, error: `${priceEnvName(tier, interval)} is not set` };
  if (!stripeConfigured()) return { ...empty, error: "STRIPE_SECRET_KEY is not set" };
  try {
    const price = await stripe().prices.retrieve(priceId);
    if (!price.active) return { ...empty, error: "The price is not active in Stripe" };
    if (!price.recurring) return { ...empty, error: "The price is not recurring" };
    return {
      tier,
      interval,
      priceId,
      amount: price.unit_amount,
      currency: price.currency,
      intervalCount: price.recurring.interval_count,
      error: "",
    };
  } catch (err) {
    console.error(`[billing] price ${priceId} (${tier} ${interval}) could not be read: ${describeStripeError(err)}`);
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

/** All four (tier × interval) plans. */
export async function plans(): Promise<Plan[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.plans;
  const read = await Promise.all(TIERS.flatMap((tier) => INTERVALS.map((interval) => readPlan(tier, interval))));
  // A failed read is not cached: the next request tries Stripe again.
  if (read.every((p) => p.error === "")) cache = { at: Date.now(), plans: read };
  return read;
}

export async function planOf(tier: Tier, interval: Interval): Promise<Plan> {
  const all = await plans();
  return all.find((p) => p.tier === tier && p.interval === interval) ?? (await readPlan(tier, interval));
}

/** All four prices read from Stripe: the switch may turn billing on. */
export async function plansReady(): Promise<boolean> {
  return (await plans()).every((p) => p.error === "" && p.amount !== null);
}

// The tier's yearly saving against twelve months at its monthly price
// (format.ts savingsPercent): the badge on the Yearly toggle carries the
// largest among the tiers.
export async function yearlySavingsPercent(tier: Tier): Promise<number | null> {
  return savingsPercent(await planOf(tier, "month"), await planOf(tier, "year"));
}
