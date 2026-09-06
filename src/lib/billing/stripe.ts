import Stripe from "stripe";
import type { PaidTier } from "@/lib/tiers";

// Stripe (SPEC.md §20): the client, the configured check, and the price map.
// STRIPE_SECRET_KEY turns billing on; STRIPE_WEBHOOK_SECRET verifies the
// webhook; the four price ids name what a checkout sells. Nothing in the
// reader's UI links to billing yet — the routes exist and the admin's
// financials page reads what the webhook writes.

export type Interval = "month" | "year";

export const PRICE_ENV: Record<PaidTier, Record<Interval, string>> = {
  PREMIUM: { month: "STRIPE_PRICE_PREMIUM_MONTHLY", year: "STRIPE_PRICE_PREMIUM_YEARLY" },
  ULTRA: { month: "STRIPE_PRICE_ULTRA_MONTHLY", year: "STRIPE_PRICE_ULTRA_YEARLY" },
};

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function webhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

// True when at least one price id is set: a checkout can sell something.
export function pricesConfigured(): boolean {
  return Object.values(PRICE_ENV).some((byInterval) =>
    Object.values(byInterval).some((name) => Boolean(process.env[name])),
  );
}

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", { typescript: true });
  return client;
}

export function priceIdFor(tier: PaidTier, interval: Interval): string | null {
  return process.env[PRICE_ENV[tier][interval]] || null;
}

// The tier a Stripe price sells. The env map decides; the metadata the
// checkout stamped on the subscription (`tier`) stands in for a price id the
// operator has since rotated. null = a price this app does not know.
export function tierOfPrice(priceId: string, metadataTier?: string | null): PaidTier | null {
  for (const tier of Object.keys(PRICE_ENV) as PaidTier[]) {
    for (const interval of Object.keys(PRICE_ENV[tier]) as Interval[]) {
      if (priceIdFor(tier, interval) === priceId) return tier;
    }
  }
  if (metadataTier === "PREMIUM" || metadataTier === "ULTRA") return metadataTier;
  return null;
}
