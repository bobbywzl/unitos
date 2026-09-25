"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useLang } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import type { Zoom } from "@/components/docs/toolbar";
import { hostPagination, paginateNow, repaginate } from "@/components/docs/ext/page";
import { stepZoom } from "@/components/docs/page/commands";
import { PAGE_PITCH_EXTRA, PAGELESS_TOP, pageAt, pageFrame, pagelessWidth, scrollParent } from "@/components/docs/page/geometry";
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
import type { PaginationConfig } from "@/components/docs/page/paginate";
import { HorizontalRuler, VerticalRuler } from "@/components/docs/page/ruler";
import { PageSetupDialog, readPageDefault } from "@/components/docs/page/setup-dialog";
import { PAGE_EVENT, pageStore, usePageState, type EditHeaderDetail, type HeaderArea } from "@/components/docs/page/store";
import { DEFAULT_PAGE_SETUP } from "@/lib/docs/schema";
import { translatorFor } from "@/lib/i18n/dictionaries";

// The page area (SPEC.md §29): the canvas, the pages, and what sits on and
// around them — the ruler under the toolbar, the vertical ruler and the tabs
// & outlines panel at the left, the headers and footers, page setup, and
// print.

/** Pageless: the room under the last line. */
const PAGELESS_RUNOUT = 300;
/** Fit: the canvas's side padding on each side. */
const FIT_GUTTER = 24;
/** The canvas's padding above the first page. */
const CANVAS_TOP = 11;

