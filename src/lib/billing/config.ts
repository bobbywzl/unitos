import type { Tier } from "@prisma/client";

// Billing (SPEC.md §24): the Stripe configuration. STRIPE_SECRET_KEY opens the
// Stripe client; STRIPE_WEBHOOK_SECRET verifies the events Stripe posts to
// /api/billing/webhook; STRIPE_PRICE_PREMIUM and STRIPE_PRICE_ULTRA name the
// recurring Stripe prices the two tiers sell at. Every value is read here and
// nowhere else. No server imports: the admin page reads the same shape.

export const TIERS: readonly Tier[] = ["PREMIUM", "ULTRA"] as const;

// The tier's slug in a billing URL (/billing/review/premium).
export function tierSlug(tier: Tier): "premium" | "ultra" {
  return tier === "ULTRA" ? "ultra" : "premium";
}

export function tierFromSlug(slug: string): Tier | null {
  return slug === "premium" ? "PREMIUM" : slug === "ultra" ? "ULTRA" : null;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function webhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

// The Stripe price id a tier sells at; "" when unset.
export function priceIdOf(tier: Tier): string {
  return (tier === "ULTRA" ? process.env.STRIPE_PRICE_ULTRA : process.env.STRIPE_PRICE_PREMIUM) ?? "";
}

// The tier a Stripe price id sells; null when it is neither tier's price.
export function tierOfPriceId(priceId: string): Tier | null {
  if (!priceId) return null;
  return TIERS.find((tier) => priceIdOf(tier) === priceId) ?? null;
}

// Every Stripe value is set: the client, the webhook, and both prices.
export function billingConfigured(): boolean {
  return stripeConfigured() && webhookConfigured() && TIERS.every((tier) => priceIdOf(tier) !== "");
}
