"use client";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { moveTableColumn, moveTableRow, TableMap } from "@tiptap/pm/tables";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { AddIcon, DropDownIcon } from "@/components/docs/icons";
import { Swatches } from "@/components/docs/insert/colors";
import { onInsert, type InsertContext } from "@/components/docs/insert/context";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BorderColorIcon,
  BorderDashIcon,
  BorderWeightIcon,
  DragHorizontalIcon,
  DragIcon,
  FillIcon,
  ImageOptionsIcon,
  PinIcon,
  SortIcon,
  TableColumnIcon,
  TableRowIcon,
  UnpinIcon,
} from "@/components/docs/insert/icons";
import { BORDER_WEIGHTS, DASHES, DropButton, MenuRow } from "@/components/docs/insert/image-controls";
import {
  BORDER_TARGETS,
  cellBorder,
  pinnedCount,
  selectedCells,
  tableRectOf,
  type BorderTarget,
  type VAlign,
} from "@/components/docs/insert/table";
import { TableGridPicker } from "@/components/docs/insert/table-grid";
import { anchorAt, Dialog, FloatingBox, keepSelection, PanelSection, SidePanel, useEditorTick, useViewportTick } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// A table's controls (SPEC.md §29), Google Docs' way: resting the pointer on
// a table shows the row's pill in the left margin (drag to move the row,
// Pin header up to this row, Insert 1 row below) and the column's pill over
// the top border (drag to move the column, Sort table, Insert 1 column
// right); a row's bottom line drags to its minimum height; the ▾ in the
// caret's cell chooses which borders the border buttons change; Split cell
// asks for columns and rows; Table options is the side panel of Table,
// Column, Row, Cell, and Color.

const PX_PER_PT = 96 / 72;
const PX_PER_IN = 96;

type Hover = { tablePos: number; row: number; col: number; rowRect: DOMRect; colRect: DOMRect; tableRect: DOMRect };

/** Where the pointer is over a table: its row and column, and their boxes. */
function hoverAt(editor: Editor, cell: HTMLElement): Hover | null {
  const view = editor.view;
  const wrapper = cell.closest<HTMLElement>(".tableWrapper");
  const tableEl = wrapper?.querySelector("table");
  const rowEl = cell.closest("tr");
  if (!wrapper || !tableEl || !rowEl) return null;
  let cellPos: number;
  try {
    cellPos = view.posAtDOM(cell, 0) - 1;
  } catch {
    return null;
  }
  const $cell = view.state.doc.resolve(cellPos);
  let tablePos = -1;
  for (let d = $cell.depth; d > 0; d--) {
    if ($cell.node(d).type.name === "table") {
      tablePos = $cell.before(d);
      break;
    }
  }
  if (tablePos < 0) return null;
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return null;
  const map = TableMap.get(table);
  let rect;
  try {
    rect = map.findCell(cellPos - tablePos - 1);
  } catch {
    return null;
  }
  // The column's box: the whole column under the cell's left edge.
  const cellRect = cell.getBoundingClientRect();
  const tableRect = tableEl.getBoundingClientRect();
  const colRect = new DOMRect(cellRect.left, tableRect.top, cellRect.width, tableRect.height);
  return { tablePos, row: rect.top, col: rect.left, rowRect: rowEl.getBoundingClientRect(), colRect, tableRect };
}

/** Put the caret in a cell of the table, so the table commands act there. */
function caretInCell(editor: Editor, tablePos: number, row: number, col: number) {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table) return;
  const map = TableMap.get(table);
  const rel = map.map[Math.min(row, map.height - 1) * map.width + Math.min(col, map.width - 1)];
  const pos = tablePos + 1 + rel + 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))));
}

