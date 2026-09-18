import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { gatewayConfigured } from "@/lib/gateway";
import { providerOf } from "@/lib/usage";
import { serverT } from "@/lib/i18n/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { BarList, DailyChart, fmtTok, fmtUsd, Tile } from "@/components/admin/charts";

export const dynamic = "force-dynamic";

// Admin: AI cost and tokens (Scalae admin pattern) — totals, per function,
// per model, per account, per day. Server-rendered; figures are estimates
// from list prices at call time.

export default async function AdminUsagePage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  // Force-dynamic admin page: the clock is the query parameter.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since90 = new Date(now - 90 * 86_400_000);
  const since30 = new Date(now - 30 * 86_400_000);

  const [totals, cost30, byFeature, byModel, byUser, byDayRaw, users] = await Promise.all([
    db.usageEvent.aggregate({
      where: { createdAt: { gte: since90 } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costUsd: true },
    }),
    db.usageEvent.aggregate({
      where: { createdAt: { gte: since30 } },
      _sum: { costUsd: true },
    }),
    db.usageEvent.groupBy({
      by: ["feature"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    }),
    db.usageEvent.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    }),
    db.usageEvent.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    }),
    db.$queryRaw<{ day: Date; cost: number }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, sum("costUsd")::float8 AS cost
      FROM "UsageEvent" WHERE "createdAt" >= ${since30}
      GROUP BY 1 ORDER BY 1`),
    db.user.findMany({ select: { id: true, email: true } }),
  ]);

  // The provider of each row is read from its model (lib/usage.ts), not from
  // the provider column it was written with: a row stamped before a provider
  // was named would otherwise sit under the wrong one forever.
  const byProvider = [...byModel
    .reduce((acc, r) => {
      const key = providerOf(r.model);
      const row = acc.get(key) ?? { label: key, _count: 0, _sum: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
      row._count += r._count;
      row._sum.inputTokens += r._sum.inputTokens ?? 0;
      row._sum.outputTokens += r._sum.outputTokens ?? 0;
      row._sum.costUsd += r._sum.costUsd ?? 0;
      acc.set(key, row);
      return acc;
    }, new Map<string, { label: string; _count: number; _sum: { inputTokens: number; outputTokens: number; costUsd: number } }>())
    .values()].sort((a, b) => b._sum.costUsd - a._sum.costUsd);

  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  const calls = totals._count;

  // Fill the trailing 30 calendar days so quiet days render as gaps.
  const costByDay = new Map(byDayRaw.map((d) => [d.day.toISOString().slice(0, 10), d.cost]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, costUsd: costByDay.get(day) ?? 0 };
  });

  const rowsOf = (
    rows: { label: string; _count: number; _sum: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null } }[],
  ) =>
    rows.map((r) => ({
      label: r.label,
      costUsd: r._sum.costUsd ?? 0,
      tokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
      calls: r._count,
    }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav active="usage" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.usage")}</h1>
        <p className="text-sm text-sand-600">{t("admin.usageDesc")}</p>
        {gatewayConfigured() && <p className="text-sm text-sand-600">{t("admin.usageGatewayNote")}</p>}
      </header>

      {calls === 0 ? (
        <p className="text-sm text-sand-600">{t("admin.usageEmpty")}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={t("admin.usageCost90")} value={fmtUsd(totals._sum.costUsd ?? 0)} />
            <Tile label={t("admin.usageCost30")} value={fmtUsd(cost30._sum.costUsd ?? 0)} />
            <Tile label={t("admin.usageCalls")} value={calls.toLocaleString()} />
            <Tile label={t("admin.usageTokensIn")} value={fmtTok(totals._sum.inputTokens ?? 0)} />
            <Tile label={t("admin.usageTokensOut")} value={fmtTok(totals._sum.outputTokens ?? 0)} />
            <Tile label={t("admin.usageCacheRead")} value={fmtTok(totals._sum.cacheReadTokens ?? 0)} />
          </div>

          <DailyChart title={t("admin.usageDaily")} days={days} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <BarList
              t={t}
              title={t("admin.usageByProvider")}
              rows={rowsOf(byProvider)}
            />
            <BarList
              t={t}
              title={t("admin.usageByFunction")}
              rows={rowsOf(byFeature.map((r) => ({ ...r, label: r.feature })))}
            />
            <BarList
              t={t}
              title={t("admin.usageByModel")}
              rows={rowsOf(byModel.map((r) => ({ ...r, label: r.model })))}
            />
          </div>

          <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
            <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
              {t("admin.usageByUser")}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                  <th className="py-2 font-semibold">{t("admin.usageColAccount")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColCalls")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColInput")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColOutput")}</th>
                  <th className="py-2 text-right font-semibold">{t("admin.usageColCost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byUser.map((r) => (
                  <tr key={r.userId ?? "-"}>
                    <td className="max-w-[240px] truncate py-2 text-sand-800">
                      {r.userId
                        ? (emailOf.get(r.userId) ?? (r.userId === "user-1" ? t("admin.localReader") : r.userId))
                        : t("admin.usageBackground")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r._count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtTok(r._sum.inputTokens ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtTok(r._sum.outputTokens ?? 0)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{fmtUsd(r._sum.costUsd ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
