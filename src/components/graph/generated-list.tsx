"use client";

import { ACTION_DANGER, CLOSE } from "./graph-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { useLang, useT } from "@/components/lang-provider";
import { replyTime } from "@/components/collab/reply-thread";
import type { GeneratedDocumentView } from "@/lib/types";
import { useGraphContent } from "@/components/graph/graph-content";

// Generated content (SPEC.md §22): every document Stitch wrote for the
// project, newest first, each with the command that made it. The list
// folds beside the graph's canvas like the recommended links. A row opens
// the document in the reader. The switch at the top draws where generated
// documents come from (the provenance; the zoom stack's page button too).

export function GeneratedList({
  notebookId,
  generated,
  onOpenDocument,
  onClose,
}: {
  notebookId: string;
  generated: GeneratedDocumentView[];
  onOpenDocument: () => void;
  /** [chrome6] The ✕ the other side lists have. */
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { canEdit } = useCollab();
  const { showProvenance, setShowProvenance } = useGraphContent();
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
      data-graph-side-list="generated"
      id="graph-list-generated"
      tabIndex={-1}
      aria-label={t("stitch.generated")}
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 pb-24 shadow-float outline-none backdrop-blur-md max-[999px]:bottom-16 max-[999px]:pb-4"
    >
      {/* [chrome6] WALK6-08: one head row, the switch and ✕; the list's
          intro is the pill's tooltip. */}
      <div className="flex items-center gap-2">
      {generated.length > 0 ? (
        <button
          role="switch"
          aria-checked={showProvenance}
          onClick={() => setShowProvenance(!showProvenance)}
          data-track="graph-provenance-switch"
          className="flex min-h-6 min-w-0 items-center gap-2 rounded-full px-1 py-0.5 text-[12.5px] text-sand-700 hover:text-clay-800 pointer-coarse:min-h-10"
        >
          <span
            aria-hidden
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${showProvenance ? "bg-clay" : "bg-sand-300"}`}
          >
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-card transition-[left] ${showProvenance ? "left-3.5" : "left-0.5"}`}
            />
          </span>
          {t("stitch.generatedProvenance")}
        </button>
      ) : (
        <span className="flex-1" />
      )}
        <button
          onClick={onClose}
          data-track="graph-generated-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className={`-mr-1 ml-auto ${CLOSE}`}
        >
          ✕
        </button>
      </div>
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
              {t("stitch.blockCount", { n: g.blockCount })} · {replyTime(g.createdAt, lang)}
            </span>
          </button>
          {canEdit && (
            <button
              onClick={() => void remove(g.id)}
              data-track="generated-delete"
              disabled={busyId !== null}
              data-tip={t("stitch.deleteGeneratedTitle")}
              className={ACTION_DANGER}
            >
              {t("stitch.deleteGenerated")}
            </button>
          )}
        </div>
      ))}
    </aside>
  );
}
