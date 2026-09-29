import { db } from "@/lib/db";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

// What a block of a document without rich text takes (SPEC.md §7): every
// edit that cannot corrupt the document. The plan (lib/assistant/plan.ts)
// and the block routes (app/api/blocks) read this one rule, so what the plan
// card offers is what the routes do.
//
// Words change in a text block, in a transcript line, and in a slide's, a
// sheet's, or a table's replica, as the replica takes them: a converted
// table (a handwritten document's TABLE) has its html written anew from its
// text, and any other table keeps its html and its rows and columns
// (lib/replica.ts). A format changes in a paragraph, a heading, a list, or
// code; a page, a transcript line, or an equation never turns into another
// kind. A text block, a transcript line, a line, a converted table, or a
// page while another page stays may go: the restore route brings each back
// whole (Convert again writes its text after
// the last page's order, lib/handwritten/convert.ts, so a page gone leaves
// no text among the pages). A style or a web link goes on a text block's
// words and on a transcript line's. Two transcript lines next to each other
// join, and one splits, their times following their words
// (lib/transcript-lines.ts). Nothing changes a video's player or a figure,
// or a table's, a slide's, or a sheet's kind. A sheets document keeps its sheet names (the
// HEADING before each sheet). A slides, sheets, or media document takes no
// new block, and no block moves in one; in a handwritten document a new
// block goes after the last page.

/** A document's format (Document.format: slides, sheets, or null), whether
    it is a video's or an audio's (a VIDEO or TRANSCRIPT block), and how
    many pages it holds (PAGE blocks, a handwritten document's). */
export type DocumentShape = { format: string | null; media: boolean; pages: number };

export const TEXT_BLOCKS: ReadonlySet<string> = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);
// A slide's, a sheet's, and a table's words change in their replica, line
// by line and cell by cell (lib/replica.ts).
const WORDS = new Set([...TEXT_BLOCKS, "TRANSCRIPT", "SLIDE", "SHEET", "TABLE"]);
// A slide and a sheet stay: their words change, the deck and the workbook keep their shape.
const REMOVABLE = new Set([...TEXT_BLOCKS, "TRANSCRIPT", "SEPARATOR"]);
const FORMATS = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE"]);
// Blocks that hold their place: none moves, and none goes before the first.
const FIXED = new Set(["PAGE", "VIDEO", "TRANSCRIPT", "SLIDE", "SHEET"]);

const sheetName = (type: string, doc: DocumentShape) => doc.format === "sheets" && type === "HEADING";
// A handwritten document's table is the conversion's: its html is its text drawn.
const convertedTable = (type: string, doc: DocumentShape) => type === "TABLE" && doc.pages > 0;
const addsBlocks = (doc: DocumentShape) => !doc.format && !doc.media;

export const blockTakes = {
  words: (type: string, doc: DocumentShape) => WORDS.has(type) && !sheetName(type, doc),
  kind: (type: string, doc: DocumentShape) => FORMATS.has(type) && !sheetName(type, doc),
  // A handwritten document keeps a page: the one left is its last.
  removal: (type: string, doc: DocumentShape) =>
    type === "PAGE" ? doc.pages > 1 : (REMOVABLE.has(type) && !sheetName(type, doc)) || convertedTable(type, doc),
  style: (type: string) => TEXT_BLOCKS.has(type) || type === "TRANSCRIPT",
  /** A new block after one of `type`, followed by one of `next`. */
  after: (type: string, next: string | undefined, doc: DocumentShape) => addsBlocks(doc) && !(type === "PAGE" && next === "PAGE"),
  /** A new block at the document's start, before one of `first`. */
  start: (first: string | undefined, doc: DocumentShape) => addsBlocks(doc) && !FIXED.has(first ?? ""),
  move: (type: string, doc: DocumentShape) => addsBlocks(doc) && !FIXED.has(type),
};

/** A slide's new words keep its lines: the same newlines and tabs, in the
    same order (lib/replica.ts has the last word, against the replica). */
export const keepsLines = (prev: string, next: string): boolean => prev.replace(/[^\n\t]/g, "") === next.replace(/[^\n\t]/g, "");

/** The plan's warning for an edit the routes refuse, with the route's reason. */
export function skippedWarning(t: TFunc, reason: TKey, description: string): string {
  const why = t(reason);
  return t("api.warnSkipped", { reason: why.charAt(0).toLowerCase() + why.slice(1), description });
}

/** A web link's address: http, https, or mailto. */
export const isWebAddress = (href: string): boolean => /^(https?:\/\/|mailto:)\S+$/i.test(href.trim());

/** The shape of a stored document. */
export async function documentShape(documentId: string): Promise<DocumentShape> {
  const [document, media, pages] = await Promise.all([
    db.document.findUnique({ where: { id: documentId }, select: { format: true } }),
    db.block.findFirst({ where: { documentId, type: { in: ["VIDEO", "TRANSCRIPT"] } }, select: { id: true } }),
    db.block.count({ where: { documentId, type: "PAGE" } }),
  ]);
  return { format: document?.format ?? null, media: media !== null, pages };
}
