import type { Tier, User } from "@prisma/client";
import { stripeConfigured, type Interval } from "@/lib/billing/config";
import { stripe, type Stripe } from "@/lib/billing/stripe";

// The subscription panel's reading of an account's subscription (SPEC.md
// §24): the stored columns (User.subscriptionTier, subscriptionEndsAt) and,
// when Stripe answers, the live state — trialing, renewing, canceled at the
// period's end, past due — the billing interval, and the card on file. A
// Stripe failure keeps the panel on the stored columns (live: false).

export type SubscriptionStatus = "trialing" | "active" | "canceling" | "past_due" | "other";

export type SubscriptionSummary = {
  tier: Tier;
  status: SubscriptionStatus;
  // The paid period's end, ISO: the renewal, the cancel date, or the first
  // payment's date on a trial. Null when unknown.
  periodEnd: string | null;
  interval: Interval | null;
  card: { brand: string; last4: string } | null;
  // Stripe answered; false = the stored columns alone.
  live: boolean;
};

function cardOf(pm: string | Stripe.PaymentMethod | null | undefined): SubscriptionSummary["card"] {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  return { brand: pm.card.brand, last4: pm.card.last4 };
}

function statusOf(sub: Stripe.Subscription): SubscriptionStatus {
  if (sub.cancel_at_period_end) return "canceling";
  if (sub.status === "trialing") return "trialing";
  if (sub.status === "active") return "active";
  if (sub.status === "past_due" || sub.status === "unpaid") return "past_due";
  return "other";
}

export async function subscriptionSummary(user: User): Promise<SubscriptionSummary | null> {
  if (!user.subscriptionId || !user.subscriptionTier) return null;
  const stored: SubscriptionSummary = {
    tier: user.subscriptionTier,
    status: "active",
    periodEnd: user.subscriptionEndsAt?.toISOString() ?? null,
    interval: null,
    card: null,
    live: false,
  };
  if (!stripeConfigured()) return stored;
  try {
    const sub = await stripe().subscriptions.retrieve(user.subscriptionId, {
      expand: ["default_payment_method", "customer.invoice_settings.default_payment_method"],
    });
    const status = statusOf(sub);
    const periodEnd =
      status === "trialing" && sub.trial_end
        ? sub.trial_end
        : Math.max(0, ...sub.items.data.map((i) => i.current_period_end));
    const raw = sub.items.data[0]?.price.recurring?.interval;
    const interval: Interval | null = raw === "month" ? "month" : raw === "year" ? "year" : null;
    // The subscription's own card first, else the customer's default.
    const customer = typeof sub.customer === "string" || sub.customer.deleted ? null : sub.customer;
    const card = cardOf(sub.default_payment_method) ?? cardOf(customer?.invoice_settings.default_payment_method);
    return {
      tier: user.subscriptionTier,
      status,
      periodEnd: periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : stored.periodEnd,
      interval,
      card,
      live: true,
    };
  } catch (err) {
    console.error("[billing] subscription read failed", err);
    return stored;
  }
}
