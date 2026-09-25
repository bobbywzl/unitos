"use client";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { moveTableColumn, moveTableRow, TableMap } from "@tiptap/pm/tables";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { AddIcon, DropDownIcon } from "@/components/docs/icons";
import { MenuItem } from "@/components/docs/menu";
import { PX_PER_PT } from "@/components/docs/page/geometry";
import { DropBtn } from "@/components/docs/toolbar/controls";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { BorderButtons, ColorButton } from "@/components/docs/insert/colors";
import { onInsert, type InsertContext } from "@/components/docs/insert/context";
import {
  ArrowDownIcon,
  ArrowUpIcon,
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
import { BORDER_TARGETS, cellBorder, pinnedCount, selectedCells, tableRectOf, type BorderTarget, type VAlign } from "@/components/docs/insert/table";
import { FloatingBox, keepSelection, LengthField, PanelSection, Seg, SidePanel, useEditorTick, useViewportTick } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// A table's controls (SPEC.md §29), Google Docs' way: the row and column
// pills on hover, a row's bottom line that drags its height, the ▾ border
// selector in the caret's cell, the Split cell dialog, and the Table
// options panel.

type Hover = { tablePos: number; row: number; col: number; rowRect: DOMRect; colRect: DOMRect; tableRect: DOMRect };

/** Where the pointer is over a table: its row and column, and their boxes. */
function hoverAt(editor: Editor, cell: HTMLElement): Hover | null {
  const view = editor.view;
  const tableEl = cell.closest(".tableWrapper")?.querySelector("table");
  const rowEl = cell.closest("tr");
  if (!tableEl || !rowEl) return null;
  try {
    const cellPos = view.posAtDOM(cell, 0) - 1;
    const $cell = view.state.doc.resolve(cellPos);
    for (let d = $cell.depth; d > 0; d--) {
      if ($cell.node(d).type.name !== "table") continue;
      const tablePos = $cell.before(d);
      const rect = TableMap.get($cell.node(d)).findCell(cellPos - tablePos - 1);
      const cellRect = cell.getBoundingClientRect();
      const tableRect = tableEl.getBoundingClientRect();
      // The column's box: the whole column under the cell.
      const colRect = new DOMRect(cellRect.left, tableRect.top, cellRect.width, tableRect.height);
      return { tablePos, row: rect.top, col: rect.left, rowRect: rowEl.getBoundingClientRect(), colRect, tableRect };
    }
  } catch {
    // Not a cell of the document.
  }
  return null;
}

/** Put the caret in a cell of the table, so the table commands act there. */
function caretInCell(editor: Editor, tablePos: number, row: number, col: number) {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table) return;
  const map = TableMap.get(table);
  const rel = map.map[Math.min(row, map.height - 1) * map.width + Math.min(col, map.width - 1)];
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(tablePos + rel + 2))));
}

export function TableControlsHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  useEditorTick(editor);
  const [hover, setHover] = useState<Hover | null>(null);
  const [panel, setPanel] = useState(false);
  const [split, setSplit] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const inTable = tableRectOf(editor.state) !== null;
  useViewportTick(hover !== null || inTable);

  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type === "table-options") setPanel(true);
        if (event.type === "split-cell") setSplit(true);
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
      if ((e.relatedTarget as Element | null)?.closest?.("[data-docs-table-pill], [data-docs-menu]")) return;
      hideTimer.current = window.setTimeout(() => setHover(null), 400);
    };
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, ctx.editing]);

  return (
    <>
      {ctx.editing && hover && (
        <Pills
          editor={editor}
          hover={hover}
          onEnter={() => hideTimer.current && window.clearTimeout(hideTimer.current)}
          onLeave={() => {
            hideTimer.current = window.setTimeout(() => setHover(null), 400);
          }}
          onDone={() => setHover(null)}
        />
      )}
      {ctx.editing && inTable && <BorderSelector editor={editor} />}
      {ctx.editing && <RowResizer editor={editor} />}
      {panel && inTable && <TableOptionsPanel editor={editor} onClose={() => setPanel(false)} />}
      {split && inTable && <SplitDialog editor={editor} onClose={() => setSplit(false)} />}
    </>
  );
}

