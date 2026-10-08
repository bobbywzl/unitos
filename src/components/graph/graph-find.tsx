"use client";

// [view2] Find across the project (SPEC.md §13): words typed in the graph's
// header light the documents that hold them, each with its count of
// passages, and the Find list beside the canvas shows the passages, each a
// jump into the reader. Pick these documents adds them to the pick, and Ask
// Stitch adds them too and puts a question in its box for the reader to
// send: a pick the reader made stays (WALK3-04). Generated documents come
// last and stay out of the pick and the counts unless the provenance switch
// is on (WALK3-14). A word match, never a model call (GET .../find).

import { CLOSE, DOC_CHIP, LEAD, LEAD_PRIMARY, TEXT_HIT } from "./graph-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GraphNode } from "@/lib/types";
import type { FindDocument, FindPassage } from "@/lib/graph/find";
import { FIND_MORE, FIND_SNIPPETS } from "@/lib/graph/find";
import { SearchIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useGraphContent, type FindState } from "@/components/graph/graph-content";
import { AddToNote } from "@/components/graph/note-gather"; // [cover4]

export function FindBox({ find }: { find: FindState }) {
  const t = useT();
  return (
    <label
      data-graph-find
      className="flex h-[34px] min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-[13px] text-sand-600 focus-within:border-clay-400 max-[900px]:w-[220px] max-md:w-[104px] max-md:focus-within:w-[200px] min-[901px]:w-[200px] min-[901px]:max-[1099px]:w-[170px] min-[1600px]:w-[260px]"
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

function Passage({ p, documentId, onOpen }: { p: FindPassage; documentId: string; onOpen: () => void }) {
  const t = useT();
  return (
    <div className="group flex items-start gap-1">
    <button
      onClick={onOpen}
      data-track="graph-find-passage"
      data-graph-find-passage={p.blockId}
      data-tip={t("graphView.findPassageTitle")}
      className="block min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left text-[12px] leading-snug text-sand-700 hover:bg-clay-100/60"
    >
      {p.text.slice(0, p.start)}
      <mark className="rounded-[3px] bg-clay-100 px-px font-semibold text-clay-800">{p.text.slice(p.start, p.end)}</mark>
      {p.text.slice(p.end)}
    </button>
    {/* [cover4] The passage as a quote: its sentences (WALK5-10), or the row's words without the ellipses. */}
    <AddToNote quote={{ documentId, blockId: p.blockId, text: p.quote ?? p.text.replace(/^…|…$/g, "").trim() }} className="mt-1" />
    </div>
  );
}

function FindGroup({
  notebookId,
  doc,
  title,
  generated,
  q,
  onOpenDocument,
}: {
  notebookId: string;
  doc: FindDocument;
  title: string;
  generated: boolean;
  q: string;
  onOpenDocument: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { select } = useGraphContent();
  const [more, setMore] = useState<FindPassage[]>([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = [...doc.passages, ...more];
  const left = doc.count - shown.length;
  async function loadMore(limit: number) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const r = await fetch(
        `/api/notebooks/${notebookId}/find?q=${encodeURIComponent(q)}&documentId=${encodeURIComponent(doc.id)}&after=${shown.length}&limit=${limit}`,
      );
      if (r.ok) {
        const data = (await r.json()) as { documents: FindDocument[] };
        setMore((prev) => [...prev, ...(data.documents[0]?.passages ?? [])]);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }
  // A document past the first FIND_TOP comes with its count only (COST4-02):
  // its first passage loads when the row scrolls into view.
  const bare = shown.length === 0 && doc.count > 0;
  useEffect(() => {
    const el = box.current;
    if (!bare || !el) return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        void loadMore(FIND_SNIPPETS);
      }
    });
    seen.observe(el);
    return () => seen.disconnect();
    // loadMore reads shown.length, which is 0 while bare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare]);
  return (
    <div ref={box} data-graph-find-group={doc.id} className="rounded-xl border border-line p-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => select(doc.id)}
          data-track="graph-find-document"
          data-tip={t("graphView.cardNeighbourTitle")}
          className={DOC_CHIP}
        >
          {title}
        </button>
        {generated && <span className="shrink-0 text-[11px] text-sand-500">{t("panes.documentKindGenerated")}</span>}
        <span className="ml-auto shrink-0 rounded-full bg-clay-100 px-1.5 text-[11px] font-semibold tabular-nums text-clay-800">
          {doc.count}
        </span>
      </div>
      <div className="mt-1 flex flex-col">
        {shown.map((p) => (
          <Passage
            key={p.blockId}
            p={p}
            documentId={doc.id}
            onOpen={() => {
              router.push(`/n/${notebookId}?doc=${doc.id}&block=${p.blockId}`);
              onOpenDocument();
            }}
          />
        ))}
      </div>
      {left > 0 && (
        <button
          onClick={() => void loadMore(FIND_MORE)}
          disabled={loading}
          className={`${TEXT_HIT} mt-1 self-start px-1.5 text-[11.5px] text-clay-700 hover:underline disabled:opacity-50`}
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
  picked,
  onPickAll,
  onAsk,
  onOpenDocument,
  onClose,
}: {
  notebookId: string;
  find: FindState;
  nodes: GraphNode[];
  canPick: boolean;
  /** The documents picked for Stitch now. */
  picked: Set<string>;
  /** Adds the documents to the pick. */
  onPickAll: (ids: string[]) => void;
  onAsk: (text: string) => void;
  onOpenDocument: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { showProvenance, setShowProvenance } = useGraphContent();
  const titleOf = new Map(nodes.map((n) => [n.id, n.title]));
  const generatedIds = new Set(nodes.filter((n) => n.kind === "generated").map((n) => n.id));
  const found = (find.result?.documents ?? []).filter((d) => titleOf.has(d.id));
  const own = found.filter((d) => !generatedIds.has(d.id));
  // [layer5] Generated documents list only while the provenance switch is
  // on, as the canvas lights them and the count counts them (VIEW5-09).
  const foundGenerated = found.filter((d) => generatedIds.has(d.id));
  const docs = showProvenance ? [...own, ...foundGenerated] : own;
  const counted = showProvenance ? docs : own;
  const total = showProvenance ? nodes.length : nodes.length - generatedIds.size;
  const passages = counted.reduce((s, d) => s + d.count, 0);
  const q = find.result?.q ?? "";
  const pickIds = counted.map((d) => d.id);
  // The reader's own picks that Find did not find: Ask Stitch keeps them.
  const others = [...picked].filter((id) => titleOf.has(id) && !pickIds.includes(id)).length;
  return (
    <aside
      data-track-surface="sidebar"
      data-graph-find-list
      data-graph-side-list="find"
      tabIndex={-1}
      aria-label={t("graphView.findLabel")}
      className="menu-in absolute outline-none top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto overscroll-contain rounded-[20px] border border-line bg-card/95 p-4 pb-24 shadow-float backdrop-blur-md max-[999px]:bottom-16 max-[999px]:pb-4"
    >
      <div className="flex items-start gap-2">
        {/* A live region: a screen reader hears what Find found (WALK4-09). */}
        <p role="status" className="min-w-0 flex-1 text-[12.5px] leading-snug text-sand-700" data-graph-find-summary>
          {find.error
            ? t("graphView.findFailed")
            : find.result === null
              ? t("graphView.findLoading")
              : found.length === 0
                ? t("graphView.findNone")
                : t("graphView.findSummary", {
                    n: counted.length,
                    total,
                    ts: total === 1 ? "" : "s",
                    p: passages,
                    ps: passages === 1 ? "" : "s",
                  })}
        </p>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className={CLOSE}
        >
          ✕
        </button>
      </div>
      {counted.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {/* [chrome6] WALK6-08: Ask Stitch picks these documents too, so it
              is the one button; Pick shows only where Ask cannot run (one
              document, nothing else picked). */}
          {canPick && counted.length + others < 2 && (
            <button
              onClick={() => onPickAll(pickIds)}
              data-track="graph-find-pick"
              className={`${LEAD} border-line text-sand-700 hover:bg-clay-100 hover:text-clay-800`}
            >
              {t("graphView.findPickOne")}
            </button>
          )}
          {canPick && counted.length + others >= 2 && (
            <button
              onClick={() => {
                onPickAll(pickIds);
                onAsk(t("graphView.findAskTemplate", { q }));
              }}
              data-track="graph-find-ask"
              data-tip={t("graphView.findAskTitle")}
              className={LEAD_PRIMARY}
            >
              {others > 0
                ? t(counted.length === 1 ? "graphView.findAskWithPicksOne" : "graphView.findAskWithPicks", {
                    n: counted.length,
                    m: others,
                    ms: others === 1 ? "" : "s",
                  })
                : t("graphView.findAsk")}
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
          generated={generatedIds.has(d.id)}
          q={q}
          onOpenDocument={onOpenDocument}
        />
      ))}
      {!showProvenance && foundGenerated.length > 0 && (
        <p data-graph-find-generated-hidden={foundGenerated.length} className="text-[11.5px] leading-snug text-sand-600">
          {t("panes.graphDocumentsGeneratedHidden", { n: foundGenerated.length, s: foundGenerated.length === 1 ? "" : "s" })}{" "}
          <button
            onClick={() => setShowProvenance(true)}
            data-track="graph-find-show-generated"
            className={`${TEXT_HIT} font-semibold text-clay-700 underline decoration-dotted underline-offset-2 hover:text-clay-800`}
          >
            {t("panes.graphDocumentsGeneratedShow")}
          </button>
        </p>
      )}
    </aside>
  );
}
