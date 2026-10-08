"use client";

// What the reader's notes cover, on the graph (SPEC.md §13, VIEW4-01): a
// dot before each part in the Documents list (sage when a note quotes the
// part, empty when none does), "N of M parts noted" and "Not opened" on each
// document's row, the head's counts with Gaps only, a ring around each
// node's dot filled by the share of its parts noted, and No reply on the
// Links list. Stored rows only, no model call: GET .../graph/coverage
// (lib/graph/coverage.ts), fetched when the graph opens and again when the
// project's notes change. The pieces are small so a list hooks them in at a
// few points: CoverageHead, DocumentCoverageLine, PartDot, CoverageRing,
// useCoverageGaps, NoReplyToggle.
//
// [layer5] The reader's layer (VIEW5-01/02, WALK5-06/07): the comments on
// each document (a small mark on the node, one line in the card and the
// row that opens into them, the count in the head text), a document with
// no parts as one part,
// the whole document, Gaps only as "no note here" with the reason on each
// row, and No reply as "waiting for your reply" (the last open reply is
// another person's). NodeComments, NodeCommentsLine, DocumentComments,
// GapReasons, useWaitsForReply.

import { ACTION, ACTION_ON } from "./graph-ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GraphEdgeLink } from "@/lib/types";
import {
  gapReasons,
  notedShare,
  openComments,
  waitsForReply,
  type DocumentCoverage,
  type GraphComment,
  type ProjectCoverage,
} from "@/lib/graph/coverage-view";
import { annotationReferenceHref } from "@/lib/annotation-reference";
import { CommentIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { useGraphNotes } from "@/components/graph/graph-notes";

type CoverageValue = {
  coverage: ProjectCoverage | null;
  gapsOnly: boolean;
  setGapsOnly: (on: boolean) => void;
};

const CoverageContext = createContext<CoverageValue>({
  coverage: null,
  gapsOnly: false,
  setGapsOnly: () => undefined,
});
// The last answer per project, so a reopened graph draws at once.
const kept = new Map<string, ProjectCoverage>();

/** The notes' sources as one short key: it moves when a note is added,
    removed, accepted, or gets a new source, so the coverage is read again. */
function useNotesKey(): string {
  const every = useGraphNotes()?.every;
  return useMemo(() => {
    if (!every) return "";
    const parts = [...every.notes, ...every.projectNotes].map(
      (g) => `${g.note.id}:${g.note.status}:${g.note.sources.map((s) => `${s.id}${s.orphaned ? "o" : ""}`).join(",")}`,
    );
    parts.sort();
    let h = 5381;
    for (const ch of parts.join("|")) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return `${parts.length}:${h.toString(36)}`;
  }, [every]);
}

export function GraphCoverageProvider({ notebookId, children }: { notebookId: string; children: React.ReactNode }) {
  const [coverage, setCoverage] = useState<ProjectCoverage | null>(() => kept.get(notebookId) ?? null);
  const [gapsOnly, setGapsOnly] = useState(false);
  const key = useNotesKey();
  useEffect(() => {
    const controller = new AbortController();
    // A beat after the notes change: a burst of edits reads once.
    const timer = window.setTimeout(() => {
      fetch(`/api/notebooks/${notebookId}/graph/coverage`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<ProjectCoverage>) : null))
        .then((data) => {
          if (!data) return;
          kept.set(notebookId, data);
          setCoverage(data);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [notebookId, key]);
  const value = useMemo(() => ({ coverage, gapsOnly, setGapsOnly }), [coverage, gapsOnly]);
  return <CoverageContext.Provider value={value}>{children}</CoverageContext.Provider>;
}

export function useDocumentCoverage(documentId: string): DocumentCoverage | null {
  return useContext(CoverageContext).coverage?.documents[documentId] ?? null;
}

/** [layer5] waitsForReply for the account signed in. */
export function useWaitsForReply(): (link: GraphEdgeLink) => boolean {
  const { myId } = useCollab();
  return useCallback((link: GraphEdgeLink) => waitsForReply(link, myId), [myId]);
}

/** What Gaps only keeps in the Documents list. Off, everything stays. */
export function useCoverageGaps() {
  const { coverage, gapsOnly } = useContext(CoverageContext);
  return useMemo(() => {
    const doc = (id: string) => coverage?.documents[id] ?? null;
    const partGap = (id: string, blockId: string) => {
      const p = doc(id)?.parts.find((x) => x.blockId === blockId);
      return p !== undefined && p.noted === 0;
    };
    const gaps = gapsOnly && coverage !== null;
    return {
      on: gaps,
      /** A part stays when no note quotes it. */
      keepPart: (id: string, blockId: string) => !gaps || partGap(id, blockId),
      /** [layer5] Gaps only is about notes (WALK5-06): links hide, as notes
          do; the Links list's No reply keeps the links waiting for a reply. */
      keepLink: () => !gaps,
      /** A document's notes hide while Gaps only is on: they are not gaps. */
      keepNotes: !gaps,
      /** A row stays when it holds a gap (gapReasons). A generated document has no coverage. */
      keepRow: (id: string) => !gaps || gapReasons(doc(id)).length > 0,
    };
  }, [coverage, gapsOnly]);
}


/** The Documents list's head: the parts noted, the documents not opened,
    the links waiting for a reply, and the Gaps only switch. */
export function CoverageHead({ documentIds, links }: { documentIds: string[]; links: GraphEdgeLink[] }) {
  const t = useT();
  const { coverage, gapsOnly, setGapsOnly } = useContext(CoverageContext);
  const waits = useWaitsForReply();
  if (!coverage) return null;
  const docs = documentIds.flatMap((id) => (coverage.documents[id] ? [coverage.documents[id]] : []));
  if (docs.length === 0) return null;
  const parts = docs.reduce((n, d) => n + d.parts.length, 0);
  const noted = docs.reduce((n, d) => n + d.parts.filter((p) => p.noted > 0).length, 0);
  const unopened = docs.filter((d) => !d.opened).length;
  const accepted = links.filter((l) => !l.recommended && !l.provenance);
  const noReply = accepted.filter(waits).length;
  // [panel6] VIEW6-07: the counts are text, "·" between them; Gaps only is the one pill.
  const counts = [
    parts > 0 && (
      <span key="parts" data-graph-coverage-parts={`${noted}/${parts}`} data-tip={t("graphCover.headPartsTitle")}>
        {t("graphCover.headParts", { n: noted, m: parts })}
      </span>
    ),
    <span
      key="unopened"
      data-graph-coverage-unopened={`${unopened}/${docs.length}`}
      data-tip={t("graphCover.headUnopenedTitle", { n: unopened, m: docs.length })}
    >
      {t("graphCover.headUnopened", { n: unopened })}
    </span>,
    // [lists7] WALK7-04: said only when a question waits.
    noReply > 0 && (
      <span key="noreply" data-graph-coverage-noreply={`${noReply}/${accepted.length}`} data-tip={t("graphCover.noReplyTitle")}>
        {noReply === 1 ? t("graphCover.headNoReplyOne") : t("graphCover.headNoReply", { n: noReply })}
      </span>
    ),
  ].filter(Boolean);
  return (
    <div data-graph-coverage-head className="flex items-center gap-2">
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-sand-600 tabular-nums">
        {counts.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="text-sand-400"> · </span>}
            {c}
          </span>
        ))}
      </p>
      <button
        onClick={() => setGapsOnly(!gapsOnly)}
        aria-pressed={gapsOnly}
        data-track="graph-documents-gaps"
        data-graph-gaps-only
        data-tip={t("graphCover.gapsOnlyTitle")}
        className={gapsOnly ? ACTION_ON : ACTION}
      >
        {t("graphCover.gapsOnly")}
      </button>
    </div>
  );
}

/** Under a document's title: "N of M parts noted" (a document with no parts:
    whether a note quotes it, with its dot), [layer5] its open comments (a
    press lists them in the row), and "Not opened". */
export function DocumentCoverageLine({
  documentId,
  commentsOpen = false,
  onToggleComments,
}: {
  documentId: string;
  /** [layer5] The row lists its open comments (a press on their count). */
  commentsOpen?: boolean;
  onToggleComments?: () => void;
}) {
  const t = useT();
  const c = useDocumentCoverage(documentId);
  if (!c) return null;
  const noted = c.parts.filter((p) => p.noted > 0).length;
  const whole = c.parts.length === 1 && c.parts[0].whole ? c.parts[0] : null;
  const open = openComments(c);
  return (
    <span data-graph-coverage-line={documentId} className="flex flex-wrap items-center gap-1.5 text-[11px] text-sand-600">
      {whole ? (
        <span data-graph-coverage-whole={whole.noted > 0 ? "noted" : "empty"}>
          <PartDot documentId={documentId} blockId="" />
          {whole.noted > 0 ? t("graphCover.wholeNoted") : t("graphCover.wholeEmpty")}
        </span>
      ) : (
        c.parts.length > 0 && <span data-graph-coverage-noted={`${noted}/${c.parts.length}`}>{t("graphCover.partsNoted", { n: noted, m: c.parts.length })}</span>
      )}
      {open.length > 0 && (
        <button
          onClick={onToggleComments}
          aria-expanded={commentsOpen}
          data-graph-coverage-comments={open.length}
          data-track="graph-documents-comments"
          data-tip={t("graphCover.commentsShowTitle")}
          className="inline-flex items-center gap-0.5 font-semibold text-[var(--kind-comment)] hover:underline"
        >
          <CommentIcon size={10} />
          {open.length === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: open.length })}
          {open.some((x) => x.asks) && <AsksMark />}
        </button>
      )}
      {!c.opened && (
        <span
          data-graph-not-opened
          data-tip={t("graphCover.notOpenedTitle")}
          className="rounded-full border border-dashed border-sand-400 px-1.5 text-[10.5px] font-semibold text-sand-600"
        >
          {t("graphCover.notOpened")}
        </span>
      )}
    </span>
  );
}

