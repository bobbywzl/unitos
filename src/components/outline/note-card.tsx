"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NoteView } from "@/lib/types";
import { Markdown } from "@/components/markdown";
import { DragHandle, type HandleProps } from "@/components/sortable";
import type { OutlineActions } from "@/components/outline/outline";

export function NoteCard({
  note,
  actions,
  handle,
}: {
  note: NoteView;
  actions: OutlineActions;
  handle: HandleProps;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [handledEdit, setHandledEdit] = useState<{ id: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pending = note.status === "PENDING";
  const focused = pending && actions.focusedPendingId === note.id;

  // Keyboard queue: `e` on the focused pending note opens the editor.
  // Adjust-during-render; each keypress creates a new request object.
  if (actions.editRequest && actions.editRequest.id === note.id && handledEdit !== actions.editRequest) {
    setHandledEdit(actions.editRequest);
    setDraft(note.content);
    setEditing(true);
  }

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  async function save() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === note.content) {
      setDraft(note.content);
      return;
    }
    await actions.saveNote(note.id, trimmed);
  }

  if (editing) {
    return (
      <div className="rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            if (e.key === "Escape") {
              setDraft(note.content);
              setEditing(false);
            }
          }}
          rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
          className="w-full resize-y bg-transparent text-sm outline-none"
        />
        <div className="mt-1 flex gap-2">
          <button onClick={() => void save()} className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white dark:bg-white dark:text-neutral-900">
            Save
          </button>
          <button
            onClick={() => {
              setDraft(note.content);
              setEditing(false);
            }}
            className="text-xs text-neutral-400"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`group/note rounded-md border bg-white p-2 dark:bg-neutral-900 ${
        pending
          ? "border-l-4 border-neutral-200 border-l-amber-400 dark:border-neutral-800"
          : "border-neutral-200 dark:border-neutral-800"
      } ${focused ? "ring-2 ring-amber-500" : ""}`}
    >
      <div className="flex items-start gap-1.5">
        <div className="opacity-0 transition-opacity group-hover/note:opacity-100">
          <DragHandle handle={handle} label="Reorder note" />
        </div>
        <div className="min-w-0 flex-1">
          <Markdown>{note.content}</Markdown>
          {note.sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {note.sources.map((source) =>
                source.orphaned ? (
                  <span
                    key={source.id}
                    title={`Anchor unresolved. Quoted text: ${source.quotedText}`}
                    className="inline-flex max-w-52 items-center gap-1 truncate rounded-full border border-dashed border-red-300 px-2 py-0.5 text-xs text-red-500 dark:border-red-800"
                  >
                    ⚠ {source.documentTitle}
                  </span>
                ) : (
                  <Link
                    key={source.id}
                    href={`/n/${actions.notebookId}?doc=${source.documentId}&src=${source.id}`}
                    title={source.quotedText}
                    className="inline-flex max-w-52 items-center gap-1 truncate rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  >
                    ⚓ {source.documentTitle}
                  </Link>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {pending ? (
        <div className="mt-1.5 flex items-center gap-2 pl-6">
          <button
            onClick={() => void actions.acceptNote(note.id)}
            className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700"
            title="Accept (Enter)"
          >
            Accept
          </button>
          <button
            onClick={() => void actions.rejectNote(note.id)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:border-red-400 hover:text-red-600 dark:border-neutral-700 dark:text-neutral-300"
            title="Reject (Backspace)"
          >
            Reject
          </button>
          <button
            onClick={() => {
              setDraft(note.content);
              setEditing(true);
            }}
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            title="Edit (e)"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2 pl-6 opacity-0 transition-opacity group-hover/note:opacity-100">
          <button
            onClick={() => {
              setDraft(note.content);
              setEditing(true);
            }}
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
          >
            Edit
          </button>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) void actions.moveNoteToSection(note.id, e.target.value);
            }}
            className="rounded border-none bg-transparent text-xs text-neutral-500 outline-none hover:text-neutral-900 dark:hover:text-white"
          >
            <option value="" disabled>
              Move to…
            </option>
            {actions.sectionChoices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (confirm("Delete this note?")) void actions.deleteNote(note.id);
            }}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
