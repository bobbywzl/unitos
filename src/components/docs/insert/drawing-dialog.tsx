"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { RedoIcon, UndoIcon } from "@/components/docs/icons";
import { onInsert, type InsertContext } from "@/components/docs/insert/context";
import { DeleteIcon } from "@/components/docs/insert/icons";
import { imageAttrs, isDrawingImage, setImageAttrs } from "@/components/docs/insert/image";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { insertImage } from "@/components/docs/typing/paste";
import { ACCENT, FILL, GOLD, INK, PLUM, SAGE } from "@/lib/derive/visual-palette";
import {
  DRAWING_FONT,
  MAX_DRAWING_POINTS,
  MAX_DRAWING_SHAPES,
  TEXT_LEADING,
  drawingSvg,
  parseDrawing,
  shapeBounds,
  shapeSvg,
  textWidth,
  type Drawing,
  type Shape,
} from "@/lib/docs/drawing";
import type { TKey } from "@/lib/i18n/dictionaries";
import { uploadImage } from "@/lib/images";
import "./drawing.css";

// Insert > Drawing (SPEC.md §29): Google Docs' drawing dialog, in Unitos's
// colors. Select, Line, Arrow, Rectangle, Oval, Text box, and Scribble draw
// on a white canvas; a shape picked with Select moves, a rectangle or an
// oval resizes by its corners and a line by its ends, and the line color,
// the fill, the line weight, and the text size set the picked shape and the
// next ones. Save and close stores the drawing, cut to what is drawn, as an
// image that keeps the shapes (lib/docs/drawing.ts); a double-click on it
// opens them again.

type Tool = "select" | "line" | "arrow" | "rect" | "ellipse" | "text" | "scribble";
type Point = { x: number; y: number };
type Handle = "start" | "end" | "nw" | "ne" | "sw" | "se";
type Drag =
  | { type: "create"; index: number; from: Point }
  | { type: "scribble"; index: number }
  | { type: "move"; index: number; from: Point; orig: Shape }
  | { type: "handle"; index: number; handle: Handle; orig: Shape };

const CANVAS_WIDTH = 880;
const CANVAS_HEIGHT = 460;
/** The widest a drawing lands in the page, in px: the text column's width. */
const MAX_PLACED_WIDTH = 624;

const STROKES = [INK, ACCENT, SAGE, GOLD, PLUM, "#4f7396", "#c5221f", "#ffffff"];
const FILLS: (string | null)[] = [null, "#ffffff", FILL, "#f6d7cc", "#dfe8dc", "#f3e6c4", "#e3def0", "#dbe5ef"];
const WEIGHTS = [1, 2, 4, 6];
const TEXT_SIZES = [12, 16, 24, 36];

const TOOLS: [Tool, TKey, ReactNode][] = [
  ["select", "docsInsert.drawingSelect", <path key="i" d="M7 3l11 10.4-5.3.4 3.1 6.8-2.1 1-3-6.9L7 18.6z" fill="currentColor" />],
  ["line", "docsInsert.drawingLine", <path key="i" d="M5 19L19 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />],
  [
    "arrow",
    "docsInsert.drawingArrow",
    <g key="i">
      <path d="M5 19L17 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 5l-1.2 6.4-5.2-5.2z" fill="currentColor" />
    </g>,
  ],
  ["rect", "docsInsert.drawingRect", <rect key="i" x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />],
  ["ellipse", "docsInsert.drawingEllipse", <ellipse key="i" cx="12" cy="12" rx="8.5" ry="6.5" fill="none" stroke="currentColor" strokeWidth="2" />],
  ["text", "docsInsert.drawingText", <path key="i" d="M5 4v3h5.5v13h3V7H19V4z" fill="currentColor" />],
  ["scribble", "docsInsert.drawingScribble", <path key="i" d="M3 17c3-7 5-10 7-7s0 8 3 5 4-9 8-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />],
];

// ── Shapes ──────────────────────────────────────────────────────────────────

function moved(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case "line":
    case "arrow":
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case "rect":
    case "ellipse":
    case "text":
      return { ...s, x: s.x + dx, y: s.y + dy };
    case "scribble":
      return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  }
}

/** A box shape stretched from a fixed corner to `p`. */
function boxTo(s: Extract<Shape, { kind: "rect" | "ellipse" }>, fixed: Point, p: Point): Shape {
  return { ...s, x: Math.min(fixed.x, p.x), y: Math.min(fixed.y, p.y), w: Math.abs(p.x - fixed.x), h: Math.abs(p.y - fixed.y) };
}

function handlesOf(s: Shape): { handle: Handle; x: number; y: number }[] {
  if (s.kind === "line" || s.kind === "arrow") {
    return [
      { handle: "start", x: s.x1, y: s.y1 },
      { handle: "end", x: s.x2, y: s.y2 },
    ];
  }
  if (s.kind === "rect" || s.kind === "ellipse") {
    return [
      { handle: "nw", x: s.x, y: s.y },
      { handle: "ne", x: s.x + s.w, y: s.y },
      { handle: "sw", x: s.x, y: s.y + s.h },
      { handle: "se", x: s.x + s.w, y: s.y + s.h },
    ];
  }
  return [];
}

/** How far `p` is from the segment a–b. */
function toSegment(p: Point, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}

/** The topmost shape under `p`. */
function shapeAt(shapes: Shape[], p: Point): number | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const near = Math.max(6, "width" in s ? s.width : 0);
    if ((s.kind === "line" || s.kind === "arrow") && toSegment(p, s.x1, s.y1, s.x2, s.y2) <= near) return i;
    if (s.kind === "scribble" && s.points.some((q, k) => toSegment(p, q[0], q[1], s.points[Math.max(0, k - 1)][0], s.points[Math.max(0, k - 1)][1]) <= near)) return i;
    if (s.kind === "rect" || s.kind === "ellipse" || s.kind === "text") {
      const [x0, y0, x1, y1] = shapeBounds(s);
      if (p.x >= x0 - 4 && p.x <= x1 + 4 && p.y >= y0 - 4 && p.y <= y1 + 4) {
        if (s.kind !== "ellipse") return i;
        const rx = s.w / 2 + 4;
        const ry = s.h / 2 + 4;
        if (((p.x - s.x - s.w / 2) / rx) ** 2 + ((p.y - s.y - s.h / 2) / ry) ** 2 <= 1) return i;
      }
    }
  }
  return null;
}

