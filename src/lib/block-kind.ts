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
