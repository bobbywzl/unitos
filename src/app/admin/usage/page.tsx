import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

// Admin: AI cost and tokens (Scalae admin pattern) — totals, per function,
// per model, per account, per day. Server-rendered; figures are estimates
// from list prices at call time.

function fmtUsd(v: number): string {
  return v >= 100 ? `$${Math.round(v).toLocaleString()}` : v >= 0.01 ? `$${v.toFixed(2)}` : v > 0 ? "<$0.01" : "$0.00";
}
function fmtTok(v: number): string {
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(1)}k` : String(v);
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 shadow-soft">
      <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-sand-800 tabular-nums">{value}</p>
    </div>
  );
}

// Horizontal magnitude bars: label left, value at the tip, detail under.
function BarList({
  t,
  title,
  rows,
}: {
  t: TFunc;
  title: string;
  rows: { label: string; costUsd: number; tokens: number; calls: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.costUsd), 1e-9);
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <p className="mb-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{title}</p>
      <div className="space-y-2.5">
        {rows.slice(0, 8).map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate font-mono text-xs text-sand-800">{r.label}</span>
              <span className="shrink-0 text-xs font-semibold text-sand-800 tabular-nums">
                {fmtUsd(r.costUsd)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sand-100">
              <div
                className="h-full rounded-full bg-clay-400"
                style={{ width: `${Math.max(2, (r.costUsd / max) * 100)}%` }}
              />
            </div>
            <p className="mt-0.5 text-[10px] text-sand-500">
              {t("admin.usageDetail", { tokens: fmtTok(r.tokens), calls: r.calls })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Daily columns, last 30 days, server-rendered SVG.
function DailyChart({ title, days }: { title: string; days: { day: string; costUsd: number }[] }) {
  const W = 600;
  const H = 90;
  const max = Math.max(...days.map((d) => d.costUsd), 1e-9);
  const slot = W / days.length;
  const barW = Math.min(16, Math.max(4, slot - 2));
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{title}</p>
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={title}>
        {days.map((d, i) => {
          const h = d.costUsd <= 0 ? 0 : Math.max(2, (d.costUsd / max) * H);
          return (
            <rect
              key={d.day}
              x={i * slot + (slot - barW) / 2}
              y={H - h}
              width={barW}
              height={h}
              rx={2}
              className="fill-clay-400"
            >
              <title>{`${d.day.slice(5)} · ${fmtUsd(d.costUsd)}`}</title>
            </rect>
          );
        })}
        <line x1="0" y1={H} x2={W} y2={H} className="stroke-line" strokeWidth="1" />
        <text x="0" y={H + 11} className="fill-sand-500" fontSize="9">
          {days[0]?.day.slice(5)}
        </text>
        <text x={W} y={H + 11} textAnchor="end" className="fill-sand-500" fontSize="9">
          {days.at(-1)?.day.slice(5)}
        </text>
      </svg>
    </div>
  );
}

export default async function AdminUsagePage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  // Force-dynamic admin page: the clock is the query parameter.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since90 = new Date(now - 90 * 86_400_000);
  const since30 = new Date(now - 30 * 86_400_000);

  const [totals, cost30, byProvider, byFeature, byModel, byUser, byDayRaw, users] = await Promise.all([
    db.usageEvent.aggregate({
      where: { createdAt: { gte: since90 } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costUsd: true },
    }),
    db.usageEvent.aggregate({
      where: { createdAt: { gte: since30 } },
      _sum: { costUsd: true },
    }),
    // Every model call stamps its provider (anthropic, google, groq, openai),
    // so the cost of each API account is one row here.
    db.usageEvent.groupBy({
      by: ["provider"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
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
              rows={rowsOf(byProvider.map((r) => ({ ...r, label: r.provider })))}
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
