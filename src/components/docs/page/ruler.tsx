"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { PageIcon } from "@/components/docs/page/icons";
import {
  PT_PER_UNIT,
  PX_PER_PT,
  pageFrame,
  type LengthUnit,
  type PageFrame,
} from "@/components/docs/page/geometry";
import { usePageState, type PageStore } from "@/components/docs/page/store";
import type { PageSetup } from "@/lib/docs/schema";

// The rulers (SPEC.md §29), Google Docs': a 15 px strip under the toolbar
// whose 0 is the left margin, ticks every 1/8 in (0.25 cm), a number every
// inch (cm) counted outward from the margin; the margin areas drag the page's
// margins, and the three blue markers drag the paragraph's left, first-line,
// and right indents. While a marker or a margin moves, a blue guide runs down
// the page and a dark tip shows the value to two decimals. The vertical ruler
// at the left does the same for the top and bottom margins of the page that
// holds the caret. Both follow the zoom.

/** The page's place on screen, client px. */
export type PageRect = { left: number; top: number; width: number; height: number; scale: number };

/** Ticks closer than this draw only the major ones; numbers need more. */
const MIN_TICK = 5;
const MIN_NUMBER_TICK = 7;
/** The least room a text column keeps, in points. */
const MIN_TEXT_PT = 36;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
  }
  return null;
}

/** Where the page is on screen, kept up to date through scrolling, resizing,
    zooming, and the page's moves. */
export function usePageRect(editor: Editor, deps: unknown[]): PageRect | null {
  const [rect, setRect] = useState<PageRect | null>(null);
  useEffect(() => {
    const page = editor.view.dom.closest<HTMLElement>("[data-docs-page]");
    if (!page) return;
    const canvas = page.closest<HTMLElement>(".docs-canvas");
    const scroller = scrollParent(page);
    let frame = 0;
    let moving = 0;
    const measure = () => {
      frame = 0;
      const r = page.getBoundingClientRect();
      const scale = page.offsetWidth > 0 ? r.width / page.offsetWidth : 1;
      setRect((prev) =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height, scale },
      );
      if (moving > 0) frame = requestAnimationFrame(measure);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const start = () => {
      moving += 1;
      schedule();
    };
    const stop = () => {
      moving = Math.max(0, moving - 1);
      schedule();
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(page);
    if (canvas) ro.observe(canvas);
    canvas?.addEventListener("scroll", schedule, { passive: true });
    canvas?.addEventListener("transitionrun", start);
    canvas?.addEventListener("transitionend", stop);
    canvas?.addEventListener("transitioncancel", stop);
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      canvas?.removeEventListener("scroll", schedule);
      canvas?.removeEventListener("transitionrun", start);
      canvas?.removeEventListener("transitionend", stop);
      canvas?.removeEventListener("transitioncancel", stop);
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // The page's own changes (setup, zoom, pages) come in through deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, ...deps]);
  return rect;
}

/** A value in the ruler's unit, to two decimals, never "-0.00". */
export function formatRulerValue(pt: number, unit: LengthUnit): string {
  const v = pt / PT_PER_UNIT[unit];
  return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
}

/** Snap to 1/16 in or 0.25 cm, as Docs' ruler does. */
function snapPt(pt: number, unit: LengthUnit): number {
  const step = unit === "in" ? 4.5 : 7.0866;
  return Math.round(pt / step) * step;
}

type Tick = { at: number; kind: "minor" | "major" | "unit"; label: string | null; active: boolean };

/** The ticks along a ruler `length` px long whose 0 sits at `origin` px, in
    px at the page's zoom; `active` is the text column [from, to]. */
function ticks(unit: LengthUnit, scale: number, origin: number, length: number, from: number, to: number): Tick[] {
  const unitPx = PT_PER_UNIT[unit] * PX_PER_PT * scale;
  const sub = unit === "in" ? 8 : 4;
  const majorEvery = unit === "in" ? 4 : 2;
  const step = unitPx / sub;
  let every = 1;
  let onlyMajor = false;
  if (step <= MIN_TICK) {
    onlyMajor = true;
    every = majorEvery;
    // Majors crowded too: space them out by 4, then 2, and so on.
    let factor = 4;
    while (step * every <= MIN_TICK) {
      every *= factor;
      factor = factor === 4 ? 2 : 4;
    }
  }
  const numbers = !onlyMajor && step > MIN_NUMBER_TICK;
  const out: Tick[] = [];
  const first = Math.ceil(-origin / step);
  const last = Math.floor((length - origin) / step);
  for (let k = first; k <= last; k++) {
    if (k % every !== 0) continue;
    const at = origin + k * step;
    const isUnit = k % sub === 0;
    const isMajor = k % majorEvery === 0;
    const active = at >= from - 0.5 && at <= to + 0.5;
    if (isUnit && k !== 0 && numbers) out.push({ at, kind: "unit", label: String(Math.abs(k / sub)), active });
    else if (isUnit && k === 0) out.push({ at, kind: "unit", label: null, active });
    else out.push({ at, kind: isMajor || onlyMajor ? "major" : "minor", label: null, active });
  }
  return out;
}

type DragTip = { x: number; y: number; text: string; vertical: boolean; guide: number } | null;

/** The guide down the page and the value's tip while a marker moves. */
function DragFeedback({ tip }: { tip: DragTip }) {
  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div className="docs-ruler-feedback" data-edit-control>
      {tip.vertical ? (
        <div className="docs-ruler-guide docs-ruler-guide-h" style={{ top: tip.guide, left: tip.x }} />
      ) : (
        <div className="docs-ruler-guide docs-ruler-guide-v" style={{ left: tip.guide, top: tip.y }} />
      )}
      <div
        className={`docs-ruler-tip${tip.vertical ? " docs-ruler-tip-v" : ""}`}
        style={{ left: tip.vertical ? tip.x + 18 : tip.x, top: tip.vertical ? tip.guide : tip.y - 4 }}
      >
        {tip.text}
      </div>
    </div>,
    document.body,
  );
}

/** Start a drag on a ruler control: `move` gets the pointer's client x (or
    y), `end` the last one. */
function startDrag(
  e: React.PointerEvent,
  vertical: boolean,
  move: (client: number) => void,
  end: (client: number | null) => void,
) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  let last: number | null = null;
  const onMove = (ev: PointerEvent) => {
    last = vertical ? ev.clientY : ev.clientX;
    move(last);
  };
  const onUp = () => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onCancel);
    end(last);
  };
  const onCancel = () => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onCancel);
    end(null);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onCancel);
  move(vertical ? e.clientY : e.clientX);
}

