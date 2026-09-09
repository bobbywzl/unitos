"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";

// The visualization viewer (SPEC.md §20): a visualization opened large, in
// the app, with its caption under it. One viewer for the workspace; every
// visualization image on the page opens it — the picture in a tool card, in
// the Annotations tab, in a note — through one event, so no surface plumbs a
// callback. Escape, the backdrop, and ✕ close it.
export const OPEN_VISUALIZATION = "dissect:open-visualization";

export type OpenVisualization = { src: string; caption: string };

export function openVisualization(detail: OpenVisualization) {
  window.dispatchEvent(new CustomEvent<OpenVisualization>(OPEN_VISUALIZATION, { detail }));
}

/** A stored visualization's image: its markdown points at /api/images/<id>. */
export function isVisualizationImage(src: string | undefined): src is string {
  return /^\/api\/images\/[A-Za-z0-9_-]+$/.test(src ?? "");
}

export function VisualizationViewer() {
  const t = useT();
  const [shown, setShown] = useState<OpenVisualization | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setShown((e as CustomEvent<OpenVisualization>).detail);
    window.addEventListener(OPEN_VISUALIZATION, onOpen);
    return () => window.removeEventListener(OPEN_VISUALIZATION, onOpen);
  }, []);

  // Escape closes the viewer before anything under it reacts (capture, like
  // the graph and the pages).
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setShown(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shown]);

  return (
    <Presence show={shown !== null} exit="fade">
      {shown && (
        <div
          data-selection-popover
          role="dialog"
          aria-label={t("reader.visualization")}
          onClick={() => setShown(null)}
          className="graph-overlay-in fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper/95 p-6 backdrop-blur-sm"
        >
          <button
            onClick={() => setShown(null)}
            data-track="visualization-viewer-close"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
          <figure
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-full max-w-full flex-col items-center gap-4"
          >
            {/* An animation plays here as it does in the card: SMIL runs in an <img>. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shown.src}
              alt={shown.caption}
              className="max-h-[78vh] max-w-[min(92vw,1100px)] rounded-2xl bg-card object-contain shadow-float"
            />
            {shown.caption && (
              <figcaption className="max-w-[min(92vw,720px)] text-center text-[15px] leading-relaxed text-sand-800">
                {shown.caption}
              </figcaption>
            )}
          </figure>
        </div>
      )}
    </Presence>
  );
}
