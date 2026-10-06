// Sort by in the document list (SPEC.md §6). One choice orders every list —
// the project itself and each folder's own list — and a sort other than
// Added puts the list's rows in categories: a letter for Title, a kind for
// Kind, a week or a month for Week added and Month added. A folder is a row
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

// added: the list as it has always been — folders by title, then documents
// oldest first — with no categories.
export type DocumentSort = "added" | "title" | "kind" | "week" | "month";
export const DOCUMENT_SORTS: DocumentSort[] = ["added", "title", "kind", "week", "month"];

// One row of a list: a folder or a document. addedAt: when the folder was
// made or the document added (DocumentFolder.createdAt, Document.createdAt).
export type SortRow = { id: string; title: string; kind: RowKind; addedAt: string };

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

/** A list's rows in categories, for every sort but Added. `rows` come in the
    list's own order (folders by title, then documents in the order they
    were added); ties keep it.
    - Title: rows A to Z, in a category per first letter or digit; # for
      any other first mark, No title last.
    - Kind: Folder first, then each kind of document; a category keeps the
      list's own order.
    - Week added, Month added: oldest first, the rows in a category oldest
      first, as Added lists them: every date order runs one way. */
export function categorizeRows<T extends SortRow>(
  rows: T[],
  sort: Exclude<DocumentSort, "added">,
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
    const d = new Date(time(row.addedAt));
    if (sort === "week") {
      const start = weekStart(d.getTime());
      add(
        start.toISOString(),
        labels.weekOf(start.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })),
        row,
      );
    } else {
      add(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        d.toLocaleDateString(locale, { year: "numeric", month: "long" }),
        row,
      );
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
