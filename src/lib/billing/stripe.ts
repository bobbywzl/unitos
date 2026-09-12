import Stripe from "stripe";

// The Stripe client (SPEC.md §24), built once per process from
// STRIPE_SECRET_KEY. Callers check stripeConfigured() (config.ts) first;
// this throws when the key is unset so a misconfigured route fails loudly.
const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  globalForStripe.stripe ??= new Stripe(key, { appInfo: { name: "Unitos" } });
  return globalForStripe.stripe;
}

export type { Stripe };
