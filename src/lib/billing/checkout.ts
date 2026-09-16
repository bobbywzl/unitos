import type { Tier, User } from "@prisma/client";
import { type Interval, priceIdOf, tierSlug } from "@/lib/billing/config";
import { stripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import type { Lang } from "@/lib/i18n/config";

// Checkout (SPEC.md §24): Pay on the order page opens a Stripe Checkout
// session for the tier's price at the chosen interval. Stripe returns to
// /billing/confirmed with the session id; Cancel returns to the order page.
// The account's Stripe customer is created on the first checkout and kept
// on User.stripeCustomerId.

export async function ensureCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
  });
  await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

function stripeLocale(lang: Lang): "zh" | "en" {
  return lang === "zh" ? "zh" : "en";
}

/** The Stripe Checkout URL to send the browser to. */
export async function createCheckout(
  user: User,
  tier: Tier,
  interval: Interval,
  origin: string,
  lang: Lang,
): Promise<string> {
  const customer = await ensureCustomer(user);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceIdOf(tier, interval), quantity: 1 }],
    success_url: `${origin}/billing/confirmed?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/order/${tierSlug(tier)}?canceled=1&interval=${interval}`,
    client_reference_id: user.id,
    // Both carry the account and the tier: the checkout event reads the
    // session's, every invoice of the subscription reads the subscription's.
    // The interval itself needs no metadata — the price id the subscription
    // and every invoice carry already names it (config.ts intervalOfPriceId).
    metadata: { userId: user.id, tier },
    subscription_data: { metadata: { userId: user.id, tier } },
    allow_promotion_codes: true,
    locale: stripeLocale(lang),
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}

/** The Stripe billing portal URL: Manage subscription opens it. The account
    changes its card, cancels, or switches tier there; the webhook brings
    every change back. */
export async function portalUrl(user: User, origin: string, lang: Lang): Promise<string> {
  const customer = await ensureCustomer(user);
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${origin}/billing`,
    locale: stripeLocale(lang),
  });
  return session.url;
}
