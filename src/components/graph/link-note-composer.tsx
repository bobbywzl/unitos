"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { readLinkNoteDraft, writeLinkNoteDraft } from "@/lib/note-drafts";
import { refreshWhenOnline } from "@/lib/offline/queue";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { useCollab } from "@/components/collab/collab-context";
import { NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useGraphNotes } from "@/components/graph/graph-notes";
import { announceSavedLine, onOtherSavedLine } from "@/components/graph/saved-line"; // [ui5]

// Note on this link (SPEC.md §13): in an expanded link, the reader writes a
// note of their own words that quotes both ends of the link
// (`POST /api/notes` with `fromLinkId`). It lands accepted, in the section
// the reader picks — by default the one they last wrote a note in. What is
// typed is kept in the browser for the account (lib/note-drafts.ts) until the server
// has the note, so a reload, a closed graph, or a failed save never loses
// it; Cancel keeps nothing. Offline (Unitos Premium) the note waits in the
// offline queue: the line says so, and Show comes once the note lands.

export function LinkNoteComposer({ linkId }: { linkId: string }) {
  const t = useT();
  const router = useRouter();
  const ime = useImeGuard();
  const { canEdit, myId } = useCollab();
  const ctx = useGraphNotes();
  const readDraft = (id: string) => readLinkNoteDraft(myId, id);
  const writeDraft = (id: string, text: string, section: string | null) => writeLinkNoteDraft(myId, id, text, section);
  // A draft left from before opens the composer on it. The composer renders
  // in the browser only (the graph loads there), so the draft is read at once.
  const [initial] = useState(() => (typeof window === "undefined" ? null : readDraft(linkId)));
  const [open, setOpen] = useState(initial !== null);
  const [content, setContent] = useState(initial?.content ?? "");
  const [sectionId, setSectionId] = useState<string | null>(initial?.sectionId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape folds the composer with its words kept (here and in the browser)
  // and gives the focus back to Note on this link (WALK4-07); opening it
  // scrolls Save into view on a short screen (WALK4-17).
  const openerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const returnFocus = useRef(false);
  const scrollOnOpen = useRef(false);
  useEffect(() => {
    if (open && scrollOnOpen.current) {
      scrollOnOpen.current = false;
      formRef.current?.scrollIntoView({ block: "nearest" });
    }
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      openerRef.current?.focus();
    }
  }, [open]);
  const [saved, setSaved] = useState<
    | { noteId: string; section: string }
    | { queued: { sectionId: string; content: string; at: number }; section: string }
    | null
  >(null);
  // [ui5] WALK5-14: one saved line at a time on the graph.
  useEffect(() => (saved ? onOtherSavedLine("link", () => setSaved(null)) : undefined), [saved]);

  if (!ctx || !canEdit) return null;
  const choices = ctx.sectionChoices;
  const chosen = choices.find((c) => c.id === sectionId) ?? choices.find((c) => c.id === ctx.defaultSectionId) ?? choices[0];

  // A queued note has an id once the queue sends it and the page refreshes.
  const savedId = !saved
    ? null
    : "noteId" in saved
      ? saved.noteId
      : ctx.findNote(saved.queued.sectionId, saved.queued.content, saved.queued.at);
  if (saved && !savedId) {
    return (
      <p data-graph-link-note-queued="" className="mt-2 flex items-center gap-1.5 text-[11.5px] text-sage-700">
        <NotesIcon size={12} />
        {t("graphNotes.noteOnLinkQueued", { section: saved.section })}
      </p>
    );
  }
  if (saved && savedId) {
    return (
      <p data-graph-link-note-saved={savedId} className="mt-2 flex items-center gap-1.5 text-[11.5px] text-sage-700">
        <NotesIcon size={12} />
        {t("graphNotes.noteOnLinkSaved", { section: saved.section })}
        <button
          onClick={() => ctx.showSaved(savedId) /* [ui5] VIEW5-10 */}
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
        ref={openerRef}
        onClick={() => {
          scrollOnOpen.current = true;
          setOpen(true);
        }}
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
      const note = await api<{ id: string } | { queued: true }>("/api/notes", "POST", {
        sectionId: chosen.id,
        content: text,
        fromLinkId: linkId,
      });
      // The server has the note, or the offline queue does: the draft goes.
      writeDraft(linkId, "", null);
      announceSavedLine("link"); // [ui5] WALK5-14
      setSaved(
        "queued" in note
          ? { queued: { sectionId: chosen.id, content: text, at: Date.now() }, section: chosen.label }
          : { noteId: note.id, section: chosen.label },
      );
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
      ref={formRef}
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
          if (e.key === "Escape") {
            e.preventDefault();
            returnFocus.current = true;
            setOpen(false);
            return;
          }
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
