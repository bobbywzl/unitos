import { Extension, type Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CellSelection, TableMap, isInTable, selectedRect, type TableRect } from "@tiptap/pm/tables";

// Tables (SPEC.md §29), Google Docs' model on Tiptap's table: a cell's
// background, each side's border ("1 solid #000000": points, dash, color;
// 0 hides the side), its vertical alignment and padding; a row's minimum
// height and whether it is a pinned header row; the table's alignment and
// left indent. And the structure commands the table's right-click menu and
// Table options run: insert several rows or columns, split a cell into a
// grid, sort by a column, distribute, pin header rows.

export type Dash = "solid" | "dotted" | "dashed";
export type BorderSpec = { width: number; dash: Dash; color: string };
export const DEFAULT_BORDER: BorderSpec = { width: 1, dash: "solid", color: "#000000" };
const SIDES = ["borderTop", "borderRight", "borderBottom", "borderLeft"] as const;
type Side = (typeof SIDES)[number];
const CSS_SIDE: Record<Side, string> = { borderTop: "top", borderRight: "right", borderBottom: "bottom", borderLeft: "left" };
const BORDER = /^(\d{1,2}(?:\.\d{1,2})?) (solid|dotted|dashed) (#[0-9a-fA-F]{6})$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

export function parseBorder(value: unknown): BorderSpec | null {
  const m = typeof value === "string" ? BORDER.exec(value) : null;
  return m ? { width: Number(m[1]), dash: m[2] as Dash, color: m[3].toLowerCase() } : null;
}

export function formatBorder(b: BorderSpec): string {
  return `${Math.max(0, Math.min(99, Math.round(b.width * 100) / 100))} ${b.dash} ${b.color}`;
}

/** Which borders the border buttons change: Google Docs' 3 × 3 selector. */
export type BorderTarget = "all" | "inner" | "outer" | "top" | "innerH" | "bottom" | "left" | "innerV" | "right";
export const BORDER_TARGETS: BorderTarget[] = ["all", "inner", "outer", "top", "innerH", "bottom", "left", "innerV", "right"];

export type VAlign = "top" | "middle" | "bottom";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docsTable: {
      /** A table of `rows` × `cols` at the caret, caret in the first cell. */
      insertDocsTable: (rows: number, cols: number) => ReturnType;
      /** Set attributes on every selected cell (or the caret's cell). */
      setCellsAttrs: (attrs: Record<string, unknown>) => ReturnType;
      /** Change the chosen borders of the selected cells. */
      setTableBorders: (target: BorderTarget, spec: Partial<BorderSpec>) => ReturnType;
      /** Sort the rows under the pinned header rows by the selection's column. */
      sortTable: (direction: 1 | -1) => ReturnType;
      /** Every column the same width, the table's width kept. */
      distributeColumns: () => ReturnType;
      /** The rows' minimum height in points (null = none): the selected rows, or every row. */
      setRowsMinHeight: (pt: number | null, everyRow?: boolean) => ReturnType;
      /** Pin the first `count` rows as header rows (0 unpins). */
      pinHeaderRows: (count: number) => ReturnType;
      /** Split the caret's cell into `cols` × `rows` cells. */
      splitCellInto: (cols: number, rows: number) => ReturnType;
      /** Insert `count` rows above or below the selection. */
      insertRows: (side: "before" | "after", count: number) => ReturnType;
      /** Insert `count` columns left or right of the selection. */
      insertColumns: (side: "before" | "after", count: number) => ReturnType;
      /** The table's alignment and left indent. */
      setTableAttrs: (attrs: { tableAlign?: string | null; tableIndent?: number | null }) => ReturnType;
      /** Every column's width in pixels (the table's width is their sum). */
      setColumnWidths: (widths: number[]) => ReturnType;
    };
  }
}