/** The ruler row under the toolbar. */
export function PageRuler({ editor, documentId, pageSetup, editing }: DocsAreaProps) {
  const store = pageStore(editor, documentId, pageSetup);
  const showRuler = usePageState(store, (s) => s.showRuler);
  return showRuler ? <HorizontalRuler editor={editor} store={store} editing={editing} /> : null;
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
  onZoom: (zoom: Zoom) => void;
  onPageClick: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  const store = pageStore(editor, documentId, pageSetup);
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

  // A newer stored setup that arrives with the page (another person's
  // change) replaces the one on screen — unless a change made here waits to
  // be saved, or a header is being edited.
  const propRef = useRef(pageSetup);
  useEffect(() => {
    if (propRef.current === pageSetup) return;
    propRef.current = pageSetup;
    const now = store.get();
    if (now.editing || store.pendingSaves() > 0) return;
    if (JSON.stringify(now.setup) !== JSON.stringify(pageSetup)) store.set({ setup: pageSetup });
  }, [pageSetup, store]);

  // A new document takes this browser's default page (Set as default), and
  // opens with the caret at its start.
  useEffect(() => {
    if (!editing || !editor.isEmpty) return;
    editor.commands.focus("start");
    const fallback = readPageDefault();
    if (!fallback || JSON.stringify(store.get().setup) !== JSON.stringify(DEFAULT_PAGE_SETUP)) return;
    void store.saveSetup({ ...DEFAULT_PAGE_SETUP, ...fallback });
    // Once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The title row, the toolbar, and the ruler stay over the pane's top: a
  // caret scrolled into view stops below them.
  useEffect(() => {
    const margin = { top: view.header + 8, right: 5, bottom: 8, left: 5 };
    editor.setOptions({ editorProps: { ...editor.options.editorProps, scrollMargin: margin, scrollThreshold: margin } });
  }, [editor, view.header]);

  // The zoom is DocsEditor's; the commands and the shortcuts change it here.
  useEffect(() => {
    store.bindZoom(onZoom);
  }, [store, onZoom]);

  // A saved setup refreshes the page's props, so the other areas (the
  // toolbar, typing) read it too.
  const router = useRouter();
  useEffect(() => {
    store.bindSaved(() => router.refresh());
  }, [store, router]);

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
  // The canvas's left edge for the page: past the outline while it is
  // open, so the page never goes under it. Fit fills the rest.
  const vruler = showRuler && !pageless && !compact;
  const outlineLeft = vruler ? 16 : 0;
  const side = outlineOpen ? outlineLeft + outlineWidth + 16 : FIT_GUTTER;
  const fitScale = canvasWidth > 0 ? (canvasWidth - FIT_GUTTER - side) / frame.width : 1;
  const scale = zoom === "fit" ? (pageless ? 1 : Math.max(0.25, Math.min(4, fitScale))) : zoom / 100;
  const columnWidth = pageless ? pagelessWidth(canvasWidth || frame.width, scale, textWidth) : frame.width;

  useEffect(() => {
    if (store.get().scale !== scale) store.set({ scale });
  }, [store, scale]);

  // A pane narrower than the page (the notes tray open, a phone) opens the
  // page at Fit, so no line runs past the pane's edge.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || canvasWidth === 0) return;
    fittedRef.current = true;
    if (zoom === 100 && !pageless && frame.width + 2 * FIT_GUTTER > canvasWidth) store.zoomTo("fit");
  }, [canvasWidth, zoom, pageless, frame.width, store]);

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
      const height = (a: HeaderArea) => {
        const slot = slotFor(setup, a, page);
        return hasText(setup[slot]) ? hfHeights[slot] ?? 0 : 0;
      };
      const h = height("header");
      const f = height("footer");
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
  const lang = useLang();
  useLayoutEffect(() => {
    const t = translatorFor(lang);
    return hostPagination(editor, {
      config,
      onPages: (pages) => {
        if (store.get().pages !== pages) store.set({ pages });
      },
      labels: { fold: t("docsPage.collapseHeading"), unfold: t("docsPage.expandHeading") },
    });
  }, [editor, store, config, lang]);

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
    if (pageless) shell.style.setProperty("--docs-canvas", white ? "var(--docs-page)" : setup.color);
    else shell.style.removeProperty("--docs-canvas");
    return () => {
      shell.style.removeProperty("--docs-canvas");
    };
  }, [pageless, white, setup.color]);

  // Insert > Header / Footer and the chords (hold Ctrl+Alt, press O then H
  // or F) edit the header or footer of the page that holds the caret.
  useEffect(() => {
    const caretPage = () => {
      const el = pageRef.current;
      try {
        return el ? Math.max(0, pageAt(el, frame.pitch, editor.view.coordsAtPos(editor.state.selection.head).top).page) : 0;
      } catch {
        return 0;
      }
    };
    const editAtCaret = (area: HeaderArea) => {
      if (!editor.isEditable || store.get().setup.pageless) return;
      store.set({ editing: { area, page: Math.min(caretPage(), store.get().pages - 1) } });
    };
    const onEdit = (e: Event) => editAtCaret((e as CustomEvent<EditHeaderDetail>).detail.area);
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const shell = canvasRef.current?.closest(".docs-shell");
      const active = document.activeElement;
      if (!shell || !(active === document.body || (active && shell.contains(active)))) return;
      if (!e.ctrlKey && !e.metaKey) return;
      // Zoom: the page's own, not the browser's.
      let zoom: number | "fit" | null = null;
      if (!e.altKey && !e.shiftKey) {
        if (e.code === "Equal" || e.code === "NumpadAdd" || e.key === "=" || e.key === "+") zoom = stepZoom(store.get().scale, 1);
        else if (e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-") zoom = stepZoom(store.get().scale, -1);
        else if (e.code === "Digit0" || e.code === "Numpad0") zoom = 100;
      } else if (e.altKey && e.code === "BracketLeft") zoom = "fit";
      if (zoom !== null) {
        e.preventDefault();
        store.zoomTo(zoom);
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
        editAtCaret(e.code === "KeyH" ? "header" : "footer");
      }
    };
    window.addEventListener(PAGE_EVENT.editHeader, onEdit);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(PAGE_EVENT.editHeader, onEdit);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [editor, store, frame.pitch]);

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
  // A double-click in a page's top or bottom margin edits its header or
  // footer.
  const onPageDoubleClick = (e: React.MouseEvent) => {
    const el = pageRef.current;
    if (!el || pageless || compact || !editor.isEditable) return;
    if ((e.target as Element).closest("[data-docs-hf], [data-edit-control]")) return;
    const { page, y } = pageAt(el, frame.pitch, e.clientY);
    if (page < 0 || page >= pages || y > frame.height) return;
    const a = area(page);
    if (y < a.top) store.set({ editing: { area: "header", page } });
    else if (y > a.bottom) store.set({ editing: { area: "footer", page } });
  };

  const firstTop = pageless ? 0 : area(0).top;
  const pageStyle: React.CSSProperties & Record<`--${string}`, string> = pageless
    ? {
        width: columnWidth,
        padding: `${PAGELESS_TOP - CANVAS_TOP}px 0 ${PAGELESS_RUNOUT}px`,
        zoom: scale === 1 ? undefined : scale,
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

  // The page stands centered in the canvas while the room left of it holds
  // the outline; else it moves right, past the outline.
  const pageVisual = columnWidth * scale;
  const centered = (canvasWidth - pageVisual) / 2 >= side;

  // A new, empty document opens the outline, as Google Docs does, when the
  // pane has the room for it beside the page.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || store.outlineChosen || canvasWidth === 0) return;
    autoOpened.current = true;
    const room = (canvasWidth - pageVisual) / 2 >= outlineLeft + outlineWidth + 16;
    if (editor.isEmpty && room && !pageless) store.set({ outlineOpen: true });
  }, [canvasWidth, editor, store, pageVisual, outlineLeft, outlineWidth, pageless]);

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
        {vruler && <VerticalRuler editor={editor} store={store} editing={editing} top={view.top} height={view.height} />}
        {outlineOpen ? (
          <OutlinePanel editor={editor} store={store} left={outlineLeft} height={view.height} viewTop={view.top} />
        ) : (
          <OutlineButton editor={editor} store={store} ruler={vruler} />
        )}
      </div>
      <div
        ref={canvasRef}
        className="docs-canvas"
        data-pageless={pageless || undefined}
        style={{ "--docs-pad-l": `${side}px`, "--docs-pad-r": `${centered ? side : FIT_GUTTER}px` } as React.CSSProperties}
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
        >
          {!pageless && (
            <div className="docs-sheets" aria-hidden>
              {Array.from({ length: pages }, (_, i) => {
                return (
                  <div
                    key={i}
                    className="docs-sheet"
                    data-docs-page-sheet
                    data-white={white || undefined}
                    style={{ top: i * frame.pitch, height: frame.height, "--docs-sheet-i": i } as React.CSSProperties}
                  >
                    {(["header", "footer"] as const).map((a) => {
                      const slot = slotFor(setup, a, i);
                      const doc = setup[slot];
                      if (compact || !doc || !hasText(doc)) return null;
                      const edge = a === "header" ? { top: frame.headerMargin } : { bottom: frame.footerMargin };
                      const hidden = editingHf?.page === i && editingHf.area === a;
                      return (
                        <div
                          key={a}
                          className="docs-hf"
                          data-hf-slot={slot}
                          style={{ ...edge, left: frame.left, right: frame.right, visibility: hidden ? "hidden" : undefined }}
                        >
                          <HeaderFooterText doc={doc} ctx={{ page: i, pages, start }} />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {!pageless && !compact && (
            <HeaderFooterLayer store={store} frame={frame} pages={pages} area={area} />
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
