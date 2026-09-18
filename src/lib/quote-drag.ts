import type { SourceInput } from "@/lib/anchors/input";

// A quote dragged from the reader into a note (SPEC.md §6): a highlighted
// passage, or a whole block by its bookmark. The drag carries the passage's
// anchor — the block, the offsets, and the quote selectors, one segment per
// block it crosses — so the note it lands in gets the same source a highlight
// added with Add to notes gets, and its quote points back to the reader.
// The payload rides the drag's own data under one type, so a drag carrying
// files or links is told from it, and a drop anywhere else ignores it.

export const QUOTE_DRAG_TYPE = "application/x-unitos-quote";

export type QuoteDrag = {
  /** The anchor: the first segment, with the document. */
  source: SourceInput;
  /** Every segment of a passage over several blocks; unset for one block. */
  segments?: SourceInput[];
  /** The quoted text, one paragraph per segment. */
  text: string;
};

export function writeQuoteDrag(dt: DataTransfer, drag: QuoteDrag): void {
  dt.setData(QUOTE_DRAG_TYPE, JSON.stringify(drag));
  // The plain text too: a drop outside the app pastes the quote.
  dt.setData("text/plain", drag.text);
  dt.effectAllowed = "copy";
}

export function hasQuoteDrag(dt: DataTransfer | null): boolean {
  return dt?.types.includes(QUOTE_DRAG_TYPE) ?? false;
}

export function readQuoteDrag(dt: DataTransfer | null): QuoteDrag | null {
  const raw = dt?.getData(QUOTE_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as QuoteDrag;
    if (!parsed || typeof parsed.text !== "string" || !parsed.source?.blockId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The quote as note markdown: blockquote lines, a bare ">" between the
    paragraphs of a passage over several blocks (reader-interactions.tsx
    writes Add to notes the same way). */
export function quoteMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

// The picture under the pointer while a quote drags: a small card with the
// quote glyph and the first words, in place of the browser's ghost of the
// selection. Built once per drag, removed after the browser has copied it.
export function setQuoteDragImage(dt: DataTransfer, text: string): void {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:fixed;top:-1000px;left:-1000px;max-width:240px;padding:6px 10px;border-radius:12px;" +
    "background:var(--card, #fff);box-shadow:0 6px 24px rgba(0,0,0,.14);font:600 12px/1.3 system-ui,sans-serif;" +
    "color:var(--sand-800, #333);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;";
  const words = text.replace(/\s+/g, " ").trim();
  el.textContent = `❝ ${words.length > 48 ? `${words.slice(0, 47)}…` : words}`;
  document.body.appendChild(el);
  dt.setDragImage(el, 12, 14);
  setTimeout(() => el.remove(), 0);
}