/** The paragraph under the caret: its indents in points and its container's
    edges in px from the text column's left, at 100%. */
type Indents = { left: number; first: number; right: number; boxLeft: number; boxRight: number };

function readIndents(editor: Editor): Indents | null {
  const { $head } = editor.state.selection;
  const node = $head.parent;
  if (!node.isTextblock || (node.type.name !== "paragraph" && node.type.name !== "heading")) return null;
  const dom = editor.view.nodeDOM($head.before());
  if (!(dom instanceof HTMLElement)) return null;
  const column = editor.view.dom.getBoundingClientRect();
  const width = editor.view.dom.offsetWidth;
  const scale = width > 0 ? column.width / width : 1;
  const r = dom.getBoundingClientRect();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const left = num(node.attrs.indentLeft);
  const right = num(node.attrs.indentRight);
  const first = num(node.attrs.indentFirstLine);
  return {
    left,
    first,
    right,
    boxLeft: (r.left - column.left) / scale - left * PX_PER_PT,
    boxRight: (r.right - column.left) / scale + right * PX_PER_PT,
  };
}

function useIndents(editor: Editor, frame: PageFrame): Indents | null {
  const [indents, setIndents] = useState<Indents | null>(null);
  useEffect(() => {
    let frameId = 0;
    const read = () => {
      frameId = 0;
      const next = readIndents(editor);
      setIndents((prev) =>
        prev && next && Object.keys(next).every((k) => Math.abs(next[k as keyof Indents] - prev[k as keyof Indents]) < 0.01)
          ? prev
          : next,
      );
    };
    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(read);
    };
    editor.on("transaction", schedule);
    schedule();
    return () => {
      editor.off("transaction", schedule);
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [editor, frame]);
  return indents;
}

/** Set an indent on every paragraph in the selection, in points. */
function setIndents(editor: Editor, patch: { indentLeft?: number; indentFirstLine?: number; indentRight?: number }) {
  const { state } = editor;
  const tr = state.tr;
  const clean = (v: number) => (Math.abs(v) < 0.01 ? null : Math.round(v * 100) / 100);
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
    const attrs: Record<string, unknown> = { ...node.attrs };
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) attrs[key] = clean(value);
    tr.setNodeMarkup(pos, undefined, attrs);
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  editor.commands.focus();
}

/** The ruler row under the toolbar: the corner with Page setup, then the
    horizontal ruler. */
