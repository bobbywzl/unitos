"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import type { GeneratedDocumentView } from "@/lib/types";

// Generated content (SPEC.md §22): every document the Stitch assistant wrote
// from the members, newest first, each with the command that made it. A row
// opens the document in the reader with the multi upload still at hand.

export function GeneratedList({
  notebookId,
  multiId,
  generated,
}: {
  notebookId: string;
  multiId: string;
  generated: GeneratedDocumentView[];
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    if (busyId || !confirm(t("multi.confirmDeleteGenerated"))) return;
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

  if (generated.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-sand-600">{t("multi.generatedEmpty")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs text-red-500">{error}</p>}
      {generated.map((g) => (
        <div key={g.id} className="flex items-start gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-soft">
          <button
            onClick={() => router.push(`/n/${notebookId}?doc=${g.id}&multi=${multiId}`)}
            data-track="generated-open"
            data-tip={t("multi.openGenerated")}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-[14px] font-semibold text-sand-800 hover:text-clay-800">
              {g.title}
            </span>
            {g.command && (
              <span className="mt-0.5 line-clamp-2 block text-xs text-sand-500">
                {t("multi.generatedFrom", { command: g.command })}
              </span>
            )}
            <span className="mt-1 block text-[11px] text-sand-500">
              {t("multi.blockCount", { n: g.blockCount })} · {new Date(g.createdAt).toLocaleString()}
            </span>
          </button>
          {canEdit && (
            <button
              onClick={() => void remove(g.id)}
              data-track="generated-delete"
              disabled={busyId !== null}
              data-tip={t("multi.deleteGeneratedTitle")}
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] text-sand-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950"
            >
              {t("multi.deleteGenerated")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