/** The selected rectangle of the table the selection is in, or null. */
export function tableRectOf(state: EditorState): TableRect | null {
  if (!isInTable(state)) return null;
  try {
    return selectedRect(state);
  } catch {
    return null;
  }
}

/** The cells of the selection (a cell selection, or the caret's cell). */
export function selectedCells(state: EditorState): { pos: number; node: PMNode }[] {
  const rect = tableRectOf(state);
  if (!rect) return [];
  const out: { pos: number; node: PMNode }[] = [];
  for (const rel of rect.map.cellsInRect(rect)) {
    const node = rect.table.nodeAt(rel);
    if (node) out.push({ pos: rect.tableStart + rel, node });
  }
  return out;
}

function rectOf(tr: Transaction, tableStart: number, rect: { left: number; top: number; right: number; bottom: number }): TableRect | null {
  const table = tr.doc.nodeAt(tableStart - 1);
  if (!table || table.type.spec.tableRole !== "table") return null;
  return { ...rect, table, tableStart, map: TableMap.get(table) };
}

/** A row's cells: every cell whose top-left sits in `row`. */
type GridCell = { row: number; col: number; rowspan: number; colspan: number; node: PMNode };

function gridOf(table: PMNode): { cells: GridCell[]; width: number; height: number; rows: PMNode[] } {
  const map = TableMap.get(table);
  const cells: GridCell[] = [];
  const seen = new Set<number>();
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const rel = map.map[row * map.width + col];
      if (seen.has(rel)) continue;
      seen.add(rel);
      const node = table.nodeAt(rel);
      if (!node) continue;
      cells.push({
        row,
        col,
        rowspan: Number(node.attrs.rowspan) || 1,
        colspan: Number(node.attrs.colspan) || 1,
        node,
      });
    }
  }
  const rows: PMNode[] = [];
  table.forEach((r) => rows.push(r));
  return { cells, width: map.width, height: map.height, rows };
}

/** Build a table's rows from a grid of cells. */
function buildRows(schema: Schema, cells: GridCell[], height: number, rowAttrs: (row: number) => Record<string, unknown> | null): PMNode[] {
  const rowType = schema.nodes.tableRow;
  const out: PMNode[] = [];
  for (let row = 0; row < height; row++) {
    const here = cells.filter((c) => c.row === row).sort((a, b) => a.col - b.col);
    const content = here.map((c) =>
      c.node.type.create({ ...c.node.attrs, rowspan: c.rowspan, colspan: c.colspan }, c.node.content, c.node.marks),
    );
    out.push(rowType.create(rowAttrs(row), Fragment.fromArray(content)));
  }
  return out;
}

function emptyCell(schema: Schema, like: PMNode): PMNode {
  const attrs = { ...like.attrs, colspan: 1, rowspan: 1, colwidth: null };
  return like.type.create(attrs, schema.nodes.paragraph.create());
}

function cellText(node: PMNode): string {
  return node.textContent.trim();
}

function sortKey(a: string, b: string): number {
  if (!a && b) return 1;
  if (a && !b) return -1;
  const na = Number(a.replace(/[,$€£¥%\s]/g, ""));
  const nb = Number(b.replace(/[,$€£¥%\s]/g, ""));
  if (a && b && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** The number of pinned header rows at the top of a table. */
export function pinnedCount(table: PMNode): number {
  let n = 0;
  for (let i = 0; i < table.childCount; i++) {
    if (table.child(i).attrs.pinned) n++;
    else break;
  }
  return n;
}

const tableDecoKey = new PluginKey<DecorationSet>("docsTableDeco");
const decorated = new WeakMap<PMNode, DecorationSet>();

function tableDecorations(doc: PMNode): DecorationSet {
  const cached = decorated.get(doc);
  if (cached) return cached;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return !node.isTextblock;
    const align = ["center", "right"].includes(node.attrs.tableAlign as string) ? (node.attrs.tableAlign as string) : "left";
    const indent = typeof node.attrs.tableIndent === "number" && node.attrs.tableIndent > 0 ? node.attrs.tableIndent : 0;
    const attrs: Record<string, string> = { "data-align": align };
    if (indent && align === "left") attrs.style = `--docs-table-indent: ${Math.min(indent, 400)}pt`;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs));
    return false;
  });
  const set = DecorationSet.create(doc, decorations);
  decorated.set(doc, set);
  return set;
}