export function TableControlsHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  useEditorTick(editor);
  const [hover, setHover] = useState<Hover | null>(null);
  const [panel, setPanel] = useState(false);
  const [split, setSplit] = useState(false);
  const [grid, setGrid] = useState<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const inTable = tableRectOf(editor.state) !== null;
  useViewportTick(hover !== null || inTable);

  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type === "table-options") setPanel(true);
        if (event.type === "split-cell") setSplit(true);
        if (event.type === "table-grid") setGrid(editor.state.selection.from);
      }),
    [editor],
  );

  useEffect(() => {
    if (!ctx.editing) return;
    const dom = editor.view.dom;
    const onMove = (e: MouseEvent) => {
      const cell = (e.target as Element | null)?.closest<HTMLElement>("td, th");
      if (!cell || !dom.contains(cell)) return;
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      const next = hoverAt(editor, cell);
      setHover((h) => (h && next && h.tablePos === next.tablePos && h.row === next.row && h.col === next.col ? h : next));
    };
    const onLeave = (e: MouseEvent) => {
      if ((e.relatedTarget as Element | null)?.closest?.("[data-docs-table-pill]")) return;
      hideTimer.current = window.setTimeout(() => setHover(null), 400);
    };
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, ctx.editing]);

  const keep = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  };
  const leave = () => {
    hideTimer.current = window.setTimeout(() => setHover(null), 400);
  };

  const closePanel = useCallback(() => setPanel(false), []);

  return (
    <>
      {ctx.editing && hover && <Pills editor={editor} hover={hover} onEnter={keep} onLeave={leave} onDone={() => setHover(null)} />}
      {ctx.editing && inTable && <BorderSelector editor={editor} />}
      {ctx.editing && <RowResizer editor={editor} />}
      {panel && inTable && <TableOptionsPanel editor={editor} onClose={closePanel} />}
      {split && inTable && <SplitDialog editor={editor} onClose={() => setSplit(false)} />}
      {grid !== null && (
        <GridAtCaret
          editor={editor}
          at={grid}
          onClose={() => {
            setGrid(null);
            editor.view.focus();
          }}
        />
      )}
    </>
  );
}

function GridAtCaret({ editor, at, onClose }: { editor: Editor; at: number; onClose: () => void }) {
  const anchor = anchorAt(editor, at);
  if (!anchor) return null;
  return (
    <FloatingBox anchor={anchor} className="docs-picker docs-picker-table" onDismiss={onClose}>
      <TableGridPicker
        onPick={(rows, cols) => {
          onClose();
          editor.chain().focus().insertDocsTable(rows, cols).run();
        }}
      />
    </FloatingBox>
  );
}

