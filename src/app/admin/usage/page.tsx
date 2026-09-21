import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { gatewayConfigured } from "@/lib/gateway";
import {
  gatewayAdminConfigured,
  gatewayErrorMessage,
  gatewaySpend,
  gatewayTagSpend,
  type GatewaySpend,
  type GatewayTagSpend,
} from "@/lib/gateway-admin";
import { providerOf } from "@/lib/usage";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { serverT } from "@/lib/i18n/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { BarList, DailyChart, fmtTok, fmtUsd, Tile } from "@/components/admin/charts";

export const dynamic = "force-dynamic";

// Admin: AI cost and tokens (Scalae admin pattern) — totals, per function,
// per model, per account, per day. Server-rendered. With the gateway set
// (SPEC.md §2), the figures are the gateway's: every call it carried, at
// the provider's price, under the model that answered; the app's own
// records then cover only what the gateway does not price — Deepgram,
// DeepL, the Edge voice, the browser, email — and one tile says what the
// app's own count makes of the gateway's models, as a check on the two
// price lists. Without the gateway, the app's records are the whole page,
// priced at list at call time.

// The providers whose cost the gateway prices (litellm/config.yaml). The
// rest is priced by the app alone.
const GATEWAY_PROVIDERS = new Set(["zai", "moonshot", "anthropic", "google", "groq", "openai"]);

type Fetched<T> = { ok: true; data: T } | { ok: false; error: string };

async function fetched<T>(run: () => Promise<T>): Promise<Fetched<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    return { ok: false, error: gatewayErrorMessage(err) };
  }
}

