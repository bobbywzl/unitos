// A text block's format kind (the value `PATCH /api/blocks/[blockId]` takes as
// `kind`), read from its stored type, html, and text. The server records it
// as the FORMAT edit's `before`; the client reads it to undo a format change.
export type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "list" | "numbered";

export function blockKind(type: string, html: string | null, text: string): BlockKind {
  if (type === "LIST") return /^\s*\d{1,3}[.)]\s/.test(text) ? "numbered" : "list";
  if (type !== "HEADING") return "paragraph";
  const m = html?.match(/^<h([1-3])/);
  return m ? (`h${m[1]}` as BlockKind) : "h2";
}

/** A block's format as the PATCH route restores it: a text block's kind,
    or code. Undo of a code block's format change sends "code". */
export type FormatKind = BlockKind | "code";

export function formatKind(type: string, html: string | null, text: string): FormatKind {
  return type === "CODE" ? "code" : blockKind(type, html, text);
}

// List markers live in a LIST block's text ("- " / "N. ", two spaces per
// level of nesting — the parser's convention). A conversion rewrites them,
// as the reader's edit toolbar does (components/reader/reader.tsx).

/** The text without its list markers. */
export function stripListMarkers(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^(\s*)(?:-|\d{1,3}[.)])\s+/, "$1"))
    .join("\n");
}

/** The text as list lines of `kind`: every line its marker, numbered per
    level; an empty text its first marker. */
export function withListMarkers(text: string, kind: "list" | "numbered"): string {
  const counters: number[] = [];
  if (!text.trim()) return kind === "list" ? "- " : "1. ";
  return stripListMarkers(text)
    .split("\n")
    .map((line) => {
      const indent = /^\s*/.exec(line)![0];
      const body = line.slice(indent.length);
      if (!body) return line;
      if (kind === "list") return `${indent}- ${body}`;
      const depth = Math.floor(indent.length / 2);
      counters.length = depth + 1;
      counters[depth] = (counters[depth] ?? 0) + 1;
      return `${indent}${counters[depth]}. ${body}`;
    })
    .join("\n");
}