export const DocsTable = Extension.create({
  name: "docsTable",
  priority: 110,
  addGlobalAttributes() {
    const cellStyle = {
      backgroundColor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-bg"),
        renderHTML: (a: Record<string, unknown>) =>
          typeof a.backgroundColor === "string" && HEX.test(a.backgroundColor)
            ? { "data-bg": a.backgroundColor, style: `background-color: ${a.backgroundColor}` }
            : {},
      },
      valign: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-valign"),
        renderHTML: (a: Record<string, unknown>) =>
          a.valign === "middle" || a.valign === "bottom" ? { "data-valign": String(a.valign) } : {},
      },
      padding: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-padding");
          return v === null ? null : Number(v);
        },
        renderHTML: (a: Record<string, unknown>) =>
          typeof a.padding === "number" && a.padding >= 0 && a.padding <= 72
            ? { "data-padding": String(a.padding), style: `padding: ${a.padding}pt` }
            : {},
      },
      ...Object.fromEntries(
        SIDES.map((side) => [
          side,
          {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute(`data-${CSS_SIDE[side]}`),
            renderHTML: (a: Record<string, unknown>) => {
              const b = parseBorder(a[side]);
              if (!b) return {};
              const css = b.width === 0 ? "hidden" : `${b.width}pt ${b.dash} ${b.color}`;
              return { [`data-${CSS_SIDE[side]}`]: formatBorder(b), style: `border-${CSS_SIDE[side]}: ${css}` };
            },
          },
        ]),
      ),
    };
    return [
      { types: ["tableCell", "tableHeader"], attributes: cellStyle },
      {
        types: ["tableRow"],
        attributes: {
          minHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute("data-min-height");
              return v === null ? null : Number(v);
            },
            renderHTML: (a: Record<string, unknown>) =>
              typeof a.minHeight === "number" && a.minHeight > 0 && a.minHeight < 2000
                ? { "data-min-height": String(a.minHeight), style: `height: ${a.minHeight}pt` }
                : {},
          },
          pinned: {
            default: false,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-pinned") === "true",
            renderHTML: (a: Record<string, unknown>) => (a.pinned ? { "data-pinned": "true" } : {}),
          },
        },
      },
      {
        types: ["table"],
        attributes: {
          tableAlign: { default: null, rendered: false },
          tableIndent: { default: null, rendered: false },
        },
      },
    ];
  },
  addCommands() {
    return {
      insertDocsTable:
        (rows, cols) =>
        ({ chain }) =>
          chain()
            .insertTable({ rows: Math.max(1, Math.min(20, rows)), cols: Math.max(1, Math.min(20, cols)), withHeaderRow: false })
            .run(),
      setCellsAttrs:
        (attrs) =>
        ({ state, dispatch }) => {
          const cells = selectedCells(state);
          if (cells.length === 0) return false;
          if (dispatch) {
            const tr = state.tr;
            for (const { pos, node } of cells) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
            dispatch(tr);
          }
          return true;
        },
      setTableBorders:
        (target, spec) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) dispatch(bordersTransaction(state, rect, target, spec));
          return true;
        },
      sortTable:
        (direction) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          const { table, tableStart } = rect;
          const grid = gridOf(table);
          const pinned = pinnedCount(table);
          // Merged cells below the header rows stop a sort, as in Google Docs.
          if (grid.cells.some((c) => c.row >= pinned && (c.rowspan > 1 || c.colspan > 1))) return false;
          if (grid.height - pinned < 2) return false;
          if (dispatch) {
            const col = rect.left;
            const body = grid.rows.slice(pinned);
            const keyed = body.map((row, i) => {
              const cells = grid.cells.filter((c) => c.row === pinned + i);
              const cell = cells.find((c) => c.col === col);
              return { row, key: cell ? cellText(cell.node) : "" };
            });
            keyed.sort((a, b) => {
              const order = sortKey(a.key, b.key);
              if (!a.key || !b.key) return order;
              return order * direction;
            });
            const rows = [...grid.rows.slice(0, pinned), ...keyed.map((k) => k.row)];
            const tr = state.tr.replaceWith(tableStart, tableStart + table.content.size, Fragment.fromArray(rows));
            dispatch(tr);
          }
          return true;
        },
      distributeColumns:
        () =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) {
            const tr = state.tr;
            rect.table.descendants((node, rel) => {
              if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
                if (node.attrs.colwidth) tr.setNodeMarkup(rect.tableStart + rel, undefined, { ...node.attrs, colwidth: null });
                return false;
              }
              return true;
            });
            dispatch(tr);
          }
          return true;
        },
      setRowsMinHeight:
        (pt, everyRow = false) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) {
            const tr = state.tr;
            let at = rect.tableStart;
            rect.table.forEach((row, _offset, index) => {
              if (everyRow || (index >= rect.top && index < rect.bottom)) {
                tr.setNodeMarkup(at, undefined, { ...row.attrs, minHeight: pt });
              }
              at += row.nodeSize;
            });
            dispatch(tr);
          }
          return true;
        },
      pinHeaderRows:
        (count) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) {
            const tr = state.tr;
            let at = rect.tableStart;
            rect.table.forEach((row, _offset, index) => {
              const pinned = index < count;
              if (Boolean(row.attrs.pinned) !== pinned) tr.setNodeMarkup(at, undefined, { ...row.attrs, pinned });
              at += row.nodeSize;
            });
            dispatch(tr);
          }
          return true;
        },
      splitCellInto:
        (cols, rows) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect || cols < 1 || rows < 1 || (cols === 1 && rows === 1)) return false;
          const { table, tableStart, map } = rect;
          const cellRel = map.map[rect.top * map.width + rect.left];
          const target = table.nodeAt(cellRel);
          if (!target || (Number(target.attrs.colspan) || 1) > 1 || (Number(target.attrs.rowspan) || 1) > 1) return false;
          if (dispatch) {
            const grid = gridOf(table);
            const r = rect.top;
            const c = rect.left;
            const extraC = cols - 1;
            const extraR = rows - 1;
            const cells: GridCell[] = [];
            for (const cell of grid.cells) {
              if (cell.row === r && cell.col === c) {
                for (let i = 0; i < rows; i++) {
                  for (let j = 0; j < cols; j++) {
                    cells.push({
                      row: r + i,
                      col: c + j,
                      rowspan: 1,
                      colspan: 1,
                      node: i === 0 && j === 0 ? cell.node.type.create({ ...cell.node.attrs, colwidth: null }, cell.node.content) : emptyCell(state.schema, cell.node),
                    });
                  }
                }
                continue;
              }
              const coversCol = cell.col <= c && c < cell.col + cell.colspan;
              const coversRow = cell.row <= r && r < cell.row + cell.rowspan;
              cells.push({
                row: cell.row + (cell.row > r ? extraR : 0),
                col: cell.col + (cell.col > c ? extraC : 0),
                rowspan: cell.rowspan + (coversRow ? extraR : 0),
                colspan: cell.colspan + (coversCol ? extraC : 0),
                node: coversCol && extraC > 0 ? cell.node.type.create({ ...cell.node.attrs, colwidth: null }, cell.node.content) : cell.node,
              });
            }
            const height = grid.height + extraR;
            const rowsOut = buildRows(state.schema, cells, height, (row) => {
              const from = row <= r ? row : row <= r + extraR ? r : row - extraR;
              return grid.rows[from]?.attrs ?? null;
            });
            const tr = state.tr.replaceWith(tableStart, tableStart + table.content.size, Fragment.fromArray(rowsOut));
            const next = rectOf(tr, tableStart, { left: 0, top: 0, right: 1, bottom: 1 });
            if (next) {
              const cellPos = tableStart + next.map.map[r * next.map.width + c];
              tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
            }
            dispatch(tr);
          }
          return true;
        },
      insertRows:
        (side, count) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) {
            const tr = state.tr;
            const at = side === "before" ? rect.top : rect.bottom;
            for (let i = 0; i < count; i++) {
              const current = rectOf(tr, rect.tableStart, rect);
              if (!current) break;
              addRowAt(tr, current, at);
            }
            dispatch(tr);
          }
          return true;
        },
      insertColumns:
        (side, count) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) {
            const tr = state.tr;
            const at = side === "before" ? rect.left : rect.right;
            for (let i = 0; i < count; i++) {
              const current = rectOf(tr, rect.tableStart, rect);
              if (!current) break;
              addColumnAt(tr, current, at);
            }
            dispatch(tr);
          }
          return true;
        },
      setTableAttrs:
        (attrs) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) {
            const pos = rect.tableStart - 1;
            dispatch(state.tr.setNodeMarkup(pos, undefined, { ...rect.table.attrs, ...attrs }));
          }
          return true;
        },
      setColumnWidths:
        (widths) =>
        ({ state, dispatch }) => {
          const rect = tableRectOf(state);
          if (!rect) return false;
          if (dispatch) {
            const tr = state.tr;
            const grid = gridOf(rect.table);
            for (const cell of grid.cells) {
              const colwidth = widths.slice(cell.col, cell.col + cell.colspan).map((w) => Math.max(24, Math.round(w)));
              if (colwidth.length !== cell.colspan) continue;
              const rel = rect.map.map[cell.row * rect.map.width + cell.col];
              tr.setNodeMarkup(rect.tableStart + rel, undefined, { ...cell.node.attrs, colwidth });
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Enter at the very start of a table that starts the document makes
      // a paragraph above it.
      Enter: () => {
        const { state, view } = this.editor;
        const sel = state.selection;
        if (!sel.empty) return false;
        const $pos = sel.$from;
        if ($pos.parentOffset !== 0) return false;
        let tableDepth = -1;
        for (let d = $pos.depth; d > 0; d--) {
          if ($pos.node(d).type.name === "table") {
            tableDepth = d;
            break;
          }
        }
        if (tableDepth !== 1 || $pos.before(1) !== 0) return false;
        // The first paragraph of the first cell.
        if ($pos.start(tableDepth) + 3 !== $pos.pos) return false;
        const tr = state.tr.insert(0, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, 1));
        view.dispatch(tr);
        return true;
      },
      // Backspace in an empty line right after a table goes into its last cell.
      Backspace: () => {
        const { state, view } = this.editor;
        const sel = state.selection;
        if (!sel.empty) return false;
        const $pos = sel.$from;
        if ($pos.parent.content.size > 0 || $pos.parentOffset !== 0 || $pos.depth < 1) return false;
        const index = $pos.index($pos.depth - 1);
        if (index === 0) return false;
        const before = $pos.node($pos.depth - 1).child(index - 1);
        if (before.type.name !== "table") return false;
        const tableEnd = $pos.before();
        const tr = state.tr;
        // A line the document needs after the table stays; any other goes.
        const isLast = index === $pos.node($pos.depth - 1).childCount - 1;
        if (!isLast) tr.delete($pos.before(), $pos.after());
        tr.setSelection(TextSelection.near(tr.doc.resolve(tableEnd - 1), -1));
        view.dispatch(tr);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableDecoKey,
        props: {
          decorations: (state) => tableDecorations(state.doc),
        },
      }),
    ];
  },
});