/** [layer5] Why Gaps only keeps a row (WALK5-06), one line in one shape:
    "Not opened · No note in 7 of 8 parts" / "No note quotes this document". */
export function GapReasons({ documentId }: { documentId: string }) {
  const t = useT();
  const reasons = gapReasonLines(t, useDocumentCoverage(documentId));
  if (reasons.length === 0) return null;
  return (
    <span data-graph-gap-why={documentId} className="text-[11.5px] font-semibold text-clay-800">
      {reasons.join(" · ")}
    </span>
  );
}

/** [layer5] The gap reasons as words, for GapReasons and the one-line row. */
export function gapReasonLines(t: ReturnType<typeof useT>, c: DocumentCoverage | null): string[] {
  return gapReasons(c).map((r) =>
    r.kind === "notOpened"
      ? t("graphCover.notOpened")
      : r.kind === "whole"
        ? t("graphCover.wholeEmpty")
        : t("graphCover.gapParts", { n: r.n, m: r.m }),
  );
}

/** Before a part's title: sage when a note quotes the part, empty when none does. */
export function PartDot({ documentId, blockId }: { documentId: string; blockId: string }) {
  const t = useT();
  const part = useDocumentCoverage(documentId)?.parts.find((p) => p.blockId === blockId);
  if (!part) return null;
  const tip = [
    part.noted === 0
      ? t(part.whole ? "graphCover.wholeEmpty" : "graphCover.partEmpty")
      : part.noted === 1
        ? t(part.whole ? "graphCover.wholeNotedOne" : "graphCover.partNotedOne")
        : t(part.whole ? "graphCover.wholeNotedMany" : "graphCover.partNotedMany", { n: part.noted }),
    part.annotated === 0
      ? null
      : part.annotated === 1
        ? t("graphCover.partAnnotationsOne")
        : t("graphCover.partAnnotationsMany", { n: part.annotated }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      data-graph-part-dot={part.noted > 0 ? "noted" : "empty"}
      role="img"
      aria-label={tip}
      data-tip={tip}
      className={`mr-1 inline-block size-[7px] rounded-full align-middle ${
        part.noted > 0 ? "bg-sage-500" : "border border-sand-400 bg-transparent"
      }`}
    />
  );
}

/** Around a node's dot: a thin ring, its sage arc the share of the
    document's parts noted (a document with no parts is one part). Nothing
    for a document with no coverage (generated). [layer5] The ring keeps
    its size on screen at a far zoom (VIEW5-08): its radius and stroke grow
    as the view zooms out (.graph-coverage-ring, globals.css, from
    --graph-zoom), so it reads at 40 and 200 documents. */
export function CoverageRing({ documentId, size }: { documentId: string; size: number }) {
  const t = useT();
  const c = useDocumentCoverage(documentId);
  if (!c || (c.parts.length === 0 && c.notes === 0)) return null;
  const share = notedShare(c);
  const box = size + 11;
  const noted = c.parts.filter((p) => p.noted > 0).length;
  const whole = c.parts.length === 1 && c.parts[0].whole;
  const label =
    c.parts.length > 0 && !whole
      ? t("graphCover.partsNoted", { n: noted, m: c.parts.length })
      : share > 0
        ? t("graphCover.wholeNoted")
        : t("graphCover.wholeEmpty");
  const circle = { cx: box / 2, cy: box / 2, fill: "none", pathLength: 100 } as const;
  return (
    <svg
      data-graph-coverage-ring={documentId}
      data-share={share.toFixed(2)}
      role="img"
      aria-label={label}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      style={{ "--ring-dot": `${size / 2}px` } as React.CSSProperties}
      className="graph-coverage-ring pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 overflow-visible"
    >
      <circle {...circle} stroke="var(--sand-300)" />
      {share > 0 && <circle {...circle} data-arc stroke="var(--sage-600)" strokeLinecap="round" strokeDasharray={`${share * 100} 100`} />}
    </svg>
  );
}

/** The Links list's No reply switch. */
export function NoReplyToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      data-track="graph-links-no-reply"
      data-graph-links-no-reply
      data-tip={t("graphCover.noReplyTitle")}
      className={on ? ACTION_ON : ACTION}
    >
      {t("graphCover.noReply")}
    </button>
  );
}

