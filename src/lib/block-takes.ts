import { db } from "@/lib/db";

// What a block of a document without rich text takes (SPEC.md §7): every
// edit that cannot corrupt the document. The plan (lib/assistant/plan.ts)
// and the block routes (app/api/blocks) read this one rule, so what the plan
// card offers is what the routes do.
//
// Words change in a text block, in a transcript line, and in a slide's or a
// sheet's replica, its lines and its grid kept (lib/replica.ts). A format changes
// in a paragraph, a heading, a list, or code; a page, a transcript line, or
// an equation never turns into another kind. A text block, a transcript
// line, or a line may go: the restore route brings each back whole. A page
// stays: Convert again writes the text after as many orders as there are
// pages (lib/handwritten/convert.ts), so a page gone would put text among
// the pages. A style or a web link goes on a text block's words. Nothing
// changes a video's player, a table, or a figure, or a slide's or a sheet's kind. A
// sheets document keeps its sheet names (the HEADING before each sheet). A
// slides, sheets, or media document takes no new block, and no block moves
// in one; in a handwritten document a new block goes after the last page.

/** A document's format (Document.format: slides, sheets, or null), and
    whether it is a video's or an audio's (a VIDEO or TRANSCRIPT block). */
export type DocumentShape = { format: string | null; media: boolean };

export const TEXT_BLOCKS: ReadonlySet<string> = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);
// A slide's and a sheet's words change in their replica, line by line and
// cell by cell (lib/replica.ts).
const WORDS = new Set([...TEXT_BLOCKS, "TRANSCRIPT", "SLIDE", "SHEET"]);
const REMOVABLE = new Set([...WORDS, "SEPARATOR"]);
const FORMATS = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE"]);
// Blocks that hold their place: none moves, and none goes before the first.
const FIXED = new Set(["PAGE", "VIDEO", "TRANSCRIPT", "SLIDE", "SHEET"]);

const sheetName = (type: string, doc: DocumentShape) => doc.format === "sheets" && type === "HEADING";
const addsBlocks = (doc: DocumentShape) => !doc.format && !doc.media;

export const blockTakes = {
  words: (type: string, doc: DocumentShape) => WORDS.has(type) && !sheetName(type, doc),
  kind: (type: string, doc: DocumentShape) => FORMATS.has(type) && !sheetName(type, doc),
  removal: (type: string, doc: DocumentShape) => REMOVABLE.has(type) && !sheetName(type, doc),
  style: (type: string) => TEXT_BLOCKS.has(type),
  /** A new block after one of `type`, followed by one of `next`. */
  after: (type: string, next: string | undefined, doc: DocumentShape) => addsBlocks(doc) && !(type === "PAGE" && next === "PAGE"),
  /** A new block at the document's start, before one of `first`. */
  start: (first: string | undefined, doc: DocumentShape) => addsBlocks(doc) && !FIXED.has(first ?? ""),
  move: (type: string, doc: DocumentShape) => addsBlocks(doc) && !FIXED.has(type),
};

/** A web link's address: http, https, or mailto. */
export const isWebAddress = (href: string): boolean => /^(https?:\/\/|mailto:)\S+$/i.test(href.trim());

/** The shape of a stored document. */
export async function documentShape(documentId: string): Promise<DocumentShape> {
  const [document, media] = await Promise.all([
    db.document.findUnique({ where: { id: documentId }, select: { format: true } }),
    db.block.findFirst({ where: { documentId, type: { in: ["VIDEO", "TRANSCRIPT"] } }, select: { id: true } }),
  ]);
  return { format: document?.format ?? null, media: media !== null };
}