/** Add a row at index `row` (rows below it move down), its cells styled
    like the row it copies, as Google Docs does. `rect` is the table as `tr`
    holds it now. */
function addRowAt(tr: Transaction, rect: TableRect, row: number) {
  const { map, table, tableStart } = rect;
  const schema = tr.doc.type.schema;
  const mapStart = tr.mapping.maps.length;
  const mapped = (pos: number) => tr.mapping.slice(mapStart).map(pos);
  let rowPos = tableStart;
  for (let i = 0; i < row; i++) rowPos += table.child(i).nodeSize;
  const refRow = row > 0 ? row - 1 : 0;
  const cells: PMNode[] = [];
  for (let col = 0, index = map.width * row; col < map.width; col++, index++) {
    if (row > 0 && row < map.height && map.map[index] === map.map[index - map.width]) {
      // A cell that spans across the new row grows instead.
      const pos = map.map[index];
      const node = table.nodeAt(pos);
      if (!node) continue;
      tr.setNodeMarkup(mapped(tableStart + pos), undefined, { ...node.attrs, rowspan: (Number(node.attrs.rowspan) || 1) + 1 });
      const span = Number(node.attrs.colspan) || 1;
      col += span - 1;
      index += span - 1;
      continue;
    }
    const refPos = map.map[refRow * map.width + col];
    const ref = table.nodeAt(refPos);
    const widths = ref?.attrs.colwidth as number[] | null | undefined;
    const width = widths ? widths[col - map.colCount(refPos)] : undefined;
    const type = ref?.type.name === "tableHeader" && row > 0 ? schema.nodes.tableCell : (ref?.type ?? schema.nodes.tableCell);
    const attrs = ref ? { ...ref.attrs, colspan: 1, rowspan: 1, colwidth: width ? [width] : null } : null;
    const cell = type.createAndFill(attrs) ?? schema.nodes.tableCell.createAndFill();
    if (cell) cells.push(cell);
  }
  const refRowNode = table.child(Math.min(refRow, table.childCount - 1));
  tr.insert(mapped(rowPos), schema.nodes.tableRow.create({ ...refRowNode.attrs, pinned: false }, cells));
}

