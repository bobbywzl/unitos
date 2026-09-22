import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { FUNNEL_STEPS, funnelStepIndex, isFunnelStep, type FunnelStep } from "@/lib/funnel";
import { serverT } from "@/lib/i18n/server";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { Tile } from "@/components/admin/charts";

export const dynamic = "force-dynamic";

// Admin: the onboarding funnel (lib/funnel.ts): how far new visitors get on
// the way from the sign-in page to a subscription. A visitor is one browser
// (the visitor cookie), joined to the account it makes: a visitor whose row
// ever carries an account is that account, on every device. The window
// (?days=7|30|90, 30 by default) picks the cohort: the visitors first seen
// in it. Each visitor counts once per step, whatever the row count.
// Server-rendered like the clicks page; the tables carry every value the
// charts show.

const DAY = 86_400_000;
const WINDOWS = [7, 30, 90] as const;

const STEP_LABEL: Record<FunnelStep, TKey> = {
  signin: "admin.funnelStepSignin",
  account: "admin.funnelStepAccount",
  dashboard: "admin.funnelStepDashboard",
  reader: "admin.funnelStepReader",
  plans: "admin.funnelStepPlans",
  order: "admin.funnelStepOrder",
  checkout: "admin.funnelStepCheckout",
  subscribed: "admin.funnelStepSubscribed",
};

// One color per step, an ordered ramp from sand to green: the further the
// step, the deeper the color. Marks wear these; text never does.
const STEP_COLOR: Record<FunnelStep, { light: string; dark: string }> = {
  signin: { light: "#d9cbb4", dark: "#6b5d48" },
  account: { light: "#c9b48f", dark: "#8a7454" },
  dashboard: { light: "#b89d6c", dark: "#a08a5e" },
  reader: { light: "#a7874c", dark: "#b4a06a" },
  plans: { light: "#8fa07a", dark: "#8c9f74" },
  order: { light: "#6fa080", dark: "#6f9e7e" },
  checkout: { light: "#43a37e", dark: "#4e9e7a" },
  subscribed: { light: "#1baf7a", dark: "#199e70" },
};

const seriesCss = [
  `.funnel-charts{${FUNNEL_STEPS.map((s) => `--funnel-${s}:${STEP_COLOR[s].light};`).join("")}}`,
  `.dark .funnel-charts{${FUNNEL_STEPS.map((s) => `--funnel-${s}:${STEP_COLOR[s].dark};`).join("")}}`,
].join(" ");

function colorOf(step: FunnelStep): string {
  return `var(--funnel-${step})`;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "–";
  return `${Math.round((part / whole) * 100)}%`;
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

function Swatch({ step }: { step: FunnelStep }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: colorOf(step) }}
    />
  );
}

function Heading({ children }: { children: string }) {
  return <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{children}</p>;
}

const th = "py-2 font-semibold";
const thRight = "px-3 py-2 text-right font-semibold";

type StepRow = { step: FunnelStep; reached: number; stopped: number };

