"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { pageAt, scrollParent } from "@/components/docs/page/geometry";

// The page indicator (SPEC.md §29), Google Docs': while the pointer is
// within 20 px of the pane's right edge, a dark tip beside the scrollbar
// thumb reads the page in view and the page count ("3 of 12"), and follows
// the thumb as the pane scrolls.

const EDGE = 20;

export function PageIndicator({
  editor,
  pages,
  pitch,
}: {
  editor: Editor;
  pages: number;
  /** From one page's top to the next, px at 100%. */
  pitch: number;
}) {
  const t = useT();
  const [tip, setTip] = useState<{ x: number; y: number; n: number } | null>(null);
  useEffect(() => {
    const page = editor.view.dom.closest<HTMLElement>("[data-docs-page]");
    const box = scrollParent(page);
    if (!page || !box || pages < 1) return;
    let near = false;
    const place = () => {
      if (!near) {
        setTip(null);
        return;
      }
      const r = box.getBoundingClientRect();
      const n = Math.max(1, Math.min(pages, pageAt(page, pitch, r.top + box.clientHeight / 2).page + 1));
      // The thumb's middle: as far down the track as the view's middle is
      // down the document.
      const y = r.top + ((box.scrollTop + box.clientHeight / 2) / Math.max(1, box.scrollHeight)) * box.clientHeight;
      setTip({ x: r.right - EDGE, y, n });
    };
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const next = e.clientX >= r.right - EDGE && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (next === near) return;
      near = next;
      place();
    };
    const onLeave = () => {
      near = false;
      place();
    };
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerleave", onLeave);
    box.addEventListener("scroll", place, { passive: true });
    return () => {
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerleave", onLeave);
      box.removeEventListener("scroll", place);
    };
  }, [editor, pages, pitch]);
  if (!tip) return null;
  return (
    <div className="docs-page-indicator" style={{ left: tip.x, top: tip.y }} aria-hidden>
      {t("docsPage.pageIndicator", { n: tip.n, total: pages })}
    </div>
  );
}