/** Add a column at index `col`, each new cell styled like its left
    neighbour. `rect` is the table as `tr` holds it now. */
function addColumnAt(tr: Transaction, rect: TableRect, col: number) {
  const { map, table, tableStart } = rect;
  const schema = tr.doc.type.schema;
  const mapStart = tr.mapping.maps.length;
  const mapped = (pos: number) => tr.mapping.slice(mapStart).map(pos);
  for (let row = 0; row < map.height; row++) {
    const index = row * map.width + col;
    if (col > 0 && col < map.width && map.map[index - 1] === map.map[index]) {
      // Inside a cell that spans columns: the cell grows.
      const pos = map.map[index];
      const cell = table.nodeAt(pos);
      if (!cell) continue;
      const at = col - map.colCount(pos);
      const widths = cell.attrs.colwidth as number[] | null;
      tr.setNodeMarkup(mapped(tableStart + pos), undefined, {
        ...cell.attrs,
        colspan: (Number(cell.attrs.colspan) || 1) + 1,
        colwidth: widths ? [...widths.slice(0, at), 0, ...widths.slice(at)] : null,
      });
      row += (Number(cell.attrs.rowspan) || 1) - 1;
      continue;
    }
    const ref = table.nodeAt(map.map[col > 0 ? index - 1 : index]);
    const attrs = ref ? { ...ref.attrs, colspan: 1, rowspan: 1, colwidth: null } : null;
    const type = ref?.type ?? schema.nodes.tableCell;
    const cell = type.createAndFill(attrs);
    if (cell) tr.insert(mapped(tableStart + map.positionAt(row, col, table)), cell);
  }
}

