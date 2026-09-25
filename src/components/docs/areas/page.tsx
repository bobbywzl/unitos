"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useLang } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import type { Zoom } from "@/components/docs/toolbar";
import { hostPagination, paginateNow, repaginate, type PaginationConfig } from "@/components/docs/ext/page";
import { PAGE_EVENT, stepZoom, type EditHeaderDetail } from "@/components/docs/page/commands";
import {
  PAGE_PITCH_EXTRA,
  PAGELESS_TOP,
  PX_PER_PT,
  pageFrame,
  pagelessWidth,
} from "@/components/docs/page/geometry";
import {
  HeaderFooterLayer,
  HeaderFooterText,
  HeaderFormatDialog,
  PageNumbersDialog,
  hasText,
  slotFor,
} from "@/components/docs/page/header-footer";
import { PageIndicator } from "@/components/docs/page/indicator";
import { OutlineButton, OutlinePanel } from "@/components/docs/page/outline";
import { HorizontalRuler, VerticalRuler } from "@/components/docs/page/ruler";
import { lengthUnitFor, PageSetupDialog, readPageDefault } from "@/components/docs/page/setup-dialog";
import { pageStore, usePageState, type HeaderArea } from "@/components/docs/page/store";
import { DEFAULT_PAGE_SETUP } from "@/lib/docs/schema";

// The page area (SPEC.md §29): the canvas, the pages, and what sits on and
// around them — the ruler under the toolbar, the vertical ruler and the
// outline at the left, the headers and footers, page setup, and print.
// Google Docs' numbers: the canvas #f8fafd, a Letter page 816 × 1056 px at
// 100% with a 1 px #c4c7c5 border and no shadow, 8 px between pages, the
// first page's border 10 px under the ruler.

export { PX_PER_PT };

/** Pageless: the room under the last line. */
const PAGELESS_RUNOUT = 300;
/** Fit: the canvas's side padding on each side. */
const FIT_GUTTER = 24;
/** The canvas's padding above the first page. */
const CANVAS_TOP = 11;

function scrollParent(el: Element | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
  }
  return null;
}

/** The ruler row under the toolbar. */
export function PageRuler({ editor, documentId, pageSetup, editing }: DocsAreaProps & { zoom: Zoom }) {
  const lang = useLang();
  const store = useMemo(() => pageStore(editor, documentId, pageSetup), [editor, documentId, pageSetup]);
  const showRuler = usePageState(store, (s) => s.showRuler);
  if (!showRuler) return null;
  return (
    <HorizontalRuler
      editor={editor}
      store={store}
      editing={editing}
      unit={lengthUnitFor(lang)}
      onPageSetup={() => store.set({ dialog: "setup" })}
    />
  );
}

/** The header's height and the room under it: the side's rulers and panel
    fill the pane below the header. */
