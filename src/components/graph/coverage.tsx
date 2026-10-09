"use client";

// What the reader's notes cover, on the graph (SPEC.md §13, VIEW4-01): a
// dot before each part in the Documents list (sage when a note quotes the
// part, empty when none does), "N of M parts noted" and "Not opened" on each
// document's row, the head's counts with Gaps only, a ring around each
// node's dot filled by the share of its parts noted, and "N waiting on you"
// in the head. Stored rows only, no model call: GET .../graph/coverage
// (lib/graph/coverage.ts), fetched when the graph opens and again when the
// project's notes change. The pieces are small so a list hooks them in at a
// few points: CoverageHead, DocumentCoverageLine, PartDot, CoverageRing,
// useCoverageGaps, AllComments.
//
// [layer5] The reader's layer (VIEW5-01/02, WALK5-06/07): the comments on
// each document (a small mark on the node, one line in the card and the
// row that opens into them, the count in the head text), a document with
// no parts as one part,
// the whole document, Gaps only as "no note here" with the reason on each
// row, and "waiting on you" (the last open words are another person's).
// NodeComments, NodeCommentsLine, DocumentComments, GapReasons,
// useWaitsForReply. [style9] VIEW9-05, WALK9-03: "N waiting on you" is a
// press that lists every waiting link and comment (AllComments, waitingOnly).

