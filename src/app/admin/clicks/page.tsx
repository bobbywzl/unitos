import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/admin-auth";
import { CLICK_GROUPS, clickGroupOf, type ClickGroup } from "@/lib/clicks";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

// Admin: how often readers use each function (SPEC.md §7): the AI tools, the
// notes functions, and the annotations they make. Every other control
// (navigation, dialogs, video playback, the article edit toolbar) records but
// stays off this page — lib/clicks.ts holds the vocabulary. Server-rendered
// like the usage page; every figure is the last 90 days unless a column says
// otherwise. The table under the charts carries every value the charts show.

const DAY = 86_400_000;

const GROUP_LABEL: Record<ClickGroup, TKey> = {
  ai: "admin.clicksGroupAi",
  notes: "admin.clicksGroupNotes",
  annotations: "admin.clicksGroupAnnotations",
};

// One hue per group (the dataviz reference palette, validated on the card
// surface in both themes). Marks wear these; text never does — the swatch
// beside a label carries the identity.
const GROUP_COLOR: Record<ClickGroup, { light: string; dark: string }> = {
  ai: { light: "#1baf7a", dark: "#199e70" },
  notes: { light: "#2a78d6", dark: "#3987e5" },
  annotations: { light: "#eb6834", dark: "#d95926" },
};

const seriesCss = [
  `.click-charts{${CLICK_GROUPS.map((g) => `--click-${g}:${GROUP_COLOR[g].light};`).join("")}}`,
  `.dark .click-charts{${CLICK_GROUPS.map((g) => `--click-${g}:${GROUP_COLOR[g].dark};`).join("")}}`,
].join(" ");

function colorOf(group: ClickGroup): string {
  return `var(--click-${group})`;
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

function Swatch({ group }: { group: ClickGroup }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: colorOf(group) }}
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

type BarRow = { key: string; label: ReactNode; count: number; color: string };

// Horizontal magnitude bars: label left, count at the tip.
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Day = { day: string; total: number; byGroup: Record<ClickGroup, number> };

