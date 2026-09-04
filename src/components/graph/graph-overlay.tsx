"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { useT } from "@/components/lang-provider";

// reactflow loads only when the graph opens — the workspace bundle stays lean.
const GraphView = dynamic(() => import("@/components/graph/graph-view"), {
  ssr: false,
  loading: () => null,
});

// Full-screen overlay over the workspace: the corpus as a connected whole.
export function GraphOverlay({
  notebookId,
  activeDocumentId,
  nodes,
  edges,
  onClose,
}: {
  notebookId: string;
  activeDocumentId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div data-track-surface="sidebar" className="graph-overlay-in fixed inset-0 z-50 flex flex-col bg-paper">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-display text-[18px]">{t("panes.graph")}</span>
        <span className="text-[13px] text-sand-600">
          {t("panes.graphCounts", {
            docs: nodes.length,
            links: edges.reduce((sum, e) => sum + e.accepted + e.recommended, 0),
          })}
        </span>
        <button
          onClick={onClose}
          data-track="graph-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {nodes.length < 2 ? (
          <p className="flex h-full items-center justify-center px-8 text-center text-sm text-sand-600">
            {t("panes.graphEmpty")}
          </p>
        ) : (
          <GraphView
            notebookId={notebookId}
            activeDocumentId={activeDocumentId}
            nodes={nodes}
            edges={edges}
            onOpenDocument={onClose}
          />
        )}
      </div>
    </div>
  );
}
