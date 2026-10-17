"use client";

import Link from "next/link";
import type { LinkIn, LinkOut, SectionView } from "@/lib/types";
import type { NoteView } from "@/lib/types";
import { noteLine } from "@/lib/graph/notes";
import { NotesIcon, PageIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// Two pieces of the reader's Annotations tab around links (SPEC.md §13).
// LinkCardNotes: under a link's card, the notes on the link (WALK4-05), each
// a row that shows it in the notes tray. ProvenanceRows: a generated
// document's provenance links, one row per document with its passage count,
// which opens the other document (WALK4-03); they are the generated
// document's, not the reader's links, so they carry no Describe and no
// Remove and the tab's count leaves them out. Nothing is removed from the
// database: the links stay, and the generated page still clicks back to
// each source.

function findNote(sections: SectionView[], id: string): NoteView | null {
  for (const s of sections) {
    const hit = s.notes.find((n) => n.id === id) ?? findNote(s.children, id);
    if (hit) return hit;
  }
  return null;
}

export function LinkCardNotes({ noteIds, sections }: { noteIds: string[] | undefined; sections: SectionView[] }) {
  const t = useT();
  const notes = (noteIds ?? []).flatMap((id) => findNote(sections, id) ?? []);
  if (notes.length === 0) return null;
  return (
    <div data-annotation-link-notes={notes.length} className="mt-2 flex flex-col gap-0.5 border-t border-line pt-1.5">
      <p className="text-[11px] font-bold tracking-[0.06em] text-sage-700 uppercase">
        {notes.length === 1 ? t("graphNotes.linkNotesOne") : t("graphNotes.linkNotesMany", { n: notes.length })}
      </p>
      {notes.map((n) => (
        <button
          key={n.id}
          onClick={() => window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: n.id } }))}
          data-track="annotation-link-note"
          data-annotation-link-note={n.id}
          data-tip={t("graphCover.linkNoteShow")}
          className="flex items-start gap-1.5 rounded-lg px-1 py-0.5 text-left text-[12.5px] leading-snug text-ink hover:bg-sage-100/60"
        >
          <NotesIcon size={11} className="mt-[3px] shrink-0 text-sage-700" />
          <span className="min-w-0 flex-1">{noteLine(n)}</span>
        </button>
      ))}
    </div>
  );
}

export function ProvenanceRows({
  notebookId,
  linksOut,
  linksIn,
  card,
}: {
  notebookId: string;
  linksOut: LinkOut[];
  linksIn: LinkIn[];
  /** The tab's card class. */
  card: string;
}) {
  const t = useT();
  const groups = new Map<string, { title: string; n: number; used: boolean }>();
  for (const l of linksIn) {
    if (!l.provenance || l.recommended) continue;
    const g = groups.get(l.fromDocumentId) ?? { title: l.fromTitle, n: 0, used: true };
    g.n++;
    groups.set(l.fromDocumentId, g);
  }
  for (const l of linksOut) {
    if (!l.provenance || l.recommended || l.detached) continue;
    const g = groups.get(l.toDocumentId) ?? { title: l.toTitle, n: 0, used: false };
    g.n++;
    groups.set(l.toDocumentId, g);
  }
  if (groups.size === 0) return null;
  return (
    <div data-annotation-provenance={groups.size} className="flex flex-col gap-1.5">
      {[...groups.entries()].map(([id, g]) => (
        <Link
          key={id}
          href={`/n/${notebookId}?doc=${id}`}
          data-track="annotation-provenance-open"
          data-annotation-provenance-row={id}
          data-tip={t("graphCover.provenanceTitle")}
          className={`${card} flex items-center gap-2 text-[12.5px] text-sand-700 hover:text-clay-800`}
          style={{ borderColor: "var(--sand-300)" }}
        >
          <PageIcon size={12} className="shrink-0 text-sand-500" />
          <span className="min-w-0 flex-1 truncate font-semibold">
            {t(g.used ? "graphCover.provenanceUsedBy" : "graphCover.provenanceFrom", { title: g.title })}
          </span>
          <span className="shrink-0 text-[11px] text-sand-500">
            {t("graphCover.provenancePassages", { n: g.n, s: g.n === 1 ? "" : "s" })}
          </span>
        </Link>
      ))}
    </div>
  );
}
