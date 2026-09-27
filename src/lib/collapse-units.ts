// Collapse's units (SPEC.md §28): what one core stands for. In a block
// document every block is one. In a document with rich text (SPEC.md §29)
// the rows are the paragraph index, a row per paragraph: a list's lines are
// one unit and a table's cells one unit (Block.cell.table), as the block
// reader holds a list and a table as one block each, and a figure object
// stays as it is. A unit's id is its first row's; its text is its rows'
// words, a row a line. lib/collapse.ts writes and reads the cores by unit;
// the page editor draws each core in place of its unit's rows
// (components/docs/layer/collapse.tsx). No imports: the page loads this too.

export type UnitRow = { id: string; type: string; text: string; cell?: unknown };
export type CollapseUnit = { id: string; type: string; text: string; rows: string[] };

/** The table a row's cell is in (Block.cell.table), or null. */
function tableOf(cell: unknown): number | null {
  const table = cell && typeof cell === "object" ? (cell as { table?: unknown }).table : null;
  return typeof table === "number" && Number.isInteger(table) ? table : null;
}

/** The units of a document's rows, in reading order. */
export function collapseUnits(rows: UnitRow[], richText: boolean): CollapseUnit[] {
  const units: CollapseUnit[] = [];
  // The unit the next row joins when it is a line of the same list or a
  // cell of the same table.
  let open: { unit: CollapseUnit; key: string } | null = null;
  for (const row of rows) {
    const table = richText ? tableOf(row.cell) : null;
    const key = table !== null ? `table ${table}` : richText && row.type === "LIST" ? "list" : null;
    if (key !== null && open?.key === key) {
      open.unit.text += `\n${row.text}`;
      open.unit.rows.push(row.id);
      continue;
    }
    open = null;
    if (richText && row.type === "FIGURE" && table === null) continue;
    const unit = { id: row.id, type: table !== null ? "TABLE" : row.type, text: row.text, rows: [row.id] };
    units.push(unit);
    if (key !== null) open = { unit, key };
  }
  return units;
}