/** The row and column pills of the hovered cell. */
function Pills({
  editor,
  hover,
  onEnter,
  onLeave,
  onDone,
}: {
  editor: Editor;
  hover: Hover;
  onEnter: () => void;
  onLeave: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [sortOpen, setSortOpen] = useState(false);
  const [drag, setDrag] = useState<{ axis: "row" | "col"; line: number } | null>(null);
  const table = editor.state.doc.nodeAt(hover.tablePos);
  if (!table || typeof document === "undefined") return null;
  const pinned = pinnedCount(table);
  const rowPinned = hover.row < pinned;
  const run = (fn: () => void) => {
    caretInCell(editor, hover.tablePos, hover.row, hover.col);
    fn();
    editor.view.focus();
  };

  /** Drag a row or a column by its handle; a line shows where it lands. */
  const startDrag = (axis: "row" | "col", e: React.MouseEvent) => {
    e.preventDefault();
    const tableEl = editor.view.nodeDOM(hover.tablePos) as HTMLElement | null;
    const rows = tableEl ? [...tableEl.querySelectorAll("tr")] : [];
    const firstRowCells = rows[0] ? [...rows[0].children] : [];
    const edges =
      axis === "row"
        ? [...rows.map((r) => r.getBoundingClientRect().top), rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : 0]
        : [...firstRowCells.map((c) => c.getBoundingClientRect().left), firstRowCells.length ? firstRowCells[firstRowCells.length - 1].getBoundingClientRect().right : 0];
    const from = axis === "row" ? hover.row : hover.col;
    let gap = from;
    const onMove = (ev: MouseEvent) => {
      const at = axis === "row" ? ev.clientY : ev.clientX;
      let best = 0;
      edges.forEach((edge, i) => {
        if (Math.abs(edge - at) < Math.abs(edges[best] - at)) best = i;
      });
      gap = best;
      setDrag({ axis, line: edges[best] });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      setDrag(null);
      const to = gap > from ? gap - 1 : gap;
      if (to === from) return;
      const pos = hover.tablePos + 1;
      const command = axis === "row" ? moveTableRow({ from, to, pos, select: false }) : moveTableColumn({ from, to, pos, select: false });
      command(editor.state, editor.view.dispatch);
      onDone();
      editor.view.focus();
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  };

  const tableRect = hover.tableRect;
  return createPortal(
    <>
      <div
        className="docs-table-pill docs-table-pill-row"
        data-docs-table-pill
        data-docs-insert-popover
        data-edit-control
        data-selection-popover
        onMouseDown={keepSelection}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{ left: tableRect.left - 30, top: hover.rowRect.top + hover.rowRect.height / 2 }}
      >
        <button type="button" className="docs-pill-btn docs-pill-drag" aria-label={t("docsInsert.dragRow")} data-tip={t("docsInsert.dragRow")} onMouseDown={(e) => startDrag("row", e)}>
          <DragIcon size={16} />
        </button>
        <button
          type="button"
          className="docs-pill-btn"
          aria-label={t(rowPinned ? (pinned > 1 ? "docsInsert.unpinHeaderRows" : "docsInsert.unpinHeaderRow") : "docsInsert.pinHeaderUpToRow")}
          data-tip={t(rowPinned ? (pinned > 1 ? "docsInsert.unpinHeaderRows" : "docsInsert.unpinHeaderRow") : "docsInsert.pinHeaderUpToRow")}
          onClick={() => run(() => editor.commands.pinHeaderRows(rowPinned ? 0 : hover.row + 1))}
        >
          {rowPinned ? <UnpinIcon size={16} /> : <PinIcon size={16} />}
        </button>
        <button
          type="button"
          className="docs-pill-btn"
          aria-label={t("docsInsert.insertOneRowBelow")}
          data-tip={t("docsInsert.insertOneRowBelow")}
          onClick={() => run(() => editor.commands.insertRows("after", 1))}
        >
          <AddIcon size={16} />
        </button>
      </div>
      <div
        className="docs-table-pill docs-table-pill-col"
        data-docs-table-pill
        data-docs-insert-popover
        data-edit-control
        data-selection-popover
        onMouseDown={keepSelection}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{ left: hover.colRect.left + 4, top: tableRect.top - 30 }}
      >
        <button type="button" className="docs-pill-btn docs-pill-drag" aria-label={t("docsInsert.dragColumn")} data-tip={t("docsInsert.dragColumn")} onMouseDown={(e) => startDrag("col", e)}>
          <DragHorizontalIcon size={16} />
        </button>
        <button
          type="button"
          className="docs-pill-btn"
          aria-label={t("docsInsert.sortTable")}
          data-tip={t("docsInsert.sortTable")}
          aria-expanded={sortOpen}
          onClick={() => setSortOpen((o) => !o)}
        >
          <SortIcon size={16} />
        </button>
        <button
          type="button"
          className="docs-pill-btn"
          aria-label={t("docsInsert.insertOneColumnRight")}
          data-tip={t("docsInsert.insertOneColumnRight")}
          onClick={() => run(() => editor.commands.insertColumns("after", 1))}
        >
          <AddIcon size={16} />
        </button>
        {sortOpen && (
          <div className="docs-pill-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="docs-dd-option"
              onClick={() => {
                setSortOpen(false);
                run(() => editor.commands.sortTable(1));
              }}
            >
              <span className="docs-dd-check">
                <ArrowUpIcon size={18} />
              </span>
              {t("docsInsert.sortAscending")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="docs-dd-option"
              onClick={() => {
                setSortOpen(false);
                run(() => editor.commands.sortTable(-1));
              }}
            >
              <span className="docs-dd-check">
                <ArrowDownIcon size={18} />
              </span>
              {t("docsInsert.sortDescending")}
            </button>
          </div>
        )}
      </div>
      {drag && (
        <div
          className={`docs-table-drop-line docs-table-drop-${drag.axis}`}
          style={
            drag.axis === "row"
              ? { left: tableRect.left, width: tableRect.width, top: drag.line - 1 }
              : { top: tableRect.top, height: tableRect.height, left: drag.line - 1 }
          }
        />
      )}
    </>,
    document.body,
  );
}

const TARGET_LABEL: Record<BorderTarget, TKey> = {
  all: "docsInsert.borderAll",
  inner: "docsInsert.borderInner",
  outer: "docsInsert.borderOuter",
  top: "docsInsert.borderTop",
  innerH: "docsInsert.borderInnerH",
  bottom: "docsInsert.borderBottom",
  left: "docsInsert.borderLeft",
  innerV: "docsInsert.borderInnerV",
  right: "docsInsert.borderRight",
};

/** A small drawing of the lines a border choice changes. */
function TargetGlyph({ target }: { target: BorderTarget }) {
  const on = (edge: string) => {
    switch (target) {
      case "all":
        return true;
      case "inner":
        return edge === "h" || edge === "v";
      case "outer":
        return ["t", "b", "l", "r"].includes(edge);
      case "top":
        return edge === "t";
      case "bottom":
        return edge === "b";
      case "left":
        return edge === "l";
      case "right":
        return edge === "r";
      case "innerH":
        return edge === "h";
      case "innerV":
        return edge === "v";
    }
  };
  const stroke = (edge: string) => (on(edge) ? "currentColor" : "#c4c7c5");
  const dash = (edge: string) => (on(edge) ? undefined : "2 2");
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
      <line x1="2" y1="2" x2="18" y2="2" stroke={stroke("t")} strokeDasharray={dash("t")} strokeWidth="2" />
      <line x1="2" y1="18" x2="18" y2="18" stroke={stroke("b")} strokeDasharray={dash("b")} strokeWidth="2" />
      <line x1="2" y1="2" x2="2" y2="18" stroke={stroke("l")} strokeDasharray={dash("l")} strokeWidth="2" />
      <line x1="18" y1="2" x2="18" y2="18" stroke={stroke("r")} strokeDasharray={dash("r")} strokeWidth="2" />
      <line x1="2" y1="10" x2="18" y2="10" stroke={stroke("h")} strokeDasharray={dash("h")} strokeWidth="2" />
      <line x1="10" y1="2" x2="10" y2="18" stroke={stroke("v")} strokeDasharray={dash("v")} strokeWidth="2" />
    </svg>
  );
}

