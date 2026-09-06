import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { loadFinancials, type Financials } from "@/lib/billing/financials";
import { pricesConfigured, stripeConfigured, webhookConfigured } from "@/lib/billing/stripe";
import { serverT } from "@/lib/i18n/server";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { TIER_LABEL } from "@/lib/tiers";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

// Admin: financials (SPEC.md §20) — MRR and revenue from Stripe beside the
// usage page's AI cost, so margin is one subtraction. Server-rendered; the
// page reads Subscription, Payment, and UsageEvent and writes nothing.

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
function fmtUsd(v: number): string {
  return v >= 100 ? `$${Math.round(v).toLocaleString()}` : v >= 0.01 ? `$${v.toFixed(2)}` : v > 0 ? "<$0.01" : "$0.00";
}
function fmtUsdSigned(v: number): string {
  return v < 0 ? `−${fmtUsd(-v)}` : fmtUsd(v);
}
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 shadow-soft">
      <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-sand-800 tabular-nums">{value}</p>
      {detail && <p className="text-[10px] text-sand-500">{detail}</p>}
    </div>
  );
}

// Daily columns, last 30 days: revenue beside AI cost, both in dollars.
function DailyChart({ t, days }: { t: TFunc; days: Financials["days"] }) {
  const W = 600;
  const H = 90;
  const max = Math.max(...days.map((d) => Math.max(d.revenueCents / 100, d.costUsd)), 1e-9);
  const slot = W / days.length;
  const barW = Math.min(7, Math.max(2, (slot - 3) / 2));
  const h = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / max) * H));
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{t("admin.finDaily")}</p>
        <p className="flex gap-3 text-[10px] text-sand-500">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-clay-400" /> {t("admin.finLegendRevenue")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-sand-400" /> {t("admin.finLegendCost")}
          </span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={t("admin.finDaily")}>
        {days.map((d, i) => {
          const x = i * slot + (slot - barW * 2 - 1) / 2;
          const rh = h(d.revenueCents / 100);
          const ch = h(d.costUsd);
          return (
            <g key={d.day}>
              <rect x={x} y={H - rh} width={barW} height={rh} rx={1} className="fill-clay-400">
                <title>{`${d.day.slice(5)} · ${t("admin.finLegendRevenue")} ${fmtUsd(d.revenueCents / 100)}`}</title>
              </rect>
              <rect x={x + barW + 1} y={H - ch} width={barW} height={ch} rx={1} className="fill-sand-400">
                <title>{`${d.day.slice(5)} · ${t("admin.finLegendCost")} ${fmtUsd(d.costUsd)}`}</title>
              </rect>
            </g>
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

export default async function AdminFinancialsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();
  const configured = stripeConfigured() && webhookConfigured() && pricesConfigured();

  // Force-dynamic admin page: the clock is the query parameter.
  // eslint-disable-next-line react-hooks/purity
  const f = await loadFinancials(Date.now());
  const cur = f.currency;
  const margin30 = f.revenue30Cents / 100 - f.cost30Usd;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <AdminNav active="financials" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.financials")}</h1>
        <p className="text-sm text-sand-600">{t("admin.financialsDesc")}</p>
      </header>

      {!configured && <p className="mb-4 text-sm text-sand-600">{t("admin.financialsOff")}</p>}
      {f.paymentsCount === 0 && f.subscriptions.length === 0 && (
        <p className="mb-4 text-sm text-sand-600">{t("admin.financialsEmpty")}</p>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t("admin.finMrr")} value={fmtMoney(f.mrrCents, cur)} />
          <Tile
            label={t("admin.finSubscribers")}
            value={String(f.subscribers.PREMIUM + f.subscribers.ULTRA)}
            detail={t("admin.finSubscribersDetail", { premium: f.subscribers.PREMIUM, ultra: f.subscribers.ULTRA })}
          />
          <Tile label={t("admin.finRevenue30")} value={fmtMoney(f.revenue30Cents, cur)} />
          <Tile label={t("admin.finRevenue90")} value={fmtMoney(f.revenue90Cents, cur)} />
          <Tile label={t("admin.finCost30")} value={fmtUsd(f.cost30Usd)} />
          <Tile label={t("admin.finMargin30")} value={fmtUsdSigned(margin30)} />
          <Tile label={t("admin.finRefunds90")} value={fmtMoney(-f.refunds90Cents, cur)} />
          <Tile label={t("admin.finFailed30")} value={String(f.failed30)} />
        </div>

        <DailyChart t={t} days={f.days} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-card p-4 shadow-soft">
            <p className="mb-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{t("admin.finUnit")}</p>
            <div className="space-y-2 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sand-700">{t("admin.finActiveAccounts")}</span>
                <span className="font-semibold text-sand-800 tabular-nums">{f.activeAccounts30}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sand-700">{t("admin.finCostPerAccount")}</span>
                <span className="font-semibold text-sand-800 tabular-nums">{fmtUsd(f.costPerActiveAccount30Usd)}</span>
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-card p-4 shadow-soft">
            <p className="mb-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{t("admin.finPerCall")}</p>
            <div className="space-y-1.5">
              {f.features.slice(0, 10).map((r) => (
                <div key={r.feature} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate font-mono text-sand-800">{r.feature}</span>
                  <span className="shrink-0 text-[10px] text-sand-500">
                    {t("admin.finPerCallDetail", { calls: r.calls, total: fmtUsd(r.costUsd) })}
                  </span>
                  <span className="shrink-0 font-semibold text-sand-800 tabular-nums">{fmtUsd(r.perCallUsd)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
          <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
            {t("admin.finSubscriptions")}
          </p>
          {f.subscriptions.length === 0 ? (
            <p className="text-xs text-sand-600">{t("admin.finNoSubscriptions")}</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                  <th className="py-2 font-semibold">{t("admin.finColAccount")}</th>
                  <th className="px-3 py-2 font-semibold">{t("admin.finColTier")}</th>
                  <th className="px-3 py-2 font-semibold">{t("admin.finColStatus")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.finColPrice")}</th>
                  <th className="px-3 py-2 font-semibold">{t("admin.finColRenews")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.finColRevenue")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.finColCost")}</th>
                  <th className="py-2 text-right font-semibold">{t("admin.finColMargin")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {f.subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td className="max-w-[220px] truncate py-2 text-sand-800">{s.email}</td>
                    <td className="px-3 py-2">{TIER_LABEL[s.tier]}</td>
                    <td className="px-3 py-2 font-mono">{s.status}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtMoney(s.amountCents, s.currency)}
                      {s.interval === "year" ? t("admin.finPerYear") : t("admin.finPerMonth")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {s.cancelAtPeriodEnd
                        ? t("admin.finEnds", { date: fmtDate(s.currentPeriodEnd) })
                        : fmtDate(s.currentPeriodEnd)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.revenue90Cents, s.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(s.cost90Usd)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {fmtUsdSigned(s.revenue90Cents / 100 - s.cost90Usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
