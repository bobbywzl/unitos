"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { refreshWhenOnline } from "@/lib/offline/queue";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { useCollab } from "@/components/collab/collab-context";
import { NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useGraphNotes } from "@/components/graph/graph-notes";

// Note on this link (SPEC.md §13): in an expanded link, the reader writes a
// note of their own words that quotes both ends of the link
// (`POST /api/notes` with `fromLinkId`). It lands accepted, in the section
// the reader picks — by default the one they last wrote a note in. What is
// typed is kept in the browser (graph-link-note:<linkId>) until the server
// has the note, so a reload, a closed graph, or a failed save never loses
// it; Cancel keeps nothing.

const draftKey = (linkId: string) => `graph-link-note:${linkId}`;

function readDraft(linkId: string): { content: string; sectionId: string | null } | null {
  try {
    const raw = window.localStorage.getItem(draftKey(linkId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { content, sectionId } = parsed as { content?: unknown; sectionId?: unknown };
    if (typeof content !== "string" || !content) return null;
    return { content, sectionId: typeof sectionId === "string" ? sectionId : null };
  } catch {
    return null;
  }
}

function writeDraft(linkId: string, content: string, sectionId: string | null) {
  try {
    if (content) window.localStorage.setItem(draftKey(linkId), JSON.stringify({ content, sectionId }));
    else window.localStorage.removeItem(draftKey(linkId));
  } catch {
    /* storage off: the text stays in the box while it is open */
  }
}

export function LinkNoteComposer({ linkId }: { linkId: string }) {
  const t = useT();
  const router = useRouter();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const ctx = useGraphNotes();
  // A draft left from before opens the composer on it. The composer renders
  // in the browser only (the graph loads there), so the draft is read at once.
  const [initial] = useState(() => (typeof window === "undefined" ? null : readDraft(linkId)));
  const [open, setOpen] = useState(initial !== null);
  const [content, setContent] = useState(initial?.content ?? "");
  const [sectionId, setSectionId] = useState<string | null>(initial?.sectionId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ noteId: string; section: string } | null>(null);

  if (!ctx || !canEdit) return null;
  const choices = ctx.sectionChoices;
  const chosen = choices.find((c) => c.id === sectionId) ?? choices.find((c) => c.id === ctx.defaultSectionId) ?? choices[0];

  if (saved) {
    return (
      <p data-graph-link-note-saved={saved.noteId} className="mt-2 flex items-center gap-1.5 text-[11.5px] text-sage-700">
        <NotesIcon size={12} />
        {t("graphNotes.noteOnLinkSaved", { section: saved.section })}
        <button
          onClick={() => ctx.showNote(saved.noteId)}
          data-track="graph-link-note-show"
          className="rounded-full bg-sage-100 px-2 py-0.5 font-semibold text-sage-800 hover:bg-sage-200"
        >
          {t("graphNotes.noteOnLinkShow")}
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-track="graph-link-note"
        data-tip={t("graphNotes.noteOnLinkTitle")}
        className="mt-2 flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-sage-100 hover:text-sage-800"
      >
        <NotesIcon size={11} />
        {t("graphNotes.noteOnLink")}
      </button>
    );
  }

  async function save() {
    const text = content.trim();
    if (!text || !chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const note = await api<{ id: string }>("/api/notes", "POST", {
        sectionId: chosen.id,
        content: text,
        fromLinkId: linkId,
      });
      writeDraft(linkId, "", null);
      setSaved({ noteId: note.id, section: chosen.label });
      setContent("");
      refreshWhenOnline(router);
    } catch (err) {
      // The draft stays in the browser: the words are not lost.
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      data-graph-link-note-composer={linkId}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="mt-2 flex flex-col gap-1.5 rounded-xl border border-sage-300 bg-card p-2"
    >
      {choices.length === 0 ? (
        <p className="text-[11px] text-sand-600">{t("graphNotes.noteOnLinkNoSection")}</p>
      ) : (
        <label className="flex items-center gap-1.5 text-[11px] text-sand-600">
          {t("graphNotes.noteOnLinkSection")}
          <select
            value={chosen?.id ?? ""}
            onChange={(e) => {
              setSectionId(e.target.value);
              writeDraft(linkId, content, e.target.value);
            }}
            data-track="graph-link-note-section"
            className="min-w-0 flex-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11.5px] text-ink"
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <textarea
        autoFocus
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          writeDraft(linkId, e.target.value, chosen?.id ?? null);
        }}
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isImeEnter(e) || isImeKey(e)) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder={t("graphNotes.noteOnLinkPlaceholder")}
        rows={3}
        className="resize-none rounded-xl bg-sand-100 px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
      />
      <span className="flex items-center justify-end gap-1.5">
        {error && <span className="mr-auto text-[11px] text-red-500">{error}</span>}
        <button
          type="button"
          onClick={() => {
            writeDraft(linkId, "", null);
            setContent("");
            setOpen(false);
            setError(null);
          }}
          data-track="graph-link-note-cancel"
          className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100"
        >
          {t("graphNotes.noteOnLinkCancel")}
        </button>
        <button
          type="submit"
          data-track="graph-link-note-save"
          disabled={!content.trim() || !chosen || busy}
          className="rounded-full bg-sage-600 px-3 py-0.5 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
        >
          {busy ? t("graphNotes.noteOnLinkSaving") : t("graphNotes.noteOnLinkSave")}
        </button>
      </span>
    </form>
  );
}