// A column with a 4px rounded top and a square base.
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} H${x} Z`;
}

// Daily columns, last 30 days, stacked by group, server-rendered SVG. A 2px
// gap separates the segments; the legend under the chart names them.
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
          const stacked = CLICK_GROUPS.filter((g) => d.byGroup[g] > 0);
          let base = PAD_T + H;
          return (
            <g key={d.day}>
              {stacked.map((g, j) => {
                const h = (d.byGroup[g] / top) * H;
                const yTop = base - h;
                const gap = j === 0 || h <= 3 ? 0 : 2;
                const shape =
                  j === stacked.length - 1
                    ? columnPath(x, yTop, barW, h - gap)
                    : `M${x},${yTop} H${x + barW} V${base - gap} H${x} Z`;
                base = yTop;
                return (
                  <path key={g} d={shape} style={{ fill: colorOf(g) }}>
                    <title>
                      {t("admin.clicksSegment", {
                        day: d.day.slice(5),
                        group: t(GROUP_LABEL[g]),
                        n: fmt(d.byGroup[g]),
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
        {CLICK_GROUPS.map((g) => (
          <span key={g} className="flex items-center gap-1.5 text-[11px] text-sand-700">
            <Swatch group={g} />
            {t(GROUP_LABEL[g])}
          </span>
        ))}
      </div>
    </div>
  );
}

type FunctionRow = {
  group: ClickGroup;
  control: string;
  count90: number;
  count30: number;
  count7: number;
  accounts: number;
  last: Date | null;
};

type AccountRow = {
  userId: string | null;
  byGroup: Record<ClickGroup, number>;
  total: number;
  last: Date | null;
};

const zeroGroups = () =>
  Object.fromEntries(CLICK_GROUPS.map((g) => [g, 0])) as Record<ClickGroup, number>;

export default async function AdminClicksPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();

  // Force-dynamic admin page: the clock is the query parameter.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since90 = new Date(now - 90 * DAY);
  const since30 = new Date(now - 30 * DAY);
  const since7 = new Date(now - 7 * DAY);

  const [rows90, rows30, rows7, rowsByUser, byDayRaw, users] = await Promise.all([
    db.clickEvent.groupBy({
      by: ["control"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _max: { createdAt: true },
    }),
    db.clickEvent.groupBy({
      by: ["control"],
      where: { createdAt: { gte: since30 } },
      _count: true,
    }),
    db.clickEvent.groupBy({
      by: ["control"],
      where: { createdAt: { gte: since7 } },
      _count: true,
    }),
    db.clickEvent.groupBy({
      by: ["control", "userId"],
      where: { createdAt: { gte: since90 } },
      _count: true,
      _max: { createdAt: true },
    }),
    db.$queryRaw<{ day: Date; control: string; n: number }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, "control", count(*)::int AS n
      FROM "ClickEvent" WHERE "createdAt" >= ${since30}
      GROUP BY 1, 2 ORDER BY 1`),
    db.user.findMany({ select: { id: true, email: true } }),
  ]);

  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  const count30 = new Map(rows30.map((r) => [r.control, r._count]));
  const count7 = new Map(rows7.map((r) => [r.control, r._count]));
  const accountsOf = new Map<string, number>();
  for (const r of rowsByUser) accountsOf.set(r.control, (accountsOf.get(r.control) ?? 0) + 1);
  const groupOrder = new Map<string, number>(CLICK_GROUPS.map((g, i) => [g, i]));

  // The functions; general controls drop here.
  const functions: FunctionRow[] = rows90
    .flatMap((r) => {
      const group = clickGroupOf(r.control);
      return group
        ? [
            {
              group,
              control: r.control,
              count90: r._count,
              count30: count30.get(r.control) ?? 0,
              count7: count7.get(r.control) ?? 0,
              accounts: accountsOf.get(r.control) ?? 0,
              last: r._max.createdAt,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        b.count90 - a.count90 ||
        (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0) ||
        a.control.localeCompare(b.control),
    );

  const totals = zeroGroups();
  for (const r of functions) totals[r.group] += r.count90;
  const total90 = functions.reduce((sum, r) => sum + r.count90, 0);

  // Uses per account, the groups side by side.
  const accountMap = new Map<string | null, AccountRow>();
  for (const r of rowsByUser) {
    const group = clickGroupOf(r.control);
    if (!group) continue;
    const row = accountMap.get(r.userId) ?? {
      userId: r.userId,
      byGroup: zeroGroups(),
      total: 0,
      last: null,
    };
    row.byGroup[group] += r._count;
    row.total += r._count;
    if (r._max.createdAt && (!row.last || r._max.createdAt > row.last)) row.last = r._max.createdAt;
    accountMap.set(r.userId, row);
  }
  const accountRows = [...accountMap.values()].sort((a, b) => b.total - a.total).slice(0, 20);
  const accounts = [...accountMap.keys()].filter((id) => id !== null).length;

  // Fill the trailing 30 calendar days so quiet days render as gaps.
  const dayMap = new Map<string, Day>();
  for (let i = 0; i < 30; i++) {
    const day = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10);
    dayMap.set(day, { day, total: 0, byGroup: zeroGroups() });
  }
  for (const r of byDayRaw) {
    const group = clickGroupOf(r.control);
    const entry = dayMap.get(r.day.toISOString().slice(0, 10));
    if (!entry || !group) continue;
    entry.byGroup[group] += r.n;
    entry.total += r.n;
  }
  const days = [...dayMap.values()];

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CLICK_GROUPS.map((g) => (
              <Tile
                key={g}
                label={t("admin.clicksGroup90", { group: t(GROUP_LABEL[g]) })}
                value={fmt(totals[g])}
              />
            ))}
            <Tile label={t("admin.clicksAccounts")} value={fmt(accounts)} />
          </div>

          <DailyChart t={t} title={t("admin.clicksDaily")} days={days} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CLICK_GROUPS.map((group) => (
              <BarList
                key={group}
                title={t("admin.clicksGroup90", { group: t(GROUP_LABEL[group]) })}
                empty={t("admin.clicksNone")}
                rows={functions
                  .filter((r) => r.group === group)
                  .map((r) => ({
                    key: r.control,
                    label: <span className="truncate font-mono">{r.control}</span>,
                    count: r.count90,
                    color: colorOf(group),
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
                  <th className="py-2 font-semibold">{t("admin.clicksColGroup")}</th>
                  <th className="px-3 py-2 font-semibold">{t("admin.clicksColControl")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksCol90")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksCol30")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksCol7")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("admin.clicksColAccounts")}</th>
                  <th className="py-2 text-right font-semibold">{t("admin.clicksColLast")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {functions.map((r) => (
                  <tr key={r.control}>
                    <td className="py-2 whitespace-nowrap text-sand-800">
                      <span className="flex items-center gap-1.5">
                        <Swatch group={r.group} />
                        {t(GROUP_LABEL[r.group])}
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
                  {CLICK_GROUPS.map((g) => (
                    <th key={g} className="px-3 py-2 text-right font-semibold">
                      {t(GROUP_LABEL[g])}
                    </th>
                  ))}
                  <th className="py-2 text-right font-semibold">{t("admin.clicksColLast")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accountRows.map((r) => (
                  <tr key={r.userId ?? "-"}>
                    <td className="max-w-[240px] truncate py-2 text-sand-800">{accountLabel(r.userId)}</td>
                    {CLICK_GROUPS.map((g) => (
                      <td key={g} className="px-3 py-2 text-right font-semibold tabular-nums">
                        {fmt(r.byGroup[g])}
                      </td>
                    ))}
                    <td className="py-2 text-right whitespace-nowrap text-sand-600">{ago(t, now, r.last)}</td>
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