// [layer5] The reader's comments on the graph (VIEW5-01/02): a small mark
// right of the node's notes chip, one line in the card and in the Documents
// row that opens into the comments. Every row opens the comment in the reader, at the address an
// annotation reference uses. Stored rows only (the coverage answer).

/** The "?" a comment that ends with a question mark carries. */
function AsksMark() {
  const t = useT();
  return (
    <span data-graph-comment-asks aria-label={t("graphCover.commentAsksTitle")} data-tip={t("graphCover.commentAsksTitle")} className="font-bold">
      ?
    </span>
  );
}

export function useDocumentComments(documentId: string): GraphComment[] {
  return useContext(CoverageContext).coverage?.documents[documentId]?.comments ?? [];
}

/** The whole coverage answer: the canvas's kept labels read it (VIEW5-07). */
export function useProjectCoverage(): ProjectCoverage | null {
  return useContext(CoverageContext).coverage;
}

/** On a node: the comment glyph and the open comments, a "?" when one ends
    with a question mark. Hidden at a far zoom, like the notes chip. */
export function NodeComments({ documentId }: { documentId: string }) {
  const t = useT();
  const open = useDocumentComments(documentId).filter((c) => c.open);
  if (open.length === 0) return null;
  const label = open.length === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: open.length });
  return (
    <span
      data-graph-node-comments={open.length}
      aria-label={label}
      data-tip={label}
      className="flex items-center gap-px text-[10px] font-semibold tabular-nums text-[var(--kind-comment)]"
    >
      <CommentIcon size={10} />
      {open.length}
      {open.some((c) => c.asks) && "?"}
    </span>
  );
}

