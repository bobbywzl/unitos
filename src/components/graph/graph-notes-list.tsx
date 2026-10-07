"use client";

import { useState } from "react";
import { readGraphKeep, writeGraphKeep } from "@/components/graph/graph-keep";
import { useCollab } from "@/components/collab/collab-context";
import { NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { useGraphNotes, useGraphNotesLit } from "@/components/graph/graph-notes";
import { noteLine, type GraphNote } from "@/lib/graph/notes";
import { splitNote } from "@/lib/note-title";

// The Notes list beside the canvas (SPEC.md §13): a lens on the graph, not a
// second notes page. It lists the notes in focus — the pinned curve's notes
// quoting both documents, else the notes quoting the documents picked for
// Stitch, else every note that quotes two or more documents — grouped by
// section. Hovering a row lights the documents the note quotes; a click
// reads it here, its quotes each with Jump; editing stays in the tray.
// Section filters the list and the graph: the node chips, the note curves,
// and the nodes no note of the section touches dim.

/** The header pill that opens and folds the list. */
export function NotesListToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  const ctx = useGraphNotes();
  if (!ctx) return null;
  return (
    <button
      onClick={onToggle}
      data-track="graph-notes"
      aria-expanded={open}
      data-tip={t("graphNotes.notesToggleTitle")}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] whitespace-nowrap hover:bg-clay-100 hover:text-clay-800 ${
        open ? "border-line bg-clay-100 text-clay-800" : ctx.sectionId ? "border-sage-400 text-sage-800" : "border-line text-sand-600"
      }`}
    >
      <NotesIcon size={13} />
      {t("graphNotes.notes")}
      <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">
        {ctx.view.notes.length}
      </span>
    </button>
  );
}

function bySection(notes: GraphNote[]): { title: string; notes: GraphNote[] }[] {
  const groups = new Map<string, { title: string; notes: GraphNote[] }>();
  for (const g of notes) {
    const group = groups.get(g.sectionId) ?? { title: g.sectionTitle, notes: [] };
    group.notes.push(g);
    groups.set(g.sectionId, group);
  }
  return [...groups.values()];
}

export function GraphNotesList({ pickedIds, onClose }: { pickedIds: Set<string>; onClose: () => void }) {
  const t = useT();
  const ctx = useGraphNotes();
  const { pinnedPair } = useGraphNotesLit();
  // The open note survives a trip to a document and Back (WALK2-07).
  const [openId, setOpenIdState] = useState<string | null>(() => readGraphKeep(ctx?.notebookId).noteId ?? null);
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    writeGraphKeep(ctx?.notebookId, { noteId: id });
  };
  if (!ctx) return null;
  const { view } = ctx;

  const [pa, pb] = pinnedPair?.split("|") ?? [];
  const pinned = pa && pb && pa !== pb ? pinnedPair : null;
  let heading: string;
  let shown: GraphNote[];
  let single = 0;
  if (pinned) {
    heading = t("graphNotes.notesOnPair");
    shown = view.byPair.get(pinned) ?? [];
  } else if (pickedIds.size > 0) {
    heading = t("graphNotes.notesOnPick");
    const hits = (g: GraphNote) => g.documentIds.filter((id) => pickedIds.has(id)).length;
    shown = view.notes.filter((g) => hits(g) > 0).sort((x, y) => Number(hits(y) >= 2) - Number(hits(x) >= 2));
  } else {
    heading = t("graphNotes.notesAcross");
    shown = view.notes.filter((g) => g.documentIds.length >= 2);
    single = view.notes.length - shown.length;
  }

  return (
    <aside
      data-track-surface="graph-notes-list"
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float backdrop-blur-md max-[999px]:bottom-16"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[11px] text-sand-500">{t("graphNotes.notesDesc")}</p>
        <button
          onClick={onClose}
          data-track="graph-notes-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-sand-600">
        {t("graphNotes.notesSection")}
        <select
          value={ctx.sectionId ?? ""}
          onChange={(e) => ctx.setSectionId(e.target.value || null)}
          data-track="graph-notes-section"
          className="min-w-0 flex-1 rounded-full border border-line bg-card px-2.5 py-1 text-[12.5px] text-ink"
        >
          <option value="">{t("graphNotes.notesSectionAll")}</option>
          {ctx.sectionChoices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] font-bold tracking-[0.06em] text-sand-600 uppercase">{heading}</p>
      {shown.length === 0 && <p className="text-[13px] text-sand-600">{t("graphNotes.notesEmpty")}</p>}
      {bySection(shown).map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <p className="text-[11.5px] font-semibold text-sage-700">{group.title}</p>
          {group.notes.map((g) => (
            <NotesListRow
              key={g.note.id}
              note={g}
              open={openId === g.note.id}
              onToggle={() => setOpenId(openId === g.note.id ? null : g.note.id)}
            />
          ))}
        </div>
      ))}
      {single > 0 && (
        <p className="text-[11.5px] text-sand-500">
          {single === 1 ? t("graphNotes.notesOneDocumentOne") : t("graphNotes.notesOneDocument", { n: single })}
        </p>
      )}
    </aside>
  );
}

function NotesListRow({ note: g, open, onToggle }: { note: GraphNote; open: boolean; onToggle: () => void }) {
  const t = useT();
  const ctx = useGraphNotes();
  const { canEdit } = useCollab();
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;
  const note = g.note;
  const openReplies = note.replies.filter((r) => r.resolvedById === null).length;
  const decide = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await (accept ? ctx.acceptNote(note.id) : ctx.rejectNote(note.id));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-graph-notes-row={note.id}
      onMouseEnter={() => ctx.setRowLit(new Set(g.documentIds))}
      onMouseLeave={() => ctx.setRowLit(null)}
      onFocus={() => ctx.setRowLit(new Set(g.documentIds))}
      onBlur={() => ctx.setRowLit(null)}
      className={`rounded-2xl border bg-card p-3 shadow-soft ${
        note.status === "PENDING" ? "border-dashed border-clay-300" : "border-line"
      }`}
    >
      <button
        onClick={onToggle}
        data-track="graph-notes-expand"
        aria-expanded={open}
        className="block w-full rounded-lg text-left hover:bg-clay-100/60"
      >
        <span className="text-[12.5px] leading-snug font-semibold text-ink">{noteLine(note)}</span>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {g.documentIds.map((id) => (
          <span
            key={id}
            className="max-w-44 truncate rounded-full bg-sand-200 px-2 py-px text-[10.5px] font-semibold text-sand-700"
          >
            {ctx.titleOf.get(id) ?? ""}
          </span>
        ))}
        <span className="text-[10.5px] text-sand-500">
          {note.sources.length === 1
            ? t("graphNotes.notesSourceOne")
            : t("graphNotes.notesSourceMany", { n: note.sources.length })}
        </span>
        {openReplies > 0 && (
          <span className="text-[10.5px] text-sand-500">
            ·{" "}
            {openReplies === 1 ? t("graphNotes.replyCountOne") : t("graphNotes.replyCountMany", { n: openReplies })}
          </span>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-[12.5px]">
            <Markdown breaks sources={note.sources} notebookId={ctx.notebookId}>
              {splitNote(note.content).body || note.content}
            </Markdown>
          </div>
          {note.sources.map((s) => (
            <div key={s.id} className="rounded-xl border border-line bg-sand-50/60 p-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink">{s.documentTitle}</span>
                {s.documentId && ctx.titleOf.has(s.documentId) && (
                  <button
                    onClick={() => ctx.openSource(s.documentId, s.id)}
                    data-track="graph-notes-jump"
                    data-tip={t("graphNotes.notesJumpTitle")}
                    className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                  >
                    {t("graphNotes.notesJump")}
                  </button>
                )}
              </div>
              <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-sand-700">
                <mark className="link-detail-quote">{s.quotedText}</mark>
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => ctx.showNote(note.id)}
          data-track="graph-notes-open"
          className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("graphNotes.notesOpenInNotes")}
        </button>
        {note.status === "PENDING" && canEdit && (
          <span className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => void decide(true)}
              disabled={busy}
              data-track="graph-notes-accept"
              className="rounded-full bg-sage-600 px-3 py-0.5 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
            >
              {t("common.accept")}
            </button>
            <button
              onClick={() => void decide(false)}
              disabled={busy}
              data-track="graph-notes-reject"
              className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
            >
              {t("common.reject")}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
