"use client";

import type { CollapsedView } from "@/components/use-collapsed-view";
import { useT } from "@/components/lang-provider";

// The one button that switches a list between its two views: Expand all shows
// every card whole; Collapse all folds every card to its one-line header.
// An icon beside the list's search and its full page arrows, its tooltip
// naming it: chevrons apart to expand, chevrons together to fold.
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
  const label = next === "expanded" ? t("outline.expandAll") : t("outline.collapseAll");
  const annotations = track === "annotations-view";
  const tip =
    next === "expanded"
      ? t(annotations ? "outline.expandAllAnnotationsTitle" : "outline.expandAllTitle")
      : t(annotations ? "outline.collapseAllAnnotationsTitle" : "outline.collapseAllTitle");
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      data-track={`${track}:${next}`}
      aria-label={label}
      data-tip={`${label}\n${tip}`}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
    >
      <svg
        width={15}
        height={15}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {next === "expanded" ? (
          <>
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </>
        ) : (
          <>
            <path d="m7 20 5-5 5 5" />
            <path d="m7 4 5 5 5-5" />
          </>
        )}
      </svg>
    </button>
  );
}
