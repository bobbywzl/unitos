import type { Tier } from "@prisma/client";
import type Stripe from "stripe";
import { tierOfPriceId } from "@/lib/billing/config";
import { stripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db";

// Stripe events (SPEC.md §24): what a payment does to an account. One code
// path — the webhook and the confirmation page both come here, and every
// write is idempotent, so the two can land in either order or twice.
//
// The tier gates keep reading User.tier and User.trialEndsAt (TIERS.md):
// - A paid subscription writes tier = the tier bought, trialEndsAt = null.
// - An ended subscription writes tier = PREMIUM, trialEndsAt = the paid
//   period's end: the account reads as Premium until then, expired after.
// - Every paid invoice is one Purchase row: the receipt.

function idOf(x: string | { id: string } | null | undefined): string {
  return typeof x === "string" ? x : (x?.id ?? "");
}

// The tier a subscription or invoice buys: the metadata the checkout set,
// else the tier whose price it carries.
function tierOf(meta: Stripe.Metadata | null | undefined, priceId: string): Tier | null {
  const named = meta?.tier;
  if (named === "PREMIUM" || named === "ULTRA") return named;
  return tierOfPriceId(priceId);
}

// The account: the metadata's userId when that account exists, else the
// account whose Stripe customer this is.
async function userIdOf(
  meta: Stripe.Metadata | null | undefined,
  customer: string | { id: string } | null | undefined,
): Promise<string | null> {
  if (meta?.userId) {
    const user = await db.user.findUnique({ where: { id: meta.userId }, select: { id: true } });
    if (user) return user.id;
  }
  const customerId = idOf(customer);
  if (!customerId) return null;
  const user = await db.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } });
  return user?.id ?? null;
}

const PAID: readonly Stripe.Subscription.Status[] = ["active", "trialing"];
const ENDED: readonly Stripe.Subscription.Status[] = ["canceled", "unpaid", "incomplete_expired"];

export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const priceId = idOf(sub.items.data[0]?.price);
  const tier = tierOf(sub.metadata, priceId);
  const userId = await userIdOf(sub.metadata, sub.customer);
  if (!tier || !userId) return;
  const periodEnd = new Date(Math.max(0, ...sub.items.data.map((i) => i.current_period_end)) * 1000);
  const customerId = idOf(sub.customer);

  if (PAID.includes(sub.status)) {
    await db.user.update({
      where: { id: userId },
      data: {
        stripeCustomerId: customerId || undefined,
        subscriptionId: sub.id,
        subscriptionTier: tier,
        subscriptionEndsAt: periodEnd,
        tier,
        trialEndsAt: null,
      },
    });
    return;
  }
  if (ENDED.includes(sub.status)) {
    // Only the subscription the account holds ends its tier. An older one
    // Stripe reports late does nothing.
    const user = await db.user.findUnique({ where: { id: userId }, select: { subscriptionId: true } });
    if (!user || user.subscriptionId !== sub.id) return;
    await db.user.update({
      where: { id: userId },
      data: {
        subscriptionId: "",
        subscriptionTier: null,
        subscriptionEndsAt: null,
        tier: "PREMIUM",
        trialEndsAt: periodEnd,
      },
    });
    return;
  }
  // past_due, paused, incomplete: the tier holds until Stripe ends the
  // subscription. The period's end is kept current.
  await db.user.updateMany({
    where: { id: userId, subscriptionId: sub.id },
    data: { subscriptionEndsAt: periodEnd },
  });
}

/** Record a paid invoice as a Purchase and keep the tier on. Returns the
    purchase id, or null when the invoice is not paid or names no account. */
export async function recordInvoice(invoice: Stripe.Invoice): Promise<string | null> {
  if (invoice.status !== "paid") return null;
  const details = invoice.parent?.subscription_details ?? null;
  const subscriptionId = idOf(details?.subscription);
  const line = invoice.lines.data[0];
  const priceId = idOf(line?.pricing?.price_details?.price);
  const tier = tierOf(details?.metadata, priceId);
  const userId = await userIdOf(details?.metadata, invoice.customer);
  if (!tier || !userId) return null;
  const period = line?.period ?? { start: invoice.period_start, end: invoice.period_end };
  const periodStart = new Date(period.start * 1000);
  const periodEnd = new Date(period.end * 1000);
  const paidAt = new Date((invoice.status_transitions.paid_at ?? invoice.created) * 1000);
  const links = {
    number: invoice.number ?? "",
    amount: invoice.amount_paid,
    currency: invoice.currency,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? "",
    invoicePdfUrl: invoice.invoice_pdf ?? "",
  };
  const purchase = await db.purchase.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: { userId, tier, stripeInvoiceId: invoice.id, subscriptionId, periodStart, periodEnd, paidAt, ...links },
    update: links,
    select: { id: true },
  });
  // A paid invoice keeps the tier on: the same write the subscription
  // event makes, so a late subscription event cannot leave a paid account
  // gated.
  await db.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: idOf(invoice.customer) || undefined,
      subscriptionId: subscriptionId || undefined,
      subscriptionTier: tier,
      subscriptionEndsAt: periodEnd,
      tier,
      trialEndsAt: null,
    },
  });
  return purchase.id;
}

/** A completed checkout: the subscription it started and the invoice it
    paid. The confirmation page calls this too, so the tier is on before the
    webhook lands. */
export async function applyCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<{ purchaseId: string | null }> {
  const userId = await userIdOf(session.metadata, session.customer);
  const customerId = idOf(session.customer);
  if (userId && customerId) {
    await db.user.updateMany({
      where: { id: userId, stripeCustomerId: "" },
      data: { stripeCustomerId: customerId },
    });
  }
  if (session.subscription) {
    const sub =
      typeof session.subscription === "string"
        ? await stripe().subscriptions.retrieve(session.subscription)
        : session.subscription;
    await applySubscription(sub);
  }
  let purchaseId: string | null = null;
  if (session.invoice) {
    const invoice =
      typeof session.invoice === "string" ? await stripe().invoices.retrieve(session.invoice) : session.invoice;
    purchaseId = await recordInvoice(invoice);
  }
  return { purchaseId };
}

// A refunded charge marks its invoice's Purchase refunded. The charge names
// its payment intent; the invoice payments list names the invoice.
async function applyRefund(charge: Stripe.Charge): Promise<void> {
  if (!charge.refunded) return;
  const paymentIntent = idOf(charge.payment_intent);
  if (!paymentIntent) return;
  const payments = await stripe().invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntent },
    limit: 10,
  });
  const invoiceIds = payments.data.map((p) => idOf(p.invoice)).filter(Boolean);
  if (invoiceIds.length === 0) return;
  await db.purchase.updateMany({
    where: { stripeInvoiceId: { in: invoiceIds } },
    data: { status: "REFUNDED" },
  });
}

/** Every Stripe event the webhook handles. Unknown types do nothing. */
export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await applyCheckoutSession(event.data.object);
      return;
    case "invoice.paid":
      await recordInvoice(event.data.object);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object);
      return;
    case "charge.refunded":
      await applyRefund(event.data.object);
      return;
    default:
      return;
  }
}
