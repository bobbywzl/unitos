// How the document list orders and groups a project's documents (SPEC.md §6),
// the way the notes tray orders and groups notes. Sort orders the documents
// of every list: the project itself, each folder, each group. Group by Folder
// is the reader's own folders, where documents drag between folders; every
// other grouping is a view: a collapsible row per group, and no document
// moves. Read only: nothing here writes a document, a folder, or an order.

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

// The kinds in the order Group by Kind lists them.
export const DOCUMENT_KINDS: DocumentKind[] = [
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

// added: oldest first, the order the list has always had.
export type DocumentSort = "added" | "added-newest" | "title" | "read";
export const DOCUMENT_SORTS: DocumentSort[] = ["added", "added-newest", "title", "read"];

export type DocumentGrouping = "folder" | "kind" | "week" | "month" | "title";
export const DOCUMENT_GROUPINGS: DocumentGrouping[] = ["folder", "kind", "week", "month", "title"];

// What ordering a document needs. addedAt: when the document was added
// (Document.createdAt); readAt: when this account last read it, or null.
export type OrderedDocument = { id: string; title: string; kind: DocumentKind; addedAt: string; readAt: string | null };

export type DocumentGroup<T> = { key: string; title: string; documents: T[] };

const time = (iso: string | null): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

function collatorFor(lang: string): Intl.Collator {
  // Titles sort as a reader expects: "Chapter 2" before "Chapter 10", case aside.
  return new Intl.Collator(lang === "zh" ? "zh-CN" : "en-US", { numeric: true, sensitivity: "base" });
}

/** The documents in the chosen order. Ties keep the order they came in (the
    order the documents were added), so every sort is stable. Last read puts
    the most recently read first, and documents never read after them, in
    the order they were added. */
export function sortDocuments<T extends OrderedDocument>(documents: T[], sort: DocumentSort, lang: string): T[] {
  const indexed = documents.map((document, index) => ({ document, index }));
  const collator = collatorFor(lang);
  const compare: (a: (typeof indexed)[number], b: (typeof indexed)[number]) => number =
    sort === "added"
      ? (a, b) => time(a.document.addedAt) - time(b.document.addedAt)
      : sort === "added-newest"
        ? (a, b) => time(b.document.addedAt) - time(a.document.addedAt)
        : sort === "title"
          ? (a, b) => collator.compare(a.document.title, b.document.title)
          : (a, b) => time(b.document.readAt) - time(a.document.readAt);
  return indexed.sort((a, b) => compare(a, b) || a.index - b.index).map(({ document }) => document);
}

/** Monday of the week, at midnight, local time. */
function weekStart(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** The documents, already in their sort order, in groups for every grouping
    but Folder. Kinds run in DOCUMENT_KINDS order; titles A to Z, by first
    letter or digit; weeks and months newest first, oldest first when the
    sort is Added, oldest first. Each group keeps the sort order inside. */
export function groupDocuments<T extends OrderedDocument>(
  documents: T[],
  grouping: Exclude<DocumentGrouping, "folder">,
  sort: DocumentSort,
  lang: string,
  labels: { kind: (kind: DocumentKind) => string; untitled: string; weekOf: (date: string) => string },
): DocumentGroup<T>[] {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const byKey = new Map<string, DocumentGroup<T>>();
  const add = (key: string, title: string, document: T) => {
    const group = byKey.get(key);
    if (group) group.documents.push(document);
    else byKey.set(key, { key, title, documents: [document] });
  };
  if (grouping === "kind") {
    for (const document of documents) add(document.kind, labels.kind(document.kind), document);
    return DOCUMENT_KINDS.flatMap((kind) => byKey.get(kind) ?? []);
  }
  if (grouping === "title") {
    const collator = collatorFor(lang);
    for (const document of documents) {
      const first = document.title.trim()[0]?.toLocaleUpperCase(locale) ?? "";
      if (!first) add("", labels.untitled, document);
      else if (/[\p{L}\p{N}]/u.test(first)) add(first, first, document);
      else add("#", "#", document);
    }
    return [...byKey.values()].sort((a, b) =>
      a.key === "" ? 1 : b.key === "" ? -1 : collator.compare(a.key, b.key),
    );
  }
  for (const document of documents) {
    const d = new Date(time(document.addedAt));
    if (grouping === "week") {
      const start = weekStart(d.getTime());
      add(start.toISOString(), labels.weekOf(start.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })), document);
    } else {
      add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, d.toLocaleDateString(locale, { year: "numeric", month: "long" }), document);
    }
  }
  const oldestFirst = sort === "added";
  return [...byKey.values()].sort((a, b) => (oldestFirst ? 1 : -1) * a.key.localeCompare(b.key));
}