// The waterfall: one bar per step, the count at the tip, and under it the
// share of new visitors and of the step before.
function Waterfall({ t, title, rows, total }: { t: TFunc; title: string; rows: StepRow[]; total: number }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <Heading>{title}</Heading>
      <div className="space-y-2.5">
        {rows.map((r, i) => {
          const previous = i === 0 ? total : rows[i - 1].reached;
          return (
            <div key={r.step}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-sand-800">
                  <Swatch step={r.step} />
                  {t(STEP_LABEL[r.step])}
                </span>
                <span className="shrink-0 text-xs text-sand-600 tabular-nums">
                  <span className="font-semibold text-sand-800">{fmt(r.reached)}</span>
                  {" · "}
                  {pct(r.reached, total)}
                  {" · "}
                  {pct(r.reached, previous)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-sand-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${total > 0 ? Math.max(r.reached > 0 ? 2 : 0, (r.reached / total) * 100) : 0}%`, background: colorOf(r.step) }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-sand-500">
        {t("admin.funnelColVisitors")} · {t("admin.funnelColOfNew")} · {t("admin.funnelColOfPrevious")}
      </p>
    </div>
  );
}

type Day = { day: string; total: number; byStep: Record<FunnelStep, number> };

// A column with a 4px rounded top and a square base.
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} H${x} Z`;
}

// Daily columns, one per day of the window: the visitors first seen that
// day, stacked by the furthest step they reached. Server-rendered SVG.
function DailyChart({ t, title, days }: { t: TFunc; title: string; days: Day[] }) {
  const W = 600;
  const H = 100;
  const PAD_L = 30;
  const PAD_T = 8;
  const top = niceCeil(Math.max(...days.map((d) => d.total), 1));
  const slot = (W - PAD_L) / days.length;
  const barW = Math.min(16, Math.max(3, slot - 2));
  const y = (v: number) => PAD_T + H - (v / top) * H;
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <Heading>{title}</Heading>
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
          const stacked = FUNNEL_STEPS.filter((s) => d.byStep[s] > 0);
          let base = PAD_T + H;
          return (
            <g key={d.day}>
              {stacked.map((s, j) => {
                const h = (d.byStep[s] / top) * H;
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
                      {t("admin.funnelSegment", {
                        day: d.day.slice(5),
                        step: t(STEP_LABEL[s]),
                        n: fmt(d.byStep[s]),
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
        {FUNNEL_STEPS.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[11px] text-sand-700">
            <Swatch step={s} />
            {t(STEP_LABEL[s])}
          </span>
        ))}
      </div>
    </div>
  );
}

// One visitor's journey: the account when there is one, the steps reached,
// when first and last seen.
type Journey = {
  key: string;
  userId: string | null;
  steps: Set<FunnelStep>;
  furthest: number;
  firstSeen: Date;
  lastSeen: Date;
};

const zeroSteps = () => Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])) as Record<FunnelStep, number>;

export default async function AdminFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();
  const { days: daysParam } = await searchParams;
  const windowDays = WINDOWS.find((n) => String(n) === daysParam) ?? 30;

  // Force-dynamic admin page: the clock is the query parameter.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since = new Date(now - windowDays * DAY);

  const [rows, links, firstByVisitor, firstByUser, users] = await Promise.all([
    db.funnelEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { visitorId: true, userId: true, step: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // Every visitor that ever carried an account: the join, all time.
    db.funnelEvent.groupBy({
      by: ["visitorId", "userId"],
      where: { visitorId: { not: null }, userId: { not: null } },
    }),
    // When each visitor and each account was first seen, all time: the
    // cohort is the visitors first seen in the window.
    db.funnelEvent.groupBy({
      by: ["visitorId"],
      where: { visitorId: { not: null } },
      _min: { createdAt: true },
    }),
    db.funnelEvent.groupBy({
      by: ["userId"],
      where: { userId: { not: null } },
      _min: { createdAt: true },
    }),
    db.user.findMany({ select: { id: true, email: true } }),
  ]);

  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  const userOfVisitor = new Map<string, string>();
  const visitorsOfUser = new Map<string, string[]>();
  for (const l of links) {
    if (!l.visitorId || !l.userId) continue;
    userOfVisitor.set(l.visitorId, l.userId);
    visitorsOfUser.set(l.userId, [...(visitorsOfUser.get(l.userId) ?? []), l.visitorId]);
  }
  const firstVisitor = new Map(firstByVisitor.map((r) => [r.visitorId ?? "", r._min.createdAt]));
  const firstUser = new Map(firstByUser.map((r) => [r.userId ?? "", r._min.createdAt]));

  // A row's visitor: the account the browser ever signed into, else the
  // account on the row, else the browser.
  const keyOf = (visitorId: string | null, userId: string | null): string | null => {
    if (visitorId && userOfVisitor.has(visitorId)) return `u:${userOfVisitor.get(visitorId)}`;
    if (userId) return `u:${userId}`;
    if (visitorId) return `v:${visitorId}`;
    return null;
  };
  // When a visitor was first seen, all time: the earliest of the account's
  // rows and every browser the account signed in from.
  const firstSeenOf = (key: string): Date | null => {
    if (key.startsWith("v:")) return firstVisitor.get(key.slice(2)) ?? null;
    const userId = key.slice(2);
    const dates = [firstUser.get(userId), ...(visitorsOfUser.get(userId) ?? []).map((v) => firstVisitor.get(v))];
    const times = dates.flatMap((d) => (d ? [d.getTime()] : []));
    return times.length ? new Date(Math.min(...times)) : null;
  };

  const journeys = new Map<string, Journey>();
  let returning = 0;
  const seenReturning = new Set<string>();
  for (const r of rows) {
    if (!isFunnelStep(r.step)) continue;
    const key = keyOf(r.visitorId, r.userId);
    if (!key) continue;
    let journey = journeys.get(key);
    if (!journey) {
      const firstSeen = firstSeenOf(key) ?? r.createdAt;
      if (firstSeen < since) {
        if (!seenReturning.has(key)) {
          seenReturning.add(key);
          returning++;
        }
        continue;
      }
      journey = {
        key,
        userId: key.startsWith("u:") ? key.slice(2) : null,
        steps: new Set(),
        furthest: -1,
        firstSeen,
        lastSeen: r.createdAt,
      };
      journeys.set(key, journey);
    }
    journey.steps.add(r.step);
    journey.furthest = Math.max(journey.furthest, funnelStepIndex(r.step));
    if (r.createdAt > journey.lastSeen) journey.lastSeen = r.createdAt;
    if (r.userId && !journey.userId) journey.userId = r.userId;
  }

  const cohort = [...journeys.values()];
  const total = cohort.length;
  const stepRows: StepRow[] = FUNNEL_STEPS.map((step) => ({
    step,
    reached: cohort.filter((j) => j.steps.has(step)).length,
    stopped: cohort.filter((j) => j.furthest === funnelStepIndex(step)).length,
  }));
  const reachedOf = (step: FunnelStep) => stepRows.find((r) => r.step === step)?.reached ?? 0;

  // The window's calendar days; a visitor lands on the day first seen.
  const dayMap = new Map<string, Day>();
  for (let i = 0; i < windowDays; i++) {
    const day = new Date(now - (windowDays - 1 - i) * DAY).toISOString().slice(0, 10);
    dayMap.set(day, { day, total: 0, byStep: zeroSteps() });
  }
  for (const j of cohort) {
    const entry = dayMap.get(j.firstSeen.toISOString().slice(0, 10));
    if (!entry || j.furthest < 0) continue;
    entry.byStep[FUNNEL_STEPS[j.furthest]] += 1;
    entry.total += 1;
  }
  const days = [...dayMap.values()];

  const recent = [...cohort].sort((a, b) => b.firstSeen.getTime() - a.firstSeen.getTime()).slice(0, 30);
  const visitorLabel = (j: Journey) =>
    j.userId === null
      ? t("admin.funnelNoAccount")
      : (emailOf.get(j.userId) ?? (j.userId === "user-1" ? t("admin.localReader") : j.userId));

  return (
    <main className="funnel-charts mx-auto max-w-4xl px-6 py-8">
      <style>{seriesCss}</style>
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.funnel")}</h1>
        <p className="text-sm text-sand-600">{t("admin.funnelDesc")}</p>
      </header>

      <div className="mb-4 flex items-center gap-1">
        {WINDOWS.map((n) => (
          <Link
            key={n}
            href={`/admin/funnel?days=${n}`}
            aria-pressed={windowDays === n}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              windowDays === n ? "bg-ink text-paper" : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
            }`}
          >
            {t("admin.funnelWindow", { n })}
          </Link>
        ))}
      </div>

      {total === 0 && returning === 0 ? (
        <p className="text-sm text-sand-600">{t("admin.funnelEmpty")}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label={t("admin.funnelNewVisitors")} value={fmt(total)} />
            <Tile label={t("admin.funnelAccounts")} value={fmt(reachedOf("account"))} />
            <Tile label={t("admin.funnelSubscribed")} value={fmt(reachedOf("subscribed"))} />
            <Tile label={t("admin.funnelConversion")} value={pct(reachedOf("subscribed"), total)} />
            <Tile label={t("admin.funnelReturning")} value={fmt(returning)} />
          </div>

          <div id="waterfall" className="grid gap-4 lg:grid-cols-2">
            <Waterfall t={t} title={t("admin.funnelWaterfall")} rows={stepRows} total={total} />

            <div id="stopped" className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
              <Heading>{t("admin.funnelStopped")}</Heading>
              <p className="mb-2 text-xs text-sand-600">{t("admin.funnelStoppedDesc")}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                    <th className={th}>{t("admin.funnelColStep")}</th>
                    <th className={thRight}>{t("admin.funnelColVisitors")}</th>
                    <th className={thRight}>{t("admin.funnelColOfNew")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {stepRows.map((r) => (
                    <tr key={r.step}>
                      <td className="py-2 whitespace-nowrap text-sand-800">
                        <span className="flex items-center gap-1.5">
                          <Swatch step={r.step} />
                          {t(STEP_LABEL[r.step])}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.stopped)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(r.stopped, total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="daily">
            <DailyChart t={t} title={t("admin.funnelDaily")} days={days} />
          </div>

          <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
            <Heading>{t("admin.funnelWaterfall")}</Heading>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                  <th className={th}>{t("admin.funnelColStep")}</th>
                  <th className={thRight}>{t("admin.funnelColVisitors")}</th>
                  <th className={thRight}>{t("admin.funnelColOfNew")}</th>
                  <th className={thRight}>{t("admin.funnelColOfPrevious")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stepRows.map((r, i) => (
                  <tr key={r.step}>
                    <td className="py-2 whitespace-nowrap text-sand-800">
                      <span className="flex items-center gap-1.5">
                        <Swatch step={r.step} />
                        {t(STEP_LABEL[r.step])}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(r.reached)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.reached, total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(r.reached, i === 0 ? total : stepRows[i - 1].reached)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-soft">
            <Heading>{t("admin.funnelRecent")}</Heading>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] tracking-wider text-sand-500 uppercase">
                  <th className={th}>{t("admin.funnelColVisitor")}</th>
                  <th className="px-3 py-2 font-semibold">{t("admin.funnelColSteps")}</th>
                  <th className={thRight}>{t("admin.funnelColFirst")}</th>
                  <th className="py-2 text-right font-semibold">{t("admin.funnelColLast")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((j) => (
                  <tr key={j.key}>
                    <td className="max-w-[220px] truncate py-2 text-sand-800">{visitorLabel(j)}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {FUNNEL_STEPS.filter((s) => j.steps.has(s)).map((s) => (
                          <span
                            key={s}
                            className="flex items-center gap-1 rounded-full bg-sand-100 px-2 py-0.5 text-[10px] whitespace-nowrap text-sand-800"
                          >
                            <Swatch step={s} />
                            {t(STEP_LABEL[s])}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-sand-600">{ago(t, now, j.firstSeen)}</td>
                    <td className="py-2 text-right whitespace-nowrap text-sand-600">{ago(t, now, j.lastSeen)}</td>
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
