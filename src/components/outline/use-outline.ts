"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { api } from "@/lib/api";
import type { NotebookView, NoteView, SectionView } from "@/lib/types";

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
  acceptNote: (id: string) => Promise<void>;
  rejectNote: (id: string) => Promise<void>;
  sectionChoices: { id: string; label: string }[];
  focusedPendingId: string | null;
  editRequest: { id: string } | null;
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

function flattenNotes(sections: SectionView[]): NoteView[] {
  return sections.flatMap((s) => [...s.notes, ...flattenNotes(s.children)]);
}

/** Notes whose content matches the query, with sections that end up empty dropped. */
export function filterSections(sections: SectionView[], query: string): SectionView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections
    .map((s) => ({
      ...s,
      notes: s.notes.filter((n) => n.content.toLowerCase().includes(needle)),
      children: filterSections(s.children, query),
    }))
    .filter((s) => s.notes.length > 0 || s.children.length > 0);
}

// The notes model shared by the tray (design 1a) and the notes full page (design 2b):
// one optimistic tree, one pending queue, one set of keyboard bindings (SPEC.md §6).
export function useOutline(notebook: NotebookView) {
  const router = useRouter();
  const [tree, setTree] = useState(notebook.sections);
  const [prevSections, setPrevSections] = useState(notebook.sections);
  const [focusIndex, setFocusIndex] = useState(0);
  const [editRequest, setEditRequest] = useState<{ id: string } | null>(null);
  if (prevSections !== notebook.sections) {
    setPrevSections(notebook.sections);
    setTree(notebook.sections);
  }

  const refresh = useCallback(() => router.refresh(), [router]);

  // Pending queue in outline order (SPEC.md §6 keyboard flow).
  const pending = useMemo(() => flattenNotes(tree).filter((n) => n.status === "PENDING"), [tree]);
  const focused = pending.length > 0 ? pending[Math.min(focusIndex, pending.length - 1)] : null;

  const acceptNote = useCallback(
    async (id: string) => {
      // Optimistic: accepting must feel instant (SPEC.md §10).
      setTree((prev) =>
        prev.map(function walk(s): SectionView {
          return {
            ...s,
            notes: s.notes.map((n) => (n.id === id ? { ...n, status: "ACCEPTED" as const } : n)),
            children: s.children.map(walk),
          };
        }),
      );
      await api(`/api/notes/${id}`, "PATCH", { status: "ACCEPTED" });
      refresh();
    },
    [refresh],
  );

  // Rejecting is one keystroke, so it gets one keystroke back: an Undo window
  // that returns the note to the pending queue.
  const [lastRejected, setLastRejected] = useState<string | null>(null);
  useEffect(() => {
    if (!lastRejected) return;
    const timer = setTimeout(() => setLastRejected(null), 8000);
    return () => clearTimeout(timer);
  }, [lastRejected]);

  const rejectNote = useCallback(
    async (id: string) => {
      setTree((prev) =>
        prev.map(function walk(s): SectionView {
          return {
            ...s,
            notes: s.notes.filter((n) => n.id !== id),
            children: s.children.map(walk),
          };
        }),
      );
      setLastRejected(id);
      await api(`/api/notes/${id}`, "PATCH", { status: "REJECTED" });
      refresh();
    },
    [refresh],
  );

  const undoReject = useCallback(async () => {
    if (!lastRejected) return;
    const id = lastRejected;
    setLastRejected(null);
    await api(`/api/notes/${id}`, "PATCH", { status: "PENDING" });
    refresh();
  }, [lastRejected, refresh]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (pending.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          // Enter on a focused button must activate the button, not the queue.
          target.closest("button, a, [role='button']"))
      ) {
        return;
      }
      const current = pending[Math.min(focusIndex, pending.length - 1)];
      switch (e.key) {
        case "j":
          setFocusIndex((i) => Math.min(i + 1, pending.length - 1));
          break;
        case "k":
          setFocusIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (current) void acceptNote(current.id);
          break;
        case "Backspace":
          e.preventDefault();
          if (current) void rejectNote(current.id);
          break;
        case "e":
          e.preventDefault();
          if (current) setEditRequest({ id: current.id });
          break;
        case "g": {
          e.preventDefault();
          const source = current?.sources[0];
          if (source && !source.orphaned) {
            router.push(`/n/${notebook.id}?doc=${source.documentId}&src=${source.id}`);
          }
          break;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, focusIndex, notebook.id, router, acceptNote, rejectNote]);

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
    acceptNote,
    rejectNote,
    sectionChoices: tree.flatMap((s) => [
      { id: s.id, label: s.title },
      ...s.children.map((c) => ({ id: c.id, label: `${s.title} / ${c.title}` })),
    ]),
    focusedPendingId: focused?.id ?? null,
    editRequest,
  };

  return { tree, pending, focused, actions, lastRejected, undoReject };
}