/** A shape too small to have been meant: a click with a drawing tool. */
function tooSmall(s: Shape): boolean {
  if (s.kind === "line" || s.kind === "arrow") return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 4;
  if (s.kind === "rect" || s.kind === "ellipse") return s.w < 4 && s.h < 4;
  return false;
}

const pointsIn = (shapes: Shape[]) => shapes.reduce((n, s) => n + (s.kind === "scribble" ? s.points.length : 0), 0);

/** The drawing as a PNG at twice its size; null when the browser cannot draw it. */
async function drawingFile(svg: string, width: number, height: number): Promise<File | null> {
  try {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], "drawing.png", { type: "image/png" }) : null;
  } catch {
    return null;
  }
}

// ── The dialog ──────────────────────────────────────────────────────────────

type Open = { shapes: Shape[]; pos: number | null };

export function DrawingHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type !== "drawing" || !ctx.editing) return;
        if (event.pos === undefined) {
          setOpen({ shapes: [], pos: null });
          return;
        }
        const node = editor.state.doc.nodeAt(event.pos);
        const drawing = node && isDrawingImage(node) ? parseDrawing(node.attrs.drawing) : null;
        if (drawing) setOpen({ shapes: drawing.shapes, pos: event.pos });
      }),
    [editor, ctx.editing],
  );
  if (!open) return null;
  return (
    <DrawingDialog
      editor={editor}
      open={open}
      onClose={() => {
        setOpen(null);
        editor.commands.focus();
      }}
    />
  );
}

