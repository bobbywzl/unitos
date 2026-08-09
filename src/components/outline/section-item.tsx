"use client";

import { useState } from "react";
import type { SectionView } from "@/lib/types";
import { DragHandle, SortableItem, SortableList, type HandleProps } from "@/components/sortable";
import { AddSection, type OutlineActions } from "@/components/outline/outline";
import { NoteCard } from "@/components/outline/note-card";

export function SectionItem({
  section,
  actions,
  handle,
  nested,
}: {
  section: SectionView;
  actions: OutlineActions;
  handle: HandleProps;
  nested?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");

  async function saveTitle() {
    const trimmed = title.trim();
    setEditing(false);
    if (!trimmed || trimmed === section.title) {
      setTitle(section.title);
      return;
    }
    await actions.renameSection(section.id, trimmed);
  }

  return (
    <section className={nested ? "mt-2" : "mb-6"}>
      <div className="group flex items-center gap-1.5">
        <DragHandle handle={handle} label={`Reorder section ${section.title}`} />
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") {
                setTitle(section.title);
                setEditing(false);
              }
            }}
            className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-sm font-medium outline-none dark:border-neutral-700 dark:bg-neutral-900"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={`text-left font-medium ${nested ? "text-sm" : "text-base"}`}
            title="Rename section"
          >
            {section.title}
          </button>
        )}
        <span className="text-xs text-neutral-400">{section.notes.length || ""}</span>
        <div className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => setComposing(true)}
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
          >
            + Note
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this section and its notes?")) void actions.deleteSection(section.id);
            }}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-2 border-l border-neutral-200 pl-4 dark:border-neutral-800">
        <SortableList
          ids={section.notes.map((n) => n.id)}
          onMove={(id, to) => actions.reorderNote(section.id, id, to)}
        >
          {section.notes.map((note) => (
            <SortableItem key={note.id} id={note.id}>
              {(noteHandle) => <NoteCard note={note} actions={actions} handle={noteHandle} />}
            </SortableItem>
          ))}
        </SortableList>

        {composing && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const trimmed = draft.trim();
              if (!trimmed) return;
              await actions.addNote(section.id, trimmed);
              setDraft("");
              setComposing(false);
            }}
          >
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                if (e.key === "Escape") setComposing(false);
              }}
              placeholder="Write a note (markdown)"
              rows={3}
              className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <div className="mt-1 flex gap-2">
              <button type="submit" className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white dark:bg-white dark:text-neutral-900">
                Save
              </button>
              <button type="button" onClick={() => setComposing(false)} className="text-xs text-neutral-400">
                Cancel
              </button>
            </div>
          </form>
        )}

        {!nested && (
          <>
            <SortableList
              ids={section.children.map((c) => c.id)}
              onMove={(id, to) => actions.reorderSection(section.id, id, to)}
            >
              {section.children.map((child) => (
                <SortableItem key={child.id} id={child.id}>
                  {(childHandle) => (
                    <SectionItem section={child} actions={actions} handle={childHandle} nested />
                  )}
                </SortableItem>
              ))}
            </SortableList>
            <AddSection small onAdd={(t) => actions.addSection(section.id, t)} />
          </>
        )}
      </div>
    </section>
  );
}
