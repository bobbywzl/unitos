"use client";

import type { CollapsedView } from "@/components/use-collapsed-view";
import { useT } from "@/components/lang-provider";

// The one button that switches a list between its two views: Expand all shows
// every card whole; Collapse all folds every card to its one-line header.
// `track` names the list in click telemetry: notes-view or annotations-view.
export function CollapsedViewToggle({
  view,
  onChange,
  track,
}: {
  view: CollapsedView;
  onChange: (view: CollapsedView) => void;
  track: "notes-view" | "annotations-view";
}) {
  const t = useT();
  const next: CollapsedView = view === "collapsed" ? "expanded" : "collapsed";
  return (
    <button
      onClick={() => onChange(next)}
      data-track={`${track}:${next}`}
      title={next === "expanded" ? t("outline.expandAllTitle") : t("outline.collapseAllTitle")}
      className="shrink-0 rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
    >
      {next === "expanded" ? t("outline.expandAll") : t("outline.collapseAll")}
    </button>
  );
}
