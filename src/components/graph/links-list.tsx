"use client";

import { CLOSE, LIST_HEAD, TEXT_BODY, TEXT_META } from "./graph-ui";
import { useState } from "react";
import type { GraphEdge, GraphEdgeLink } from "@/lib/types";
import { useT } from "@/components/lang-provider";
import { clipWords } from "@/lib/markdown-preview";
import { useGraphNotes } from "@/components/graph/graph-notes";
import { LinkReplyCount } from "@/components/graph/link-replies";
import { useWaitingReply } from "@/components/graph/coverage"; // [lists9]
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { LinkDraftTag } from "@/components/graph/link-draft-tag"; // [ui5]
import { ListName } from "@/components/graph/list-name"; // [lists7]

// Links, a folded list beside the canvas (SPEC.md §13; WALK2-06): every
// accepted link of the project, grouped by the pair of documents it joins,
// the pairs with the most links first. A row opens the link in the side
// panel (link-panel.tsx). It reaches every link without hitting a curve:
// the one sure way on a phone, and a fast one on a crowded canvas. Hovering
// or focusing a row lights its two documents. Provenance links are not
// listed: they are the generated document's, not the reader's. A filter at
// the top keeps the links whose documents, reason or [lists8] replies hold its words; opened
// while a node card is pinned, it starts on that document (WALK3-15).
// [panel6] WALK6-06: a link whose last open reply is another person's shows
// that reply's first words and its person in place of the passage. [style9]
// WALK9-03: the Waiting on you switch left this list: the Documents head's
// "N waiting on you" lists every waiting link and comment (coverage.tsx,
// AllComments). The list's purpose is the Links pill's tooltip, not a
// paragraph here (VIEW6-06).

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
  // The asker's badge from the people map, as a reply thread draws it: none for an unknown author.
  const { people } = useCollab();
  // [lists9] The reply a link waits on, by the one rule (useWaitingReply: never for a viewer, never a removed collaborator's).
  const asks = useWaitingReply();
  const words = filter.trim().toLowerCase();
  const all = edges
    .map((e) => ({ edge: e, links: e.links.filter((l) => !l.recommended && !l.provenance) }))
    .filter((g) => g.links.length > 0)
    .sort((x, y) => y.links.length - x.links.length);
  const total = all.reduce((n, g) => n + g.links.length, 0);
  const groups = words
    ? all
        .map(({ edge, links }) => {
          const titles = `${titleOf.get(edge.a) ?? ""} ${titleOf.get(edge.b) ?? ""}`.toLowerCase();
          return {
            edge,
            // [lists8] WALK8-08: the replies' words count too.
            links: titles.includes(words)
              ? links
              : links.filter((l) =>
                  [l.reason ?? l.quotedText, ...(l.replies ?? []).map((r) => r.content)].some((x) => x.toLowerCase().includes(words)),
                ),
          };
        })
        .filter((g) => g.links.length > 0)
    : all;
  const light = (e: GraphEdge | null) => setRowLit?.(e ? new Set([e.a, e.b]) : null);
  return (
    <aside
      data-track-surface="graph-links-list"
      data-graph-side-list="links"
      id="graph-list-links"
      tabIndex={-1}
      aria-label={t("panes.graphLinks")}
      className="menu-in absolute top-3 right-3 z-10 max-h-[calc(100%-24px)] flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-2.5 overflow-y-auto rounded-[20px] border border-line bg-card/95 p-4 shadow-float outline-none backdrop-blur-md max-[999px]:max-h-[calc(100%-76px)]"
    >
      <div className={LIST_HEAD /* [lists8] WALK8-09 */}>
        <ListName grow={total <= 1}>{t("panes.graphLinks")}</ListName>
        {total > 1 && (
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("panes.graphLinksFilter")}
            aria-label={t("panes.graphLinksFilter")}
            data-track="graph-links-filter"
            maxLength={100}
            className={`min-w-0 flex-1 rounded-full border border-line bg-card px-3 py-1.5 ${TEXT_BODY} text-ink placeholder:text-sand-500 focus:border-clay-400`}
          />
        )}
        <button
          onClick={onClose}
          data-track="graph-links-close"
          aria-label={t("common.close")}
          data-tip={t("common.close")}
          className={`-mr-1 ${CLOSE}`}
        >
          ✕
        </button>
      </div>
      {total === 0 && <p className={`${TEXT_BODY} text-sand-600`}>{t("panes.graphLinksEmpty")}</p>}
      {total > 0 && groups.length === 0 && (
        <p className={`${TEXT_BODY} text-sand-600`}>{t("panes.graphLinksFilterNone")}</p>
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
          <p className={`${TEXT_META} font-semibold text-sage-700`}>
            {edge.a === edge.b
              ? t("panes.graphLinksLoopTitle", { title: titleOf.get(edge.a) ?? "" })
              : t("panes.graphLinksPairTitle", { a: titleOf.get(edge.a) ?? "", b: titleOf.get(edge.b) ?? "" })}
          </p>
          {links.map((l) => {
            const ask = asks(l);
            const asker = ask ? people[ask.userId] : undefined;
            return (
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
                <span className={`${TEXT_BODY} leading-snug font-semibold text-ink`}>
                  {l.reason ?? clipWords(l.quotedText, 60)}
                  <LinkDraftTag linkId={l.id} className="ml-1.5" /* [ui5] WALK5-13 */ />
                </span>
                {ask ? (
                  <span data-graph-links-asks={ask.id} className={`flex items-start gap-1.5 ${TEXT_BODY} leading-snug text-ink`}>
                    {asker && <PersonBadge person={asker} size={16} />}
                    <span className="line-clamp-2 min-w-0">{clipWords(ask.content, 160)}</span>
                  </span>
                ) : (
                  l.reason && <span className={`${TEXT_META} leading-snug text-sand-600`}>{clipWords(l.quotedText, 40)}</span>
                )}
                <LinkReplyCount link={l} />
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