/** The borders transaction: each chosen edge is written on both cells that
    share it, so a collapsed border draws the new line. */
function bordersTransaction(state: EditorState, rect: TableRect, target: BorderTarget, spec: Partial<BorderSpec>): Transaction {
  const { map, table, tableStart } = rect;
  const tr = state.tr;
  // Edges as (row, col, side) of grid slots.
  const edits = new Map<number, Partial<Record<Side, true>>>();
  const mark = (row: number, col: number, side: Side) => {
    if (row < 0 || col < 0 || row >= map.height || col >= map.width) return;
    const rel = map.map[row * map.width + col];
    const entry = edits.get(rel) ?? {};
    entry[side] = true;
    edits.set(rel, entry);
  };
  const want = (edge: "top" | "bottom" | "left" | "right" | "innerH" | "innerV") => {
    switch (target) {
      case "all":
        return true;
      case "inner":
        return edge === "innerH" || edge === "innerV";
      case "outer":
        return edge === "top" || edge === "bottom" || edge === "left" || edge === "right";
      default:
        return target === edge;
    }
  };
  for (let row = rect.top; row < rect.bottom; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      const top = row === rect.top ? "top" : "innerH";
      const bottom = row === rect.bottom - 1 ? "bottom" : "innerH";
      const left = col === rect.left ? "left" : "innerV";
      const right = col === rect.right - 1 ? "right" : "innerV";
      if (want(top)) {
        mark(row, col, "borderTop");
        mark(row - 1, col, "borderBottom");
      }
      if (want(bottom)) {
        mark(row, col, "borderBottom");
        mark(row + 1, col, "borderTop");
      }
      if (want(left)) {
        mark(row, col, "borderLeft");
        mark(row, col - 1, "borderRight");
      }
      if (want(right)) {
        mark(row, col, "borderRight");
        mark(row, col + 1, "borderLeft");
      }
    }
  }
  for (const [rel, sides] of edits) {
    const node = table.nodeAt(rel);
    if (!node) continue;
    const attrs: Record<string, unknown> = { ...node.attrs };
    for (const side of SIDES) {
      if (!sides[side]) continue;
      const current = parseBorder(node.attrs[side]) ?? DEFAULT_BORDER;
      attrs[side] = formatBorder({ ...current, ...spec });
    }
    tr.setNodeMarkup(tableStart + rel, undefined, attrs);
  }
  return tr;
}

