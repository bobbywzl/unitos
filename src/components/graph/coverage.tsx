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

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { GraphEdgeLink } from "@/lib/types";
import { notedShare, type DocumentCoverage, type ProjectCoverage } from "@/lib/graph/coverage-view";
import { useT } from "@/components/lang-provider";
import { useGraphNotes } from "@/components/graph/graph-notes";

type CoverageValue = {
  coverage: ProjectCoverage | null;
  gapsOnly: boolean;
  setGapsOnly: (on: boolean) => void;
};

const CoverageContext = createContext<CoverageValue>({ coverage: null, gapsOnly: false, setGapsOnly: () => undefined });
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

/** A link nobody replied to: the Links list's No reply and Gaps only keep it. */
export function hasNoReply(link: GraphEdgeLink): boolean {
  return (link.replies ?? []).length === 0;
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
    return {
      on: gapsOnly && coverage !== null,
      /** A part stays when no note quotes it. */
      keepPart: (id: string, blockId: string) => !gapsOnly || !coverage || partGap(id, blockId),
      /** A link stays when it is the reader's (accepted) and has no reply. */
      keepLink: (link: GraphEdgeLink) => !gapsOnly || !coverage || (!link.recommended && hasNoReply(link)),
      /** A document's notes hide while Gaps only is on: they are not gaps. */
      keepNotes: !gapsOnly || !coverage,
      /** A row stays when it holds a gap: a part no note quotes, Not opened,
          or a link with no reply. A generated document has no coverage. */
      keepRow: (id: string, links: GraphEdgeLink[]) => {
        if (!gapsOnly || !coverage) return true;
        const c = doc(id);
        if (!c) return false;
        return !c.opened || c.parts.some((p) => p.noted === 0) || links.some((l) => !l.recommended && hasNoReply(l));
      },
    };
  }, [coverage, gapsOnly]);
}

const chip = "rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums";

/** The Documents list's head: the parts noted, the documents not opened,
    the links with no reply, and the Gaps only switch. */
export function CoverageHead({ documentIds, links }: { documentIds: string[]; links: GraphEdgeLink[] }) {
  const t = useT();
  const { coverage, gapsOnly, setGapsOnly } = useContext(CoverageContext);
  if (!coverage) return null;
  const docs = documentIds.flatMap((id) => (coverage.documents[id] ? [coverage.documents[id]] : []));
  if (docs.length === 0) return null;
  const parts = docs.reduce((n, d) => n + d.parts.length, 0);
  const noted = docs.reduce((n, d) => n + d.parts.filter((p) => p.noted > 0).length, 0);
  const unopened = docs.filter((d) => !d.opened).length;
  const accepted = links.filter((l) => !l.recommended && !l.provenance);
  const noReply = accepted.filter(hasNoReply).length;
  return (
    <div data-graph-coverage-head className="flex flex-wrap items-center gap-1.5">
      {parts > 0 && (
        <span data-graph-coverage-parts={`${noted}/${parts}`} className={`${chip} border-sage-300 bg-sage-100 text-sage-800`}>
          {t("graphCover.partsNoted", { n: noted, m: parts })}
        </span>
      )}
      <span data-graph-coverage-unopened={`${unopened}/${docs.length}`} className={`${chip} border-line text-sand-700`}>
        {t("graphCover.headUnopened", { n: unopened, m: docs.length })}
      </span>
      {accepted.length > 0 && (
        <span data-graph-coverage-noreply={`${noReply}/${accepted.length}`} className={`${chip} border-line text-sand-700`}>
          {t("graphCover.headNoReply", { n: noReply, m: accepted.length })}
        </span>
      )}
      <button
        onClick={() => setGapsOnly(!gapsOnly)}
        aria-pressed={gapsOnly}
        data-track="graph-documents-gaps"
        data-graph-gaps-only
        data-tip={t("graphCover.gapsOnlyTitle")}
        className={`${chip} ${gapsOnly ? "border-clay-400 bg-clay-100 text-clay-800" : "border-line text-sand-700 hover:bg-clay-100/60"}`}
      >
        {t("graphCover.gapsOnly")}
      </button>
    </div>
  );
}

/** Under a document's title: "N of M parts noted", and "Not opened". */
export function DocumentCoverageLine({ documentId }: { documentId: string }) {
  const t = useT();
  const c = useDocumentCoverage(documentId);
  if (!c) return null;
  const noted = c.parts.filter((p) => p.noted > 0).length;
  if (c.parts.length === 0 && c.opened) return null;
  return (
    <span data-graph-coverage-line={documentId} className="flex flex-wrap items-center gap-1.5 text-[11px] text-sand-600">
      {c.parts.length > 0 && <span data-graph-coverage-noted={`${noted}/${c.parts.length}`}>{t("graphCover.partsNoted", { n: noted, m: c.parts.length })}</span>}
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

/** Before a part's title: sage when a note quotes the part, empty when none does. */
export function PartDot({ documentId, blockId }: { documentId: string; blockId: string }) {
  const t = useT();
  const part = useDocumentCoverage(documentId)?.parts.find((p) => p.blockId === blockId);
  if (!part) return null;
  const tip = [
    part.noted === 0
      ? t("graphCover.partEmpty")
      : part.noted === 1
        ? t("graphCover.partNotedOne")
        : t("graphCover.partNotedMany", { n: part.noted }),
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
    document's parts noted. A document with no parts draws a full ring when
    a note quotes it. Nothing for a document with no coverage (generated). */
export function CoverageRing({ documentId, size }: { documentId: string; size: number }) {
  const t = useT();
  const c = useDocumentCoverage(documentId);
  if (!c || (c.parts.length === 0 && c.notes === 0)) return null;
  const share = notedShare(c);
  const r = size / 2 + 3.5;
  const box = Math.ceil(r * 2 + 4);
  const length = 2 * Math.PI * r;
  const noted = c.parts.filter((p) => p.noted > 0).length;
  const label = c.parts.length > 0 ? t("graphCover.partsNoted", { n: noted, m: c.parts.length }) : t("graphCover.wholeNoted");
  return (
    <svg
      data-graph-coverage-ring={documentId}
      data-share={share.toFixed(2)}
      role="img"
      aria-label={label}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90"
    >
      <circle cx={box / 2} cy={box / 2} r={r} fill="none" stroke="var(--sand-300)" strokeWidth={2} />
      {share > 0 && (
        <circle
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke="var(--sage-600)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${share * length} ${length}`}
        />
      )}
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
      className={`shrink-0 ${chip} py-1.5 text-[12px] ${on ? "border-clay-400 bg-clay-100 text-clay-800" : "border-line text-sand-700 hover:bg-clay-100/60"}`}
    >
      {t("graphCover.noReply")}
    </button>
  );
}
