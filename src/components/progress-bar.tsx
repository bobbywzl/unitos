"use client";

// Work in progress: a bottom-fixed bar, the same shape as every other
// bottom-fixed status in the reader (the toast, the Distill composer). The
// label says the stage, the title says what the work is on, and the fill is
// driven by real steps landing — pages fetched, stages passed — never a
// simulated timer, the rule the ingest progress card follows. Every
// function that takes more than a moment shows one: Save for offline
// (SPEC.md §17), the voice command (SPEC.md §6).
export function ProgressBar({
  label,
  title,
  done,
  total,
}: {
  label: string;
  title?: string;
  done: number;
  total: number;
}) {
  const percent = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-40 w-[320px] max-w-[88vw] -translate-x-1/2 rounded-2xl bg-card p-3.5 shadow-float"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-sand-800">{label}</p>
        <span className="shrink-0 text-xs tabular-nums text-sand-500">
          {done}/{total}
        </span>
      </div>
      {title && <p className="truncate text-xs text-sand-500">{title}</p>}
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-sand-200">
        <div
          className="h-full rounded-full bg-clay transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
