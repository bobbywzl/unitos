"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { NotesIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// Save as note (SPEC.md §7): under every answer of the assistant and every
// tool's output, the answer organized into one note of the project — a
// title, the key points with their reasoning, and under each the document's
// words as quotes (`POST /api/notes/organize`). The note lands pending in
// the section the reader last wrote in; Show opens it in the notes tray.
// The answer stays as it is.
export type SaveOrigin = "assistant" | "explain" | "simplify" | "analyze" | "ask" | "act" | "stitch";

export function SaveAsNote({
  notebookId,
  documentId,
  origin = "assistant",
  question = "",
  selection = "",
  answer,
  className = "",
}: {
  notebookId: string;
  documentId?: string;
  origin?: SaveOrigin;
  question?: string;
  selection?: string;
  answer: string;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "saved"; noteId: string; section: string } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function save() {
    if (state.kind === "busy" || !answer.trim()) return;
    setState({ kind: "busy" });
    try {
      const saved = await api<{ noteId: string; sectionTitle: string }>("/api/notes/organize", "POST", {
        notebookId,
        documentId,
        origin,
        question: question.slice(0, 20_000),
        selection: selection.slice(0, 20_000),
        answer: answer.slice(0, 60_000),
      });
      setState({ kind: "saved", noteId: saved.noteId, section: saved.sectionTitle });
      // The tray reads the new note from the refreshed page.
      router.refresh();
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.kind === "saved") {
    return (
      <span className={`flex items-center gap-1.5 text-[11.5px] text-sage-700 ${className}`}>
        <NotesIcon size={12} />
        {t("assistant.savedAsNote", { section: state.section })}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: state.noteId } }))}
          data-track="assistant-saved-note-show"
          className="rounded-full bg-sage-100 px-2 py-0.5 font-semibold text-sage-800 hover:bg-sage-200"
        >
          {t("assistant.showSavedNote")}
        </button>
      </span>
    );
  }
  return (
    <span className={`flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => void save()}
        disabled={state.kind === "busy"}
        data-track={`assistant-save-note:${origin}`}
        data-tip={t("assistant.saveAsNoteTitle")}
        className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 pointer-coarse:py-1.5 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-60"
      >
        {state.kind === "busy" ? <SpinnerIcon size={12} className="animate-spin" /> : <NotesIcon size={12} />}
        {state.kind === "busy" ? t("assistant.savingAsNote") : t("assistant.saveAsNote")}
      </button>
      {state.kind === "error" && <span className="max-w-64 text-right text-[11px] text-red-500">{state.message}</span>}
    </span>
  );
}
