import type Stripe from "stripe";
import type { User } from "@prisma/client";
import { stripeClient, tierOfPrice } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { TIER_RANK, type Tier } from "@/lib/tiers";

// Stripe → database (SPEC.md §20). The webhook hands every event to
// handleEvent; each handler upserts by Stripe's id, so a redelivered or
// out-of-order event lands on the same row. User.tier is recomputed from the
// account's subscriptions after every subscription event: the highest tier
// among the subscriptions that grant access.

// Stripe statuses that grant the tier. past_due keeps access while Stripe
// retries the card; canceled, unpaid, incomplete, and paused do not.
const ACCESS_STATUSES = ["active", "trialing", "past_due"];

function idOf(ref: string | { id: string } | null | undefined): string {
  if (!ref) return "";
  return typeof ref === "string" ? ref : ref.id;
}

const fromUnix = (seconds: number) => new Date(seconds * 1000);

// The account behind a Stripe customer: the metadata userId the checkout
// stamped, else the User row that holds the customer id.
async function userIdOfCustomer(
  stripeCustomerId: string,
  metadataUserId?: string | null,
): Promise<string | null> {
  if (metadataUserId) {
    const user = await db.user.findUnique({ where: { id: metadataUserId }, select: { id: true } });
    if (user) return user.id;
  }
  if (!stripeCustomerId) return null;
  const user = await db.user.findFirst({ where: { stripeCustomerId }, select: { id: true } });
  return user?.id ?? null;
}

// The account's Stripe customer, created on first use and stored on the row.
export async function ensureCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripeClient().customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
  });
  await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// User.tier = the highest tier among the subscriptions that grant access.
export async function recomputeTier(userId: string): Promise<Tier> {
  const subs = await db.subscription.findMany({
    where: { userId, status: { in: ACCESS_STATUSES } },
    select: { tier: true },
  });
  let tier: Tier = "FREE";
  for (const s of subs) if (TIER_RANK[s.tier] > TIER_RANK[tier]) tier = s.tier;
  await db.user.update({ where: { id: userId }, data: { tier } });
  return tier;
}

export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const stripeCustomerId = idOf(sub.customer);
  const userId = await userIdOfCustomer(stripeCustomerId, sub.metadata?.userId);
  if (!userId) {
    console.warn(`[billing] subscription ${sub.id}: no account for customer ${stripeCustomerId}`);
    return;
  }
  const item = sub.items.data[0];
  if (!item) return;
  const tier = tierOfPrice(item.price.id, sub.metadata?.tier ?? item.price.metadata?.tier);
  if (!tier) {
    console.warn(`[billing] subscription ${sub.id}: unknown price ${item.price.id}`);
    return;
  }
  const row = {
    userId,
    stripeCustomerId,
    stripePriceId: item.price.id,
    tier,
    status: sub.status,
    interval: item.price.recurring?.interval ?? "month",
    amountCents: item.price.unit_amount ?? 0,
    currency: item.price.currency,
    currentPeriodStart: fromUnix(item.current_period_start),
    currentPeriodEnd: fromUnix(item.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? fromUnix(sub.canceled_at) : null,
  };
  await db.subscription.upsert({
    where: { id: sub.id },
    create: { id: sub.id, ...row, createdAt: fromUnix(sub.created) },
    update: row,
  });
  await recomputeTier(userId);
}

// One invoice: paid (amount_paid) or failed (amount_due). A retry that later
// succeeds overwrites the failed row — same invoice id.
export async function recordInvoice(inv: Stripe.Invoice, status: "paid" | "failed"): Promise<void> {
  const stripeCustomerId = idOf(inv.customer);
  const subscriptionId = idOf(inv.parent?.subscription_details?.subscription);
  const sub = subscriptionId
    ? await db.subscription.findUnique({ where: { id: subscriptionId }, select: { userId: true, tier: true } })
    : null;
  const userId = sub?.userId ?? (await userIdOfCustomer(stripeCustomerId));
  const line = inv.lines.data[0];
  const row = {
    kind: "invoice",
    userId,
    stripeCustomerId,
    subscriptionId,
    tier: sub?.tier ?? "",
    amountCents: status === "paid" ? inv.amount_paid : inv.amount_due,
    currency: inv.currency,
    status,
    periodStart: line ? fromUnix(line.period.start) : null,
    periodEnd: line ? fromUnix(line.period.end) : null,
    createdAt: fromUnix(inv.created),
  };
  await db.payment.upsert({ where: { stripeId: inv.id }, create: { stripeId: inv.id, ...row }, update: row });
}

// Every refund on a charge, each as its own negative row.
export async function recordRefunds(charge: Stripe.Charge): Promise<void> {
  const stripeCustomerId = idOf(charge.customer);
  const userId = await userIdOfCustomer(stripeCustomerId);
  const refunds = await stripeClient().refunds.list({ charge: charge.id, limit: 100 });
  for (const refund of refunds.data) {
    if (refund.status && refund.status !== "succeeded" && refund.status !== "pending") continue;
    const row = {
      kind: "refund",
      userId,
      stripeCustomerId,
      amountCents: -refund.amount,
      currency: refund.currency,
      status: "refunded",
      createdAt: fromUnix(refund.created),
    };
    await db.payment.upsert({
      where: { stripeId: refund.id },
      create: { stripeId: refund.id, ...row },
      update: row,
    });
  }
}

// A finished checkout: the customer id lands on the account (the checkout
// stamped userId on the session), then the new subscription syncs at once —
// its own event may arrive before or after this one, and both land the same.
async function completeCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const stripeCustomerId = idOf(session.customer);
  const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
  if (userId && stripeCustomerId) {
    await db.user
      .update({ where: { id: userId }, data: { stripeCustomerId } })
      .catch(() => {});
  }
  const subscriptionId = idOf(session.subscription);
  if (subscriptionId) {
    const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
    await syncSubscription(sub);
  }
}

// The event types the webhook endpoint should subscribe to in the Stripe
// dashboard. Anything else is answered 200 and ignored.
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
] as const;

export async function handleEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed":
      await completeCheckout(event.data.object);
      return true;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      return true;
    case "invoice.paid":
      await recordInvoice(event.data.object, "paid");
      return true;
    case "invoice.payment_failed":
      await recordInvoice(event.data.object, "failed");
      return true;
    case "charge.refunded":
      await recordRefunds(event.data.object);
      return true;
    default:
      return false;
  }
}
