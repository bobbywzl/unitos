"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang, useT } from "@/components/lang-provider";
import { DropdownPanel, MenuItem } from "@/components/docs/menu";
import {
  MIN_TEXT_PT,
  PT_PER_UNIT,
  PX_PER_PT,
  lengthUnitFor,
  pageAt,
  pageFrame,
  scrollParent,
  type LengthUnit,
  type PageFrame,
} from "@/components/docs/page/geometry";
import { usePageState, type PageStore } from "@/components/docs/page/store";
import { editTabStops, parseTabStops, type TabAlign, type TabStop } from "@/components/docs/page/tabs";
import type { PageSetup } from "@/lib/docs/schema";

// The rulers (SPEC.md §29), Google Docs': a 15 px strip under the toolbar
// whose 0 is the left margin, ticks every 1/8 in (0.25 cm), a number every
// inch (cm) counted outward from the margin; the margin areas drag the page's
// margins, and the three blue markers drag the paragraph's left, first-line,
// and right indents. A click in the text column adds a tab stop; a stop drags
// along, and off the ruler to go. While a marker or a margin moves, a blue
// guide runs down the page and a dark tip shows the value to two decimals.
// The vertical ruler at the left does the same for the top and bottom
// margins of the page that holds the caret. Both follow the zoom.

/** The page's place on screen, client px; x is its left from the canvas's. */
type PageRect = { left: number; top: number; width: number; height: number; scale: number; x: number };

/** Ticks closer than this draw only the major ones; numbers need more. */
const MIN_TICK = 5;
const MIN_NUMBER_TICK = 7;

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
      const x = r.left - (canvas?.getBoundingClientRect().left ?? 0);
      setRect((prev) =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height && prev.x === x
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height, scale, x },
      );
      if (moving > 0) frame = requestAnimationFrame(measure);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // The page moves with the canvas's own padding transitions (the layer's
    // shift, the outline's push); follow them frame by frame.
    const start = (e: Event) => {
      if (e.target !== canvas) return;
      moving += 1;
      schedule();
    };
    const stop = (e: Event) => {
      if (e.target !== canvas) return;
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
function formatRulerValue(pt: number, unit: LengthUnit): string {
  const v = pt / PT_PER_UNIT[unit];
  return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
}

/** Snap to 1/16 in or 0.25 cm, as Docs' ruler does. */
function snapPt(pt: number, unit: LengthUnit): number {
  const step = unit === "in" ? 4.5 : 7.0866;
  return Math.round(pt / step) * step;
}

type Tick = { at: number; major: boolean; label: string | null; active: boolean };

/** The ticks along a ruler `length` px long whose 0 sits at `origin` px, in
    px at the page's zoom; `active` is the text column [from, to]. */
function ticks(unit: LengthUnit, scale: number, origin: number, length: number, from: number, to: number): Tick[] {
  const sub = unit === "in" ? 8 : 4;
  const majorEvery = sub / 2;
  const step = (PT_PER_UNIT[unit] * PX_PER_PT * scale) / sub;
  // Crowded ticks draw only the major ones, spaced out by 4, then 2, and so on.
  let every = 1;
  if (step <= MIN_TICK) {
    every = majorEvery;
    for (let factor = 4; step * every <= MIN_TICK; factor = factor === 4 ? 2 : 4) every *= factor;
  }
  const numbers = every === 1 && step > MIN_NUMBER_TICK;
  const out: Tick[] = [];
  for (let k = Math.ceil(-origin / step); k <= Math.floor((length - origin) / step); k++) {
    if (k % every !== 0) continue;
    const at = origin + k * step;
    const label = numbers && k % sub === 0 && k !== 0 ? String(Math.abs(k / sub)) : null;
    out.push({
      at,
      major: k !== 0 && !label && (every > 1 || k % majorEvery === 0),
      label,
      active: at >= from - 0.5 && at <= to + 0.5,
    });
  }
  return out;
}

/** The ticks of either ruler. */
function Ticks({ list, vertical }: { list: Tick[]; vertical?: boolean }) {
  return list.map((tick, i) => (
    <span
      key={i}
      className={`${vertical ? "docs-vruler-tick" : "docs-ruler-tick"}${tick.major ? " docs-ruler-major" : ""}${tick.active ? " docs-ruler-active" : ""}`}
      style={vertical ? { top: tick.at } : { left: tick.at }}
    >
      {tick.label && <span className="docs-ruler-number">{tick.label}</span>}
    </span>
  ));
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

/** Start a drag on a ruler control: `move` gets the pointer's client x and
    y, `end` whether it moved and was let go (not cancelled). */
function startDrag(e: React.PointerEvent, move: (x: number, y: number) => void, end: (moved: boolean) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    moved = true;
    move(ev.clientX, ev.clientY);
  };
  const finish = (done: boolean) => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onCancel);
    end(done);
  };
  const onUp = () => finish(moved);
  const onCancel = () => finish(false);
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onCancel);
  move(e.clientX, e.clientY);
}

