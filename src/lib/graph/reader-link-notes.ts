import type { LinkIn, LinkOut, SectionView } from "@/lib/types";
import { notesOnGraph, notesOnLink, pairKey } from "@/lib/graph/notes";

// The notes on each link of the open document, for the reader (SPEC.md §13,
// WALK4-05): the notes that quote a passage at each of the link's two ends,
// the same rule as the graph's link panel (notesOnLink). The Annotations
// tab's link card lists them; the chain icon's tip counts them. Pure: the
// page already holds every note of the outline with its sources.

type PaneLinks = {
  document: { id: string };
  linksOut: LinkOut[];
  linksIn: LinkIn[];
  linksByBlock: Record<string, { linkId: string; notes?: number }[]>;
};

/** Each link's note ids, newest edit first; links with none are absent. */
export function readerLinkNotes(
  sections: SectionView[],
  documentId: string,
  documentIds: string[],
  linksOut: LinkOut[],
  linksIn: LinkIn[],
): Map<string, string[]> {
  const view = notesOnGraph(sections, documentIds);
  const near = (a: string, b: string) => (a === b ? (view.byDocument.get(a)?.notes ?? []) : (view.byPair.get(pairKey(a, b)) ?? []));
  const out = new Map<string, string[]>();
  const put = (id: string, ids: string[]) => {
    if (ids.length > 0) out.set(id, ids);
  };
  for (const l of linksOut) {
    if (l.recommended || l.provenance) continue;
    const ends = { fromDocumentId: documentId, toDocumentId: l.toDocumentId, quotedText: l.quotedText, toQuotedText: l.targetQuotedText, fromBlockText: null, toBlockText: null };
    put(l.id, notesOnLink(near(documentId, l.toDocumentId), ends).map((g) => g.note.id));
  }
  for (const l of linksIn) {
    if (l.recommended || l.provenance) continue;
    const ends = { fromDocumentId: l.fromDocumentId, toDocumentId: documentId, quotedText: l.quotedText, toQuotedText: l.hereQuotedText, fromBlockText: null, toBlockText: null };
    put(l.id, notesOnLink(near(l.fromDocumentId, documentId), ends).map((g) => g.note.id));
  }
  return out;
}

/** Writes each link's notes onto the pane: noteIds on the Annotations tab's
    links, the count on the chain icon's mark. */
export function withReaderLinkNotes(pane: PaneLinks, sections: SectionView[], documentIds: string[]): void {
  const notes = readerLinkNotes(sections, pane.document.id, documentIds, pane.linksOut, pane.linksIn);
  for (const l of pane.linksOut) l.noteIds = notes.get(l.id) ?? [];
  for (const l of pane.linksIn) l.noteIds = notes.get(l.id) ?? [];
  for (const list of Object.values(pane.linksByBlock)) for (const m of list) m.notes = notes.get(m.linkId)?.length ?? 0;
}
