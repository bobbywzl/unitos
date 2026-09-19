"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { CommentIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { useMergeTarget, type HandleProps } from "@/components/sortable";
import { splitNote } from "@/lib/note-title";
import { NoteId } from "@/components/outline/note-id";
import { NOTE_ABSORBED_EVENT, type OutlineActions } from "@/components/outline/use-outline";

function AnchorIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3" />
      <path d="M12 22V8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

function TickIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// One tile of a section's board (SPEC.md §6): the note as a tile — its id,
// its title, and its body, whole when the board has the room for it (the
// board sets the tile's height limits, section-board.tsx), else as much as
// fits, fading out at the bottom — so the tiles line up as one board. A tile is in the note's
// draggable mode and nothing else: a hold anywhere picks it up, to reorder it
// or to hold it over another tile and merge the two; a click opens the note
// whole. Editing happens in the opened note, never in the tile.
export function NoteTile({
  note,
  actions,
  handle,
  onOpen,
}: {
  note: NoteView;
  actions: OutlineActions;
  /** The board's drag listeners: with them, a hold anywhere on the tile drags it. */
  handle?: HandleProps;
  /** A click: the note opens whole over the board. */
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const { canEdit, shared, people } = useCollab();
  const parts = splitNote(note.content);
  const pending = note.status === "PENDING";
  const isMergeTarget = useMergeTarget() === note.id && note.status === "ACCEPTED";
  const selectable = note.status === "ACCEPTED" && canEdit;
  const isSelected = actions.selected.has(note.id);
  const author = shared && note.createdById ? people[note.createdById] : undefined;
  const draggable = Boolean(handle) && canEdit;

  // The body is cut: more of it than the tile shows. Only a cut body fades
  // out at the bottom; a body shown whole reads to its last line.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [parts.body]);

  // The tile took other notes in: it blooms once as they land.
  const [absorbed, setAbsorbed] = useState(false);
  useEffect(() => {
    const onAbsorbed = (e: Event) => {
      if ((e as CustomEvent<{ noteId: string }>).detail.noteId === note.id) setAbsorbed(true);
    };
    window.addEventListener(NOTE_ABSORBED_EVENT, onAbsorbed);
    return () => window.removeEventListener(NOTE_ABSORBED_EVENT, onAbsorbed);
  }, [note.id]);
  useEffect(() => {
    if (!absorbed) return;
    const timer = setTimeout(() => setAbsorbed(false), 600);
    return () => clearTimeout(timer);
  }, [absorbed]);

  const surface = [
    "note-tile group/tile relative flex flex-col overflow-hidden rounded-2xl bg-card p-3.5 text-left shadow-soft",
    pending ? "opacity-85" : "",
    isMergeTarget ? "outline-2 outline-sage-500" : isSelected ? "outline-2 outline-clay-300" : "",
    absorbed ? "note-absorb note-merged" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-note-id={note.id}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as Element).closest("button, a")) return;
        onOpen(note.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(note.id);
        }
      }}
      {...(draggable ? (handle?.listeners ?? {}) : {})}
      onDragStart={(e) => e.preventDefault()}
      style={{ touchAction: "pan-y" }}
      className={surface}
      data-tip={isMergeTarget ? t("outline.holdToMerge") : draggable ? t("outline.holdToDragTile") : t("outline.openNoteTitle")}
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <NoteId id={note.id} />
        {pending && (
          <span className="rounded-full bg-clay-200 px-2 py-0.5 text-[10px] font-semibold text-clay-800">
            {t("outline.pendingLabel")}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {note.pinned && <span className="text-[10px] font-semibold text-clay">{t("outline.pinnedLabel")}</span>}
          {selectable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                actions.toggleSelect(note.id);
              }}
              data-track="note-select"
              data-no-drag
              role="checkbox"
              aria-checked={isSelected}
              aria-label={t("outline.selectNote")}
              data-tip={t("outline.selectNoteTitleCompare")}
              className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors ${
                isSelected
                  ? "border-clay bg-clay text-clay-fg opacity-100"
                  : "border-sand-400 bg-card text-transparent opacity-50 hover:border-clay-500 hover:opacity-100"
              }`}
            >
              <TickIcon />
            </button>
          )}
        </span>
      </div>
      {parts.title && <h3 className="note-title mt-2 shrink-0">{parts.title}</h3>}
      <div ref={bodyRef} className={`note-tile-body mt-1.5 min-h-0 flex-1 overflow-hidden${cut ? " note-tile-cut" : ""}`}>
        {parts.body.trim() !== "" && (
          <Markdown breaks sources={note.sources} notebookId={actions.notebookId}>
            {parts.body}
          </Markdown>
        )}
      </div>
      {(note.sources.length > 0 || note.replies.length > 0 || author) && (
        <div className="mt-2 flex shrink-0 items-center gap-2.5 text-[11px] text-sand-500">
          {note.sources.length > 0 && (
            <span className="flex items-center gap-1" data-tip={note.sources.map((s) => s.documentTitle).join(", ")}>
              <AnchorIcon />
              {note.sources.length}
            </span>
          )}
          {note.replies.length > 0 && (
            <span className="flex items-center gap-1" data-tip={t("outline.repliesTitle", { n: note.replies.length })}>
              <CommentIcon size={11} />
              {note.replies.length}
            </span>
          )}
          {author && (
            <span className="ml-auto">
              <PersonBadge person={author} size={14} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