type Side = keyof PageSetup["margins"];
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/** Drag a page margin: it follows the pointer from where the press started,
    snapped, and leaves the text MIN_TEXT_PT; `show` gets the margin in
    points while it moves, null at the end. The setup saves on release. */
function dragMargin(e: React.PointerEvent, store: PageStore, side: Side, unit: LengthUnit, scale: number, show: (pt: number | null) => void) {
  const setup = store.get().setup;
  const vertical = side === "top" || side === "bottom";
  const sign = side === "left" || side === "top" ? 1 : -1;
  const initial = setup.margins[side];
  const limit = (vertical ? setup.height : setup.width) - setup.margins[OPPOSITE[side]] - MIN_TEXT_PT;
  const start = vertical ? e.clientY : e.clientX;
  let value = initial;
  startDrag(
    e,
    (x, y) => {
      value = Math.max(0, Math.min(limit, snapPt(initial + (sign * ((vertical ? y : x) - start)) / scale / PX_PER_PT, unit)));
      show(value);
    },
    (moved) => {
      show(null);
      if (moved) void store.saveSetup({ ...setup, margins: { ...setup.margins, [side]: Math.round(value * 100) / 100 } });
    },
  );
}

/** The paragraph under the caret: its indents and tab stops in points, and
    its container's edges in px from the text column's left, at 100%. */
type Indents = { left: number; first: number; right: number; boxLeft: number; boxRight: number; tabs: TabStop[] };

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
    tabs: parseTabStops(node.attrs.tabStops),
  };
}

