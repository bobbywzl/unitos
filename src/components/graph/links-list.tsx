"use client";

import { useState } from "react";
import type { GraphEdge, GraphEdgeLink } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { clipWords } from "@/lib/markdown-preview";
import { useGraphNotes } from "@/components/graph/graph-notes";
import { LinkReplyCount } from "@/components/graph/link-replies";
import { NoReplyToggle, hasNoReply } from "@/components/graph/coverage"; // [cover4]

// Links, a folded list beside the canvas (SPEC.md §13; WALK2-06): every
// accepted link of the project, grouped by the pair of documents it joins,
// the pairs with the most links first. A row opens the link in the side
// panel (link-panel.tsx). It reaches every link without hitting a curve:
// the one sure way on a phone, and a fast one on a crowded canvas. Hovering
// or focusing a row lights its two documents. Provenance links are not
// listed: they are the generated document's, not the reader's. A filter at
// the top keeps the links whose documents or reason hold its words; opened
// while a node card is pinned, it starts on that document (WALK3-15).

export function LinksList({
  edges,
  titleOf,
  openLinkId,
  onOpen,
  onClose,
  initialFilter = "",
}: {
  edges: GraphEdge[];
  titleOf: Map<string, string>;
  openLinkId: string | null;
  initialFilter?: string;
  onOpen: (link: GraphEdgeLink) => void;
  onClose: () => void;
}) {
  const t = useT();
  const setRowLit = useGraphNotes()?.setRowLit;
  const [filter, setFilter] = useState(initialFilter);
  const [noReply, setNoReply] = useState(false); // [cover4] No reply (VIEW4-01)
  const words = filter.trim().toLowerCase();
  const all = edges
    .map((e) => ({ edge: e, links: e.links.filter((l) => !l.recommended && !l.provenance) }))
    .filter((g) => g.links.length > 0)
    .sort((x, y) => y.links.length - x.links.length);
  const total = all.reduce((n, g) => n + g.links.length, 0);
  const kept = noReply
    ? all.map((g) => ({ ...g, links: g.links.filter(hasNoReply) })).filter((g) => g.links.length > 0)
    : all;
  const groups = words
    ? kept
        .map(({ edge, links }) => {
          const titles = `${titleOf.get(edge.a) ?? ""} ${titleOf.get(edge.b) ?? ""}`.toLowerCase();
          return {
            edge,
            links: titles.includes(words) ? links : links.filter((l) => (l.reason ?? l.quotedText).toLowerCase().includes(words)),
          };
        })
        .filter((g) => g.links.length > 0)
    : kept;
  const light = (e: GraphEdge | null) => setRowLit?.(e ? new Set([e.a, e.b]) : null);
  return (
    <aside
      data-track-surface="graph-links-list"
      data-graph-side-list="links"
      id="graph-list-links"
      tabIndex={-1}
      aria-label={t("panes.graphLinks")}
      className="menu-in absolute top-3 right-3 bottom-3 z-10 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 pb-24 shadow-float outline-none backdrop-blur-md max-[999px]:bottom-16 max-[999px]:pb-4"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[11px] text-sand-500">{t("panes.graphLinksDesc")}</p>
        <button
          onClick={onClose}
          data-track="graph-links-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      {total > 1 && (
        <div className="flex items-center gap-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("panes.graphLinksFilter")}
          aria-label={t("panes.graphLinksFilter")}
          data-track="graph-links-filter"
          maxLength={100}
          className="min-w-0 flex-1 rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink placeholder:text-sand-500 focus:border-clay-400"
        />
        <NoReplyToggle on={noReply} onChange={setNoReply} />
        </div>
      )}
      {total === 0 && <p className="text-[13px] text-sand-600">{t("panes.graphLinksEmpty")}</p>}
      {total > 0 && groups.length === 0 && (
        <p className="text-[13px] text-sand-600">{noReply && kept.length === 0 ? t("graphCover.noReplyNone") : t("panes.graphLinksFilterNone")}</p>
      )}
      {groups.map(({ edge, links }) => (
        <div
          key={`${edge.a}|${edge.b}`}
          className="flex flex-col gap-1"
          onMouseEnter={() => light(edge)}
          onMouseLeave={() => light(null)}
          onFocus={() => light(edge)}
          onBlur={() => light(null)}
        >
          <p className="text-[11.5px] font-semibold text-sage-700">
            {edge.a === edge.b
              ? t("panes.graphLinksLoopTitle", { title: titleOf.get(edge.a) ?? "" })
              : t("panes.graphLinksPairTitle", { a: titleOf.get(edge.a) ?? "", b: titleOf.get(edge.b) ?? "" })}
          </p>
          {links.map((l) => (
            <button
              key={l.id}
              onClick={() => onOpen(l)}
              data-track="graph-links-open"
              data-graph-links-row={l.id}
              aria-expanded={openLinkId === l.id}
              className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left hover:bg-clay-100/60 ${
                openLinkId === l.id ? "border-clay-300 bg-clay-100/50" : "border-line bg-card"
              }`}
            >
              <span className="text-[12.5px] leading-snug font-semibold text-ink">{l.reason ?? clipWords(l.quotedText, 60)}</span>
              {l.reason && <span className="text-[11px] leading-snug text-sand-600">{clipWords(l.quotedText, 40)}</span>}
              <LinkReplyCount link={l} />
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
