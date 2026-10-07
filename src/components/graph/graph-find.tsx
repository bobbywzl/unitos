"use client";

// [view2] Find across the project (SPEC.md §13): words typed in the graph's
// header light the documents that hold them, each with its count of
// passages, and the Find list beside the canvas shows the passages, each a
// jump into the reader. Pick these documents hands them to Stitch, and Ask
// Stitch puts a question in its box for the reader to send. A word match,
// never a model call (GET .../find).

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GraphNode } from "@/lib/types";
import type { FindDocument, FindPassage } from "@/lib/graph/find";
import { FIND_MORE, FIND_SNIPPETS } from "@/lib/graph/find";
import { SearchIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useGraphContent, type FindState } from "@/components/graph/graph-content";

export function FindBox({ find }: { find: FindState }) {
  const t = useT();
  return (
    <label
      data-graph-find
      className="flex h-[34px] min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-[13px] text-sand-600 focus-within:border-clay-400 max-[900px]:w-[220px] min-[901px]:w-[200px] min-[1600px]:w-[260px]"
    >
      <SearchIcon size={13} />
      <input
        type="search"
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        placeholder={t("graphView.findPlaceholder")}
        aria-label={t("graphView.findLabel")}
        maxLength={100}
        data-track="graph-find"
        // The box draws the focus (its border); the global ring would draw a second one inside it.
        style={{ outline: "none" }}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-sand-500 [&::-webkit-search-cancel-button]:hidden"
      />
      {find.query && (
        <button
          type="button"
          onClick={find.clear}
          aria-label={t("graphView.findClear")}
          data-tip={t("graphView.findClear")}
          className="flex size-5 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      )}
    </label>
  );
}

function Passage({ p, onOpen }: { p: FindPassage; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onOpen}
      data-track="graph-find-passage"
      data-graph-find-passage={p.blockId}
      data-tip={t("graphView.findPassageTitle")}
      className="block w-full rounded-lg px-1.5 py-1 text-left text-[12px] leading-snug text-sand-700 hover:bg-clay-100/60"
    >
      {p.text.slice(0, p.start)}
      <mark className="rounded-[3px] bg-clay-100 px-px font-semibold text-clay-800">{p.text.slice(p.start, p.end)}</mark>
      {p.text.slice(p.end)}
    </button>
  );
}

function FindGroup({
  notebookId,
  doc,
  title,
  q,
  onOpenDocument,
}: {
  notebookId: string;
  doc: FindDocument;
  title: string;
  q: string;
  onOpenDocument: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { select } = useGraphContent();
  const [more, setMore] = useState<FindPassage[]>([]);
  const [loading, setLoading] = useState(false);
  const shown = [...doc.passages, ...more];
  const left = doc.count - shown.length;
  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      const after = Math.max(FIND_SNIPPETS, shown.length);
      const r = await fetch(
        `/api/notebooks/${notebookId}/find?q=${encodeURIComponent(q)}&documentId=${encodeURIComponent(doc.id)}&after=${after}`,
      );
      if (r.ok) {
        const data = (await r.json()) as { documents: FindDocument[] };
        setMore((prev) => [...prev, ...(data.documents[0]?.passages ?? [])]);
      }
    } finally {
      setLoading(false);
    }
  }
  return (
    <div data-graph-find-group={doc.id} className="rounded-xl border border-line p-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => select(doc.id)}
          data-track="graph-find-document"
          data-tip={t("graphView.cardNeighbourTitle")}
          className="min-w-0 truncate rounded-full bg-sand-200 px-2.5 py-0.5 text-[12px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {title}
        </button>
        <span className="ml-auto shrink-0 rounded-full bg-clay-100 px-1.5 text-[11px] font-semibold tabular-nums text-clay-800">
          {doc.count}
        </span>
      </div>
      <div className="mt-1 flex flex-col">
        {shown.map((p) => (
          <Passage
            key={p.blockId}
            p={p}
            onOpen={() => {
              router.push(`/n/${notebookId}?doc=${doc.id}&block=${p.blockId}`);
              onOpenDocument();
            }}
          />
        ))}
      </div>
      {left > 0 && (
        <button
          onClick={() => void loadMore()}
          disabled={loading}
          className="mt-1 px-1.5 text-[11.5px] text-clay-700 hover:underline disabled:opacity-50"
        >
          {t("graphView.findMore", { n: Math.min(left, FIND_MORE) })}
        </button>
      )}
    </div>
  );
}

export function FindList({
  notebookId,
  find,
  nodes,
  canPick,
  onPickAll,
  onAsk,
  onOpenDocument,
  onClose,
}: {
  notebookId: string;
  find: FindState;
  nodes: GraphNode[];
  canPick: boolean;
  onPickAll: (ids: string[]) => void;
  onAsk: (text: string) => void;
  onOpenDocument: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const titleOf = new Map(nodes.map((n) => [n.id, n.title]));
  const docs = (find.result?.documents ?? []).filter((d) => titleOf.has(d.id));
  const passages = docs.reduce((s, d) => s + d.count, 0);
  const q = find.result?.q ?? "";
  return (
    <aside
      data-track-surface="sidebar"
      data-graph-find-list
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto overscroll-contain rounded-[20px] border border-line bg-card/95 p-4 shadow-float backdrop-blur-md max-[999px]:bottom-16"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-sand-700" data-graph-find-summary>
          {find.error
            ? t("graphView.findFailed")
            : find.result === null
              ? t("graphView.findLoading")
              : docs.length === 0
                ? t("graphView.findNone")
                : t("graphView.findSummary", {
                    n: docs.length,
                    total: nodes.length,
                    ts: nodes.length === 1 ? "" : "s",
                    p: passages,
                    ps: passages === 1 ? "" : "s",
                  })}
        </p>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {canPick && (
            <button
              onClick={() => onPickAll(docs.map((d) => d.id))}
              data-track="graph-find-pick"
              className="rounded-full border border-line px-3 py-1.5 text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {docs.length === 1 ? t("graphView.findPickOne") : t("graphView.findPick", { n: docs.length })}
            </button>
          )}
          {canPick && docs.length >= 2 && (
            <button
              onClick={() => {
                onPickAll(docs.map((d) => d.id));
                onAsk(t("graphView.findAskTemplate", { q }));
              }}
              data-track="graph-find-ask"
              className="rounded-full bg-clay px-3.5 py-1.5 text-[12px] font-semibold text-clay-fg hover:bg-clay-600"
            >
              {t("graphView.findAsk")}
            </button>
          )}
        </div>
      )}
      {docs.map((d) => (
        <FindGroup
          key={`${q}:${d.id}`}
          notebookId={notebookId}
          doc={d}
          title={titleOf.get(d.id) ?? ""}
          q={q}
          onOpenDocument={onOpenDocument}
        />
      ))}
    </aside>
  );
}
