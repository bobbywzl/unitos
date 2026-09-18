import type { TFunc } from "@/lib/i18n/dictionaries";

// The admin pages' figures (Scalae admin pattern): a tile, a bar list, a
// daily column chart. Server-rendered; the usage page and the gateway page
// draw the same shapes.

export function fmtUsd(v: number): string {
  return v >= 100 ? `$${Math.round(v).toLocaleString()}` : v >= 0.01 ? `$${v.toFixed(2)}` : v > 0 ? "<$0.01" : "$0.00";
}
export function fmtTok(v: number): string {
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(1)}k` : String(v);
}

export function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 shadow-soft">
      <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-sand-800 tabular-nums">{value}</p>
    </div>
  );
}

// Horizontal magnitude bars: label left, value at the tip, detail under.
export function BarList({
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
export function DailyChart({ title, days }: { title: string; days: { day: string; costUsd: number }[] }) {
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

