"use client";

import { useT } from "@/components/lang-provider";

// Work in progress: a bottom-fixed bar, the same shape as every other
// bottom-fixed status in the reader (the toast, the Extract composer). The
// label says the stage, the title says what the work is on, and the fill is
// driven by real steps landing — pages fetched, stages passed — never a
// simulated timer, the rule the ingest progress card follows. Every
// function that takes more than a moment shows one: Save for offline
// (SPEC.md §17), the voice command (SPEC.md §6).

/** Where a bottom-center status sits: over the phone's bottom bar, never on
    it (the notes pill's place, BOTTOM_PILL in merge-undo.tsx), and 24 px
    off the window's foot from md up, where the bar is the rail. The
    progress bar and the one-line toasts (Saved for offline, the Ultra
    message) all take it. */
export const BOTTOM_STATUS =
  "fixed bottom-[calc(66px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 md:bottom-6";

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
  const t = useT();
  // Until the work is counted (Save for offline asks the server for the
  // pages first) the count reads a word, never "0/0".
  const counted = total > 0;
  const percent = counted ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div
      role="status"
      className={`${BOTTOM_STATUS} z-40 w-[320px] max-w-[88vw] rounded-2xl bg-card p-3.5 shadow-float`}
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-sand-800">{label}</p>
        <span className="shrink-0 text-xs tabular-nums text-sand-500">
          {counted ? `${done}/${total}` : t("works.progressCounting")}
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
