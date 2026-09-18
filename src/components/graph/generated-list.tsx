"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import type { GeneratedDocumentView } from "@/lib/types";

// Generated content (SPEC.md §22): every document Stitch wrote for the
// project, newest first, each with the command that made it. The list
// folds beside the graph's canvas like the recommended links. A row opens
// the document in the reader.

export function GeneratedList({
  notebookId,
  generated,
  onOpenDocument,
}: {
  notebookId: string;
  generated: GeneratedDocumentView[];
  onOpenDocument: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    if (busyId || !confirm(t("stitch.confirmDeleteGenerated"))) return;
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/documents/${id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusyId(null);
    }
  }

  function open(id: string) {
    router.push(`/n/${notebookId}?doc=${id}`);
    onOpenDocument();
  }

  return (
    <aside
      data-track-surface="sidebar"
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float backdrop-blur-md"
    >
      <p className="text-[11px] text-sand-500">{t("stitch.generatedDesc")}</p>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      {generated.length === 0 && (
        <p className="text-[13px] text-sand-600">{t("stitch.generatedEmpty")}</p>
      )}
      {generated.map((g) => (
        <div key={g.id} className="flex items-start gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-soft">
          <button
            onClick={() => open(g.id)}
            data-track="generated-open"
            data-tip={t("stitch.openGenerated")}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-[14px] font-semibold text-sand-800 hover:text-clay-800">
              {g.title}
            </span>
            {g.command && (
              <span className="mt-0.5 line-clamp-2 block text-xs text-sand-500">
                {t("stitch.generatedFrom", { command: g.command })}
              </span>
            )}
            <span className="mt-1 block text-[11px] text-sand-500">
              {t("stitch.blockCount", { n: g.blockCount })} · {new Date(g.createdAt).toLocaleString()}
            </span>
          </button>
          {canEdit && (
            <button
              onClick={() => void remove(g.id)}
              data-track="generated-delete"
              disabled={busyId !== null}
              data-tip={t("stitch.deleteGeneratedTitle")}
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] text-sand-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950"
            >
              {t("stitch.deleteGenerated")}
            </button>
          )}
        </div>
      ))}
    </aside>
  );
}
