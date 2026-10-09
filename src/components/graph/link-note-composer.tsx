"use client";

import { ACTION_NOTE } from "./graph-ui";
import { useEffect } from "react";
import type { GraphEdgeLink } from "@/lib/types";
import { DRAFT_KEPT_EVENT, linkNoteDraftKey, readLinkNoteDraft, writeLinkNoteDraft } from "@/lib/note-drafts";
import { useCollab } from "@/components/collab/collab-context";
import { NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useNoteGather, type GatherQuote } from "@/components/graph/note-gather";

// Note on this link (SPEC.md §13): in an expanded link, one press puts the
// link's two passages into the new note docked at the foot of the side list
// (note-gather.tsx, the note Add to note fills), opened with the focus in
// its words box — the one note surface on the graph ([lists9] WALK9-10; a
// box of its own before). The dock's Save sends the two ends as the link's
// own anchors (`POST /api/notes` with `fromLinkId`), so the note quotes both
// ends as before. Words typed in the box of before, kept in the browser for
// the account (lib/note-drafts.ts; a refused offline replay puts words there
// too, keepDroppedWords), go on into the new note when the link opens, with
// the section picked then; the box's key clears once the new note's draft
// holds them (rule zero item 6). Words the queue puts there while the link
// is open go in the same way at once, after the words typed in the new
// note, so the next keystroke writes over nothing (REV9-02).

export type NoteOnLinkLink = Pick<GraphEdgeLink, "id" | "fromDocumentId" | "toDocumentId" | "quotedText" | "toQuotedText">;

/** The link's ends as the new note's quotes, each naming the link; one for a document-level end. */
function linkEnds(link: NoteOnLinkLink): GatherQuote[] {
  return [
    { documentId: link.fromDocumentId, text: link.quotedText, linkId: link.id },
    ...(link.toQuotedText !== null ? [{ documentId: link.toDocumentId, text: link.toQuotedText, linkId: link.id }] : []),
  ];
}

/** The press of Note on this link, or null for a viewer: the link's ends go
    into the new note, which opens with the focus in its words box. Words
    left in the box of before go in with them, once, as the link opens, and
    words the queue puts back while the link is open go in at once. */
export function useNoteOnLink(link: NoteOnLinkLink): (() => void) | null {
  const gather = useNoteGather();
  const { myId } = useCollab();
  const add = gather?.add;
  const { id, fromDocumentId, toDocumentId, quotedText, toQuotedText } = link;
  useEffect(() => {
    if (!add) return;
    const takeUp = () => {
      const draft = readLinkNoteDraft(myId, id);
      if (!draft) return;
      add(linkEnds({ id, fromDocumentId, toDocumentId, quotedText, toQuotedText }), draft);
      writeLinkNoteDraft(myId, id, "", null);
    };
    takeUp();
    // The queue put a dropped Note on this link's words into the link's
    // draft (keepDroppedWords, REV9-02): the new note takes them up now.
    const onKept = (e: Event) => {
      if ((e as CustomEvent<{ key?: unknown }>).detail?.key === linkNoteDraftKey(myId, id)) takeUp();
    };
    window.addEventListener(DRAFT_KEPT_EVENT, onKept);
    return () => window.removeEventListener(DRAFT_KEPT_EVENT, onKept);
  }, [add, myId, id, fromDocumentId, toDocumentId, quotedText, toQuotedText]);
  if (!gather) return null;
  return () => {
    gather.add(linkEnds(link));
    // The words box, once the note is drawn.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[data-graph-note-gather-words]")?.focus());
  };
}

/** Note on this link where no action row holds it (the Recommended links list). */
export function NoteOnLink({ link }: { link: NoteOnLinkLink }) {
  const t = useT();
  const press = useNoteOnLink(link);
  if (!press) return null;
  return (
    <button
      onClick={press}
      data-track="graph-link-note"
      data-tip={t("graphNotes.noteOnLinkTitle")}
      className={`mt-2 ${ACTION_NOTE} self-start`}
    >
      <NotesIcon size={11} />
      {t("graphNotes.noteOnLink")}
    </button>
  );
}
