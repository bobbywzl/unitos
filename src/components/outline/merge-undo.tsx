"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { OutlineActions } from "@/components/outline/use-outline";

// The pill after a merge (SPEC.md §6): the notes merged into one, and Undo,
// which puts them back as they were. It stays for a while after each merge,
// and the next merge takes it. Rendered by the tray and the notes full page.
export function MergeUndoBar({ actions }: { actions: OutlineActions }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const merge = actions.lastMerge;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  if (!merge && !error) return null;
  return (
    <div className="fixed bottom-[calc(66px+env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-card px-5 py-2.5 shadow-float md:bottom-6">
      {error ? (
        <span className="text-[13px] text-red-500">{error}</span>
      ) : merge ? (
        <>
          <span className="text-[13px] text-sand-600">{t("outline.mergedNotes", { n: merge.count })}</span>
          <button
            onClick={() => {
              void actions.undoMerge().then((reason) => {
                if (reason) setError(reason);
              });
            }}
            data-track="undo-merge"
            data-tip={t("outline.undoMergeTitle")}
            className="rounded-full bg-clay px-3.5 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("outline.undo")}
          </button>
          <button
            onClick={() => actions.dismissMerge()}
            data-track="dismiss-merge"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="text-sand-500 hover:text-clay-700"
          >
            ✕
          </button>
        </>
      ) : null}
    </div>
  );
}