function DrawingDialog({ editor, open, onClose }: { editor: Editor; open: Open; onClose: () => void }) {
  const t = useT();
  const [shapes, setShapes] = useState<Shape[]>(open.shapes);
  const [past, setPast] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  const [tool, setTool] = useState<Tool>(open.shapes.length > 0 ? "select" : "line");
  const [picked, setPicked] = useState<number | null>(null);
  const [stroke, setStroke] = useState(INK);
  const [fill, setFill] = useState<string | null>(null);
  const [weight, setWeight] = useState(2);
  const [textSize, setTextSize] = useState(16);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const before = useRef<Shape[] | null>(null);
  // What the handlers read and write: the shapes as the last change left
  // them, and the text box being typed in. A render only shows them.
  const live = useRef<Shape[]>(open.shapes);
  const editingRef = useRef<number | null>(null);
  const show = (next: Shape[]) => {
    live.current = next;
    setShapes(next);
  };
  const startEditing = (index: number | null) => {
    editingRef.current = index;
    setEditing(index);
  };

  /** A change the reader made: one step for Undo. */
  const commit = (next: Shape[], from: Shape[] = live.current) => {
    setPast((p) => [...p.slice(-99), from]);
    setFuture([]);
    show(next);
  };
  const undo = () => {
    if (past.length === 0) return;
    const current = live.current;
    setFuture([current, ...future]);
    setPast(past.slice(0, -1));
    show(past[past.length - 1]);
    setPicked(null);
  };
  const redo = () => {
    if (future.length === 0) return;
    const current = live.current;
    setPast([...past, current]);
    setFuture(future.slice(1));
    show(future[0]);
    setPicked(null);
  };
  const remove = () => {
    if (picked === null) return;
    commit(live.current.filter((_, i) => i !== picked));
    setPicked(null);
  };

  /** The text box being typed in is done: kept with words, gone without.
      The ref ends it once, though the press and the blur both end it. */
  const endText = () => {
    const index = editingRef.current;
    if (index === null) return;
    editingRef.current = null;
    const s = live.current[index];
    const kept = Boolean(s && s.kind === "text" && s.text.trim());
    const next = kept ? live.current : live.current.filter((_, i) => i !== index);
    commit(next, before.current ?? live.current);
    before.current = null;
    setPicked(kept ? index : null);
    startEditing(null);
  };

  // The keys, before the dialog's Escape: Escape ends the text box or drops
  // the pick first; Delete removes the picked shape; Undo and Redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (editing !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          endText();
        }
        return;
      }
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && picked !== null) {
        e.preventDefault();
        e.stopPropagation();
        setPicked(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && picked !== null && !inField) {
        e.preventDefault();
        remove();
      } else if (mod && !e.altKey && e.key.toLowerCase() === "z" && !inField) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && !e.altKey && e.key.toLowerCase() === "y" && !inField) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const point = (e: { clientX: number; clientY: number }): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: ((e.clientX - box.left) * CANVAS_WIDTH) / box.width, y: ((e.clientY - box.top) * CANVAS_HEIGHT) / box.height };
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    // The press keeps the focus where it is: a new text box takes it, and
    // a drag selects nothing on the page behind.
    e.preventDefault();
    if (editing !== null) {
      endText();
      return;
    }
    const p = point(e);
    const all = live.current;
    before.current = all;
    if (tool === "select") {
      const handle = picked !== null ? handlesOf(all[picked]).find((h) => Math.hypot(h.x - p.x, h.y - p.y) <= 8) : undefined;
      if (handle && picked !== null) drag.current = { type: "handle", index: picked, handle: handle.handle, orig: all[picked] };
      else {
        const hit = shapeAt(all, p);
        setPicked(hit);
        drag.current = hit === null ? null : { type: "move", index: hit, from: p, orig: all[hit] };
      }
    } else if (all.length >= MAX_DRAWING_SHAPES) {
      return;
    } else if (tool === "text") {
      const s: Shape = { kind: "text", x: p.x, y: p.y - textSize * 0.6, text: "", color: stroke, size: textSize };
      show([...all, s]);
      startEditing(all.length);
      setPicked(null);
      return;
    } else if (tool === "scribble") {
      if (pointsIn(all) >= MAX_DRAWING_POINTS) return;
      show([...all, { kind: "scribble", points: [[p.x, p.y]], stroke, width: weight }]);
      drag.current = { type: "scribble", index: all.length };
    } else {
      const s: Shape =
        tool === "line" || tool === "arrow"
          ? { kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke, width: weight }
          : { kind: tool, x: p.x, y: p.y, w: 0, h: 0, stroke, fill, width: weight };
      show([...all, s]);
      drag.current = { type: "create", index: all.length, from: p };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    show(
      live.current.map((s, i) => {
        if (i !== d.index) return s;
        if (d.type === "move") return moved(d.orig, p.x - d.from.x, p.y - d.from.y);
        if (d.type === "scribble" && s.kind === "scribble") {
          const last = s.points[s.points.length - 1];
          return Math.hypot(p.x - last[0], p.y - last[1]) < 2 ? s : { ...s, points: [...s.points, [p.x, p.y] as [number, number]] };
        }
        if (d.type === "create") {
          if (s.kind === "line" || s.kind === "arrow") return { ...s, x2: p.x, y2: p.y };
          if (s.kind === "rect" || s.kind === "ellipse") return boxTo(s, d.from, p);
        }
        if (d.type === "handle") {
          const o = d.orig;
          if ((o.kind === "line" || o.kind === "arrow") && (d.handle === "start" || d.handle === "end")) {
            return d.handle === "start" ? { ...o, x1: p.x, y1: p.y } : { ...o, x2: p.x, y2: p.y };
          }
          if (o.kind === "rect" || o.kind === "ellipse") {
            const fixed = {
              x: d.handle === "nw" || d.handle === "sw" ? o.x + o.w : o.x,
              y: d.handle === "nw" || d.handle === "ne" ? o.y + o.h : o.y,
            };
            return boxTo(o, fixed, p);
          }
        }
        return s;
      }),
    );
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const all = live.current;
    const from = before.current ?? all;
    before.current = null;
    if (d.type === "create" || d.type === "scribble") {
      const s = all[d.index];
      if (!s || (d.type === "create" && tooSmall(s))) {
        show(from);
        return;
      }
      commit(all, from);
      // As in Docs, a shape just drawn is picked, ready to move.
      if (d.type === "create") {
        setTool("select");
        setPicked(d.index);
      }
      return;
    }
    if (all !== from && JSON.stringify(all[d.index]) !== JSON.stringify(from[d.index])) commit(all, from);
  };

  /** A style control: it sets the picked shape, and the next ones. */
  const restyle = (patch: (s: Shape) => Shape | null) => {
    if (picked === null) return;
    const s = live.current[picked];
    const next = s ? patch(s) : null;
    if (next) commit(live.current.map((x, i) => (i === picked ? next : x)));
  };
  const pickStroke = (c: string) => {
    setStroke(c);
    restyle((s) => (s.kind === "text" ? { ...s, color: c } : { ...s, stroke: c }));
  };
  const pickFill = (c: string | null) => {
    setFill(c);
    restyle((s) => (s.kind === "rect" || s.kind === "ellipse" ? { ...s, fill: c } : null));
  };
  const pickWeight = (w: number) => {
    setWeight(w);
    restyle((s) => (s.kind === "text" ? null : { ...s, width: w }));
  };
  const pickSize = (size: number) => {
    setTextSize(size);
    restyle((s) => (s.kind === "text" ? { ...s, size } : null));
  };

  // Each shape in a group that names its kind (the canvas's; the stored SVG has none).
  const shown = useMemo(() => shapes.map((s, i) => (i === editing ? "" : `<g data-shape="${s.kind}">${shapeSvg(s)}</g>`)).join(""), [shapes, editing]);
  const typing = editing !== null ? shapes[editing] : null;
  const pickedShape = picked !== null ? shapes[picked] : null;
  const drawn = shapes.some((s) => s.kind !== "text" || s.text.trim());

  async function save() {
    if (busy) return;
    const drawing: Drawing = { v: 1, shapes: live.current.filter((s) => s.kind !== "text" || s.text.trim()) };
    const svg = drawingSvg(drawing);
    if (!svg) return;
    setBusy(true);
    setError(null);
    try {
      const file = await drawingFile(svg.svg, svg.width, svg.height);
      if (!file) throw new Error(t("common.requestFailed"));
      const { url } = await uploadImage(file);
      const width = Math.min(svg.width, MAX_PLACED_WIDTH);
      const height = Math.round((svg.height * width) / svg.width);
      const data = JSON.stringify(drawing);
      if (open.pos !== null) {
        const node = editor.state.doc.nodeAt(open.pos);
        if (node && node.type.name === "image") {
          // The reader's own width stays; the height follows the new image.
          const kept = imageAttrs(node).width;
          const w = kept ? Math.min(kept, MAX_PLACED_WIDTH) : width;
          setImageAttrs(editor.view, open.pos, { src: url, alt: t("docsInsert.drawing"), drawing: data, width: w, height: Math.round((svg.height * w) / svg.width) });
        }
      } else {
        insertImage(editor, { src: url, alt: t("docsInsert.drawing"), width, height, drawing: data });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("common.requestFailed"));
      setBusy(false);
    }
  }

  const toolButton = ([id, label, icon]: (typeof TOOLS)[number]) => (
    <button
      key={id}
      type="button"
      className="docs-drawing-tool"
      aria-pressed={tool === id}
      aria-label={t(label)}
      data-tip={t(label)}
      data-track={`docs:drawing:${id}`}
      onClick={() => {
        if (editing !== null) endText();
        setTool(id);
        if (id !== "select") setPicked(null);
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        {icon}
      </svg>
    </button>
  );

  return (
    <ToolbarDialog
      title={t(open.pos === null ? "docsInsert.drawing" : "docsInsert.editDrawing")}
      onClose={onClose}
      className="docs-drawing-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <button
            type="button"
            className="docs-tb-button docs-tb-button-primary"
            data-track="docs:drawing:save"
            disabled={busy || !drawn}
            onClick={() => void save()}
          >
            {t("docsInsert.drawingSave")}
          </button>
        </>
      }
    >
      <div className="docs-drawing-bar" role="toolbar" aria-label={t("docsInsert.drawing")}>
        <button type="button" className="docs-drawing-tool" aria-label={t("docs.undo")} data-tip={t("docs.undo")} disabled={past.length === 0} onClick={undo}>
          <UndoIcon size={20} />
        </button>
        <button type="button" className="docs-drawing-tool" aria-label={t("docs.redo")} data-tip={t("docs.redo")} disabled={future.length === 0} onClick={redo}>
          <RedoIcon size={20} />
        </button>
        <span className="docs-drawing-sep" />
        {TOOLS.map(toolButton)}
        <span className="docs-drawing-sep" />
        <button
          type="button"
          className="docs-drawing-tool"
          aria-label={t("common.delete")}
          data-tip={t("common.delete")}
          data-track="docs:drawing:delete"
          disabled={picked === null}
          onClick={remove}
        >
          <DeleteIcon />
        </button>
      </div>
      <div className="docs-drawing-styles">
        <span className="docs-drawing-label">{t("docsInsert.drawingLineColor")}</span>
        {STROKES.map((c) => (
          <button
            key={c}
            type="button"
            className="docs-drawing-swatch"
            style={{ background: c }}
            aria-pressed={stroke === c}
            aria-label={c}
            data-track="docs:drawing:stroke"
            onClick={() => pickStroke(c)}
          />
        ))}
        <span className="docs-drawing-label">{t("docsInsert.drawingFill")}</span>
        {FILLS.map((c) => (
          <button
            key={c ?? "none"}
            type="button"
            className={`docs-drawing-swatch${c === null ? " docs-drawing-none" : ""}`}
            style={c ? { background: c } : undefined}
            aria-pressed={fill === c}
            aria-label={c ?? t("docsInsert.drawingNoFill")}
            data-tip={c === null ? t("docsInsert.drawingNoFill") : undefined}
            data-track="docs:drawing:fill"
            onClick={() => pickFill(c)}
          />
        ))}
        <span className="docs-drawing-label">{t("docsInsert.drawingWeight")}</span>
        {WEIGHTS.map((w) => (
          <button
            key={w}
            type="button"
            className="docs-drawing-weight"
            aria-pressed={weight === w}
            aria-label={`${w} px`}
            data-track="docs:drawing:weight"
            onClick={() => pickWeight(w)}
          >
            <span style={{ height: w }} />
          </button>
        ))}
        <span className="docs-drawing-label">{t("docsInsert.drawingTextSize")}</span>
        {TEXT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className="docs-drawing-size"
            aria-pressed={textSize === size}
            data-track="docs:drawing:size"
            onClick={() => pickSize(size)}
          >
            {size}
          </button>
        ))}
      </div>
      <div className="docs-drawing-stage">
        <svg
          ref={svgRef}
          className="docs-drawing-canvas"
          data-tool={tool}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={(e) => {
            // A double-click on a text box types in it again.
            const hit = shapeAt(live.current, point(e));
            if (hit !== null && live.current[hit].kind === "text") {
              before.current = live.current;
              startEditing(hit);
              setPicked(null);
            }
          }}
        >
          <g dangerouslySetInnerHTML={{ __html: shown }} />
          {pickedShape && editing === null && (
            <g className="docs-drawing-pick">
              {(() => {
                const [x0, y0, x1, y1] = shapeBounds(pickedShape);
                return <rect x={x0 - 3} y={y0 - 3} width={x1 - x0 + 6} height={y1 - y0 + 6} fill="none" />;
              })()}
              {handlesOf(pickedShape).map((h) => (
                <circle key={h.handle} cx={h.x} cy={h.y} r={5} data-handle={h.handle} />
              ))}
            </g>
          )}
        </svg>
        {typing && typing.kind === "text" && editing !== null && (
          <textarea
            className="docs-drawing-text"
            autoFocus
            value={typing.text}
            data-track="docs:drawing:text-box"
            style={{
              left: typing.x,
              top: typing.y,
              fontSize: typing.size,
              lineHeight: TEXT_LEADING,
              fontFamily: DRAWING_FONT,
              color: typing.color,
              width: Math.max(140, ...typing.text.split("\n").map((l) => textWidth(l, typing.size) + typing.size)),
              height: typing.size * TEXT_LEADING * Math.max(1, typing.text.split("\n").length) + 8,
            }}
            onChange={(e) => {
              const value = e.target.value.slice(0, 2000);
              show(live.current.map((s, i) => (i === editing && s.kind === "text" ? { ...s, text: value } : s)));
            }}
            onBlur={endText}
          />
        )}
        {shapes.length === 0 && <p className="docs-drawing-hint">{t("docsInsert.drawingHint")}</p>}
      </div>
      {error && <p className="docs-drawing-error">{error}</p>}
    </ToolbarDialog>
  );
}
