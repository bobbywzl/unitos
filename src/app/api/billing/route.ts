import { NextResponse } from "next/server";
import { authEnabled, currentUser } from "@/lib/auth";
import { loadPrices } from "@/lib/billing/prices";
import { pricesConfigured, stripeConfigured } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// The account's tier, subscription, and live Stripe prices (SPEC.md §20).
// The Settings billing section is the one reader-facing caller.
export async function GET() {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });

  const billing = authEnabled() && stripeConfigured() && pricesConfigured();

  const subscription = authEnabled()
    ? await db.subscription.findFirst({
        where: { userId: user.id, status: { in: ["active", "trialing", "past_due"] } },
        orderBy: { currentPeriodEnd: "desc" },
        select: {
          tier: true,
          status: true,
          interval: true,
          amountCents: true,
          currency: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      })
    : null;

  return NextResponse.json({
    tier: user.tier,
    billing,
    hasCustomer: Boolean(user.stripeCustomerId),
    subscription,
    prices: billing ? await loadPrices() : null,
  });
}
