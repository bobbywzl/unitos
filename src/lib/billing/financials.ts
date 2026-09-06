import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Tier } from "@/lib/tiers";

// The admin financials page's numbers (SPEC.md §20): revenue from Payment,
// MRR from Subscription, AI cost from UsageEvent — the same rows the usage
// page sums, so margin is revenue less the usage page's cost.

const DAY = 86_400_000;

// Stripe statuses that count toward MRR: the subscriptions that grant access.
const MRR_STATUSES = ["active", "trialing", "past_due"];

export type SubscriptionRow = {
  id: string;
  userId: string;
  email: string;
  tier: Tier;
  status: string;
  interval: string;
  amountCents: number;
  currency: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  revenue90Cents: number;
  cost90Usd: number;
};

export type FeatureUnit = { feature: string; calls: number; costUsd: number; perCallUsd: number };

export type Financials = {
  currency: string;
  mrrCents: number;
  subscribers: Record<Tier, number>;
  revenue30Cents: number;
  revenue90Cents: number;
  refunds90Cents: number;
  failed30: number;
  cost30Usd: number;
  cost90Usd: number;
  // Accounts with at least one model call in the last 30 days, and their
  // average cost — the unit the tier prices are set against.
  activeAccounts30: number;
  costPerActiveAccount30Usd: number;
  days: { day: string; revenueCents: number; costUsd: number }[];
  subscriptions: SubscriptionRow[];
  features: FeatureUnit[];
  paymentsCount: number;
};

const monthly = (amountCents: number, interval: string) =>
  interval === "year" ? amountCents / 12 : interval === "week" ? amountCents * 4.33 : interval === "day" ? amountCents * 30 : amountCents;

export async function loadFinancials(now: number): Promise<Financials> {
  const since30 = new Date(now - 30 * DAY);
  const since90 = new Date(now - 90 * DAY);

  const [subs, paid30, paid90, refunds90, failed30, cost30, cost90, active30, byDayRevenue, byDayCost, byUserRevenue, byUserCost, byFeature, paymentsCount] =
    await Promise.all([
      db.subscription.findMany({
        where: { status: { in: MRR_STATUSES } },
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
      }),
      db.payment.aggregate({
        where: { createdAt: { gte: since30 }, status: { in: ["paid", "refunded"] } },
        _sum: { amountCents: true },
      }),
      db.payment.aggregate({
        where: { createdAt: { gte: since90 }, status: { in: ["paid", "refunded"] } },
        _sum: { amountCents: true },
      }),
      db.payment.aggregate({
        where: { createdAt: { gte: since90 }, kind: "refund" },
        _sum: { amountCents: true },
      }),
      db.payment.count({ where: { createdAt: { gte: since30 }, status: "failed" } }),
      db.usageEvent.aggregate({ where: { createdAt: { gte: since30 } }, _sum: { costUsd: true } }),
      db.usageEvent.aggregate({ where: { createdAt: { gte: since90 } }, _sum: { costUsd: true } }),
      db.usageEvent.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since30 }, userId: { not: null } },
        _sum: { costUsd: true },
      }),
      db.$queryRaw<{ day: Date; cents: number }[]>(Prisma.sql`
        SELECT date_trunc('day', "createdAt") AS day, sum("amountCents")::float8 AS cents
        FROM "Payment" WHERE "createdAt" >= ${since30} AND "status" IN ('paid', 'refunded')
        GROUP BY 1 ORDER BY 1`),
      db.$queryRaw<{ day: Date; cost: number }[]>(Prisma.sql`
        SELECT date_trunc('day', "createdAt") AS day, sum("costUsd")::float8 AS cost
        FROM "UsageEvent" WHERE "createdAt" >= ${since30}
        GROUP BY 1 ORDER BY 1`),
      db.payment.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since90 }, status: { in: ["paid", "refunded"] } },
        _sum: { amountCents: true },
      }),
      db.usageEvent.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since90 } },
        _sum: { costUsd: true },
      }),
      db.usageEvent.groupBy({
        by: ["feature"],
        where: { createdAt: { gte: since90 } },
        _count: true,
        _sum: { costUsd: true },
        orderBy: { _sum: { costUsd: "desc" } },
      }),
      db.payment.count(),
    ]);

  const revenueOf = new Map(byUserRevenue.map((r) => [r.userId, r._sum.amountCents ?? 0]));
  const costOf = new Map(byUserCost.map((r) => [r.userId, r._sum.costUsd ?? 0]));

  const subscribers: Record<Tier, number> = { FREE: 0, PREMIUM: 0, ULTRA: 0 };
  let mrrCents = 0;
  for (const s of subs) {
    subscribers[s.tier] += 1;
    mrrCents += monthly(s.amountCents, s.interval);
  }

  const revenueByDay = new Map(byDayRevenue.map((d) => [d.day.toISOString().slice(0, 10), d.cents]));
  const costByDay = new Map(byDayCost.map((d) => [d.day.toISOString().slice(0, 10), d.cost]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10);
    return { day, revenueCents: revenueByDay.get(day) ?? 0, costUsd: costByDay.get(day) ?? 0 };
  });

  const activeCost = active30.reduce((sum, r) => sum + (r._sum.costUsd ?? 0), 0);

  return {
    currency: subs[0]?.currency ?? "usd",
    mrrCents: Math.round(mrrCents),
    subscribers,
    revenue30Cents: paid30._sum.amountCents ?? 0,
    revenue90Cents: paid90._sum.amountCents ?? 0,
    refunds90Cents: refunds90._sum.amountCents ?? 0,
    failed30,
    cost30Usd: cost30._sum.costUsd ?? 0,
    cost90Usd: cost90._sum.costUsd ?? 0,
    activeAccounts30: active30.length,
    costPerActiveAccount30Usd: active30.length ? activeCost / active30.length : 0,
    days,
    subscriptions: subs.map((s) => ({
      id: s.id,
      userId: s.userId,
      email: s.user.email,
      tier: s.tier,
      status: s.status,
      interval: s.interval,
      amountCents: s.amountCents,
      currency: s.currency,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      revenue90Cents: revenueOf.get(s.userId) ?? 0,
      cost90Usd: costOf.get(s.userId) ?? 0,
    })),
    features: byFeature.map((r) => ({
      feature: r.feature,
      calls: r._count,
      costUsd: r._sum.costUsd ?? 0,
      perCallUsd: r._count ? (r._sum.costUsd ?? 0) / r._count : 0,
    })),
    paymentsCount,
  };
}
