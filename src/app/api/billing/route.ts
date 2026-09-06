import { NextResponse } from "next/server";
import { authEnabled, currentUser } from "@/lib/auth";
import { pricesConfigured, stripeConfigured } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// The account's tier and subscription (SPEC.md §20). No UI reads this yet;
// the future billing section of Settings will.
export async function GET() {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });

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
    billing: authEnabled() && stripeConfigured() && pricesConfigured(),
    subscription,
  });
}