/** How wide the node's comments chip runs, in flow units (curve-place.ts
    keeps a curve's marks off it). 0: no chip. */
export function nodeCommentsWidth(c: DocumentCoverage | null | undefined): number {
  const open = openComments(c);
  if (open.length === 0) return 0;
  return 13 + String(open.length).length * 6 + (open.some((x) => x.asks) ? 5 : 0);
}

/** One comment as a row: its words (three lines), a "?" when it asks, its
    replies; a click opens it in the reader. */
function CommentRow({ notebookId, documentId, comment: c, onOpenDocument }: { notebookId: string; documentId: string; comment: GraphComment; onOpenDocument: () => void }) {
  const t = useT();
  const router = useRouter();
  return (
    <button
      data-graph-comment={c.id}
      data-track="graph-comment-open"
      onClick={() => {
        router.push(annotationReferenceHref(notebookId, { annotationId: c.id, documentId, sourceId: c.sourceId, kind: "comment" }));
        onOpenDocument();
      }}
      data-tip={t("graphCover.commentOpenTitle")}
      className={`flex w-full items-start gap-1.5 rounded-xl px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--kind-comment)_8%,transparent)] ${c.open ? "" : "opacity-60"}`}
    >
      <CommentIcon size={12} className="mt-[3px] shrink-0 text-[var(--kind-comment)]" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-3 text-[12.5px] leading-snug text-ink">{c.text}</span>
        {(c.replies > 0 || !c.open) && (
          <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-sand-600">
            {c.replies > 0 && <span>{c.replies === 1 ? t("graphNotes.replyCountOne") : t("graphNotes.replyCountMany", { n: c.replies })}</span>}
            {!c.open && <span>{t("graphCover.commentResolved")}</span>}
          </span>
        )}
      </span>
      {c.open && c.asks && (
        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--kind-comment)_12%,transparent)] px-1.5 text-[11px] text-[var(--kind-comment)]">
          <AsksMark />
        </span>
      )}
    </button>
  );
}

