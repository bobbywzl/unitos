"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import type { Zoom } from "@/components/docs/toolbar";

// The page area (SPEC.md §29): the gray canvas, the page, and what sits on
// and around it — the ruler under the toolbar, the outline at the left.

export const PX_PER_PT = 96 / 72;

/** The ruler row under the toolbar. */
export function PageRuler(props: DocsAreaProps & { zoom: Zoom }) {
  void props;
  return null;
}

/** The canvas and the page the editor's text is drawn on. */
export function PageCanvas({
  pageSetup,
  zoom,
  onPageClick,
  children,
}: DocsAreaProps & { zoom: Zoom; onPageClick: (e: React.MouseEvent) => void; children: ReactNode }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const pageWidthPx = pageSetup.width * PX_PER_PT;
  // Fit: the page scales to the canvas's width.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || zoom !== "fit") return;
    const measure = () => setFitScale(Math.max(0.25, Math.min(3, (canvas.clientWidth - 48) / pageWidthPx)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [zoom, pageWidthPx]);
  const scale = zoom === "fit" ? fitScale : zoom / 100;
  const m = pageSetup.margins;
  const pageStyle: React.CSSProperties = {
    width: pageWidthPx,
    minHeight: pageSetup.pageless ? undefined : pageSetup.height * PX_PER_PT,
    paddingTop: m.top * PX_PER_PT,
    paddingRight: m.right * PX_PER_PT,
    paddingBottom: m.bottom * PX_PER_PT,
    paddingLeft: m.left * PX_PER_PT,
    background: pageSetup.color,
    zoom: scale === 1 ? undefined : scale,
  };
  return (
    <div ref={canvasRef} className="docs-canvas">
      <article className="docs-page" style={pageStyle} onClick={onPageClick} data-docs-page>
        {children}
      </article>
    </div>
  );
}
