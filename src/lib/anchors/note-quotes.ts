import { z } from "zod";
import { db } from "@/lib/db";
import { documentBlocks, resolveAnchor, type ResolvedAnchor } from "@/lib/anchors/resolve";
import { MAX_NOTE_QUOTES } from "@/lib/anchors/note-quotes-limit";

// The quotes of a note gathered on the graph (SPEC.md §13, Add to note;
// VIEW4-03): passages from one or more documents of the section's project,
// each sent with what the graph knows of it — its document, its block when
// known, its words. Each resolves through the anchor ladder (SPEC.md §5):
// the block and the words in it, else the words anywhere in the document.
// A quote with no words quotes its block's words; a heading's quote takes
// the paragraph after it, so a part's quote is the part's opening words.

export { MAX_NOTE_QUOTES };

export const noteQuoteSchema = z.object({
  documentId: z.string().min(1).max(64),
  blockId: z.string().min(1).max(100).optional(),
  quotedText: z.string().min(1).max(10_000).optional(),
  startOffset: z.number().int().min(0).optional(),
  endOffset: z.number().int().min(0).optional(),
  prefix: z.string().max(64).optional(),
  suffix: z.string().max(64).optional(),
}).refine((q) => q.blockId !== undefined || q.quotedText !== undefined, { message: "A quote needs a block or words" });

export type NoteQuoteInput = z.infer<typeof noteQuoteSchema>;
export type NoteQuoteSource = ResolvedAnchor & { documentId: string; layer: null };

/** The quotes' sources, in the order sent; or the first quote that does not
    resolve; or notInProject when a quote's document is not attached to the
    project (no write reaches another project's document). */
export async function resolveNoteQuotes(
  notebookId: string,
  quotes: NoteQuoteInput[],
): Promise<{ sources: NoteQuoteSource[] } | { unresolved: number } | { notInProject: true }> {
  const docIds = [...new Set(quotes.map((q) => q.documentId))];
  const attached = await db.notebookDocument.count({ where: { notebookId, documentId: { in: docIds } } });
  if (attached < docIds.length) return { notInProject: true };
  const blocksOf = new Map(await Promise.all(docIds.map(async (id) => [id, await documentBlocks(id)] as const)));
  const sources: NoteQuoteSource[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const resolved = resolveQuote(blocksOf.get(q.documentId) ?? [], q);
    if (!resolved) return { unresolved: i };
    // The same words twice are one source.
    const key = `${q.documentId}:${resolved.blockId}:${resolved.startOffset}:${resolved.endOffset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ ...resolved, documentId: q.documentId, layer: null });
  }
  return { sources };
}

/** One quote of a gathered note, as the note keeps it: a source, or, for a
    quote that no longer resolves or whose document left the project, its
    words as plain quoted text with no source (REV5-06). */
export type KeptNoteQuote = { source: NoteQuoteSource } | { text: string };

/** The quotes of a gathered note replayed from the offline queue (REV5-06):
    every quote that resolves is a source, in the order sent; every other
    quote keeps its words as text, so the note saves and no typed word is
    dropped. `kept` counts the quotes kept as text (a quote with no words
    that does not resolve has nothing to keep and is counted too). */
export async function resolveNoteQuotesKeeping(
  notebookId: string,
  quotes: NoteQuoteInput[],
): Promise<{ items: KeptNoteQuote[]; kept: number }> {
  const docIds = [...new Set(quotes.map((q) => q.documentId))];
  const attached = new Set(
    (await db.notebookDocument.findMany({ where: { notebookId, documentId: { in: docIds } }, select: { documentId: true } })).map(
      (d) => d.documentId,
    ),
  );
  const blocksOf = new Map(
    await Promise.all([...attached].map(async (id) => [id, await documentBlocks(id)] as const)),
  );
  const items: KeptNoteQuote[] = [];
  const seen = new Set<string>();
  let kept = 0;
  for (const q of quotes) {
    const resolved = attached.has(q.documentId) ? resolveQuote(blocksOf.get(q.documentId) ?? [], q) : null;
    if (!resolved) {
      kept++;
      const text = q.quotedText?.trim();
      if (text) items.push({ text });
      continue;
    }
    const key = `${q.documentId}:${resolved.blockId}:${resolved.startOffset}:${resolved.endOffset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ source: { ...resolved, documentId: q.documentId, layer: null } });
  }
  return { items, kept };
}

function resolveQuote(blocks: { id: string; text: string; type: string }[], q: NoteQuoteInput): ResolvedAnchor | null {
  return q.quotedText === undefined
    ? wholeBlock(blocks, q.blockId ?? "")
    : resolveAnchor(blocks, {
        blockId: q.blockId ?? "",
        startOffset: q.startOffset ?? 0,
        endOffset: q.endOffset ?? 0,
        quotedText: q.quotedText.trim(),
        prefix: q.prefix,
        suffix: q.suffix,
      });
}

// A whole-block quote keeps the block's opening words, cut at a sentence end
// (else a space) inside this many characters.
const WHOLE_MAX = 400;

function wholeBlock(blocks: { id: string; text: string; type: string }[], blockId: string): ResolvedAnchor | null {
  const at = blocks.findIndex((b) => b.id === blockId);
  if (at < 0) return null;
  let block = blocks[at];
  if (block.type === "HEADING") {
    const next = blocks.slice(at + 1).find((b) => b.text.trim() !== "");
    if (next && next.type !== "HEADING") block = next;
  }
  const text = block.text;
  if (!text.trim()) return null;
  let end = text.length;
  if (end > WHOLE_MAX) {
    const head = text.slice(0, WHOLE_MAX);
    const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("。"), head.lastIndexOf("? "), head.lastIndexOf("! "));
    const space = head.lastIndexOf(" ");
    end = sentence > WHOLE_MAX / 3 ? sentence + 1 : space > WHOLE_MAX / 3 ? space : WHOLE_MAX;
  }
  return resolveAnchor(blocks, { blockId: block.id, startOffset: 0, endOffset: end });
}