export default async function AdminUsagePage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  // Force-dynamic admin page: the clock is the query parameter.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since30 = new Date(now - 30 * 86_400_000);

  const gateway = gatewayConfigured() && gatewayAdminConfigured();

  // The horizons (SPEC.md §7): the app's own records are kept for good, so
  // every window is a slice of one history — the last 7, 30, 90, and 365
  // days, and all time since the first call — each with its total and its
  // averages per day and per call. All time's days run from the first
  // record, so its per-day average is over days the app was in use.
  const first = await db.usageEvent.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const firstDay = first ? new Date(first.createdAt) : new Date(now);
  const allDays = Math.max(1, Math.ceil((now - firstDay.getTime()) / 86_400_000));
  const HORIZONS: { key: string; days: number | null }[] = [
    { key: "7", days: 7 },
    { key: "30", days: 30 },
    { key: "90", days: 90 },
    { key: "365", days: 365 },
    { key: "all", days: null },
  ];
  const horizons = await Promise.all(
    HORIZONS.map(async (h) => {
      const since = h.days === null ? undefined : new Date(now - h.days * 86_400_000);
      const agg = await db.usageEvent.aggregate({
        where: since ? { createdAt: { gte: since } } : {},
        _count: true,
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      });
      const days = h.days === null ? allDays : Math.min(h.days, allDays);
      const cost = agg._sum.costUsd ?? 0;
      return {
        key: h.key,
        days,
        cost,
        calls: agg._count,
        tokens: (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0),
        perDay: cost / days,
        callsPerDay: agg._count / days,
        perCall: agg._count > 0 ? cost / agg._count : 0,
      };
    }),
  );

  const [totals, cost30, byFeature, byModel, byUser, byDayRaw, users, byModel30, byFeature30, spend, tags] = await Promise.all([
    // All time: the app's records are never deleted (SPEC.md §7).
    db.usageEvent.aggregate({
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costUsd: true },
    }),
    db.usageEvent.aggregate({
      where: { createdAt: { gte: since30 } },
      _sum: { costUsd: true },
    }),
    db.usageEvent.groupBy({
      by: ["feature"],
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    }),
    db.usageEvent.groupBy({
      by: ["model"],
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    }),
    db.usageEvent.groupBy({
      by: ["userId"],
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    }),
    db.$queryRaw<{ day: Date; cost: number }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, sum("costUsd")::float8 AS cost
      FROM "UsageEvent" WHERE "createdAt" >= ${since30}
      GROUP BY 1 ORDER BY 1`),
    db.user.findMany({ select: { id: true, email: true } }),
    // The last 30 days by model and by function, for the gateway view: what
    // the app's own count makes of the gateway's models, and the cost of
    // the services outside the gateway.
    db.usageEvent.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since30 } },
      _sum: { costUsd: true },
    }),
    db.usageEvent.groupBy({
      by: ["feature", "model"],
      where: { createdAt: { gte: since30 } },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    gateway ? fetched<GatewaySpend>(() => gatewaySpend(30)) : null,
    gateway ? fetched<GatewayTagSpend>(() => gatewayTagSpend(30)) : null,
  ]);
  // The app's own count over 30 days, split by whether the gateway prices
  // the model: the gateway providers' part is the cross-check tile; the
  // rest is the "outside the gateway" figure and its by-function rows.
  const appGatewayUsd = byModel30
    .filter((r) => GATEWAY_PROVIDERS.has(providerOf(r.model)))
    .reduce((sum, r) => sum + (r._sum.costUsd ?? 0), 0);
  const outside = byFeature30.filter((r) => !GATEWAY_PROVIDERS.has(providerOf(r.model)));
  const outsideUsd = outside.reduce((sum, r) => sum + (r._sum.costUsd ?? 0), 0);
  const outsideByFeature = [...outside
    .reduce((acc, r) => {
      const row = acc.get(r.feature) ?? { label: r.feature, costUsd: 0, tokens: 0, calls: 0 };
      row.costUsd += r._sum.costUsd ?? 0;
      row.tokens += (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
      row.calls += r._count;
      acc.set(r.feature, row);
      return acc;
    }, new Map<string, { label: string; costUsd: number; tokens: number; calls: number }>())
    .values()].sort((a, b) => b.costUsd - a.costUsd);

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
        <p className="text-sm text-sand-600">{gateway ? t("admin.usageGatewayDesc") : t("admin.usageDesc")}</p>
      </header>

      {gateway && spend && !spend.ok && <p className="mb-4 text-xs text-red-600">{spend.error}</p>}
      {gateway && spend?.ok ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t("admin.gatewaySpend30")} value={fmtUsd(spend.data.totalUsd)} />
            <Tile label={t("admin.usageAppCount")} value={fmtUsd(appGatewayUsd)} />
            <Tile label={t("admin.usageOutside")} value={fmtUsd(outsideUsd)} />
            <Tile label={t("admin.gatewayRequests")} value={spend.data.requests.toLocaleString()} />
            <Tile label={t("admin.gatewayFailed")} value={spend.data.failed.toLocaleString()} />
            <Tile label={t("admin.usageTokensIn")} value={fmtTok(spend.data.inputTokens)} />
            <Tile label={t("admin.usageTokensOut")} value={fmtTok(spend.data.outputTokens)} />
            <Tile label={t("admin.usageCacheRead")} value={fmtTok(spend.data.cacheReadTokens)} />
          </div>
          <p className="text-xs text-sand-500">{t("admin.usageAppCountHint")}</p>

          <HorizonTable
            t={t}
            rows={horizons}
            firstDay={firstDay}
          />

          <DailyChart title={t("admin.gatewayDaily")} days={spend.data.days} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <BarList t={t} title={t("admin.usageByProvider")} rows={spend.data.byProvider} />
            <BarList t={t} title={t("admin.usageByModel")} rows={spend.data.byModel} />
            {tags?.ok ? (
              <BarList t={t} title={t("admin.usageByFunction")} rows={tags.data.byFeature} />
            ) : (
              <BarList t={t} title={t("admin.usageOutsideBy")} rows={outsideByFeature} />
            )}
          </div>
          {tags && !tags.ok && <p className="text-xs text-red-600">{tags.error}</p>}

          {tags?.ok && (
            <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
              <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                {t("admin.usageByUser")}
              </p>
              {tags.data.byUser.length === 0 ? (
                <p className="text-xs text-sand-500">{t("admin.gatewayNoTagged")}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                      <th className="py-2 font-semibold">{t("admin.usageColAccount")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColCalls")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("admin.gatewayColTokens")}</th>
                      <th className="py-2 text-right font-semibold">{t("admin.usageColCost")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {tags.data.byUser.map((r) => (
                      <tr key={r.label}>
                        <td className="max-w-[240px] truncate py-2 text-sand-800">
                          {emailOf.get(r.label) ?? (r.label === "user-1" ? t("admin.localReader") : r.label)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtTok(r.tokens)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{fmtUsd(r.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tags?.ok && outsideByFeature.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <BarList t={t} title={t("admin.usageOutsideBy")} rows={outsideByFeature} />
            </div>
          )}
        </div>
      ) : calls === 0 ? (
        <p className="text-sm text-sand-600">{t("admin.usageEmpty")}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={t("admin.usageCostAll")} value={fmtUsd(totals._sum.costUsd ?? 0)} />
            <Tile label={t("admin.usageCost30")} value={fmtUsd(cost30._sum.costUsd ?? 0)} />
            <Tile label={t("admin.usageCalls")} value={calls.toLocaleString()} />
            <Tile label={t("admin.usageTokensIn")} value={fmtTok(totals._sum.inputTokens ?? 0)} />
            <Tile label={t("admin.usageTokensOut")} value={fmtTok(totals._sum.outputTokens ?? 0)} />
            <Tile label={t("admin.usageCacheRead")} value={fmtTok(totals._sum.cacheReadTokens ?? 0)} />
          </div>

          <HorizonTable
            t={t}
            rows={horizons}
            firstDay={firstDay}
          />

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

type HorizonRow = { key: string; days: number; cost: number; calls: number; tokens: number; perDay: number; callsPerDay: number; perCall: number };

// The horizons table: one row per window, its total and its averages. The
// all-time row says when the record starts.
function HorizonTable({ t, rows, firstDay }: { t: TFunc; rows: HorizonRow[]; firstDay: Date }) {
  const label = (row: HorizonRow) =>
    row.key === "all" ? t("admin.usageHorizonAll", { date: firstDay.toISOString().slice(0, 10) }) : t("admin.usageHorizonDays", { n: row.key });
  return (
    <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
      <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{t("admin.usageHorizons")}</p>
      <p className="mb-2 text-xs text-sand-500">{t("admin.usageHorizonsHint")}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
            <th className="py-2 font-semibold">{t("admin.usageColWindow")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColCost")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColCalls")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("admin.gatewayColTokens")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColPerDay")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("admin.usageColCallsPerDay")}</th>
            <th className="py-2 text-right font-semibold">{t("admin.usageColPerCall")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="py-2 text-sand-800">{label(row)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtUsd(row.cost)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.calls.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtTok(row.tokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(row.perDay)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.callsPerDay.toFixed(1)}</td>
              <td className="py-2 text-right tabular-nums">{fmtUsd(row.perCall)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
