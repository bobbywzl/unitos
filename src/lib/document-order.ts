// Sort by in the document list (SPEC.md §6). One choice orders every list —
// the project itself and each folder's own list. Last edited, the default,
// lists the rows newest edit first; Added is the list as it was before
// sorts existed, and a list added over more than one week draws a category
// per week. Title and Kind put the list's rows in categories: a letter for
// Title, a kind for Kind. A folder is a row
// like a document: its own title and the day it was made sort it, not what
// it holds; under Kind, folders are a kind of their own. Read only: nothing
// here writes a document, a folder, or an order.

// What a document is, by what it was made from.
export type DocumentKind =
  | "pdf"
  | "page"
  | "word"
  | "markdown"
  | "slides"
  | "sheets"
  | "media"
  | "handwritten"
  | "blank"
  | "generated"
  | "text";

// A row's kind under Sort by Kind: a folder, or what a document was made from.
export type RowKind = "folder" | DocumentKind;

// The kinds in the order Sort by Kind lists them: folders first.
export const ROW_KINDS: RowKind[] = [
  "folder",
  "pdf",
  "page",
  "word",
  "markdown",
  "slides",
  "sheets",
  "media",
  "handwritten",
  "blank",
  "generated",
  "text",
];

// edited: the rows newest edit first, folders among the documents, with no
// categories; the default. added: the list as it was before sorts existed —
// folders by title, then documents oldest first — and, over more than one
// week, every row oldest first in a category per week (Week added and Month
// added were two more sorts until 2026-10-07; a browser that kept either
// lists by Added).
export type DocumentSort = "edited" | "added" | "title" | "kind";
export const DOCUMENT_SORTS: DocumentSort[] = ["edited", "added", "title", "kind"];
// The categories a list can draw: Title's, Kind's, and Added's weeks.
export type CategorySort = "title" | "kind" | "week";

// One row of a list: a folder or a document. addedAt: when the folder was
// made or the document added (DocumentFolder.createdAt, Document.createdAt).
// editedAt: the row's last edit — a document's from documentEditedAt, a
// folder's the newest of the documents in it, at any depth, else the day it
// was made.
export type SortRow = { id: string; title: string; kind: RowKind; addedAt: string; editedAt: string };

export type RowCategory<T> = { key: string; title: string; rows: T[] };

const time = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
};

function collatorFor(lang: string): Intl.Collator {
  // Titles sort as a reader expects: "Chapter 2" before "Chapter 10", case aside.
  return new Intl.Collator(lang === "zh" ? "zh-CN" : "en-US", { numeric: true, sensitivity: "base" });
}

/** Monday of the week, at midnight, local time. */
function weekStart(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** A document's last edit in a project: the newest of its rich text's last
    save (a blank document or an import), the last change to a note or an
    annotation of the project written in it or quoting it, and the day it
    was added. */
export function documentEditedAt(addedAt: string, edits: (string | null | undefined)[]): string {
  let newest = addedAt;
  for (const at of edits) if (at && time(at) > time(newest)) newest = at;
  return newest;
}

/** A list's rows newest edit first, for Last edited. Ties keep the list's
    own order. */
export function sortByEdited<T extends SortRow>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => time(b.row.editedAt) - time(a.row.editedAt) || a.index - b.index)
    .map(({ row }) => row);
}

/** Whether a list's rows were added over more than one week: Added then
    draws its weeks. */
export function spansWeeks(rows: SortRow[]): boolean {
  const weeks = new Set(rows.map((row) => weekStart(time(row.addedAt)).getTime()));
  return weeks.size > 1;
}

/** A list's rows in categories, for Title, Kind, and Added over weeks.
    `rows` come in the list's own order (folders by title, then documents in the order they
    were added); ties keep it.
    - Title: rows A to Z, in a category per first letter or digit; # for
      any other first mark, No title last.
    - Kind: Folder first, then each kind of document; a category keeps the
      list's own order.
    - Week: oldest first, the rows in a category oldest first, as Added
      lists them. */
export function categorizeRows<T extends SortRow>(
  rows: T[],
  sort: CategorySort,
  lang: string,
  labels: { kind: (kind: RowKind) => string; untitled: string; weekOf: (date: string) => string },
): RowCategory<T>[] {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const collator = collatorFor(lang);
  const byKey = new Map<string, RowCategory<T>>();
  const add = (key: string, title: string, row: T) => {
    const category = byKey.get(key);
    if (category) category.rows.push(row);
    else byKey.set(key, { key, title, rows: [row] });
  };
  const indexed = rows.map((row, index) => ({ row, index }));

  if (sort === "kind") {
    for (const row of rows) add(row.kind, labels.kind(row.kind), row);
    return ROW_KINDS.flatMap((kind) => byKey.get(kind) ?? []);
  }
  if (sort === "title") {
    indexed.sort((a, b) => collator.compare(a.row.title, b.row.title) || a.index - b.index);
    for (const { row } of indexed) {
      const first = row.title.trim()[0]?.toLocaleUpperCase(locale) ?? "";
      if (!first) add("", labels.untitled, row);
      else if (/[\p{L}\p{N}]/u.test(first)) add(first, first, row);
      else add("#", "#", row);
    }
    return [...byKey.values()].sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : collator.compare(a.key, b.key)));
  }
  indexed.sort((a, b) => time(a.row.addedAt) - time(b.row.addedAt) || a.index - b.index);
  for (const { row } of indexed) {
    const start = weekStart(time(row.addedAt));
    add(
      start.toISOString(),
      labels.weekOf(start.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })),
      row,
    );
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