import { ACTION, ACTION_ON, TEXT_BODY, TEXT_HIT, TEXT_META } from "./graph-ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GraphEdge, GraphEdgeLink, ReplyView } from "@/lib/types";
import {
  commentWaits,
  gapReasons,
  notedShare,
  openComments,
  waitingReply,
  waitsForReply,
  type DocumentCoverage,
  type GraphComment,
  type ProjectCoverage,
} from "@/lib/graph/coverage-view";
import { annotationReferenceHref } from "@/lib/annotation-reference";
import { LinkReplyCount } from "@/components/graph/link-replies";
import { CommentIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
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

/** [lists8] commentWaits for the account signed in (WALK8-01). */
export function useCommentWaits(): (c: GraphComment) => boolean {
  const { myId } = useCollab();
  return useCallback((c: GraphComment) => commentWaits(c, myId), [myId]);
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


/** What the Documents list shows: its rows, [lists8] every open comment
    (WALK8-02), or [style9] every thread waiting on you (VIEW9-05, WALK9-03). */
export type DocumentsListing = "rows" | "comments" | "waiting";

/** The Documents list's head: the parts noted, the documents not opened,
    [lists8] the open comments (a press lists them all, WALK8-02), what waits
    on this account (links and comments, WALK8-01; [style9] a press lists
    them all, VIEW9-05), and the Gaps only switch. */
export function CoverageHead({
  documentIds,
  links,
  listing = "rows",
  onListing,
}: {
  documentIds: string[];
  links: GraphEdgeLink[];
  /** What the list shows in place of the rows. */
  listing?: DocumentsListing;
  onListing?: (next: DocumentsListing) => void;
}) {
  const t = useT();
  const { coverage, gapsOnly, setGapsOnly } = useContext(CoverageContext);
  const waits = useWaitsForReply();
  const commentWaitsOn = useCommentWaits();
  const docs = documentIds.flatMap((id) => (coverage?.documents[id] ? [coverage.documents[id]] : []));
  const accepted = links.filter((l) => !l.recommended && !l.provenance);
  const linksWaiting = accepted.filter(waits).length;
  // [lists8] WALK8-01: one rule for links and comments.
  const open = docs.flatMap((d) => openComments(d));
  const commentsWaiting = open.filter(commentWaitsOn).length;
  const noReply = linksWaiting + commentsWaiting;
  // [style9] VIEW9-05: a listing whose count fell to none (the last comment
  // resolved, the last answer sent) has no press left; the rows come back.
  const listingGone = coverage !== null && ((listing === "comments" && open.length === 0) || (listing === "waiting" && noReply === 0));
  useEffect(() => {
    if (listingGone) onListing?.("rows");
  }, [listingGone, onListing]);
  if (!coverage || docs.length === 0) return null;
  const parts = docs.reduce((n, d) => n + d.parts.length, 0);
  const noted = docs.reduce((n, d) => n + d.parts.filter((p) => p.noted > 0).length, 0);
  const unopened = docs.filter((d) => !d.opened).length;
  const press = (which: DocumentsListing) => onListing?.(listing === which ? "rows" : which);
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
    // [lists8] WALK8-02: the open comments, a press that lists them all.
    open.length > 0 && (
      <button
        key="comments"
        onClick={() => press("comments")}
        aria-pressed={listing === "comments"}
        data-graph-coverage-comments-all={open.length}
        data-track="graph-documents-comments-all"
        data-tip={t("graphCover.commentsAllTitle")}
        className={`${TEXT_HIT} font-semibold text-[var(--kind-comment)] hover:underline ${listing === "comments" ? "underline" : ""}`}
      >
        {open.length === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: open.length })}
      </button>
    ),
    // [lists7] WALK7-04: said only when something waits. [style9] VIEW9-05,
    // WALK9-03: a press that lists every waiting link and comment (the Links
    // list's Waiting on you switch found the links only).
    noReply > 0 && (
      <button
        key="waiting"
        onClick={() => press("waiting")}
        aria-pressed={listing === "waiting"}
        data-graph-coverage-noreply={`${noReply}/${accepted.length + open.length}`}
        data-track="graph-documents-waiting"
        data-tip={`${t("graphCover.headNoReplyTitle", { l: linksWaiting, c: commentsWaiting })} ${t("graphCover.waitingAllTitle")}`}
        className={`${TEXT_HIT} font-semibold text-[var(--kind-comment)] hover:underline ${listing === "waiting" ? "underline" : ""}`}
      >
        {noReply === 1 ? t("graphCover.headNoReplyOne") : t("graphCover.headNoReply", { n: noReply })}
      </button>
    ),
  ].filter(Boolean);
  return (
    <div data-graph-coverage-head className="flex items-center gap-2">
      <p className={`min-w-0 flex-1 ${TEXT_META} leading-snug text-sand-600 tabular-nums`}>
        {/* [style8] VIEW8-03: a line breaks at a "·", never inside a count. */}
        {counts.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="text-sand-400"> · </span>}
            <span className="whitespace-nowrap">{c}</span>
          </span>
        ))}
      </p>
      {/* [style9] WALK9-08: Gaps only is about the rows; while a listing
          shows in their place it is off (the rows come back with it). */}
      <button
        onClick={() => setGapsOnly(!gapsOnly)}
        aria-pressed={gapsOnly}
        disabled={listing !== "rows"}
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
    whether a note quotes it, with its dot), [layer5] its open comments
    ([lists8] WALK8-02: a count; the opened row lists them under this line,
    and the head's count lists every document's), and "Not opened". */
