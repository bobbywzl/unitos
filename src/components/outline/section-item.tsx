"use client";

import { useState } from "react";
import type { SectionView } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { DragHandle, SortableItem, SortableList, type HandleProps } from "@/components/sortable";
import { AddSection } from "@/components/outline/add-section";
import { NoteCard } from "@/components/outline/note-card";
import type { OutlineActions } from "@/components/outline/use-outline";

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
  const t = useT();
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
    <section className={`group flex flex-col gap-2.5 ${nested ? "mt-4 pl-5" : ""}`}>
      <div className="flex items-baseline gap-2.5">
        <span className="self-center">
          <DragHandle handle={handle} label={t("outline.reorderSection", { title: section.title })} />
        </span>
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
            aria-label={t("outline.sectionTitle")}
            className={`rounded-full bg-card px-4 py-1 font-display shadow-soft outline-none ${nested ? "text-lg" : "text-[22px]"}`}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={`text-left font-display ${nested ? "text-lg" : "text-[22px]"}`}
            title={t("outline.renameSection")}
          >
            {section.title}
          </button>
        )}
        <span className="text-[13px] text-sand-600">{section.notes.length || ""}</span>
        <button
          onClick={() => setComposing(true)}
          className="ml-auto text-xs text-sand-600 hover:text-clay-700"
        >
          + note
        </button>
        <button
          onClick={() => {
            if (confirm("Delete this section and its notes?")) void actions.deleteSection(section.id);
          }}
          className="text-xs text-red-500 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-700"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        <SortableList
          id={`notes-${section.id}`}
          ids={section.notes.map((n) => n.id)}
          onMove={(id, to) => actions.reorderNote(section.id, id, to)}
        >
          {section.notes.map((note) => (
            <SortableItem key={note.id} id={note.id}>
              {(noteHandle) => (
                <NoteCard note={note} actions={actions} handle={noteHandle} variant="page" />
              )}
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
              className="w-full rounded-2xl bg-card p-4 text-sm shadow-soft outline-none placeholder:text-sand-500"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {!nested && (
          <>
            <SortableList
              id={`children-${section.id}`}
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