/** The border of one side of the caret's cell, as the border buttons show it. */
export function cellBorder(state: EditorState, side: Side = "borderTop"): BorderSpec {
  const cell = selectedCells(state)[0];
  return parseBorder(cell?.node.attrs[side]) ?? DEFAULT_BORDER;
}

/** Distribute rows: every row as tall as the tallest, drawn. */
export function distributeRows(editor: Editor): boolean {
  const rect = tableRectOf(editor.state);
  if (!rect) return false;
  const dom = editor.view.nodeDOM(rect.tableStart - 1);
  const rows = dom instanceof HTMLElement ? [...dom.querySelectorAll<HTMLElement>("tr")] : [];
  const zoom = dom instanceof HTMLElement && dom.offsetHeight > 0 ? dom.getBoundingClientRect().height / dom.offsetHeight : 1;
  const tallest = rows.reduce((m, r) => Math.max(m, r.getBoundingClientRect().height / (zoom || 1)), 0);
  if (!tallest) return false;
  return editor.commands.setRowsMinHeight(Math.round((tallest * 72) / 96), true);
}

/** Where a table sits: its node, position, and the caret's row and column. */
export function tableAt(state: EditorState): { table: PMNode; pos: number; rect: TableRect } | null {
  const rect = tableRectOf(state);
  return rect ? { table: rect.table, pos: rect.tableStart - 1, rect } : null;
}

export function isCellSelection(state: EditorState): boolean {
  return state.selection instanceof CellSelection;
}
