"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { api } from "@/lib/api";
import type { NotebookView, SectionView } from "@/lib/types";
import { SortableItem, SortableList } from "@/components/sortable";
import { SectionItem } from "@/components/outline/section-item";

export type OutlineActions = {
  notebookId: string;
  addSection: (parentId: string | null, title: string) => Promise<void>;
  renameSection: (id: string, title: string) => Promise<void>;
  deleteSection: (id: string) => Promise<void>;
  reorderSection: (parentId: string | null, id: string, toIndex: number) => void;
  addNote: (sectionId: string, content: string) => Promise<void>;
  saveNote: (id: string, content: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  reorderNote: (sectionId: string, id: string, toIndex: number) => void;
  moveNoteToSection: (id: string, sectionId: string) => Promise<void>;
  sectionChoices: { id: string; label: string }[];
};

function updateSection(
  sections: SectionView[],
  id: string,
  fn: (s: SectionView) => SectionView,
): SectionView[] {
  return sections.map((s) =>
    s.id === id ? fn(s) : { ...s, children: updateSection(s.children, id, fn) },
  );
}

export function Outline({ notebook }: { notebook: NotebookView }) {
  const router = useRouter();
  const [tree, setTree] = useState(notebook.sections);
  const [prevSections, setPrevSections] = useState(notebook.sections);
  if (prevSections !== notebook.sections) {
    setPrevSections(notebook.sections);
    setTree(notebook.sections);
  }

  const refresh = () => router.refresh();

  const actions: OutlineActions = {
    notebookId: notebook.id,
    async addSection(parentId, title) {
      await api("/api/sections", "POST", { notebookId: notebook.id, title, parentId });
      refresh();
    },
    async renameSection(id, title) {
      await api(`/api/sections/${id}`, "PATCH", { title });
      refresh();
    },
    async deleteSection(id) {
      await api(`/api/sections/${id}`, "DELETE");
      refresh();
    },
    reorderSection(parentId, id, toIndex) {
      setTree((prev) => {
        if (parentId === null) {
          const from = prev.findIndex((s) => s.id === id);
          return from === -1 ? prev : arrayMove(prev, from, toIndex);
        }
        return updateSection(prev, parentId, (parent) => {
          const from = parent.children.findIndex((s) => s.id === id);
          return from === -1
            ? parent
            : { ...parent, children: arrayMove(parent.children, from, toIndex) };
        });
      });
      void api(`/api/sections/${id}`, "PATCH", { order: toIndex }).then(refresh);
    },
    async addNote(sectionId, content) {
      await api("/api/notes", "POST", { sectionId, content });
      refresh();
    },
    async saveNote(id, content) {
      await api(`/api/notes/${id}`, "PATCH", { content });
      refresh();
    },
    async deleteNote(id) {
      await api(`/api/notes/${id}`, "DELETE");
      refresh();
    },
    reorderNote(sectionId, id, toIndex) {
      setTree((prev) =>
        updateSection(prev, sectionId, (s) => {
          const from = s.notes.findIndex((n) => n.id === id);
          return from === -1 ? s : { ...s, notes: arrayMove(s.notes, from, toIndex) };
        }),
      );
      void api(`/api/notes/${id}`, "PATCH", { order: toIndex }).then(refresh);
    },
    async moveNoteToSection(id, sectionId) {
      await api(`/api/notes/${id}`, "PATCH", { sectionId });
      refresh();
    },
    sectionChoices: tree.flatMap((s) => [
      { id: s.id, label: s.title },
      ...s.children.map((c) => ({ id: c.id, label: `${s.title} / ${c.title}` })),
    ]),
  };

  return (
    <div className="space-y-4">
      <SortableList
        id="sections-root"
        ids={tree.map((s) => s.id)}
        onMove={(id, to) => actions.reorderSection(null, id, to)}
      >
        {tree.map((section) => (
          <SortableItem key={section.id} id={section.id}>
            {(handle) => <SectionItem section={section} actions={actions} handle={handle} />}
          </SortableItem>
        ))}
      </SortableList>
      <AddSection onAdd={(title) => actions.addSection(null, title)} />
      {tree.length === 0 && (
        <p className="text-sm text-neutral-500">No sections yet. Add one to start taking notes.</p>
      )}
    </div>
  );
}

export function AddSection({
  onAdd,
  small,
}: {
  onAdd: (title: string) => Promise<void>;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={
          small
            ? "text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            : "rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-900 dark:border-neutral-700 dark:hover:text-white"
        }
      >
        + Add section
      </button>
    );
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        await onAdd(trimmed);
        setTitle("");
        setOpen(false);
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Section title"
        className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      />
      <button type="submit" className="text-sm text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white">
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-neutral-400">
        Cancel
      </button>
    </form>
  );
}
