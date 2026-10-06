"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";

// Where a document is and what a delete reaches (SPEC.md §5): the footprint
// route's answer. `projects` are the reader's own projects that hold it (the
// ones they can edit), by name; `otherProjects` counts the projects of other
// accounts that hold it; `openProjects` are the ids of the projects holding
// it that the reader can open, at any role.
export type DocumentReach = {
  annotations: number;
  notes: number;
  shared: boolean;
  projects: { id: string; title: string }[];
  otherProjects: number;
  openProjects?: string[];
};

/** The footprint of one document, read when `documentId` is set (a menu or a
    confirm opens) and again for each new id. null while it loads, or when
    the read failed (offline): the confirm then says the plain message. */
export function useDocumentReach(documentId: string | null): { reach: DocumentReach | null; loading: boolean } {
  const [state, setState] = useState<{ id: string | null; reach: DocumentReach | null; loading: boolean }>({
    id: null,
    reach: null,
    loading: false,
  });
  // A new id starts a new read: adjust during render, then fetch.
  if (state.id !== documentId) setState({ id: documentId, reach: null, loading: documentId !== null });
  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    void (async () => {
      let reach: DocumentReach | null = null;
      try {
        const res = await fetch(`/api/documents/${documentId}/footprint`);
        if (res.ok) reach = (await res.json()) as DocumentReach;
      } catch {
        // Offline: the plain message stands.
      }
      if (!cancelled) setState((s) => (s.id === documentId ? { ...s, reach, loading: false } : s));
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);
  return { reach: state.reach, loading: state.loading };
}

/** The projects other than `notebookId` that hold the document: the reader's
    own by name, the other accounts' as a count. */
export function otherPlaces(reach: DocumentReach, notebookId: string | null) {
  return { names: reach.projects.filter((p) => p.id !== notebookId).map((p) => p.title), others: reach.otherProjects };
}

/** Remove from this project can run: another project the reader can open
    still holds the document, so it stays in the reader's reach. A project of
    another account the reader cannot open does not count: removed, the
    document would be out of the reader's reach, and Delete document is the
    way, its confirm naming what goes. */
export function inAnotherProject(reach: DocumentReach | null, notebookId: string): boolean {
  if (!reach) return false;
  const open = reach.openProjects ?? reach.projects.map((p) => p.id);
  return open.some((id) => id !== notebookId);
}

// "QA Student, QA Skimmer and 1 project of another account".
function useJoinPlaces() {
  const t = useT();
  return (names: string[], others: number): string => {
    const items = [
      ...names.map((n) => `“${n}”`),
      ...(others > 0
        ? [others === 1 ? t("panes.deleteOtherAccountOne") : t("panes.deleteOtherAccounts", { n: others })]
        : []),
    ];
    if (items.length <= 1) return items[0] ?? "";
    return t("panes.listAnd", { rest: items.slice(0, -1).join(t("panes.listSeparator")), last: items.at(-1)! });
  };
}

/** The confirm a Delete document opens under the row, in the app's own
    look: where the document is, what goes with it and what stays, then
    Delete document and Cancel — and, for a document of the project in view
    that another project also holds, the narrower Remove from this project.
    `notebookId` is the project in view when the document is in it; null in
    the library, where the document is in other projects only. */
export function DocumentDeleteConfirm({
  reach,
  loading,
  notebookId,
  busy,
  onDelete,
  onRemove,
  onCancel,
}: {
  reach: DocumentReach | null;
  loading: boolean;
  notebookId: string | null;
  busy: boolean;
  onDelete: () => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const join = useJoinPlaces();
  const lines: string[] = [];
  if (loading) {
    lines.push(t("common.loading"));
  } else if (!reach) {
    lines.push(t("panes.confirmDeleteDocument"));
  } else {
    const { names, others } = otherPlaces(reach, notebookId);
    if (reach.shared) {
      // Another account's project holds it: Delete takes it out of the
      // reader's own projects only, and nothing goes.
      lines.push(t("panes.deleteShared", { projects: join(reach.projects.map((p) => p.title), 0) }));
    } else {
      lines.push(t("panes.deleteAsk"));
      const count = names.length + others;
      const projects = join(names, others);
      if (notebookId === null) {
        lines.push(t(count === 1 ? "panes.deleteWhereLibraryOne" : "panes.deleteWhereLibrary", { projects }));
      } else if (count > 0) {
        lines.push(t(count === 1 ? "panes.deleteWhereAlsoOne" : "panes.deleteWhereAlso", { projects }));
      } else {
        lines.push(t("panes.deleteWhereOnly"));
      }
      if (reach.annotations > 0) {
        lines.push(
          reach.annotations === 1
            ? t("panes.deleteAnnotationsOne")
            : t("panes.deleteAnnotations", { n: reach.annotations }),
        );
      }
      if (reach.notes > 0) {
        lines.push(reach.notes === 1 ? t("panes.deleteNotesOne") : t("panes.deleteNotes", { n: reach.notes }));
      }
    }
  }
  const canRemove = notebookId !== null && onRemove !== undefined && inAnotherProject(reach, notebookId);
  // The confirm opens under the row, at the foot of a list that may scroll:
  // it scrolls into view, so the reader sees what they are agreeing to.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [loading]);
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-label={t("panes.deleteDocument")}
      data-delete-confirm
      className="flex flex-col gap-1.5 border-y border-line bg-sand-50/60 px-4 py-2"
    >
      {lines.map((line, i) => (
        <p key={i} className={`text-[11.5px] leading-snug ${i === 0 ? "font-semibold text-sand-800" : "text-sand-700"}`}>
          {line}
        </p>
      ))}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <button
          onClick={onDelete}
          data-track="document-delete-confirm"
          disabled={busy || loading}
          className="rounded-full bg-red-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-red-700 disabled:opacity-40"
        >
          {t("panes.deleteDocument")}
        </button>
        {canRemove && (
          <button
            onClick={onRemove}
            data-track="document-remove-confirm"
            disabled={busy}
            data-tip={t("panes.removeFromProjectTitle")}
            className="rounded-full border border-line px-3 py-1 text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
          >
            {t("panes.removeFromProject")}
          </button>
        )}
        <button
          onClick={onCancel}
          data-track="document-delete-cancel"
          className="rounded-full px-3 py-1 text-[12px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
