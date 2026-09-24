"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { AnnotationItem } from "@/lib/types";

// The collapsed view and the whole text keep their own annotations (SPEC.md
// §28): an annotation made on a core lists with the collapsed view's, every
// other one with the whole text's. The switch picks which list shows; in the
// reader it follows the article, which announces its view with this event.
export const COLLAPSE_VIEW_EVENT = "dissect:collapse-view";
export type CollapseViewDetail = { documentId: string; on: boolean };
export type AnnotationLayer = "whole" | "core";

// The last view each article announced, for a list that mounts after it.
const lastView = new Map<string, boolean>();

/** The article tells the lists which view it shows. */
export function announceCollapseView(documentId: string, on: boolean) {
  lastView.set(documentId, on);
  window.dispatchEvent(new CustomEvent<CollapseViewDetail>(COLLAPSE_VIEW_EVENT, { detail: { documentId, on } }));
}

export function inLayer(a: AnnotationItem, layer: AnnotationLayer): boolean {
  return layer === "core" ? a.layer === "core" : a.layer !== "core";
}

/** The list the switch shows; it follows the article's view of `documentId`. */
export function useAnnotationLayer(documentId: string | null): [AnnotationLayer, (layer: AnnotationLayer) => void] {
  const [layer, setLayer] = useState<AnnotationLayer>(() =>
    documentId && lastView.get(documentId) ? "core" : "whole",
  );
  useEffect(() => {
    if (!documentId) return;
    const onView = (e: Event) => {
      const detail = (e as CustomEvent<CollapseViewDetail>).detail;
      if (detail.documentId === documentId) setLayer(detail.on ? "core" : "whole");
    };
    window.addEventListener(COLLAPSE_VIEW_EVENT, onView);
    return () => window.removeEventListener(COLLAPSE_VIEW_EVENT, onView);
  }, [documentId]);
  return [layer, setLayer];
}

/** Whole text | Collapsed, each with its count. */
export function LayerSwitch({
  layer,
  onChange,
  counts,
}: {
  layer: AnnotationLayer;
  onChange: (layer: AnnotationLayer) => void;
  counts: Record<AnnotationLayer, number>;
}) {
  const t = useT();
  const options: { value: AnnotationLayer; label: string }[] = [
    { value: "whole", label: t("panels.layerWhole") },
    { value: "core", label: t("panels.layerCore") },
  ];
  return (
    <div role="tablist" aria-label={t("panels.layerTitle")} className="flex shrink-0 rounded-full border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={layer === o.value}
          onClick={() => onChange(o.value)}
          data-track={`annotations-layer:${o.value}`}
          data-tip={t(o.value === "core" ? "panels.layerCoreTitle" : "panels.layerWholeTitle")}
          className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
            layer === o.value ? "bg-ink text-paper" : "text-sand-700 hover:text-clay-800"
          }`}
        >
          {o.label} {counts[o.value]}
        </button>
      ))}
    </div>
  );
}
