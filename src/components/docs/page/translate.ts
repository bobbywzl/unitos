import type { RichMark, RichNode } from "@/lib/docs/schema";

// Tools > Translate document (SPEC.md §29): a copy's words replaced by
// their translations. The translations are the Translate bar's (DeepL, the
// route /api/documents/[documentId]/translate): one per row of the copy's
// paragraph index, by block id. A paragraph, a heading, a list line, a table
// cell's paragraph, and a footnote take their translation: its words, a
// line break where it breaks a line, and the marks every word of the
// paragraph shared (a paragraph all in bold stays bold); a mark on some
// words only stays behind, since the words move. A paragraph that holds an
// equation, a chip, or another object keeps its own words, and so does
// code. A figure's caption takes its translation.

const TEXTBLOCKS = new Set(["paragraph", "heading"]);

const same = (a: RichMark, b: RichMark) => JSON.stringify(a) === JSON.stringify(b);

/** The marks every text of `content` carries. */
function sharedMarks(content: RichNode[]): RichMark[] {
  const texts = content.filter((n) => n.type === "text");
  if (texts.length === 0) return [];
  return (texts[0].marks ?? []).filter((m) => texts.every((text) => (text.marks ?? []).some((o) => same(o, m))));
}

/** The words of a translation, its line breaks as the page's. */
function words(text: string, marks: RichMark[]): RichNode[] {
  const out: RichNode[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    if (line) out.push(marks.length > 0 ? { type: "text", text: line, marks } : { type: "text", text: line });
  });
  return out;
}

export type TranslatedCopy = {
  doc: RichNode;
  /** Paragraphs and captions that took their translation. */
  translated: number;
  /** Paragraphs that kept their words: an object stands among them. */
  kept: number;
};

/** `doc` with each block's words replaced by `translations[blockId]`. */
export function translatedCopy(doc: RichNode, translations: Readonly<Record<string, string>>): TranslatedCopy {
  let translated = 0;
  let kept = 0;
  const walk = (node: RichNode): RichNode => {
    const id = typeof node.attrs?.blockId === "string" ? node.attrs.blockId : null;
    const text = id !== null && Object.hasOwn(translations, id) ? translations[id] : undefined;
    if (TEXTBLOCKS.has(node.type) && text !== undefined) {
      const content = node.content ?? [];
      if (content.some((c) => c.type !== "text" && c.type !== "hardBreak")) {
        kept += 1;
        return node;
      }
      translated += 1;
      return { ...node, content: words(text, sharedMarks(content)) };
    }
    if (node.type === "figure" && text) {
      translated += 1;
      // The caption's styles name places in the words it had.
      const attrs: Record<string, unknown> = { ...node.attrs, caption: text };
      delete attrs.captionStyles;
      return { ...node, attrs };
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  return { doc: walk(doc), translated, kept };
}