function useIndents(editor: Editor, frame: PageFrame): Indents | null {
  const [indents, setIndents] = useState<Indents | null>(null);
  useEffect(() => {
    let frameId = 0;
    const read = () => {
      frameId = 0;
      const next = readIndents(editor);
      setIndents((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
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
export function setIndents(editor: Editor, patch: { indentLeft?: number; indentFirstLine?: number; indentRight?: number }) {
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
export function HorizontalRuler({ editor, store, editing }: { editor: Editor; store: PageStore; editing: boolean }) {
  const t = useT();
  const unit = lengthUnitFor(useLang());
  const setup = usePageState(store, (s) => s.setup);
  const pages = usePageState(store, (s) => s.pages);
  const scale = usePageState(store, (s) => s.scale);
  const textWidth = usePageState(store, (s) => s.textWidth);
  const frame = useMemo(() => pageFrame(setup), [setup]);
  const page = usePageRect(editor, [setup, scale, pages, textWidth]);
  const stripRef = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState<{ left: number; bottom: number } | null>(null);
  const indents = useIndents(editor, frame);
  const [tip, setTip] = useState<DragTip>(null);
  // While a marker moves: its place, px at the page's zoom from the page's
  // left; a tab stop dragged off the ruler goes.
  const [draft, setDraft] = useState<{ key: string; at: number; off?: boolean } | null>(null);
  // Add a tab stop: the menu at the click, and the stop's place in points.
  const [adding, setAdding] = useState<{ at: number; pt: number } | null>(null);
  const addRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStrip((prev) => (prev && prev.left === r.left && prev.bottom === r.bottom ? prev : { left: r.left, bottom: r.bottom }));
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
  const showTip = (at: number, pt: number) =>
    page && setTip({ x: page.left + at, y: tipY, text: formatRulerValue(pt, unit), vertical: false, guide: page.left + at });
  /** A place on the ruler, snapped, in points from the text column's left. */
  const columnPt = (clientX: number) =>
    page ? Math.max(0, Math.min(toPt(pageWidth - marginLeft - marginRight), snapPt(toPt(clientX - page.left - marginLeft), unit))) : 0;

  const onMargin = (side: "left" | "right") => (e: React.PointerEvent) => {
    if (!editing || !page || !strip || pageless) return;
    dragMargin(e, store, side, unit, s, (pt) => {
      if (pt === null) {
        setDraft(null);
        setTip(null);
        return;
      }
      const at = side === "left" ? pt * PX_PER_PT * s : pageWidth - pt * PX_PER_PT * s;
      setDraft({ key: `margin-${side}`, at });
      showTip(at, pt);
    });
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
      (clientX) => {
        const x = clientX - page.left;
        const right = key === "right";
        const room = boxWidthPt - (right ? indents.left : indents.right) - MIN_TEXT_PT;
        const pt = Math.max(0, Math.min(room, snapPt(toPt(right ? boxRight - x : x - boxLeft), unit)));
        value = pt;
        const at = right ? boxRight - pt * PX_PER_PT * s : boxLeft + pt * PX_PER_PT * s;
        setDraft({ key, at });
        showTip(at, pt);
      },
      (moved) => {
        setDraft(null);
        setTip(null);
        if (!moved) return;
        if (key === "left") setIndents(editor, { indentLeft: value });
        else if (key === "first") setIndents(editor, { indentFirstLine: value - indents.left });
        else setIndents(editor, { indentRight: value });
      },
    );
  };

  // A tab stop moves along the ruler, and goes when dragged below it.
  const dragTab = (stop: TabStop, key: string) => (e: React.PointerEvent) => {
    if (!editing || !strip) return;
    let pt = stop.pt;
    let off = false;
    startDrag(
      e,
      (clientX, clientY) => {
        pt = columnPt(clientX);
        off = clientY > strip.bottom + 20;
        const at = marginLeft + pt * PX_PER_PT * s;
        setDraft({ key, at, off });
        if (off) setTip(null);
        else showTip(at, pt);
      },
      (moved) => {
        setDraft(null);
        setTip(null);
        if (!moved) return;
        editTabStops(editor, (stops) => {
          const rest = stops.filter((t) => t.pt !== stop.pt && (off || t.pt !== pt));
          return off ? rest : [...rest, { pt, align: stop.align }];
        });
      },
    );
  };
  const addTab = (align: TabAlign) => {
    const pt = adding?.pt ?? 0;
    setAdding(null);
    editTabStops(editor, (stops) => [...stops.filter((t) => t.pt !== pt), { pt, align }]);
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
    <div className="docs-ruler-row">
      {editing && (
        <button
          type="button"
          className="docs-ruler-corner"
          aria-label={t("docsPage.pageSetup")}
          data-tip={t("docsPage.pageSetup")}
          data-track="docs:page-setup-corner"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => store.set({ dialog: "setup" })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
            <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 19c0 1.1.89 2 1.99 2H17c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7V5h10v14z" />
          </svg>
        </button>
      )}
      <div ref={stripRef} className="docs-ruler" role="presentation" aria-label={t("docsPage.ruler")}>
        {strip && page && (
          <div
            className="docs-ruler-face"
            style={{ left: pageLeft, width: pageWidth }}
            onClick={(e) => {
              // A click on the text column, not on a marker, adds a tab stop.
              if (!editing || !indents || e.target !== e.currentTarget) return;
              const pt = columnPt(e.clientX);
              setAdding({ at: marginLeft + pt * PX_PER_PT * s, pt });
            }}
          >
            <Ticks list={list} />
            <span ref={addRef} className="docs-ruler-add-at" style={{ left: adding?.at ?? 0 }} />
            {!pageless && (
              <>
                <span
                  className="docs-ruler-margin docs-ruler-margin-start"
                  style={{ left: 0, width: Math.max(0, marginLeftAt) }}
                  data-tip={draft ? undefined : t("docsPage.leftMargin")}
                  onPointerDown={onMargin("left")}
                  data-edit={editing || undefined}
                />
                <span
                  className="docs-ruler-margin docs-ruler-margin-end"
                  style={{ left: marginRightAt, width: Math.max(0, pageWidth - marginRightAt) }}
                  data-tip={draft ? undefined : t("docsPage.rightMargin")}
                  onPointerDown={onMargin("right")}
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
                  <Mark d="M0 0h12L6 6z" height={6} />
                </span>
                <span
                  className="docs-ruler-marker docs-ruler-indent-end"
                  style={{ left: markers.right }}
                  data-tip={draft ? undefined : t("docsPage.rightIndent")}
                  aria-label={t("docsPage.rightIndent")}
                  onPointerDown={dragIndent("right")}
                  data-edit={editing || undefined}
                >
                  <Mark d="M0 0h12L6 6z" height={6} />
                </span>
                {indents?.tabs.map((stop) => {
                  const key = `tab-${stop.pt}`;
                  const moving = draft?.key === key;
                  return (
                    <span
                      key={key}
                      className="docs-ruler-marker docs-ruler-tab"
                      // Dragged off, it hides but stays, so the drag goes on.
                      style={{ left: moving ? draft.at : marginLeft + stop.pt * PX_PER_PT * s, visibility: moving && draft.off ? "hidden" : undefined }}
                      onPointerDown={dragTab(stop, key)}
                      data-edit={editing || undefined}
                    >
                      <Mark d={TAB_MARKS[stop.align]} height={10} />
                    </span>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
      <DragFeedback tip={tip} />
      <DropdownPanel open={adding !== null} anchorRef={addRef} onClose={() => setAdding(null)}>
        <MenuItem onSelect={() => addTab("left")}>{t("docsPage.addLeftTabStop")}</MenuItem>
        <MenuItem onSelect={() => addTab("center")}>{t("docsPage.addCenterTabStop")}</MenuItem>
        <MenuItem onSelect={() => addTab("right")}>{t("docsPage.addRightTabStop")}</MenuItem>
      </DropdownPanel>
    </div>
  );
}

/** The tab stops' marks, 12 px wide with the stop at 6: a left stop points
    right, a right stop points left, a center stop is a diamond. */
const TAB_MARKS: Record<TabAlign, string> = { left: "M6 0v10l5-5z", center: "M6 0l5 5-5 5-5-5z", right: "M6 0v10L1 5z" };

function Mark({ d, height }: { d: string; height: number }) {
  return (
    <svg width="12" height={height} viewBox={`0 0 12 ${height}`} aria-hidden focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** The vertical ruler at the canvas's left: the top and bottom margins of the
    page that holds the caret. */
export function VerticalRuler({
  editor,
  store,
  editing,
  top,
  height,
}: {
  editor: Editor;
  store: PageStore;
  editing: boolean;
  /** The ruler's top on screen, client px. */
  top: number;
  height: number;
}) {
  const t = useT();
  const unit = lengthUnitFor(useLang());
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
    const at = (clientY: number) => Math.max(0, Math.min(pages - 1, pageAt(art, frame.pitch, clientY).page));
    const middle = at(top + height / 2);
    try {
      const caretTop = editor.view.coordsAtPos(editor.state.selection.head).top;
      const caret = at(caretTop);
      // The caret's page shows while any of it is in view.
      const { y } = pageAt(art, frame.pitch, caretTop);
      const s = art.getBoundingClientRect().width / (art.offsetWidth || 1);
      const pageTop = caretTop - y * s;
      setCaretPage(pageTop < top + height && pageTop + frame.height * s > top ? caret : middle);
    } catch {
      setCaretPage(middle);
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

  const onMargin = (side: "top" | "bottom") => (e: React.PointerEvent) => {
    if (!editing) return;
    const edge = top + pageTop;
    dragMargin(e, store, side, unit, s, (pt) => {
      if (pt === null) {
        setDraft(null);
        setTip(null);
        return;
      }
      const at = side === "top" ? pt * PX_PER_PT * s : pageHeight - pt * PX_PER_PT * s;
      setDraft({ key: side, at });
      setTip({ x: 16, y: 0, text: formatRulerValue(pt, unit), vertical: true, guide: edge + at });
    });
  };
  const topAt = draft?.key === "top" ? draft.at : marginTop;
  const bottomAt = draft?.key === "bottom" ? draft.at : pageHeight - marginBottom;

  return (
    <div className="docs-vruler" style={{ height }} aria-label={t("docsPage.verticalRuler")}>
      <div className="docs-vruler-face" style={{ top: pageTop, height: pageHeight }}>
        <Ticks list={list} vertical />
        <span
          className="docs-ruler-margin docs-ruler-margin-start"
          style={{ top: 0, height: Math.max(0, topAt) }}
          data-tip={draft ? undefined : t("docsPage.topMargin")}
          onPointerDown={onMargin("top")}
          data-edit={editing || undefined}
        />
        <span
          className="docs-ruler-margin docs-ruler-margin-end"
          style={{ top: bottomAt, height: Math.max(0, pageHeight - bottomAt) }}
          data-tip={draft ? undefined : t("docsPage.bottomMargin")}
          onPointerDown={onMargin("bottom")}
          data-edit={editing || undefined}
        />
      </div>
      <DragFeedback tip={tip} />
    </div>
  );
}