export function HorizontalRuler({
  editor,
  store,
  editing,
  unit,
  onPageSetup,
}: {
  editor: Editor;
  store: PageStore;
  editing: boolean;
  unit: LengthUnit;
  onPageSetup: () => void;
}) {
  const t = useT();
  const setup = usePageState(store, (s) => s.setup);
  const pages = usePageState(store, (s) => s.pages);
  const scale = usePageState(store, (s) => s.scale);
  const textWidth = usePageState(store, (s) => s.textWidth);
  const frame = useMemo(() => pageFrame(setup), [setup]);
  const page = usePageRect(editor, [setup, scale, pages, textWidth]);
  const stripRef = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState<{ left: number; width: number; bottom: number } | null>(null);
  const indents = useIndents(editor, frame);
  const [tip, setTip] = useState<DragTip>(null);
  // While a marker moves: its place, px at the page's zoom from the page's left.
  const [draft, setDraft] = useState<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStrip((prev) => (prev && prev.left === r.left && prev.width === r.width && prev.bottom === r.bottom ? prev : { left: r.left, width: r.width, bottom: r.bottom }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const pageless = setup.pageless;
  const s = page?.scale ?? scale;
  // The page's left edge and the text column, px at the zoom, from the
  // strip's left.
  const pageLeft = page && strip ? page.left - strip.left : 0;
  const marginLeft = pageless ? 0 : frame.left * s;
  const pageWidth = page ? page.width : frame.width * s;
  const marginRight = pageless ? 0 : frame.right * s;
  const list = strip && page ? ticks(unit, s, marginLeft, pageWidth, marginLeft, pageWidth - marginRight) : [];

  const toPt = (px: number) => px / s / PX_PER_PT;
  const tipY = strip ? strip.bottom - 16 : 0;

  const dragMargin = (side: "left" | "right") => (e: React.PointerEvent) => {
    if (!editing || !page || !strip || pageless) return;
    const other = side === "left" ? frame.right : frame.left;
    const limit = frame.width - other - MIN_TEXT_PT * PX_PER_PT; // px at 100%
    let value = side === "left" ? setup.margins.left : setup.margins.right;
    startDrag(
      e,
      false,
      (clientX) => {
        const fromEdge = side === "left" ? clientX - page.left : page.left + page.width - clientX;
        const pt = Math.max(0, Math.min(limit / PX_PER_PT, snapPt(toPt(fromEdge), unit)));
        value = pt;
        const at = side === "left" ? pt * PX_PER_PT * s : pageWidth - pt * PX_PER_PT * s;
        setDraft({ key: `margin-${side}`, at });
        setTip({ x: page.left + at, y: tipY, text: formatRulerValue(pt, unit), vertical: false, guide: page.left + at });
      },
      (last) => {
        setDraft(null);
        setTip(null);
        if (last === null) return;
        const next: PageSetup = { ...setup, margins: { ...setup.margins, [side]: Math.round(value * 100) / 100 } };
        void store.saveSetup(next);
      },
    );
  };

  const dragIndent = (key: "left" | "first" | "right") => (e: React.PointerEvent) => {
    if (!editing || !indents || !page || !strip) return;
    // Container edges in px at the zoom, from the page's left.
    const boxLeft = marginLeft + indents.boxLeft * s;
    const boxRight = marginLeft + indents.boxRight * s;
    const boxWidthPt = toPt(boxRight - boxLeft);
    let value = 0;
    startDrag(
      e,
      false,
      (clientX) => {
        const x = clientX - page.left;
        let at = 0;
        if (key === "right") {
          const pt = Math.max(0, Math.min(boxWidthPt - indents.left - MIN_TEXT_PT, snapPt(toPt(boxRight - x), unit)));
          value = pt;
          at = boxRight - pt * PX_PER_PT * s;
          setTip({ x: page.left + at, y: tipY, text: formatRulerValue(pt, unit), vertical: false, guide: page.left + at });
        } else {
          const pt = Math.max(0, Math.min(boxWidthPt - indents.right - MIN_TEXT_PT, snapPt(toPt(x - boxLeft), unit)));
          value = pt;
          at = boxLeft + pt * PX_PER_PT * s;
          setTip({ x: page.left + at, y: tipY, text: formatRulerValue(pt, unit), vertical: false, guide: page.left + at });
        }
        setDraft({ key, at });
      },
      (last) => {
        setDraft(null);
        setTip(null);
        if (last === null) return;
        if (key === "left") setIndents(editor, { indentLeft: value });
        else if (key === "first") setIndents(editor, { indentFirstLine: value - indents.left });
        else setIndents(editor, { indentRight: value });
      },
    );
  };

  // The markers' places, px at the zoom from the page's left.
  const markers = indents
    ? {
        left: marginLeft + (indents.boxLeft + indents.left * PX_PER_PT) * s,
        first: marginLeft + (indents.boxLeft + (indents.left + indents.first) * PX_PER_PT) * s,
        right: marginLeft + (indents.boxRight - indents.right * PX_PER_PT) * s,
      }
    : null;
  if (markers && draft) {
    if (draft.key === "left") {
      markers.first += draft.at - markers.left;
      markers.left = draft.at;
    } else if (draft.key === "first") markers.first = draft.at;
    else if (draft.key === "right") markers.right = draft.at;
  }
  const marginLeftAt = draft?.key === "margin-left" ? draft.at : marginLeft;
  const marginRightAt = draft?.key === "margin-right" ? draft.at : pageWidth - marginRight;

  return (
    <div className="docs-ruler-row" data-pageless={pageless || undefined}>
      <div className="docs-ruler-corner">
        {editing && (
          <button
            type="button"
            className="docs-ruler-corner-btn"
            aria-label={t("docsPage.pageSetup")}
            data-tip={t("docsPage.pageSetup")}
            data-track="docs:page-setup-corner"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPageSetup}
          >
            <PageIcon size={14} />
          </button>
        )}
      </div>
      <div ref={stripRef} className="docs-ruler" role="presentation" aria-label={t("docsPage.ruler")}>
        {strip && page && (
          <div className="docs-ruler-face" style={{ left: pageLeft, width: pageWidth }}>
            {list.map((tick, i) => (
              <span
                key={i}
                className={`docs-ruler-tick docs-ruler-${tick.kind}${tick.active ? " docs-ruler-active" : ""}`}
                style={{ left: tick.at }}
              >
                {tick.label && <span className="docs-ruler-number">{tick.label}</span>}
              </span>
            ))}
            {!pageless && (
              <>
                <span
                  className="docs-ruler-margin docs-ruler-margin-start"
                  style={{ left: 0, width: Math.max(0, marginLeftAt) }}
                  data-tip={draft ? undefined : t("docsPage.leftMargin")}
                  onPointerDown={dragMargin("left")}
                  data-edit={editing || undefined}
                />
                <span
                  className="docs-ruler-margin docs-ruler-margin-end"
                  style={{ left: marginRightAt, width: Math.max(0, pageWidth - marginRightAt) }}
                  data-tip={draft ? undefined : t("docsPage.rightMargin")}
                  onPointerDown={dragMargin("right")}
                  data-edit={editing || undefined}
                />
              </>
            )}
            {markers && (
              <>
                <span
                  className="docs-ruler-marker docs-ruler-indent-first"
                  style={{ left: markers.first }}
                  data-tip={draft ? undefined : t("docsPage.firstLineIndent")}
                  aria-label={t("docsPage.firstLineIndent")}
                  onPointerDown={dragIndent("first")}
                  data-edit={editing || undefined}
                />
                <span
                  className="docs-ruler-marker docs-ruler-indent-start"
                  style={{ left: markers.left }}
                  data-tip={draft ? undefined : t("docsPage.leftIndent")}
                  aria-label={t("docsPage.leftIndent")}
                  onPointerDown={dragIndent("left")}
                  data-edit={editing || undefined}
                >
                  <Triangle />
                </span>
                <span
                  className="docs-ruler-marker docs-ruler-indent-end"
                  style={{ left: markers.right }}
                  data-tip={draft ? undefined : t("docsPage.rightIndent")}
                  aria-label={t("docsPage.rightIndent")}
                  onPointerDown={dragIndent("right")}
                  data-edit={editing || undefined}
                >
                  <Triangle />
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <DragFeedback tip={tip} />
    </div>
  );
}

function Triangle() {
  return (
    <svg width="12" height="6" viewBox="0 0 12 6" aria-hidden focusable="false">
      <path d="M0 0h12L6 6z" fill="currentColor" />
    </svg>
  );
}

/** The vertical ruler at the canvas's left: the top and bottom margins of the
    page that holds the caret. */
export function VerticalRuler({
  editor,
  store,
  editing,
  unit,
  top,
  height,
}: {
  editor: Editor;
  store: PageStore;
  editing: boolean;
  unit: LengthUnit;
  /** The ruler's top on screen, client px. */
  top: number;
  height: number;
}): ReactNode {
  const t = useT();
  const setup = usePageState(store, (s) => s.setup);
  const pages = usePageState(store, (s) => s.pages);
  const scale = usePageState(store, (s) => s.scale);
  const frame = useMemo(() => pageFrame(setup), [setup]);
  const page = usePageRect(editor, [setup, scale, pages]);
  const [caretPage, setCaretPage] = useState(0);
  const [tip, setTip] = useState<DragTip>(null);
  const [draft, setDraft] = useState<{ key: "top" | "bottom"; at: number } | null>(null);

  // The page that holds the caret; when that page is out of view, the page
  // most in view.
  const readCaretPage = useCallback(() => {
    const art = editor.view.dom.closest<HTMLElement>("[data-docs-page]");
    if (!art) return;
    const r = art.getBoundingClientRect();
    const s = art.offsetWidth > 0 ? r.width / art.offsetWidth : 1;
    const pageAt = (clientY: number) => Math.max(0, Math.min(pages - 1, Math.floor((clientY - r.top) / s / frame.pitch)));
    try {
      const c = editor.view.coordsAtPos(editor.state.selection.head);
      const caret = pageAt(c.top);
      const pageTop = r.top + caret * frame.pitch * s;
      const visible = pageTop < top + height && pageTop + frame.height * s > top;
      setCaretPage(visible ? caret : pageAt(top + height / 2));
    } catch {
      setCaretPage(pageAt(top + height / 2));
    }
  }, [editor, pages, frame.pitch, frame.height, top, height]);

  useEffect(() => {
    let id = 0;
    const schedule = () => {
      if (!id) id = requestAnimationFrame(() => {
        id = 0;
        readCaretPage();
      });
    };
    editor.on("selectionUpdate", schedule);
    editor.on("update", schedule);
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    schedule();
    return () => {
      editor.off("selectionUpdate", schedule);
      editor.off("update", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
      if (id) cancelAnimationFrame(id);
    };
  }, [editor, readCaretPage]);

  if (!page) return <div className="docs-vruler" style={{ height }} aria-hidden />;
  const s = page.scale;
  const pageTop = page.top + caretPage * frame.pitch * s - top;
  const pageHeight = frame.height * s;
  const marginTop = frame.top * s;
  const marginBottom = frame.bottom * s;
  const list = ticks(unit, s, marginTop, pageHeight, marginTop, pageHeight - marginBottom);
  const toPt = (px: number) => px / s / PX_PER_PT;

  const drag = (side: "top" | "bottom") => (e: React.PointerEvent) => {
    if (!editing) return;
    const other = side === "top" ? frame.bottom : frame.top;
    const limit = (frame.height - other) / PX_PER_PT - MIN_TEXT_PT;
    let value = side === "top" ? setup.margins.top : setup.margins.bottom;
    const edge = top + pageTop;
    startDrag(
      e,
      true,
      (clientY) => {
        const fromEdge = side === "top" ? clientY - edge : edge + pageHeight - clientY;
        const pt = Math.max(0, Math.min(limit, snapPt(toPt(fromEdge), unit)));
        value = pt;
        const at = side === "top" ? pt * PX_PER_PT * s : pageHeight - pt * PX_PER_PT * s;
        setDraft({ key: side, at });
        setTip({ x: 16, y: 0, text: formatRulerValue(pt, unit), vertical: true, guide: edge + at });
      },
      (last) => {
        setDraft(null);
        setTip(null);
        if (last === null) return;
        void store.saveSetup({ ...setup, margins: { ...setup.margins, [side]: Math.round(value * 100) / 100 } });
      },
    );
  };
  const topAt = draft?.key === "top" ? draft.at : marginTop;
  const bottomAt = draft?.key === "bottom" ? draft.at : pageHeight - marginBottom;

  return (
    <div className="docs-vruler" style={{ height }} aria-label={t("docsPage.verticalRuler")}>
      <div className="docs-vruler-face" style={{ top: pageTop, height: pageHeight }}>
        {list.map((tick, i) => (
          <span
            key={i}
            className={`docs-vruler-tick docs-ruler-${tick.kind}${tick.active ? " docs-ruler-active" : ""}`}
            style={{ top: tick.at }}
          >
            {tick.label && <span className="docs-ruler-number">{tick.label}</span>}
          </span>
        ))}
        <span
          className="docs-vruler-margin docs-vruler-margin-start"
          style={{ top: 0, height: Math.max(0, topAt) }}
          data-tip={draft ? undefined : t("docsPage.topMargin")}
          onPointerDown={drag("top")}
          data-edit={editing || undefined}
        />
        <span
          className="docs-vruler-margin docs-vruler-margin-end"
          style={{ top: bottomAt, height: Math.max(0, pageHeight - bottomAt) }}
          data-tip={draft ? undefined : t("docsPage.bottomMargin")}
          onPointerDown={drag("bottom")}
          data-edit={editing || undefined}
        />
      </div>
      <DragFeedback tip={tip} />
    </div>
  );
}
