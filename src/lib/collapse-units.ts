import type { RichNode } from "@/lib/docs/schema";

// Collapse's units (SPEC.md §28): what one core stands for. In a block
// document every block is one. In a document with rich text (SPEC.md §29)
// the rows are the paragraph index, a row per paragraph: the lines of one
// list are one unit and the cells of one table one unit (Block.cell.table),
// as the block reader holds a list and a table as one block each, and a
// figure object stays as it is. A unit's id is its first row's; its text is
// its rows' words, a row a line. lib/collapse.ts writes and reads the cores
// by unit; the page editor draws each core in place of its unit's rows
// (components/docs/layer/collapse.tsx). Type imports only: the page loads
// this too.

export type UnitRow = { id: string; type: string; text: string; cell?: unknown };
export type CollapseUnit = { id: string; type: string; text: string; rows: string[] };

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

/** The table a row's cell is in (Block.cell.table), or null. */
function tableOf(cell: unknown): number | null {
  const table = cell && typeof cell === "object" ? (cell as { table?: unknown }).table : null;
  return typeof table === "number" && Number.isInteger(table) ? table : null;
}

/** The list each list line of a rich text is in, by row id: the number of
    its outermost list. A table's lists are its cells'. */
function listsOf(doc: RichNode): Map<string, number> {
  const lists = new Map<string, number>();
  let count = 0;
  const walk = (node: RichNode, list: number | null) => {
    if (node.type === "table") return;
    const inList = list ?? (LISTS.has(node.type) ? ++count : null);
    const id = node.attrs?.blockId;
    if (inList !== null && typeof id === "string") lists.set(id, inList);
    for (const child of node.content ?? []) walk(child, inList);
  };
  walk(doc, null);
  return lists;
}

/** The units of a document's rows, in reading order. richText: the
    document's rich text; anything else is a block document. */
export function collapseUnits(rows: UnitRow[], richText: unknown): CollapseUnit[] {
  const doc = richText && typeof richText === "object" && (richText as RichNode).type === "doc" ? (richText as RichNode) : null;
  const lists = doc ? listsOf(doc) : null;
  const units: CollapseUnit[] = [];
  // The unit the next row joins when it is a line of the same list or a
  // cell of the same table.
  let open = null as { unit: CollapseUnit; key: string } | null;
  for (const row of rows) {
    const table = lists ? tableOf(row.cell) : null;
    const list = table === null && row.type === "LIST" ? lists?.get(row.id) : undefined;
    const key = table !== null ? `table ${table}` : list !== undefined ? `list ${list}` : null;
    if (key !== null && open?.key === key) {
      open.unit.text += `\n${row.text}`;
      open.unit.rows.push(row.id);
      continue;
    }
    open = null;
    if (lists && row.type === "FIGURE" && table === null) continue;
    const unit = { id: row.id, type: table !== null ? "TABLE" : row.type, text: row.text, rows: [row.id] };
    units.push(unit);
    if (key !== null) open = { unit, key };
  }
  return units;
}
