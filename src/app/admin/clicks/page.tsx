import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/admin-auth";
import { CLICK_SURFACES, isClickSurface, type ClickSurface } from "@/lib/clicks";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

// Admin: click frequency per reader control (SPEC.md §7) — where readers
// click (surface) and which controls they use (control). Server-rendered like
// the usage page; every figure is the last 90 days unless a column says
// otherwise. The table under the charts carries every value the charts show.

const DAY = 86_400_000;

const SURFACE_LABEL: Record<ClickSurface, TKey> = {
  topbar: "admin.surfaceTopbar",
  sidebar: "admin.surfaceSidebar",
  "ai-toolbar": "admin.surfaceAiToolbar",
  "article-menu": "admin.surfaceArticleMenu",
  reader: "admin.surfaceReader",
  tray: "admin.surfaceTray",
};

// One hue per surface, in this fixed order (the dataviz reference palette,
// validated on the card surface in both themes). Marks wear these; text never
// does — the swatch beside a label carries the identity.
const SURFACE_COLOR: Record<ClickSurface, { light: string; dark: string }> = {
  topbar: { light: "#2a78d6", dark: "#3987e5" },
  sidebar: { light: "#eb6834", dark: "#d95926" },
  "ai-toolbar": { light: "#1baf7a", dark: "#199e70" },
  "article-menu": { light: "#eda100", dark: "#c98500" },
  reader: { light: "#e87ba4", dark: "#d55181" },
  tray: { light: "#008300", dark: "#008300" },
};

// The three surfaces the page breaks down control by control.
const FOCUS_SURFACES: ClickSurface[] = ["topbar", "sidebar", "ai-toolbar"];

const seriesCss = [
  `.click-charts{${CLICK_SURFACES.map((s) => `--click-${s}:${SURFACE_COLOR[s].light};`).join("")}}`,
  `.dark .click-charts{${CLICK_SURFACES.map((s) => `--click-${s}:${SURFACE_COLOR[s].dark};`).join("")}}`,
].join(" ");

function colorOf(surface: ClickSurface): string {
  return `var(--click-${surface})`;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// Axis top: the smallest 1, 2, 5, or 10 × 10^k at or above the maximum.
function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

function ago(t: TFunc, now: number, then: Date | null): string {
  if (!then) return "";
  const minutes = Math.floor((now - then.getTime()) / 60_000);
  if (minutes < 1) return t("admin.agoNow");
  if (minutes < 60) return t("admin.agoMinutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("admin.agoHours", { n: hours });
  return t("admin.agoDays", { n: Math.floor(hours / 24) });
}

function Swatch({ surface }: { surface: ClickSurface }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: colorOf(surface) }}
    />
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 shadow-soft">
      <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-sand-800">{value}</p>
    </div>
  );
}

type BarRow = { key: string; label: ReactNode; count: number; color: string; detail?: string };

// Horizontal magnitude bars: label left, count at the tip, detail under.
function BarList({ title, empty, rows }: { title: string; empty: string; rows: BarRow[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <p className="mb-3 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-sand-500">{empty}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-sand-800">{r.label}</span>
                <span className="shrink-0 text-xs font-semibold text-sand-800 tabular-nums">{fmt(r.count)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-sand-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(2, (r.count / max) * 100)}%`, background: r.color }}
                />
              </div>
              {r.detail && <p className="mt-0.5 text-[10px] text-sand-500">{r.detail}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Day = { day: string; total: number; bySurface: Record<ClickSurface, number> };

// A column with a 4px rounded top and a square base.
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} H${x} Z`;
}

// Daily columns, last 30 days, stacked by surface, server-rendered SVG. A 2px
// surface gap separates the segments; the legend under the chart names them.
function DailyChart({ t, title, days }: { t: TFunc; title: string; days: Day[] }) {
  const W = 600;
  const H = 100;
  const PAD_L = 30;
  const PAD_T = 8; // room for the top tick label
  const top = niceCeil(Math.max(...days.map((d) => d.total), 1));
  const slot = (W - PAD_L) / days.length;
  const barW = Math.min(16, Math.max(4, slot - 2));
  const y = (v: number) => PAD_T + H - (v / top) * H;
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{title}</p>
      <svg viewBox={`0 0 ${W} ${H + PAD_T + 16}`} className="w-full" role="img" aria-label={title}>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD_L} y1={y(top * f)} x2={W} y2={y(top * f)} className="stroke-line" strokeWidth="1" />
            <text x={PAD_L - 5} y={y(top * f) + 3} textAnchor="end" className="fill-sand-500" fontSize="9">
              {fmt(top * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const stacked = CLICK_SURFACES.filter((s) => d.bySurface[s] > 0);
          let base = PAD_T + H;
          return (
            <g key={d.day}>
              {stacked.map((s, j) => {
                const h = (d.bySurface[s] / top) * H;
                const yTop = base - h;
                const gap = j === 0 || h <= 3 ? 0 : 2;
                const shape =
                  j === stacked.length - 1
                    ? columnPath(x, yTop, barW, h - gap)
                    : `M${x},${yTop} H${x + barW} V${base - gap} H${x} Z`;
                base = yTop;
                return (
                  <path key={s} d={shape} style={{ fill: colorOf(s) }}>
                    <title>
                      {t("admin.clicksSegment", {
                        day: d.day.slice(5),
                        surface: t(SURFACE_LABEL[s]),
                        n: fmt(d.bySurface[s]),
                        total: fmt(d.total),
                      })}
                    </title>
                  </path>
                );
              })}
            </g>
          );
        })}
        <line x1={PAD_L} y1={PAD_T + H} x2={W} y2={PAD_T + H} className="stroke-line" strokeWidth="1" />
        <text x={PAD_L} y={PAD_T + H + 12} className="fill-sand-500" fontSize="9">
          {days[0]?.day.slice(5)}
        </text>
        <text x={W} y={PAD_T + H + 12} textAnchor="end" className="fill-sand-500" fontSize="9">
          {days.at(-1)?.day.slice(5)}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {CLICK_SURFACES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[11px] text-sand-700">
            <Swatch surface={s} />
            {t(SURFACE_LABEL[s])}
          </span>
        ))}
      </div>
    </div>
  );
}