/** The ▾ at the top right of the caret's cell (or the selected cells): the
    3 × 3 border choice, then the border and background buttons for it. */
function BorderSelector({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<BorderTarget>("all");
  const cells = selectedCells(editor.state);
  if (cells.length === 0 || typeof document === "undefined") return null;
  // The top-right cell of the selection.
  let corner: DOMRect | null = null;
  for (const { pos } of cells) {
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) continue;
    const r = dom.getBoundingClientRect();
    if (!corner || r.top < corner.top - 1 || (Math.abs(r.top - corner.top) <= 1 && r.right > corner.right)) corner = r;
  }
  if (!corner) return null;
  const border = cellBorder(editor.state, target === "bottom" ? "borderBottom" : target === "left" ? "borderLeft" : target === "right" ? "borderRight" : "borderTop");
  const background = (cells[0].node.attrs.backgroundColor as string | null) ?? null;
  const apply = (spec: { width?: number; dash?: "solid" | "dotted" | "dashed"; color?: string }) =>
    editor.chain().focus().setTableBorders(target, spec).run();
  return createPortal(
    <>
      <button
        type="button"
        className="docs-border-select"
        aria-label={t("docsInsert.selectBorders")}
        data-tip={t("docsInsert.selectBorders")}
        aria-expanded={open}
        data-docs-insert-popover
        data-edit-control
        data-selection-popover
        onMouseDown={keepSelection}
        onClick={() => setOpen((o) => !o)}
        style={{ left: corner.right - 18, top: corner.top + 2 }}
      >
        <DropDownIcon size={14} />
      </button>
      {open && (
        <FloatingBox
          anchor={{ left: corner.right - 18, top: corner.top, bottom: corner.top + 18, right: corner.right }}
          className="docs-border-pop"
          onDismiss={() => setOpen(false)}
          label={t("docsInsert.selectBorders")}
        >
          <div className="docs-border-grid" role="radiogroup" aria-label={t("docsInsert.selectBorders")}>
            {BORDER_TARGETS.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={target === b}
                className={`docs-icon-btn docs-border-target${target === b ? " is-on" : ""}`}
                aria-label={t(TARGET_LABEL[b])}
                data-tip={t(TARGET_LABEL[b])}
                onClick={() => setTarget(b)}
              >
                <TargetGlyph target={b} />
              </button>
            ))}
          </div>
          <div className="docs-border-tools">
            <DropButton label={t("docsInsert.backgroundColor")} face={<FillIcon size={20} />}>
              {(close) => (
                <Swatches
                  current={background}
                  onPick={(hex) => {
                    editor.chain().focus().setCellsAttrs({ backgroundColor: hex }).run();
                    close();
                  }}
                  onNone={() => {
                    editor.chain().focus().setCellsAttrs({ backgroundColor: null }).run();
                    close();
                  }}
                />
              )}
            </DropButton>
            <DropButton label={t("docsInsert.borderColor")} face={<BorderColorIcon size={20} />}>
              {(close) => (
                <Swatches
                  current={border.color}
                  onPick={(hex) => {
                    apply({ color: hex });
                    close();
                  }}
                />
              )}
            </DropButton>
            <DropButton label={t("docsInsert.borderWidth")} face={<BorderWeightIcon size={20} />}>
              {(close) =>
                BORDER_WEIGHTS.map((w) => (
                  <MenuRow
                    key={w}
                    checked={border.width === w}
                    onSelect={() => {
                      apply({ width: w });
                      close();
                    }}
                  >
                    <span className="docs-weight-row">
                      <span className="docs-weight-line" style={{ borderTopWidth: `${Math.max(w, 0.5)}pt`, opacity: w ? 1 : 0.3 }} />
                      {w} pt
                    </span>
                  </MenuRow>
                ))
              }
            </DropButton>
            <DropButton label={t("docsInsert.borderDash")} face={<BorderDashIcon size={20} />}>
              {(close) =>
                DASHES.map(({ dash, label }) => (
                  <MenuRow
                    key={dash}
                    checked={border.dash === dash}
                    onSelect={() => {
                      apply({ dash });
                      close();
                    }}
                  >
                    <span className="docs-weight-row">
                      <span className="docs-weight-line" style={{ borderTopStyle: dash, borderTopWidth: "2px" }} />
                      {t(label)}
                    </span>
                  </MenuRow>
                ))
              }
            </DropButton>
          </div>
        </FloatingBox>
      )}
    </>,
    document.body,
  );
}