export function DocumentCoverageLine({ documentId }: { documentId: string }) {
  const t = useT();
  const c = useDocumentCoverage(documentId);
  const waits = useCommentWaits();
  if (!c) return null;
  const noted = c.parts.filter((p) => p.noted > 0).length;
  const whole = c.parts.length === 1 && c.parts[0].whole ? c.parts[0] : null;
  const open = openComments(c);
  return (
    <span data-graph-coverage-line={documentId} className={`flex flex-wrap items-center gap-1.5 ${TEXT_META} text-sand-600`}>
      {whole ? (
        <span data-graph-coverage-whole={whole.noted > 0 ? "noted" : "empty"}>
          <PartDot documentId={documentId} blockId="" />
          {whole.noted > 0 ? t("graphCover.wholeNoted") : t("graphCover.wholeEmpty")}
        </span>
      ) : (
        c.parts.length > 0 && <span data-graph-coverage-noted={`${noted}/${c.parts.length}`}>{t("graphCover.partsNoted", { n: noted, m: c.parts.length })}</span>
      )}
      {open.length > 0 && (
        <span data-graph-coverage-comments={open.length} className="inline-flex items-center gap-0.5 font-semibold text-[var(--kind-comment)]">
          <CommentIcon size={10} />
          {open.length === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: open.length })}
          {open.some(waits) && <WaitsMark />}
        </span>
      )}
      {!c.opened && (
        <span
          data-graph-not-opened
          data-tip={t("graphCover.notOpenedTitle")}
          className={`rounded-full border border-dashed border-sand-400 px-1.5 ${TEXT_META} font-semibold text-sand-600`}
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
    <span data-graph-gap-why={documentId} className={`${TEXT_META} font-semibold text-clay-800`}>
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
  // [style9] VIEW9-01: a comment waiting on this account marks the ring
  // (data-waits): zoomed out, where the comments chip hides, globals.css
  // draws the ring in the comment color, so every waiting node is marked at
  // rest, at 40 documents and on a phone too.
  const waits = useCommentWaits();
  if (!c || (c.parts.length === 0 && c.notes === 0)) return null;
  const waiting = openComments(c).some(waits);
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
      data-waits={waiting ? "" : undefined}
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

// [layer5] The reader's comments on the graph (VIEW5-01/02): a small mark
// right of the node's notes chip, one line in the card and in the Documents
// row that opens into the comments. Every row opens the comment in the reader, at the address an
// annotation reference uses. Stored rows only (the coverage answer).

/** The "?" a comment waiting on this account carries ([lists8] WALK8-01:
    commentWaits, not the comment's last character). */
function WaitsMark() {
  const t = useT();
  return (
    <span data-graph-comment-asks aria-label={t("graphCover.commentWaitsTitle")} data-tip={t("graphCover.commentWaitsTitle")} className="font-bold">
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

/** On a node: the comment glyph and the open comments, a "?" when one
    waits on this account. Hidden at a far zoom, like the notes chip. */
export function NodeComments({ documentId }: { documentId: string }) {
  const t = useT();
  const waits = useCommentWaits();
  const open = useDocumentComments(documentId).filter((c) => c.open);
  if (open.length === 0) return null;
  const label = open.length === 1 ? t("graphCover.commentsOpenOne") : t("graphCover.commentsOpenMany", { n: open.length });
  return (
    <span
      data-graph-node-comments={open.length}
      aria-label={label}
      data-tip={label}
      className={`flex items-center gap-px ${TEXT_META} font-semibold tabular-nums text-[var(--kind-comment)]`}
    >
      <CommentIcon size={10} />
      {open.length}
      {open.some(waits) && "?"}
    </span>
  );
}

/** How wide the node's comments chip runs, in flow units (curve-place.ts
    keeps a curve's marks off it). 0: no chip. */
export function nodeCommentsWidth(c: DocumentCoverage | null | undefined, myId: string): number {
  const open = openComments(c);
  if (open.length === 0) return 0;
  return 13 + String(open.length).length * 6 + (open.some((x) => commentWaits(x, myId)) ? 5 : 0);
}

/** One comment as a row: [lists8] its author's badge (WALK8-02), its words
    (three lines), [style9] WALK9-04: when it waits on this account, the
    newest reply's words under them with their author's badge (the words
    that wait; `newest` comes with the coverage answer, and a row from an
    answer without it draws as before), a "?", its open replies and its
    resolved ones apart (`openReplies`; absent: one count); a click opens it
    in the reader. */
function CommentRow({ notebookId, documentId, comment: c, onOpenDocument }: { notebookId: string; documentId: string; comment: GraphComment; onOpenDocument: () => void }) {
  const t = useT();
  const router = useRouter();
  const { myId, people } = useCollab();
  const commentWaitsOn = useCommentWaits();
  // The badge only when the project has another person: a reader alone wrote every comment.
  const author = c.authorId && Object.keys(people).some((id) => id !== myId) ? people[c.authorId] : undefined;
  const waiting = commentWaitsOn(c);
  const newest = waiting && c.newest ? c.newest : null;
  const newestBy = newest?.userId ? people[newest.userId] : undefined;
  const openReplies = c.openReplies ?? c.replies;
  const resolvedReplies = c.openReplies === undefined ? 0 : c.replies - c.openReplies;
  const meta = [
    openReplies > 0 && (openReplies === 1 ? t("graphNotes.replyCountOne") : t("graphNotes.replyCountMany", { n: openReplies })),
    resolvedReplies > 0 && (resolvedReplies === 1 ? t("common.resolvedCountOne") : t("common.resolvedCountMany", { n: resolvedReplies })),
    !c.open && t("graphCover.commentResolved"),
  ].filter((x): x is string => typeof x === "string");
  return (
    <button
      data-graph-comment={c.id}
      data-track="graph-comment-open"
      onClick={() => {
        router.push(annotationReferenceHref(notebookId, { annotationId: c.id, documentId, sourceId: c.sourceId, kind: "comment" }));
        onOpenDocument();
      }}
      data-tip={t("graphCover.commentOpenTitle")}
      className={`flex w-full items-start gap-1.5 rounded-xl px-2 py-1.5 text-left pointer-coarse:min-h-11 hover:bg-[color-mix(in_srgb,var(--kind-comment)_8%,transparent)] ${c.open ? "" : "opacity-60"}`}
    >
      {author ? <PersonBadge person={author} size={16} /> : <CommentIcon size={12} className="mt-[3px] shrink-0 text-[var(--kind-comment)]" />}
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-3 ${TEXT_BODY} leading-snug text-ink`}>{c.text}</span>
        {newest && (
          <span data-graph-comment-newest className={`mt-1 flex items-start gap-1.5 ${TEXT_BODY} leading-snug text-ink`}>
            {newestBy && <PersonBadge person={newestBy} size={16} />}
            <span className="line-clamp-2 min-w-0">{newest.text}</span>
          </span>
        )}
        {meta.length > 0 && (
          <span className={`mt-0.5 flex items-center gap-1.5 ${TEXT_META} text-sand-600`}>
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-sand-400">·</span>}
                {m}
              </span>
            ))}
          </span>
        )}
      </span>
      {waiting && (
        <span className={`shrink-0 rounded-full bg-[color-mix(in_srgb,var(--kind-comment)_12%,transparent)] px-1.5 ${TEXT_META} text-[var(--kind-comment)]`}>
          <WaitsMark />
        </span>
      )}
    </button>
  );
}

/** [style9] VIEW9-05: a link waiting on this account, as a row of the
    waiting list: the badge of the person whose reply waits, that reply's
    words (three lines), the other document, its replies, a "?"; a click
    opens the link panel. */
function LinkWaitingRow({
  link: l,
  reply: r,
  hereId,
  open,
  onOpen,
}: {
  link: GraphEdgeLink;
  reply: ReplyView;
  /** The document whose group the row is in. */
  hereId: string;
  open: boolean;
  onOpen: (linkId: string) => void;
}) {
  const t = useT();
  const { people } = useCollab();
  const asker = people[r.userId];
  const loop = l.fromDocumentId === l.toDocumentId;
  const otherTitle = l.fromDocumentId === hereId ? l.toTitle : l.fromTitle;
  return (
    <button
      onClick={() => onOpen(l.id)}
      data-track="graph-documents-link-waiting"
      data-graph-link-waiting={l.id}
      aria-expanded={open}
      data-tip={t("panes.graphDocumentsLinkTitle")}
      className={`flex w-full items-start gap-1.5 rounded-xl px-2 py-1.5 text-left pointer-coarse:min-h-11 hover:bg-[color-mix(in_srgb,var(--kind-comment)_8%,transparent)] ${open ? "bg-clay-100/50" : ""}`}
    >
      {asker ? <PersonBadge person={asker} size={16} /> : <CommentIcon size={12} className="mt-[3px] shrink-0 text-[var(--kind-comment)]" />}
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-3 ${TEXT_BODY} leading-snug text-ink`}>{r.content}</span>
        <span className={`mt-0.5 block truncate ${TEXT_META} font-semibold text-clay-700`}>{loop ? t("graphView.cardWithin") : `⇄ ${otherTitle}`}</span>
        <LinkReplyCount link={l} />
      </span>
      <span className={`shrink-0 rounded-full bg-[color-mix(in_srgb,var(--kind-comment)_12%,transparent)] px-1.5 ${TEXT_META} text-[var(--kind-comment)]`}>
        <WaitsMark />
      </span>
    </button>
  );
}

/** The node card's comments: one line, "2 open comments ? · 1 resolved",
    that a press opens into the comments (open first), each a row that
    opens the comment in the reader. */
export function NodeCommentsLine({
  notebookId,
  documentId,
  onOpenDocument,
  facts,
}: {
  notebookId: string;
  documentId: string;
  onOpenDocument: () => void;
  /** [style8] VIEW8-04: the card's facts line; the comments press ends it, so the two take one line. */
  facts?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(documentId);
  if (shownFor !== documentId) {
    setShownFor(documentId);
    setOpen(false);
  }
  const comments = useDocumentComments(documentId);
  const waits = useCommentWaits();
  const factsLine = facts ? <span className="text-sand-600">{facts}</span> : null;
  if (comments.length === 0) return factsLine ? <p className={`-mt-2 ${TEXT_META}`}>{factsLine}</p> : null;
  const openOnes = comments.filter((c) => c.open);
  const resolved = comments.length - openOnes.length;
  // [lists8] WALK8-11: none open says "1 resolved comment", in grey.
  const noneOpen = openOnes.length === 0;
  return (
    <div data-graph-card-comments={comments.length} className="-mt-2">
      <p className={`flex flex-wrap items-center gap-x-2 ${TEXT_META}`}>
        {factsLine}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-track="graph-card-comments"
          data-tip={t("graphCover.commentsShowTitle")}
          className={`inline-flex min-h-6 items-center gap-1 ${TEXT_META} font-semibold hover:underline pointer-coarse:min-h-10 ${noneOpen ? "text-sand-600" : "text-[var(--kind-comment)]"}`}
        >
          <CommentIcon size={11} />
          {/* [style9] On a phone the press takes the node chip's form, the
              glyph and the count ("1 ?"), so the facts line and it share
              one line of the bottom card (VIEW8-04); the words stay for a
              screen reader. */}
          <span className="max-md:sr-only">
            {noneOpen
              ? resolved === 1
                ? t("graphCover.commentsResolvedOne")
                : t("graphCover.commentsResolvedMany", { n: resolved })
              : openOnes.length === 1
                ? t("graphCover.commentsOpenOne")
                : t("graphCover.commentsOpenMany", { n: openOnes.length })}
          </span>
          <span aria-hidden className="tabular-nums md:hidden">
            {noneOpen ? resolved : openOnes.length}
          </span>
          {openOnes.some(waits) && <WaitsMark />}
          {!noneOpen && resolved > 0 && (
            <span className="font-normal text-sand-600 max-md:sr-only">
              · {resolved === 1 ? t("common.resolvedCountOne") : t("common.resolvedCountMany", { n: resolved })}
            </span>
          )}
        </button>
      </p>
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

/** A row of a listing: a comment, or [style9] a link waiting on you. `at`:
    when its newest words were written, for newest first; null for a comment
    from an answer without `newest` (it keeps the reading order, last). */
type ListingRow = { key: string; at: string | null } & ({ comment: GraphComment; link?: undefined } | { link: GraphEdgeLink; reply: ReplyView; comment?: undefined });

/** [lists8] WALK8-02: every open comment of the project, in place of the
    Documents rows (the head's count, pressed): under each document's title,
    in the list's order, each row with its author; the resolved ones counted
    at the end (a node's card lists them).
    [style9] VIEW9-05, WALK9-03: `waitingOnly` lists every thread waiting on
    you instead, links and comments together under each document's title,
    newest first (the document with the newest thread first; a link under
    its from end, else its to end). A link's row quotes the reply that waits
    with its author's badge and opens the link panel. */
export function AllComments({
  notebookId,
  documents,
  onOpenDocument,
  waitingOnly = false,
  edges = [],
  openLinkId = null,
  onOpenLink,
  filtered = false,
}: {
  notebookId: string;
  documents: { id: string; title: string }[];
  onOpenDocument: () => void;
  waitingOnly?: boolean;
  /** The project's edges, for the links waiting on you. */
  edges?: GraphEdge[];
  openLinkId?: string | null;
  onOpenLink?: (linkId: string) => void;
  /** [style9] WALK9-08: the filter holds words: the list says how many rows it holds. */
  filtered?: boolean;
}) {
  const t = useT();
  const coverage = useProjectCoverage();
  const { myId } = useCollab();
  const commentWaitsOn = useCommentWaits();
  const waits = useWaitsForReply();
  const listed = new Set(documents.map((d) => d.id));
  const linksOf = new Map<string, ListingRow[]>();
  if (waitingOnly && onOpenLink) {
    for (const e of edges) {
      for (const l of e.links) {
        if (l.recommended || l.provenance || !waits(l)) continue;
        const reply = waitingReply(l, myId);
        const under = listed.has(l.fromDocumentId) ? l.fromDocumentId : listed.has(l.toDocumentId) ? l.toDocumentId : null;
        if (!reply || !under) continue;
        linksOf.set(under, [...(linksOf.get(under) ?? []), { key: `link:${l.id}`, at: reply.createdAt, link: l, reply }]);
      }
    }
  }
  const groups = documents.flatMap((d) => {
    const comments = openComments(coverage?.documents[d.id]).filter((c) => !waitingOnly || commentWaitsOn(c));
    const rows: ListingRow[] = [
      ...comments.map((c): ListingRow => ({ key: `comment:${c.id}`, at: c.newest?.createdAt ?? c.createdAt ?? null, comment: c })),
      ...(linksOf.get(d.id) ?? []),
    ];
    if (rows.length === 0) return [];
    if (waitingOnly) rows.sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));
    return [{ ...d, rows, newest: rows.reduce((m, r) => (r.at !== null && r.at > m ? r.at : m), "") }];
  });
  if (waitingOnly) groups.sort((x, y) => y.newest.localeCompare(x.newest));
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const resolved = waitingOnly ? 0 : documents.reduce((n, d) => n + (coverage?.documents[d.id]?.comments ?? []).filter((c) => !c.open).length, 0);
  return (
    <div
      data-graph-documents-all-comments={waitingOnly ? undefined : total}
      data-graph-documents-waiting={waitingOnly ? total : undefined}
      className="flex flex-col gap-2"
    >
      {/* [style9] WALK9-08: with words in the filter, the found line counts the
          rows listed, not the documents (no document matched: the list's own line says so). */}
      {filtered && documents.length > 0 && (
        <p role="status" data-graph-documents-found className={`${TEXT_META} text-sand-600`}>
          {waitingOnly
            ? total === 1
              ? t("graphCover.headNoReplyOne")
              : t("graphCover.headNoReply", { n: total })
            : total === 1
              ? t("graphCover.commentsOpenOne")
              : t("graphCover.commentsOpenMany", { n: total })}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-0.5">
          <p className={`px-2 ${TEXT_META} font-semibold text-sage-700`}>{g.title}</p>
          {g.rows.map((r) =>
            r.comment ? (
              <CommentRow key={r.key} notebookId={notebookId} documentId={g.id} comment={r.comment} onOpenDocument={onOpenDocument} />
            ) : (
              <LinkWaitingRow key={r.key} link={r.link} reply={r.reply} hereId={g.id} open={openLinkId === r.link.id} onOpen={(id) => onOpenLink?.(id)} />
            ),
          )}
        </div>
      ))}
      {resolved > 0 && (
        <p className={`px-2 ${TEXT_META} text-sand-500`}>{resolved === 1 ? t("common.resolvedCountOne") : t("common.resolvedCountMany", { n: resolved })}</p>
      )}
    </div>
  );
}