type ControlRow = {
  surface: ClickSurface;
  control: string;
  count90: number;
  count30: number;
  count7: number;
  accounts: number;
  last: Date | null;
};

export default async function AdminClicksPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  // Force-dynamic admin page: the clock is the query parameter.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since90 = new Date(now - 90 * DAY);
  const since30 = new Date(now - 30 * DAY);
  const since7 = new Date(now - 7 * DAY);

  const [rows90, rows30, rows7, rowsByUser, byUser, byDayRaw, users] = await Promise.all([
    db.clickEvent.groupBy({
      by: ["surface", "control"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _max: { createdAt: true },
    }),
    db.clickEvent.groupBy({
      by: ["surface", "control"],
      where: { createdAt: { gte: since30 } },
      _count: true,
    }),
    db.clickEvent.groupBy({
      by: ["surface", "control"],
      where: { createdAt: { gte: since7 } },
      _count: true,
    }),
    db.clickEvent.groupBy({
      by: ["surface", "control", "userId"],
      where: { createdAt: { gte: since90 } },
      _count: true,
    }),
    db.clickEvent.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _max: { createdAt: true },
    }),
    db.$queryRaw<{ day: Date; surface: string; n: number }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, "surface", count(*)::int AS n
      FROM "ClickEvent" WHERE "createdAt" >= ${since30}
      GROUP BY 1, 2 ORDER BY 1`),
    db.user.findMany({ select: { id: true, email: true } }),
  ]);

  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  const keyOf = (surface: string, control: string) => `${surface} ${control}`;
  const count30 = new Map(rows30.map((r) => [keyOf(r.surface, r.control), r._count]));
  const count7 = new Map(rows7.map((r) => [keyOf(r.surface, r.control), r._count]));
  const accountsOf = new Map<string, number>();
  for (const r of rowsByUser) {
    const key = keyOf(r.surface, r.control);
    accountsOf.set(key, (accountsOf.get(key) ?? 0) + 1);
  }
  const surfaceOrder = new Map<string, number>(CLICK_SURFACES.map((s, i) => [s, i]));

  const controls: ControlRow[] = rows90
    .flatMap((r) =>
      isClickSurface(r.surface)
        ? [
            {
              surface: r.surface,
              control: r.control,
              count90: r._count,
              count30: count30.get(keyOf(r.surface, r.control)) ?? 0,
              count7: count7.get(keyOf(r.surface, r.control)) ?? 0,
              accounts: accountsOf.get(keyOf(r.surface, r.control)) ?? 0,
              last: r._max.createdAt,
            },
          ]
        : [],
    )
    .sort(
      (a, b) =>
        b.count90 - a.count90 ||
        (surfaceOrder.get(a.surface) ?? 0) - (surfaceOrder.get(b.surface) ?? 0) ||
        a.control.localeCompare(b.control),
    );

  const total90 = controls.reduce((sum, r) => sum + r.count90, 0);
  const total30 = controls.reduce((sum, r) => sum + r.count30, 0);
  const total7 = controls.reduce((sum, r) => sum + r.count7, 0);
  const bySurface = CLICK_SURFACES.map((surface) => ({
    surface,
    count: controls.filter((r) => r.surface === surface).reduce((sum, r) => sum + r.count90, 0),
  }));
  const accounts = byUser.filter((r) => r.userId !== null).length;

  // Fill the trailing 30 calendar days so quiet days render as gaps.
  const dayMap = new Map<string, Day>();
  for (let i = 0; i < 30; i++) {
    const day = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10);
    dayMap.set(day, {
      day,
      total: 0,
      bySurface: Object.fromEntries(CLICK_SURFACES.map((s) => [s, 0])) as Record<ClickSurface, number>,
    });
  }
  for (const r of byDayRaw) {
    const entry = dayMap.get(r.day.toISOString().slice(0, 10));
    if (!entry || !isClickSurface(r.surface)) continue;
    entry.bySurface[r.surface] += r.n;
    entry.total += r.n;
  }
  const days = [...dayMap.values()];

  const controlLabel = (r: ControlRow) => (
    <>
      <Swatch surface={r.surface} />
      <span className="truncate font-mono">{r.control}</span>
    </>
  );

  const accountLabel = (userId: string | null) =>
    userId === null
      ? t("admin.clicksNoAccount")
      : (emailOf.get(userId) ?? (userId === "user-1" ? t("admin.localReader") : userId));

  return (
    <main className="click-charts mx-auto max-w-4xl px-6 py-8">
      <style>{seriesCss}</style>
      <AdminNav active="clicks" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.clicks")}</h1>
        <p className="text-sm text-sand-600">{t("admin.clicksDesc")}</p>
      </header>

      {total90 === 0 ? (
        <p className="text-sm text-sand-600">{t("admin.clicksEmpty")}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label={t("admin.clicks90")} value={fmt(total90)} />
            <Tile label={t("admin.clicks30")} value={fmt(total30)} />
            <Tile label={t("admin.clicks7")} value={fmt(total7)} />
            <Tile label={t("admin.clicksAccounts")} value={fmt(accounts)} />
            <Tile label={t("admin.clicksControls")} value={fmt(controls.length)} />
          </div>

          <DailyChart t={t} title={t("admin.clicksDaily")} days={days} />

          <div className="grid gap-4 sm:grid-cols-2">
            <BarList
              title={t("admin.clicksBySurface")}
              empty={t("admin.clicksNone")}
              rows={bySurface.map((r) => ({
                key: r.surface,
                label: (
                  <>
                    <Swatch surface={r.surface} />
                    {t(SURFACE_LABEL[r.surface])}
                  </>
                ),
                count: r.count,
                color: colorOf(r.surface),
                detail: t("admin.clicksShare", {
                  pct: total90 > 0 ? Math.round((r.count / total90) * 100) : 0,
                }),
              }))}
            />
            <BarList
              title={t("admin.clicksTopControls")}
              empty={t("admin.clicksNone")}
              rows={controls.slice(0, 8).map((r) => ({
                key: keyOf(r.surface, r.control),
                label: controlLabel(r),
                count: r.count90,
                color: colorOf(r.surface),
                detail: t(SURFACE_LABEL[r.surface]),
              }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FOCUS_SURFACES.map((surface) => (
              <BarList
                key={surface}
                title={t("admin.clicksBySurfaceControls", { surface: t(SURFACE_LABEL[surface]) })}
                empty={t("admin.clicksNone")}
                rows={controls
                  .filter((r) => r.surface === surface)
                  .slice(0, 8)
                  .map((r) => ({
                    key: r.control,
                    label: <span className="truncate font-mono">{r.control}</span>,
                    count: r.count90,
                    color: colorOf(surface),
                  }))}
              />
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
            <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
              {t("admin.clicksTable")}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                  <th className="py-2 font-semibold">{t("admin.clicksColSurface")}</th>
                  <th className="px-3 py-2 font-semibold">{t("admin.clicksColControl")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksCol90")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksCol30")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksCol7")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksColAccounts")}</th>
                  <th className="py-2 text-right font-semibold">{t("admin.clicksColLast")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {controls.map((r) => (
                  <tr key={keyOf(r.surface, r.control)}>
                    <td className="py-2 whitespace-nowrap text-sand-800">
                      <span className="flex items-center gap-1.5">
                        <Swatch surface={r.surface} />
                        {t(SURFACE_LABEL[r.surface])}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-sand-800">{r.control}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.count90)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.count30)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.count7)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.accounts)}</td>
                    <td className="py-2 text-right whitespace-nowrap text-sand-600">{ago(t, now, r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
            <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
              {t("admin.clicksByAccount")}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                  <th className="py-2 font-semibold">{t("admin.clicksColAccount")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksColClicks")}</th>
                  <th className="py-2 text-right font-semibold">{t("admin.clicksColLast")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...byUser]
                  .sort((a, b) => b._count - a._count)
                  .slice(0, 20)
                  .map((r) => (
                    <tr key={r.userId ?? "-"}>
                      <td className="max-w-[240px] truncate py-2 text-sand-800">{accountLabel(r.userId)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r._count)}</td>
                      <td className="py-2 text-right whitespace-nowrap text-sand-600">
                        {ago(t, now, r._max.createdAt)}
                      </td>
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