/** The node card's comments: one line, "2 open comments ? · 1 resolved",
    that a press opens into the comments (open first), each a row that
    opens the comment in the reader. */
export function NodeCommentsLine({ notebookId, documentId, onOpenDocument }: { notebookId: string; documentId: string; onOpenDocument: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(documentId);
  if (shownFor !== documentId) {
    setShownFor(documentId);
    setOpen(false);
  }
  const comments = useDocumentComments(documentId);
  if (comments.length === 0) return null;
  const openOnes = comments.filter((c) => c.open);
  const resolved = comments.length - openOnes.length;
  return (
    <div data-graph-card-comments={comments.length} className="-mt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-track="graph-card-comments"
        data-tip={t("graphCover.commentsShowTitle")}
        className="inline-flex min-h-6 items-center gap-1 text-[11.5px] font-semibold text-[var(--kind-comment)] hover:underline pointer-coarse:min-h-10"
      >
        <CommentIcon size={11} />
        {openOnes.length === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: openOnes.length })}
        {openOnes.some((c) => c.asks) && <AsksMark />}
        {resolved > 0 && (
          <span className="font-normal text-sand-600">
            · {resolved === 1 ? t("common.resolvedCountOne") : t("common.resolvedCountMany", { n: resolved })}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5">
          {comments.map((c) => (
            <CommentRow key={c.id} notebookId={notebookId} documentId={documentId} comment={c} onOpenDocument={onOpenDocument} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A Documents row's open comments, once their count is pressed: every one, in reading order. */
export function DocumentComments({ notebookId, documentId, onOpenDocument }: { notebookId: string; documentId: string; onOpenDocument: () => void }) {
  const open = useDocumentComments(documentId).filter((c) => c.open);
  if (open.length === 0) return null;
  return (
    <div data-graph-documents-comments={open.length} className="flex flex-col gap-0.5">
      {open.map((c) => (
        <CommentRow key={c.id} notebookId={notebookId} documentId={documentId} comment={c} onOpenDocument={onOpenDocument} />
      ))}
    </div>
  );
}
