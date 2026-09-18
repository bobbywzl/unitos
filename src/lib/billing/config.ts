import type { Tier } from "@prisma/client";

// Billing (SPEC.md §24): the Stripe configuration. STRIPE_SECRET_KEY opens the
// Stripe client; STRIPE_WEBHOOK_SECRET verifies the events Stripe posts to
// /api/stripe/webhook; STRIPE_PRICE_<TIER>_MONTHLY and STRIPE_PRICE_<TIER>_YEARLY
// name the two recurring Stripe prices each tier sells at — monthly and
// yearly, four prices in all. Every value is read here and nowhere else. No
// server imports: the admin page reads the same shape.

export const TIERS: readonly Tier[] = ["PREMIUM", "ULTRA"] as const;

export type Interval = "month" | "year";
export const INTERVALS: readonly Interval[] = ["month", "year"] as const;

// The tier's slug in a billing URL (/billing/order/premium).
export function tierSlug(tier: Tier): "premium" | "ultra" {
  return tier === "ULTRA" ? "ultra" : "premium";
}

export function tierFromSlug(slug: string): Tier | null {
  return slug === "premium" ? "PREMIUM" : slug === "ultra" ? "ULTRA" : null;
}

// The interval a billing URL names; anything but "year" reads as monthly, so
// a missing or malformed ?interval= never blocks the page.
export function intervalFromParam(value: string | undefined): Interval {
  return value === "year" ? "year" : "month";
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function webhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

const PRICE_ENV: Record<Tier, Record<Interval, string>> = {
  PREMIUM: { month: "STRIPE_PRICE_PREMIUM_MONTHLY", year: "STRIPE_PRICE_PREMIUM_YEARLY" },
  ULTRA: { month: "STRIPE_PRICE_ULTRA_MONTHLY", year: "STRIPE_PRICE_ULTRA_YEARLY" },
};

// The env var name that carries a tier's price at one interval — for
// messages that point at what to set.
export function priceEnvName(tier: Tier, interval: Interval): string {
  return PRICE_ENV[tier][interval];
}

// The Stripe price id a tier sells at for one interval; "" when unset.
export function priceIdOf(tier: Tier, interval: Interval): string {
  return process.env[PRICE_ENV[tier][interval]] ?? "";
}

// The tier a Stripe price id sells; null when it is none of the four.
export function tierOfPriceId(priceId: string): Tier | null {
  if (!priceId) return null;
  for (const tier of TIERS) {
    for (const interval of INTERVALS) {
      if (priceIdOf(tier, interval) === priceId) return tier;
    }
  }
  return null;
}

// The interval a Stripe price id sells at; null when it is none of the four.
export function intervalOfPriceId(priceId: string): Interval | null {
  if (!priceId) return null;
  for (const tier of TIERS) {
    for (const interval of INTERVALS) {
      if (priceIdOf(tier, interval) === priceId) return interval;
    }
  }
  return null;
}

// Every Stripe value is set: the client, the webhook, and all four prices.
export function billingConfigured(): boolean {
  return (
    stripeConfigured() &&
    webhookConfigured() &&
    TIERS.every((tier) => INTERVALS.every((interval) => priceIdOf(tier, interval) !== ""))
  );
}