function useView(canvas: React.RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState({ header: 0, height: 0, top: 0 });
  useEffect(() => {
    const el = canvas.current;
    const shell = el?.closest<HTMLElement>(".docs-shell");
    const header = shell?.querySelector<HTMLElement>(".docs-header");
    const scroller = scrollParent(shell ?? null);
    if (!el || !header) return;
    const measure = () => {
      const h = header.offsetHeight;
      const room = scroller ? scroller.clientHeight : window.innerHeight;
      const top = (scroller ? scroller.getBoundingClientRect().top : 0) + h;
      setView((v) => (v.header === h && v.height === room - h && v.top === top ? v : { header: h, height: Math.max(0, room - h), top }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    if (scroller) ro.observe(scroller);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [canvas]);
  return view;
}

/** The canvas and the page the editor's text is drawn on. */
export function PageCanvas({
  editor,
  documentId,
  pageSetup,
  editing,
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
  const lang = useLang();
  const store = useMemo(() => pageStore(editor, documentId, pageSetup), [editor, documentId, pageSetup]);
  const setup = usePageState(store, (s) => s.setup);
  const pages = usePageState(store, (s) => s.pages);
  const textWidth = usePageState(store, (s) => s.textWidth);
  const showRuler = usePageState(store, (s) => s.showRuler);
  const dialog = usePageState(store, (s) => s.dialog);
  const outlineOpen = usePageState(store, (s) => s.outlineOpen);
  const outlineWidth = usePageState(store, (s) => s.outlineWidth);
  const editingHf = usePageState(store, (s) => s.editing);
  const printLayout = usePageState(store, (s) => s.printLayout);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const view = useView(canvasRef);
  const [canvasWidth, setCanvasWidth] = useState(0);

  // A newer stored setup that arrives with the page replaces the one on
  // screen.
  const propRef = useRef(pageSetup);
  useEffect(() => {
    if (propRef.current === pageSetup) return;
    if (JSON.stringify(propRef.current) !== JSON.stringify(pageSetup)) store.set({ setup: pageSetup });
    propRef.current = pageSetup;
  }, [pageSetup, store]);

  // A new document takes this browser's default page (Set as default), and
  // opens with the caret at its start.
  useEffect(() => {
    if (!editing) return;
    const doc = editor.state.doc;
    const empty = doc.childCount === 1 && doc.firstChild?.isTextblock === true && doc.firstChild.content.size === 0;
    if (empty) editor.commands.focus("start");
    const fallback = readPageDefault();
    if (!empty || !fallback || JSON.stringify(store.get().setup) !== JSON.stringify(DEFAULT_PAGE_SETUP)) return;
    void store.saveSetup({ ...DEFAULT_PAGE_SETUP, ...fallback });
    // Once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The zoom is DocsEditor's; the commands and the shortcuts change it here.
  useEffect(() => {
    store.bindZoom((next) => onZoom?.(next));
  }, [store, onZoom]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasWidth(canvas.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const pageless = setup.pageless;
  // Show print layout off: each page keeps only its text area, edge to edge.
  const compact = !printLayout && !pageless;
  const frame = useMemo(() => {
    const full = pageFrame(setup);
    if (!compact) return full;
    const text = full.height - full.top - full.bottom;
    return { ...full, height: text, top: 0, bottom: 0, pitch: text };
  }, [setup, compact]);
  // Fit: the page fills the canvas's width, beside the outline when it is
  // open.
  const vruler = showRuler && !pageless && !compact;
  const outlineLeft = vruler ? 16 : 0;
  const fitRoom = canvasWidth - FIT_GUTTER - (outlineOpen ? outlineLeft + outlineWidth + 16 : FIT_GUTTER);
  const fitScale = canvasWidth > 0 ? fitRoom / frame.width : 1;
  const scale = zoom === "fit" ? (pageless ? 1 : Math.max(0.25, Math.min(4, fitScale))) : zoom / 100;
  const columnWidth = pageless ? pagelessWidth(canvasWidth || frame.width, scale, textWidth) : frame.width;

  useEffect(() => {
    if (store.get().scale !== scale) store.set({ scale });
  }, [store, scale]);

  // Zooming keeps the caret's line where it was on screen, or else the same
  // part of the document at the top of the view.
  const anchorRef = useRef<{ scale: number; ratio: number; caret: number | null }>({ scale, ratio: 0, caret: null });
  useEffect(() => {
    const page = pageRef.current;
    const scroller = scrollParent(page);
    if (!page || !scroller) return;
    const record = () => {
      let caret: number | null = null;
      try {
        const c = editor.view.coordsAtPos(editor.state.selection.head);
        const r = scroller.getBoundingClientRect();
        if (editor.view.hasFocus() && c.top >= r.top && c.bottom <= r.bottom) caret = c.top;
      } catch {
        caret = null;
      }
      anchorRef.current = { scale: anchorRef.current.scale, ratio: scroller.scrollTop / Math.max(1, scroller.scrollHeight), caret };
    };
    record();
    scroller.addEventListener("scroll", record, { passive: true });
    editor.on("selectionUpdate", record);
    return () => {
      scroller.removeEventListener("scroll", record);
      editor.off("selectionUpdate", record);
    };
  }, [editor]);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor.scale === scale) return;
    anchorRef.current = { ...anchor, scale };
    const scroller = scrollParent(pageRef.current);
    if (!scroller) return;
    if (anchor.caret !== null) {
      try {
        scroller.scrollTop += editor.view.coordsAtPos(editor.state.selection.head).top - anchor.caret;
        return;
      } catch {
        // Fall back to the ratio.
      }
    }
    scroller.scrollTop = anchor.ratio * scroller.scrollHeight;
  }, [scale, editor]);

  // The headers' and footers' heights: a header taller than the top margin
  // pushes the text down, a tall footer pulls its bottom up.
  const [hfHeights, setHfHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const measure = () => {
      const next: Record<string, number> = {};
      page.querySelectorAll<HTMLElement>("[data-hf-slot]").forEach((el) => {
        const slot = el.dataset.hfSlot ?? "";
        next[slot] = Math.max(next[slot] ?? 0, el.offsetHeight);
      });
      setHfHeights((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    page.querySelectorAll("[data-hf-slot]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [setup, pages]);

  const area = useMemo(() => {
    if (compact) return () => ({ top: 0, bottom: frame.height });
    return (page: number) => {
      const header = setup[slotFor(setup, "header", page)];
      const footer = setup[slotFor(setup, "footer", page)];
      const h = hasText(header) ? hfHeights[slotFor(setup, "header", page)] ?? 0 : 0;
      const f = hasText(footer) ? hfHeights[slotFor(setup, "footer", page)] ?? 0 : 0;
      return {
        top: Math.max(frame.top, h > 0 ? frame.headerMargin + h : 0),
        bottom: Math.min(frame.height - frame.bottom, f > 0 ? frame.height - frame.footerMargin - f : frame.height),
      };
    };
  }, [setup, frame, hfHeights, compact]);

  // The pagination reads the page from here and says how many pages it
  // drew.
  const config = useMemo<PaginationConfig>(
    () => ({ enabled: !pageless, pitch: frame.pitch, area }),
    [pageless, frame, area],
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

  // Print: the pages at their size, laid out at 100%.
  useEffect(() => {
    const id = "unitos-docs-print-page";
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    const m = setup.margins;
    style.textContent = pageless
      ? `@page { size: ${setup.width}pt ${setup.height}pt; margin: ${m.top}pt ${m.right}pt ${m.bottom}pt ${m.left}pt; }`
      : `@page { size: ${setup.width}pt ${setup.height}pt; margin: 0; }`;
    const page = pageRef.current;
    let restoreCompact = false;
    const before = () => {
      if (!page || pageless) return;
      // Print always lays out the pages whole.
      if (!store.get().printLayout) {
        restoreCompact = true;
        store.setPrinting(true);
        flushSync(() => store.set({ printLayout: true }));
      }
      page.style.setProperty("zoom", "1");
      paginateNow(editor);
    };
    const after = () => {
      if (!page) return;
      page.style.removeProperty("zoom");
      if (restoreCompact) {
        restoreCompact = false;
        store.set({ printLayout: false });
        store.setPrinting(false);
      }
      repaginate(editor);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      style?.remove();
    };
  }, [setup, pageless, editor, store]);

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

  /** The page under a point, and whether the point is in its header, body,
      or footer. */
  const hitPage = (clientY: number): { page: number; zone: HeaderArea | "body" } | null => {
    const el = pageRef.current;
    if (!el || pageless || compact) return null;
    const r = el.getBoundingClientRect();
    const s = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
    const y = (clientY - r.top) / s;
    const page = Math.floor(y / frame.pitch);
    if (page < 0 || page >= pages) return null;
    const local = y - page * frame.pitch;
    if (local > frame.height) return null;
    const a = area(page);
    return { page, zone: local < a.top ? "header" : local > a.bottom ? "footer" : "body" };
  };

  const editHeader = (areaName: HeaderArea, page: number) => {
    if (!editor.isEditable || pageless) return;
    store.set({ editing: { area: areaName, page } });
  };

  // Insert > Header / Footer and the chords (hold Ctrl+Alt, press O then H
  // or F) edit the header or footer of the page that holds the caret.
  useEffect(() => {
    const caretPage = () => {
      const el = pageRef.current;
      if (!el) return 0;
      try {
        const c = editor.view.coordsAtPos(editor.state.selection.head);
        const r = el.getBoundingClientRect();
        const s = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
        return Math.max(0, Math.floor((c.top - r.top) / s / frame.pitch));
      } catch {
        return 0;
      }
    };
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<EditHeaderDetail>).detail;
      if (!editor.isEditable || pageless || !detail) return;
      store.set({ editing: { area: detail.area, page: Math.min(caretPage(), store.get().pages - 1) } });
    };
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const shell = canvasRef.current?.closest(".docs-shell");
      const active = document.activeElement;
      if (!shell || !(active === document.body || (active && shell.contains(active)))) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Zoom: the page's own, not the browser's.
      if (!e.altKey && !e.shiftKey && (e.code === "Equal" || e.code === "NumpadAdd" || e.key === "=" || e.key === "+")) {
        e.preventDefault();
        store.zoomTo(stepZoom(store.get().scale, 1));
        return;
      }
      if (!e.altKey && !e.shiftKey && (e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-")) {
        e.preventDefault();
        store.zoomTo(stepZoom(store.get().scale, -1));
        return;
      }
      if (!e.altKey && !e.shiftKey && (e.code === "Digit0" || e.code === "Numpad0")) {
        e.preventDefault();
        store.zoomTo(100);
        return;
      }
      if (e.altKey && e.code === "BracketLeft") {
        e.preventDefault();
        store.zoomTo("fit");
        return;
      }
      if (!e.altKey) return;
      if (e.code === "KeyO") {
        chordAt = Date.now();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (chordAt && Date.now() - chordAt < 2500 && (e.code === "KeyH" || e.code === "KeyF")) {
        chordAt = 0;
        e.preventDefault();
        e.stopPropagation();
        if (editor.isEditable && !store.get().setup.pageless) {
          store.set({ editing: { area: e.code === "KeyH" ? "header" : "footer", page: Math.min(caretPage(), store.get().pages - 1) } });
        }
      }
    };
    window.addEventListener(PAGE_EVENT.editHeader, onEdit);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(PAGE_EVENT.editHeader, onEdit);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [editor, store, pageless, frame.pitch]);

  // A press in a page's margins puts the caret on the nearest line, as it
  // does in Google Docs; a press in the text leaves a header or footer.
  const onMarginDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest("[data-docs-hf], [data-edit-control]")) return;
    if (store.get().editing) store.set({ editing: null });
    if (editor.view.dom.contains(target) || !editor.isEditable) return;
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
  const onPageDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("[data-docs-hf], [data-edit-control]")) return;
    const hit = hitPage(e.clientY);
    if (hit && hit.zone !== "body") editHeader(hit.zone, hit.page);
  };

  const firstTop = pageless ? 0 : area(0).top;
  const pageStyle: React.CSSProperties & Record<`--${string}`, string> = pageless
    ? {
        width: columnWidth,
        padding: `${PAGELESS_TOP - CANVAS_TOP}px 0 ${PAGELESS_RUNOUT}px`,
        zoom: scale === 1 ? undefined : scale,
        "--docs-page-h": "0px",
      }
    : {
        width: frame.width,
        height: pages * frame.pitch - PAGE_PITCH_EXTRA,
        padding: `${firstTop}px ${frame.right}px 0 ${frame.left}px`,
        zoom: scale === 1 ? undefined : scale,
        "--docs-sheet-color": setup.color,
        "--docs-page-h": `${frame.height}px`,
        "--docs-print-h": `${pages * frame.height}px`,
      };

  // The outline sits right of the vertical ruler; while it would cover the
  // page, the page moves right past it.
  const pageVisual = columnWidth * scale;
  const outlinePush = outlineOpen && outlineLeft + outlineWidth + 8 > (canvasWidth - pageVisual) / 2;

  // A new, empty document opens the outline, as Google Docs does, when the
  // pane has the room for it beside the page.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || store.outlineChosen || canvasWidth === 0) return;
    autoOpened.current = true;
    const doc = editor.state.doc;
    const empty = doc.childCount === 1 && doc.firstChild?.isTextblock === true && doc.firstChild.content.size === 0;
    const room = (canvasWidth - pageVisual) / 2 >= outlineLeft + outlineWidth + 8;
    if (empty && room && !pageless) store.set({ outlineOpen: true });
  }, [canvasWidth, editor, store, pageVisual, outlineLeft, outlineWidth, pageless]);

  const unit = lengthUnitFor(lang);
  const closeDialog = () => {
    store.set({ dialog: null });
    if (!store.get().editing) editor.commands.focus();
  };
  const start = setup.pageNumberStart ?? 1;

  return (
    <>
      <div
        className="docs-side"
        data-pageless={pageless || undefined}
        style={{ "--docs-header-h": `${view.header}px` } as React.CSSProperties}
      >
        {vruler && <VerticalRuler editor={editor} store={store} editing={editing} unit={unit} top={view.top} height={view.height} />}
        {outlineOpen ? (
          <OutlinePanel editor={editor} store={store} left={outlineLeft} height={view.height} viewTop={view.top} />
        ) : (
          <OutlineButton store={store} left={outlineLeft + 50} />
        )}
      </div>
      <div
        ref={canvasRef}
        className="docs-canvas"
        data-pageless={pageless || undefined}
        data-outline-push={outlinePush || undefined}
        style={{ "--docs-outline-w": `${outlineLeft + outlineWidth}px` } as React.CSSProperties}
      >
        <article
          ref={pageRef}
          className={`docs-page${compact ? " docs-page-compact" : ""}`}
          style={pageStyle}
          onMouseDown={onMarginDown}
          onClick={onPageClick}
          onDoubleClick={onPageDoubleClick}
          data-docs-page
          data-pageless={pageless || undefined}
          data-docs-pages={pageless ? undefined : pages}
        >
          {!pageless && (
            <div className="docs-sheets" aria-hidden>
              {Array.from({ length: pages }, (_, i) => {
                const headerSlot = slotFor(setup, "header", i);
                const footerSlot = slotFor(setup, "footer", i);
                const header = setup[headerSlot];
                const footer = setup[footerSlot];
                const ctx = { page: i, pages, start };
                const hidden = (a: HeaderArea) => editingHf?.page === i && editingHf.area === a;
                return (
                  <div
                    key={i}
                    className="docs-sheet"
                    data-docs-page-sheet
                    data-white={white || undefined}
                    style={{ top: i * frame.pitch, height: frame.height, "--docs-sheet-i": i } as React.CSSProperties}
                  >
                    {!compact && header && hasText(header) && (
                      <div
                        className="docs-hf"
                        data-hf-slot={headerSlot}
                        style={{ top: frame.headerMargin, left: frame.left, right: frame.right, visibility: hidden("header") ? "hidden" : undefined }}
                      >
                        <HeaderFooterText doc={header} ctx={ctx} />
                      </div>
                    )}
                    {!compact && footer && hasText(footer) && (
                      <div
                        className="docs-hf"
                        data-hf-slot={footerSlot}
                        style={{ bottom: frame.footerMargin, left: frame.left, right: frame.right, visibility: hidden("footer") ? "hidden" : undefined }}
                      >
                        <HeaderFooterText doc={footer} ctx={ctx} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!pageless && !compact && (
            <HeaderFooterLayer
              store={store}
              frame={frame}
              pages={pages}
              pitch={frame.pitch}
              bodyTop={(i) => area(i).top}
              bodyBottom={(i) => area(i).bottom}
            />
          )}
          {children}
        </article>
      </div>
      {!pageless && <PageIndicator editor={editor} pages={pages} pitch={frame.pitch} />}
      {dialog === "setup" && <PageSetupDialog store={store} onClose={closeDialog} />}
      {dialog === "pageNumbers" && <PageNumbersDialog store={store} onClose={closeDialog} />}
      {dialog === "headerFormat" && <HeaderFormatDialog store={store} onClose={closeDialog} />}
    </>
  );
}
