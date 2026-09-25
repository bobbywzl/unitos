"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import type { Zoom } from "@/components/docs/toolbar";
import { hostPagination, repaginate, type PaginationConfig } from "@/components/docs/ext/page";
import {
  PAGE_PITCH_EXTRA,
  PAGELESS_TOP,
  PX_PER_PT,
  pageFrame,
  pagelessWidth,
} from "@/components/docs/page/geometry";
import { pageStore, usePageState } from "@/components/docs/page/store";

// The page area (SPEC.md §29): the canvas, the pages, and what sits on and
// around them — the ruler under the toolbar, the vertical ruler and the
// outline at the left, the headers and footers, page setup, and print.

export { PX_PER_PT };

/** Pageless: the room under the last line. */
const PAGELESS_RUNOUT = 300;
/** Fit: the canvas's side padding on each side. */
const FIT_GUTTER = 24;

/** The ruler row under the toolbar. */
export function PageRuler(props: DocsAreaProps & { zoom: Zoom }) {
  void props;
  return null;
}

/** The canvas and the page the editor's text is drawn on. */
export function PageCanvas({
  editor,
  documentId,
  pageSetup,
  zoom,
  onZoom,
  onPageClick,
  children,
}: DocsAreaProps & {
  zoom: Zoom;
  onZoom?: (zoom: Zoom) => void;
  onPageClick: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  const store = useMemo(() => pageStore(editor, documentId, pageSetup), [editor, documentId, pageSetup]);
  const setup = usePageState(store, (s) => s.setup);
  const pages = usePageState(store, (s) => s.pages);
  const textWidth = usePageState(store, (s) => s.textWidth);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  // A newer stored setup that arrives with the page replaces the one on
  // screen.
  const propRef = useRef(pageSetup);
  useEffect(() => {
    if (propRef.current === pageSetup) return;
    if (JSON.stringify(propRef.current) !== JSON.stringify(pageSetup)) store.set({ setup: pageSetup });
    propRef.current = pageSetup;
  }, [pageSetup, store]);

  // The zoom is DocsEditor's; the commands and the shortcuts change it here.
  useEffect(() => {
    store.zoom = zoom;
    store.zoomTo = (next) => onZoom?.(next);
  }, [store, zoom, onZoom]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasWidth(canvas.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const frame = useMemo(() => pageFrame(setup), [setup]);
  const pageless = setup.pageless;
  const fitScale = canvasWidth > 0 ? (canvasWidth - 2 * FIT_GUTTER) / frame.width : 1;
  const scale = zoom === "fit" ? (pageless ? 1 : Math.max(0.25, Math.min(4, fitScale))) : zoom / 100;
  const columnWidth = pageless ? pagelessWidth(canvasWidth || frame.width, scale, textWidth) : frame.width;

  useEffect(() => {
    if (store.get().scale !== scale) store.set({ scale });
  }, [store, scale]);

  // The pagination reads the page from here and says how many pages it
  // drew.
  const config = useMemo<PaginationConfig>(
    () => ({
      enabled: !pageless,
      pitch: frame.pitch,
      area: () => ({ top: frame.top, bottom: frame.height - frame.bottom }),
    }),
    [pageless, frame],
  );
  const configRef = useRef(config);
  useLayoutEffect(() => {
    configRef.current = config;
    repaginate(editor);
  }, [config, editor]);
  useLayoutEffect(
    () =>
      hostPagination(editor, {
        config: () => configRef.current,
        onLayout: (layout) => {
          if (store.get().pages !== layout.pages) store.set({ pages: layout.pages });
        },
      }),
    [editor, store],
  );

  // Pageless: the canvas and the chrome take the page's color.
  const white = /^#f{3}(f{3})?$/i.test(setup.color);
  useEffect(() => {
    const shell = canvasRef.current?.closest<HTMLElement>(".docs-shell");
    if (!shell) return;
    if (pageless && !white) shell.style.setProperty("--docs-canvas", setup.color);
    else if (pageless) shell.style.setProperty("--docs-canvas", "var(--docs-page)");
    else shell.style.removeProperty("--docs-canvas");
    return () => {
      shell.style.removeProperty("--docs-canvas");
    };
  }, [pageless, white, setup.color]);

  // A press in a page's margins puts the caret on the nearest line, as it
  // does in Google Docs.
  const onMarginDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !editor.isEditable) return;
    const target = e.target as Element;
    if (editor.view.dom.contains(target) || target.closest("[data-docs-hf], [data-edit-control]")) return;
    const text = editor.view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, text.left + 2), text.right - 2);
    const y = Math.min(Math.max(e.clientY, text.top + 2), text.bottom - 2);
    const hit = editor.view.posAtCoords({ left: x, top: y });
    if (!hit) return;
    e.preventDefault();
    const { from } = editor.state.selection;
    if (e.shiftKey) editor.chain().focus().setTextSelection({ from, to: hit.pos }).run();
    else editor.chain().focus().setTextSelection(hit.pos).run();
  };

  const pageStyle: React.CSSProperties & Record<`--${string}`, string> = pageless
    ? {
        width: columnWidth,
        padding: `${PAGELESS_TOP - 11}px 0 ${PAGELESS_RUNOUT}px`,
        zoom: scale === 1 ? undefined : scale,
      }
    : {
        width: frame.width,
        height: pages * frame.pitch - PAGE_PITCH_EXTRA,
        padding: `${frame.top}px ${frame.right}px 0 ${frame.left}px`,
        zoom: scale === 1 ? undefined : scale,
        "--docs-sheet-color": setup.color,
      };

  return (
    <div ref={canvasRef} className="docs-canvas" data-pageless={pageless || undefined}>
      <article
        ref={pageRef}
        className="docs-page"
        style={pageStyle}
        onMouseDown={onMarginDown}
        onClick={onPageClick}
        data-docs-page
        data-pageless={pageless || undefined}
        data-docs-pages={pageless ? undefined : pages}
      >
        {!pageless && (
          <div className="docs-sheets" aria-hidden>
            {Array.from({ length: pages }, (_, i) => (
              <div
                key={i}
                className="docs-sheet"
                data-docs-page-sheet
                data-white={white || undefined}
                style={{ top: i * frame.pitch, height: frame.height }}
              />
            ))}
          </div>
        )}
        {children}
      </article>
    </div>
  );
}