/** The row and column pills of the hovered cell. */
function Pills({ editor, hover, onEnter, onLeave, onDone }: { editor: Editor; hover: Hover; onEnter: () => void; onLeave: () => void; onDone: () => void }) {
  const t = useT();
  const [drag, setDrag] = useState<{ axis: "row" | "col"; line: number } | null>(null);
  const table = editor.state.doc.nodeAt(hover.tablePos);
  if (!table || typeof document === "undefined") return null;
  const pinned = pinnedCount(table);
  const rowPinned = hover.row < pinned;
  const pinLabel = t(rowPinned ? (pinned > 1 ? "docsInsert.unpinHeaderRows" : "docsInsert.unpinHeaderRow") : "docsInsert.pinHeaderUpToRow");
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
    const parts = axis === "row" ? rows : [...(rows[0]?.children ?? [])];
    const boxes = parts.map((el) => el.getBoundingClientRect());
    const edges = axis === "row" ? [...boxes.map((r) => r.top), boxes[boxes.length - 1]?.bottom ?? 0] : [...boxes.map((r) => r.left), boxes[boxes.length - 1]?.right ?? 0];
    const from = axis === "row" ? hover.row : hover.col;
    let gap = from;
    const onMove = (ev: MouseEvent) => {
      const at = axis === "row" ? ev.clientY : ev.clientX;
      gap = edges.reduce((best, edge, i) => (Math.abs(edge - at) < Math.abs(edges[best] - at) ? i : best), 0);
      setDrag({ axis, line: edges[gap] });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      setDrag(null);
      const to = gap > from ? gap - 1 : gap;
      if (to === from) return;
      const move = axis === "row" ? moveTableRow : moveTableColumn;
      move({ from, to, pos: hover.tablePos + 1, select: false })(editor.state, editor.view.dispatch);
      onDone();
      editor.view.focus();
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  };

  const pill = (axis: "row" | "col", style: React.CSSProperties, buttons: React.ReactNode) => (
    <div
      className={`docs-table-pill docs-table-pill-${axis}`}
      data-docs-table-pill
      data-docs-insert-popover
      data-edit-control
      data-selection-popover
      onMouseDown={keepSelection}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={style}
    >
      <button
        type="button"
        className="docs-pill-btn docs-pill-drag"
        aria-label={t(axis === "row" ? "docsInsert.dragRow" : "docsInsert.dragColumn")}
        data-tip={t(axis === "row" ? "docsInsert.dragRow" : "docsInsert.dragColumn")}
        onMouseDown={(e) => startDrag(axis, e)}
      >
        {axis === "row" ? <DragIcon size={16} /> : <DragHorizontalIcon size={16} />}
      </button>
      {buttons}
    </div>
  );
  const plus = (label: TKey, fn: () => void) => (
    <button type="button" className="docs-pill-btn" aria-label={t(label)} data-tip={t(label)} onClick={() => run(fn)}>
      <AddIcon size={16} />
    </button>
  );
  const { tableRect } = hover;
  return createPortal(
    <>
      {pill(
        "row",
        { left: tableRect.left - 30, top: hover.rowRect.top + hover.rowRect.height / 2 },
        <>
          <button
            type="button"
            className="docs-pill-btn"
            aria-label={pinLabel}
            data-tip={pinLabel}
            onClick={() => run(() => editor.commands.pinHeaderRows(rowPinned ? 0 : hover.row + 1))}
          >
            {rowPinned ? <UnpinIcon size={16} /> : <PinIcon size={16} />}
          </button>
          {plus("docsInsert.insertOneRowBelow", () => editor.commands.insertRows("after", 1))}
        </>,
      )}
      {pill(
        "col",
        { left: hover.colRect.left + 4, top: tableRect.top - 30 },
        <>
          <DropBtn label={t("docsInsert.sortTable")} track="table-sort" arrow={false} className="docs-pill-btn" face={<SortIcon size={16} />}>
            {(close) =>
              ([1, -1] as const).map((direction) => (
                <MenuItem
                  key={direction}
                  icon={direction === 1 ? <ArrowUpIcon size={18} /> : <ArrowDownIcon size={18} />}
                  onSelect={() => {
                    close();
                    run(() => editor.commands.sortTable(direction));
                  }}
                >
                  {t(direction === 1 ? "docsInsert.sortAscending" : "docsInsert.sortDescending")}
                </MenuItem>
              ))
            }
          </DropBtn>
          {plus("docsInsert.insertOneColumnRight", () => editor.commands.insertColumns("after", 1))}
        </>,
      )}
      {drag && (
        <div
          className="docs-table-drop-line"
          style={
            drag.axis === "row"
              ? { left: tableRect.left, width: tableRect.width, top: drag.line - 1, height: 2 }
              : { top: tableRect.top, height: tableRect.height, left: drag.line - 1, width: 2 }
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

/** The lines of a cell's square, and a border choice's drawn solid. */
const LINES: [string, number, number, number, number][] = [
  ["t", 2, 2, 18, 2],
  ["b", 2, 18, 18, 18],
  ["l", 2, 2, 2, 18],
  ["r", 18, 2, 18, 18],
  ["h", 2, 10, 18, 10],
  ["v", 10, 2, 10, 18],
];

function TargetGlyph({ target }: { target: BorderTarget }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
      {LINES.map(([edge, x1, y1, x2, y2]) => {
        const on = BORDER_TARGETS[target].includes(edge);
        return <line key={edge} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2" stroke={on ? "currentColor" : "#c4c7c5"} strokeDasharray={on ? undefined : "2 2"} />;
      })}
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
  const side = target === "bottom" ? "borderBottom" : target === "left" ? "borderLeft" : target === "right" ? "borderRight" : "borderTop";
  const background = (cells[0].node.attrs.backgroundColor as string | null) ?? null;
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
          anchor={{ left: corner.right - 18, top: corner.top, bottom: corner.top + 18 }}
          className="docs-border-pop"
          onDismiss={() => setOpen(false)}
          label={t("docsInsert.selectBorders")}
        >
          <div className="docs-border-grid" role="radiogroup" aria-label={t("docsInsert.selectBorders")}>
            {(Object.keys(BORDER_TARGETS) as BorderTarget[]).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={target === b}
                className="docs-icon-btn"
                aria-label={t(TARGET_LABEL[b])}
                data-tip={t(TARGET_LABEL[b])}
                onClick={() => setTarget(b)}
              >
                <TargetGlyph target={b} />
              </button>
            ))}
          </div>
          <div className="docs-border-tools">
            <ColorButton
              label={t("docsInsert.backgroundColor")}
              track="table-background"
              face={<FillIcon />}
              current={background}
              onPick={(hex) => editor.chain().focus().setCellsAttrs({ backgroundColor: hex }).run()}
              onNone={() => editor.chain().focus().setCellsAttrs({ backgroundColor: null }).run()}
            />
            <BorderButtons track="table" border={cellBorder(editor.state, side)} onChange={(spec) => editor.chain().focus().setTableBorders(target, spec).run()} />
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
    const onMove = (e: MouseEvent) => {
      if (e.buttons) return;
      const cell = (e.target as Element | null)?.closest<HTMLElement>("td, th");
      const row = cell?.closest("tr");
      armed = cell && row && dom.contains(cell) && Math.abs(e.clientY - row.getBoundingClientRect().bottom) <= 3 ? { row, cell } : null;
      dom.classList.toggle("docs-row-resize", Boolean(armed));
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
  return createPortal(<div className="docs-table-drop-line" style={{ ...guide, height: 2 }} />, document.body);
}

function SplitDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(1);
  const valid = cols >= 1 && rows >= 1 && cols <= 20 && rows <= 20 && !(cols === 1 && rows === 1);
  const field = (label: TKey, icon: React.ReactNode, value: number, set: (n: number) => void) => (
    <label className="docs-split-field">
      {icon}
      <span>{t(label)}</span>
      <input className="docs-field" type="number" min={1} max={20} value={value} onChange={(e) => set(Math.round(Number(e.target.value)))} />
    </label>
  );
  return (
    <ToolbarDialog
      title={t("docsInsert.splitCell")}
      onClose={onClose}
      className="docs-split-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("common.cancel")}</DialogButton>
          <DialogButton
            primary
            disabled={!valid}
            onClick={() => {
              onClose();
              editor.chain().focus().splitCellInto(cols, rows).run();
            }}
          >
            {t("docsInsert.split")}
          </DialogButton>
        </>
      }
    >
      {field("docsInsert.columns", <TableColumnIcon />, cols, setCols)}
      {field("docsInsert.rows", <TableRowIcon />, rows, setRows)}
    </ToolbarDialog>
  );
}

/** Table options: Table, Column, Row, Cell, Color, applied as they change. */
function TableOptionsPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const rect = tableRectOf(editor.state);
  if (!rect) return null;
  const chain = () => editor.chain().focus();
  const table = rect.table;
  const align = ((table.attrs.tableAlign as string | null) ?? "left") as "left" | "center" | "right";
  const indent = typeof table.attrs.tableIndent === "number" ? table.attrs.tableIndent : 0;
  const first = selectedCells(editor.state)[0]?.node;
  const colwidth = (first?.attrs.colwidth as number[] | null) ?? null;
  const minHeight = table.child(rect.top).attrs.minHeight as number | null;
  const pinned = pinnedCount(table);
  const valign = (first?.attrs.valign as VAlign | null) ?? "top";
  const padding = typeof first?.attrs.padding === "number" ? first.attrs.padding : 5;
  const background = (first?.attrs.backgroundColor as string | null) ?? null;

  const setColumnWidth = (pt: number | null) => {
    if (pt === null) {
      chain().distributeColumns().run();
      return;
    }
    const cols = editor.view.nodeDOM(rect.tableStart - 1);
    const widths = [...(cols instanceof HTMLElement ? cols.querySelectorAll("col") : [])].map((el) => el.getBoundingClientRect().width);
    for (let c = rect.left; c < rect.right; c++) widths[c] = pt * PX_PER_PT;
    chain().setColumnWidths(widths).run();
  };

  return (
    <SidePanel title={t("docsInsert.tableOptions")} icon={<ImageOptionsIcon />} onClose={onClose}>
      <PanelSection title={t("docsInsert.sectionTable")}>
        <span className="docs-side-label">{t("docsInsert.alignment")}</span>
        <Seg
          label={t("docsInsert.alignment")}
          value={align}
          options={[
            ["left", t("docsInsert.alignLeft")],
            ["center", t("docsInsert.alignCenter")],
            ["right", t("docsInsert.alignRight")],
          ]}
          onChange={(a) => chain().setTableAttrs({ tableAlign: a === "left" ? null : a }).run()}
        />
        {align === "left" && <LengthField label={t("docsInsert.leftIndent")} pt={indent} onChange={(pt) => chain().setTableAttrs({ tableIndent: pt || null }).run()} />}
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionColumn")}>
        <label className="docs-side-check">
          <input type="checkbox" checked={Boolean(colwidth)} onChange={(e) => setColumnWidth(e.target.checked ? 108 : null)} />
          {t("docsInsert.columnWidth")}
        </label>
        {colwidth && <LengthField bare label={t("docsInsert.columnWidth")} pt={colwidth[0] / PX_PER_PT} onChange={(pt) => setColumnWidth(Math.max(22, pt))} />}
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionRow")}>
        <label className="docs-side-check">
          <input type="checkbox" checked={minHeight !== null} onChange={(e) => chain().setRowsMinHeight(e.target.checked ? 36 : null).run()} />
          {t("docsInsert.minRowHeight")}
        </label>
        {minHeight !== null && <LengthField bare label={t("docsInsert.minRowHeight")} pt={minHeight} onChange={(pt) => chain().setRowsMinHeight(Math.max(1, pt)).run()} />}
        <label className="docs-side-check">
          <input type="checkbox" checked={pinned > 0} onChange={(e) => chain().pinHeaderRows(e.target.checked ? 1 : 0).run()} />
          {t("docsInsert.pinHeaderRows")}
        </label>
        {pinned > 0 && (
          <input
            className="docs-field docs-side-num"
            type="number"
            min="1"
            max={table.childCount}
            value={pinned}
            onChange={(e) => chain().pinHeaderRows(Math.max(1, Math.min(table.childCount, Number(e.target.value) || 1))).run()}
          />
        )}
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionCell")}>
        <span className="docs-side-label">{t("docsInsert.cellVerticalAlignment")}</span>
        <Seg
          label={t("docsInsert.cellVerticalAlignment")}
          value={valign}
          options={[
            ["top", t("docsInsert.vTop")],
            ["middle", t("docsInsert.vMiddle")],
            ["bottom", t("docsInsert.vBottom")],
          ]}
          onChange={(v) => chain().setCellsAttrs({ valign: v === "top" ? null : v }).run()}
        />
        <LengthField label={t("docsInsert.cellPadding")} pt={padding} onChange={(pt) => chain().setCellsAttrs({ padding: Math.min(72, pt) }).run()} />
      </PanelSection>
      <PanelSection title={t("docsInsert.sectionColor")}>
        <span className="docs-side-label">{t("docsInsert.tableBorder")}</span>
        <div className="docs-side-row">
          <BorderButtons track="table-options" border={cellBorder(editor.state)} onChange={(spec) => chain().setTableBorders("all", spec).run()} />
        </div>
        <span className="docs-side-label">{t("docsInsert.cellBackground")}</span>
        <ColorButton
          label={t("docsInsert.cellBackground")}
          track="table-options-background"
          face={<FillIcon />}
          current={background}
          onPick={(hex) => chain().setCellsAttrs({ backgroundColor: hex }).run()}
          onNone={() => chain().setCellsAttrs({ backgroundColor: null }).run()}
        />
      </PanelSection>
    </SidePanel>
  );
}
