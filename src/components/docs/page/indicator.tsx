"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { importedOf } from "@/components/docs/insert/figure";
import { pageName } from "@/components/docs/insert/page-start";
import { pageAt, scrollParent } from "@/components/docs/page/geometry";

// The page indicator (SPEC.md §29), Google Docs': while the pointer is
// within 20 px of the pane's right edge, a dark tip beside the scrollbar
// thumb reads the page in view and the page count ("3 of 12"), and follows
// the thumb as the pane scrolls. An import with page starts reads the PDF's
// page in view and the PDF's page count instead ("p. 7 of 30").

const EDGE = 20;

type PdfPage = { page: number; total: number };

/** The PDF's page at `y` (client px): the last page start at or above it,
    else the first one. Null when the document has no page starts. */
function pdfPageAt(editor: Editor, y: number): PdfPage | null {
  const starts = editor.view.dom.querySelectorAll<HTMLElement>("[data-page-start]");
  if (starts.length === 0) return null;
  // The page starts stand in document order, top to bottom.
  let lo = 0;
  let hi = starts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid].getBoundingClientRect().top <= y) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const page = Number(starts[found].dataset.pageStart);
  if (!Number.isInteger(page) || page < 1) return null;
  let last = 0;
  starts.forEach((el) => {
    last = Math.max(last, Number(el.dataset.pageStart) || 0);
  });
  const imported = importedOf(editor);
  const total = imported?.pages || imported?.pageLabels?.length || last;
  return { page, total: Math.max(total, page) };
}

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
  const [tip, setTip] = useState<{ x: number; y: number; n: number; pdf: PdfPage | null } | null>(null);
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
      const middle = r.top + box.clientHeight / 2;
      const n = Math.max(1, Math.min(pages, pageAt(page, pitch, middle).page + 1));
      // The thumb's middle: as far down the track as the view's middle is
      // down the document.
      const y = r.top + ((box.scrollTop + box.clientHeight / 2) / Math.max(1, box.scrollHeight)) * box.clientHeight;
      setTip({ x: r.right - EDGE, y, n, pdf: pdfPageAt(editor, middle) });
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
      {tip.pdf
        ? t("docsInsert.pageStartOf", { page: pageName(editor, tip.pdf.page), total: tip.pdf.total })
        : t("docsPage.pageIndicator", { n: tip.n, total: pages })}
    </div>
  );
}
