import type { NoteView, SectionView } from "@/lib/types";
import { noteTitle } from "@/lib/note-title";
import { clipWords, markdownPreview } from "@/lib/markdown-preview";

// The project's notes on the graph (SPEC.md §13): which documents each note
// belongs to, and which pairs of documents a note joins. A note belongs to a
// document when it was written in it or quotes it (noteInDocument); a note
// that quotes two documents joins them, so the graph draws it as a
// connection. Pure: the workspace already holds every visible note with its
// sources' documents, so nothing is read from the server.

export type GraphNote = {
  note: NoteView;
  sectionId: string;
  sectionTitle: string;
  /** The documents of the graph the note belongs to: its own document, then
      each source's, in order, without repeats. */
  documentIds: string[];
};

export type DocumentNotes = { accepted: number; pending: number; notes: GraphNote[] };

export type NotesOnGraph = {
  /** Every note that belongs to a document of the graph, newest edit first. */
  notes: GraphNote[];
  byDocument: Map<string, DocumentNotes>;
  /** The notes that belong to both documents of a pair, by pairKey. */
  byPair: Map<string, GraphNote[]>;
  /** The notes of the project that belong to no document of the graph (no
      document of their own, no source in one): a saved Stitch answer with
      no quote, a note written on the notes full page. Newest edit first. */
  projectNotes: GraphNote[];
};

/** One key per undirected pair, the same as a graph edge's id ("a|b", sorted). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The row a note shows in a list: its title, else its gist, else its first words. */
export function noteLine(note: NoteView): string {
  return noteTitle(note.content) || note.gist || clipWords(markdownPreview(note.content), 90);
}

/** The project's notes on the graph's documents. sectionId: only the notes of
    that section and its subsections; null = every section. The sections are
    the outline's (the hidden Annotations section is never among them). */
export function notesOnGraph(
  sections: SectionView[],
  nodeIds: Iterable<string>,
  sectionId: string | null = null,
): NotesOnGraph {
  const nodes = new Set(nodeIds);
  const notes: GraphNote[] = [];
  const projectNotes: GraphNote[] = [];
  const walk = (list: SectionView[], inFilter: boolean, parentTitle: string | null) => {
    for (const s of list) {
      const on = inFilter || sectionId === null || s.id === sectionId;
      const title = parentTitle ? `${parentTitle} / ${s.title}` : s.title;
      if (on) {
        for (const note of s.notes) {
          const ids: string[] = [];
          for (const id of [note.documentId, ...note.sources.map((src) => src.documentId)]) {
            if (id && nodes.has(id) && !ids.includes(id)) ids.push(id);
          }
          const g = { note, sectionId: s.id, sectionTitle: title, documentIds: ids };
          if (ids.length > 0) notes.push(g);
          else projectNotes.push(g);
        }
      }
      walk(s.children, on, title);
    }
  };
  walk(sections, false, null);
  notes.sort((x, y) => Date.parse(y.note.updatedAt) - Date.parse(x.note.updatedAt));
  projectNotes.sort((x, y) => Date.parse(y.note.updatedAt) - Date.parse(x.note.updatedAt));

  const byDocument = new Map<string, DocumentNotes>();
  const byPair = new Map<string, GraphNote[]>();
  for (const g of notes) {
    for (const id of g.documentIds) {
      const entry = byDocument.get(id) ?? { accepted: 0, pending: 0, notes: [] };
      if (g.note.status === "PENDING") entry.pending++;
      else entry.accepted++;
      entry.notes.push(g);
      byDocument.set(id, entry);
    }
    for (let i = 0; i < g.documentIds.length; i++) {
      for (let j = i + 1; j < g.documentIds.length; j++) {
        const key = pairKey(g.documentIds[i], g.documentIds[j]);
        const list = byPair.get(key) ?? [];
        list.push(g);
        byPair.set(key, list);
      }
    }
  }
  return { notes, byDocument, byPair, projectNotes };
}

type LinkEnds = {
  fromDocumentId: string;
  toDocumentId: string;
  quotedText: string;
  toQuotedText: string | null;
  fromBlockText: string | null;
  toBlockText: string | null;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Whether a quote sits on a link's end: in its document, and the end's
    quote holds it or it holds the end's quote, or it lies in the end's
    block. A document-level end (no quote) takes any quote of its document. */
function onEnd(
  source: { documentId: string; quotedText: string },
  documentId: string,
  quote: string | null,
  blockText: string | null,
): boolean {
  if (source.documentId !== documentId) return false;
  if (quote === null) return true;
  const mine = squash(source.quotedText);
  const theirs = squash(quote);
  if (!mine || !theirs) return false;
  return mine.includes(theirs) || theirs.includes(mine) || (blockText !== null && squash(blockText).includes(mine));
}

/** The notes on a link (WALK3-03): the notes that quote a passage at each of
    its two ends — what Note on this link writes, and an older note that
    quotes the same two passages. Newest edit first, as `notes` comes. */
export function notesOnLink(notes: GraphNote[], link: LinkEnds): GraphNote[] {
  return notes.filter((g) => {
    const sources = g.note.sources;
    const from = sources.some((s) => onEnd(s, link.fromDocumentId, link.quotedText, link.fromBlockText));
    const to = sources.some((s) => onEnd(s, link.toDocumentId, link.toQuotedText, link.toBlockText));
    return from && to;
  });
}