/** A row's bottom line drags to set the row's minimum height. */
function RowResizer({ editor }: { editor: Editor }) {
  const [guide, setGuide] = useState<{ left: number; width: number; top: number } | null>(null);
  useEffect(() => {
    const dom = editor.view.dom;
    let armed: { row: HTMLTableRowElement; cell: HTMLElement } | null = null;
    const near = (e: MouseEvent) => {
      const cell = (e.target as Element | null)?.closest<HTMLElement>("td, th");
      const row = cell?.closest("tr");
      if (!cell || !row || !dom.contains(cell)) return null;
      const r = row.getBoundingClientRect();
      return Math.abs(e.clientY - r.bottom) <= 3 ? { row, cell } : null;
    };
    const onMove = (e: MouseEvent) => {
      if (e.buttons) return;
      const hit = near(e);
      armed = hit;
      dom.classList.toggle("docs-row-resize", Boolean(hit));
    };
    const onDown = (e: MouseEvent) => {
      if (!armed || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const { row, cell } = armed;
      const start = row.getBoundingClientRect();
      const tableRect = row.closest("table")?.getBoundingClientRect() ?? start;
      const zoom = row.offsetHeight > 0 ? start.height / row.offsetHeight : 1;
      let height = start.height;
      const onDrag = (ev: MouseEvent) => {
        height = Math.max(8, ev.clientY - start.top);
        setGuide({ left: tableRect.left, width: tableRect.width, top: start.top + height });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onDrag, true);
        window.removeEventListener("mouseup", onUp, true);
        setGuide(null);
        dom.classList.remove("docs-row-resize");
        try {
          const pos = editor.view.posAtDOM(cell, 0);
          editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))));
          editor.commands.setRowsMinHeight(Math.round((height / zoom / PX_PER_PT) * 10) / 10);
        } catch {
          // The row is gone: nothing to size.
        }
      };
      window.addEventListener("mousemove", onDrag, true);
      window.addEventListener("mouseup", onUp, true);
    };
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mousedown", onDown, true);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mousedown", onDown, true);
      dom.classList.remove("docs-row-resize");
    };
  }, [editor]);
  if (!guide || typeof document === "undefined") return null;
  return createPortal(<div className="docs-table-drop-line docs-table-drop-row" style={{ left: guide.left, width: guide.width, top: guide.top }} />, document.body);
}

function SplitDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(1);
  const valid = cols >= 1 && rows >= 1 && cols <= 20 && rows <= 20 && !(cols === 1 && rows === 1);
  return (
    <Dialog
      title={t("docsInsert.splitCell")}
      onClose={onClose}
      className="docs-split-dialog"
      actions={
        <>
          <button type="button" className="docs-button-outline" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="docs-button-primary"
            disabled={!valid}
            onClick={() => {
              onClose();
              editor.chain().focus().splitCellInto(cols, rows).run();
            }}
          >
            {t("docsInsert.split")}
          </button>
        </>
      }
    >
      <div className="docs-split-fields">
        <label className="docs-split-field">
          <TableColumnIcon size={20} />
          <span>{t("docsInsert.columns")}</span>
          <input className="docs-field" type="number" min={1} max={20} value={cols} onChange={(e) => setCols(Math.round(Number(e.target.value)))} autoFocus />
        </label>
        <label className="docs-split-field">
          <TableRowIcon size={20} />
          <span>{t("docsInsert.rows")}</span>
          <input className="docs-field" type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Math.round(Number(e.target.value)))} />
        </label>
      </div>
    </Dialog>
  );
}

function inchesOfPt(pt: number): string {
  return (Math.round((pt / 72) * 1000) / 1000).toString();
}

