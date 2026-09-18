"use client";

import { useT } from "@/components/lang-provider";
import type { SaveProgress } from "@/lib/offline/saved";

// A save in progress (SPEC.md §17): a bottom-fixed bar, the same shape as
// every other bottom-fixed status in the reader (the toast, the Distill
// composer). The fill is driven by real fetches landing (SaveProgress), never
// a simulated timer — the same rule the ingest progress card follows.
export function SaveProgressBar({ title, progress }: { title: string; progress: SaveProgress }) {
  const t = useT();
  const percent = progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-40 w-[320px] max-w-[88vw] -translate-x-1/2 rounded-2xl bg-card p-3.5 shadow-float"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-sand-800">
          {t(progress.stage === "pages" ? "works.savingOfflinePages" : "works.savingOfflineFiles")}
        </p>
        <span className="shrink-0 text-xs tabular-nums text-sand-500">
          {progress.done}/{progress.total}
        </span>
      </div>
      <p className="truncate text-xs text-sand-500">{title}</p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-sand-200">
        <div
          className="h-full rounded-full bg-clay transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