/** Table options: Table, Column, Row, Cell, Color, applied as they change. */
function TableOptionsPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [open, setOpen] = useState({ table: true, column: true, row: true, cell: true, color: true });
  const rect = tableRectOf(editor.state);
  if (!rect) return null;
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const table = rect.table;
  const align = (table.attrs.tableAlign as string) || "left";
  const indent = typeof table.attrs.tableIndent === "number" ? table.attrs.tableIndent : 0;
  const cells = selectedCells(editor.state);
  const first = cells[0]?.node;
  const colwidth = (first?.attrs.colwidth as number[] | null) ?? null;
  const rowNode = table.child(rect.top);
  const minHeight = typeof rowNode.attrs.minHeight === "number" ? rowNode.attrs.minHeight : null;
  const pinned = pinnedCount(table);
  const valign = ((first?.attrs.valign as VAlign | null) ?? "top") as VAlign;
  const padding = typeof first?.attrs.padding === "number" ? first.attrs.padding : 5;
  const border = cellBorder(editor.state);
  const background = (first?.attrs.backgroundColor as string | null) ?? null;
  const tableDom = editor.view.nodeDOM(rect.tableStart - 1) as HTMLElement | null;
  const colEls = tableDom?.querySelectorAll("col");

  const setColumnWidth = (inches: number | null) => {
    const widths: number[] = [];
    const count = rect.map.width;
    for (let i = 0; i < count; i++) {
      const el = colEls?.[i] as HTMLElement | undefined;
      const current = el ? el.getBoundingClientRect().width : 100;
      widths.push(current);
    }
    if (inches === null) {
      editor.chain().focus().distributeColumns().run();
      return;
    }
    for (let c = rect.left; c < rect.right; c++) widths[c] = inches * PX_PER_IN;
    editor.chain().focus().setColumnWidths(widths).run();
  };

  return (
    <SidePanel title={t("docsInsert.tableOptions")} icon={<ImageOptionsIcon size={20} />} onClose={onClose}>
      <PanelSection title={t("docsInsert.sectionTable")} open={open.table} onToggle={() => toggle("table")}>
        <span className="docs-side-label">{t("docsInsert.alignment")}</span>
        <div className="docs-seg" role="group" aria-label={t("docsInsert.alignment")}>
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} type="button" aria-pressed={align === a} onClick={() => editor.chain().focus().setTableAttrs({ tableAlign: a === "left" ? null : a }).run()}>
              {t(a === "left" ? "docsInsert.alignLeft" : a === "center" ? "docsInsert.alignCenter" : "docsInsert.alignRight")}
            </button>
          ))}
        </div>
        <label className="docs-side-row">
          <span className="docs-side-label">{t("docsInsert.leftIndent")}</span>
          <input
            key={`indent${indent}`}
            className="docs-field"
            type="number"
            step="0.1"
            min="0"
            defaultValue={inchesOfPt(indent)}
            disabled={align !== "left"}
            onBlur={(e) => editor.chain().focus().setTableAttrs({ tableIndent: Math.max(0, Number(e.target.value) * 72) || null }).run()}
          />
        </label>
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionColumn")} open={open.column} onToggle={() => toggle("column")}>
        <label className="docs-side-check">
          <input type="checkbox" checked={Boolean(colwidth)} onChange={(e) => setColumnWidth(e.target.checked ? 1.5 : null)} />
          {t("docsInsert.columnWidth")}
        </label>
        {colwidth && (
          <input
            key={`cw${colwidth.join(",")}`}
            className="docs-field docs-side-num"
            type="number"
            step="0.1"
            min="0.3"
            defaultValue={(Math.round((colwidth[0] / PX_PER_IN) * 100) / 100).toString()}
            onBlur={(e) => setColumnWidth(Math.max(0.3, Number(e.target.value) || 1))}
          />
        )}
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionRow")} open={open.row} onToggle={() => toggle("row")}>
        <label className="docs-side-check">
          <input
            type="checkbox"
            checked={minHeight !== null}
            onChange={(e) => editor.chain().focus().setRowsMinHeight(e.target.checked ? 36 : null).run()}
          />
          {t("docsInsert.minRowHeight")}
        </label>
        {minHeight !== null && (
          <input
            key={`mh${minHeight}`}
            className="docs-field docs-side-num"
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={inchesOfPt(minHeight)}
            onBlur={(e) => editor.chain().focus().setRowsMinHeight(Math.max(1, Number(e.target.value) * 72)).run()}
          />
        )}
        <label className="docs-side-check">
          <input type="checkbox" checked={pinned > 0} onChange={(e) => editor.chain().focus().pinHeaderRows(e.target.checked ? 1 : 0).run()} />
          {t("docsInsert.pinHeaderRows")}
        </label>
        {pinned > 0 && (
          <input
            className="docs-field docs-side-num"
            type="number"
            min="1"
            max={table.childCount}
            value={pinned}
            onChange={(e) => editor.chain().focus().pinHeaderRows(Math.max(1, Math.min(table.childCount, Number(e.target.value) || 1))).run()}
          />
        )}
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionCell")} open={open.cell} onToggle={() => toggle("cell")}>
        <span className="docs-side-label">{t("docsInsert.cellVerticalAlignment")}</span>
        <div className="docs-seg" role="group" aria-label={t("docsInsert.cellVerticalAlignment")}>
          {(["top", "middle", "bottom"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={valign === v} onClick={() => editor.chain().focus().setCellsAttrs({ valign: v === "top" ? null : v }).run()}>
              {t(v === "top" ? "docsInsert.vTop" : v === "middle" ? "docsInsert.vMiddle" : "docsInsert.vBottom")}
            </button>
          ))}
        </div>
        <label className="docs-side-row">
          <span className="docs-side-label">{t("docsInsert.cellPadding")}</span>
          <input
            key={`pad${padding}`}
            className="docs-field"
            type="number"
            step="0.01"
            min="0"
            defaultValue={inchesOfPt(padding)}
            onBlur={(e) => editor.chain().focus().setCellsAttrs({ padding: Math.max(0, Math.min(72, Number(e.target.value) * 72)) }).run()}
          />
        </label>
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionColor")} open={open.color} onToggle={() => toggle("color")}>
        <span className="docs-side-label">{t("docsInsert.tableBorder")}</span>
        <div className="docs-side-row">
          <DropButton label={t("docsInsert.borderColor")} face={<span className="docs-color-chip" style={{ backgroundColor: border.color }} />}>
            {(close) => (
              <Swatches
                current={border.color}
                onPick={(hex) => {
                  editor.chain().focus().setTableBorders("all", { color: hex }).run();
                  close();
                }}
              />
            )}
          </DropButton>
          <select
            className="docs-select"
            value={String(border.width)}
            aria-label={t("docsInsert.borderWidth")}
            onChange={(e) => editor.chain().focus().setTableBorders("all", { width: Number(e.target.value) }).run()}
          >
            {BORDER_WEIGHTS.map((w) => (
              <option key={w} value={String(w)}>
                {w} pt
              </option>
            ))}
          </select>
        </div>
        <span className="docs-side-label">{t("docsInsert.cellBackground")}</span>
        <DropButton label={t("docsInsert.cellBackground")} face={<span className="docs-color-chip" style={{ backgroundColor: background ?? "transparent" }} />}>
          {(close) => (
            <Swatches
              current={background}
              onPick={(hex) => {
                editor.chain().focus().setCellsAttrs({ backgroundColor: hex }).run();
                close();
              }}
              onNone={() => {
                editor.chain().focus().setCellsAttrs({ backgroundColor: null }).run();
                close();
              }}
            />
          )}
        </DropButton>
      </PanelSection>
    </SidePanel>
  );
}
