"use client";

import { useState } from "react";
import { CheckIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

export type IngestStepStatus = "pending" | "active" | "done";
// labelKey is translated at render; key stays the wire stage id.
export type IngestStep = { key: string; labelKey: TKey; detail?: string; status: IngestStepStatus };

// Ordered step templates, one per source. Keys match the stage events the server
// sends (see /api/documents); the first step is active from the moment the
// request leaves, before any event arrives.
const STEP_TEMPLATES: Record<
  "pdf" | "url" | "video" | "youtube" | "media" | "drive",
  { key: string; labelKey: TKey }[]
> = {
  pdf: [
    { key: "receive", labelKey: "panes.stepUploading" },
    { key: "parse", labelKey: "panes.stepParsing" },
    { key: "save", labelKey: "panes.stepSaving" },
  ],
  // Google Drive PDF, or a Google Doc/Sheet/Slide exported to PDF (SPEC.md
  // §14): the server fetches the bytes instead of receiving an upload.
  drive: [
    { key: "fetch", labelKey: "panes.stepFetchingDrive" },
    { key: "parse", labelKey: "panes.stepParsing" },
    { key: "save", labelKey: "panes.stepSaving" },
  ],
  url: [
    { key: "fetch", labelKey: "panes.stepFetchingPage" },
    { key: "extract", labelKey: "panes.stepReadingPage" },
    { key: "select", labelKey: "panes.stepFindingArticle" },
    { key: "structure", labelKey: "panes.stepStructuring" },
    { key: "save", labelKey: "panes.stepSaving" },
  ],
  video: [
    { key: "receive", labelKey: "panes.stepUploading" },
    { key: "save", labelKey: "panes.stepSaving" },
  ],
  youtube: [
    { key: "fetch", labelKey: "panes.stepFetchingVideoInfo" },
    { key: "save", labelKey: "panes.stepSaving" },
  ],
  // A direct video or audio file link: the server downloads and stores it.
  media: [
    { key: "fetch", labelKey: "panes.stepFetchingMedia" },
    { key: "save", labelKey: "panes.stepSaving" },
  ],
};

export function initialIngestSteps(
  kind: "pdf" | "url" | "video" | "youtube" | "media" | "drive",
): IngestStep[] {
  return STEP_TEMPLATES[kind].map((s, i) => ({
    ...s,
    status: i === 0 ? "active" : "pending",
  }));
}

// Advances on a stage event from the server: every step before the named stage is
// done, the named stage goes active, everything after stays pending. A repeated
// stage event updates the active step's detail line ("148 figures · 152 equations").
export function advanceIngestSteps(
  steps: IngestStep[],
  stage: string,
  detail?: string,
): IngestStep[] {
  const idx = steps.findIndex((s) => s.key === stage);
  if (idx === -1) return steps;
  return steps.map((s, i): IngestStep => {
    const status: IngestStepStatus = i < idx ? "done" : i === idx ? "active" : "pending";
    return { ...s, status, detail: i === idx && detail !== undefined ? detail : s.detail };
  });
}

export function completeIngestSteps(steps: IngestStep[]): IngestStep[] {
  return steps.map((s) => ({ ...s, status: "done" }));
}

// Count details travel as JSON ({blocks, figures, equations, references}) and
// render in the UI language; any other detail renders as sent.
function detailText(t: TFunc, detail: string): string {
  if (!detail.startsWith("{")) return detail;
  try {
    const counts = JSON.parse(detail) as Record<string, number>;
    const parts = [
      ...(counts.blocks > 0 ? [t("panes.detailBlocks", { n: counts.blocks })] : []),
      ...(counts.figures > 0 ? [t("panes.detailFigures", { n: counts.figures })] : []),
      ...(counts.equations > 0 ? [t("panes.detailEquations", { n: counts.equations })] : []),
      ...(counts.references > 0 ? [t("panes.detailReferences", { n: counts.references })] : []),
    ];
    return parts.join(" · ") || detail;
  } catch {
    return detail;
  }
}

// A small line-art cat that dances while the pipeline works. Same 24-grid and
// stroke weight as the workspace icons; sits still when reduced motion is set.
function DancingCat({ done }: { done: boolean }) {
  return (
    <svg
      aria-hidden
      width={44}
      height={44}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-clay"
    >
      <g className={done ? undefined : "cat-bop"}>
        <g className={done ? undefined : "cat-tail"}>
          <path d="M35 39c6 0 8-4 5-8" />
        </g>
        {/* ears */}
        <path d="M16 13V5l6 5" />
        <path d="M32 13V5l-6 5" />
        {/* head */}
        <path d="M14 16a10 9 0 1 0 20 0 10 9 0 1 0-20 0" />
        {/* eyes */}
        <path d="M20 15h.01" />
        <path d="M28 15h.01" />
        {/* body */}
        <path d="M16 27c-4 4-4 12 8 12s12-8 8-12" />
        {/* front paws */}
        <path d="M20 39v3" />
        <path d="M28 39v3" />
      </g>
    </svg>
  );
}

// Ingest progress card: what has loaded, what is being worked on, how far along.
// Driven entirely by real backend stage events (see /api/documents), never a
// simulated timer. The cat runs laps around the card border to ease the wait —
// gait randomized per run, paused when done or when reduced motion is set.
// Floats fixed at top center by default; inline renders it in flow (the
// add-document dialog shows it inside its upload space).
export function IngestProgress({
  fileLabel,
  steps,
  inline = false,
}: {
  fileLabel: string;
  steps: IngestStep[];
  inline?: boolean;
}) {
  const t = useT();
  const activeIndex = steps.findIndex((s) => s.status === "active");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const complete = doneCount === steps.length;
  const current = steps[activeIndex] ?? steps[steps.length - 1];
  const position = complete
    ? steps.length
    : Math.min(activeIndex === -1 ? steps.length : activeIndex + 1, steps.length);
  const fillPercent = complete ? 100 : ((doneCount + (activeIndex === -1 ? 0 : 0.5)) / steps.length) * 100;
  const [gait] = useState(() => ({
    lap: 6.5 + Math.random() * 3,
    hop: 0.7 + Math.random() * 0.5,
  }));

  return (
    <div
      className={`${
        inline
          ? "relative w-[380px] max-w-full"
          : "fixed top-24 left-1/2 z-50 w-[380px] max-w-[92vw] -translate-x-1/2"
      } rounded-[24px] bg-card p-4 shadow-float`}
    >
      <span
        aria-hidden
        className={`cat-runner${complete ? " cat-runner-done" : ""}`}
        style={{ "--cat-lap": `${gait.lap}s`, "--cat-hop": `${gait.hop}s` } as React.CSSProperties}
      >
        <span className="cat-hopper inline-block">
          <DancingCat done={complete} />
        </span>
      </span>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-sand-800">
            {complete ? t("common.done") : `${t(current.labelKey)}…`}
          </p>
          <p className="truncate text-xs text-sand-500">{fileLabel}</p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-sand-500">
          {position}/{steps.length}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sand-200">
        <div
          className="h-full rounded-full bg-clay transition-[width] duration-300 ease-out"
          style={{ width: `${fillPercent}%` }}
        />
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-xs">
            {s.status === "done" ? (
              <CheckIcon size={12} className="shrink-0 text-sage" />
            ) : s.status === "active" ? (
              <SpinnerIcon size={12} className="shrink-0 text-clay motion-safe:animate-spin" />
            ) : (
              <span aria-hidden className="mx-[3px] size-1.5 shrink-0 rounded-full bg-sand-300" />
            )}
            <span className={s.status === "pending" ? "text-sand-500" : "font-medium text-sand-700"}>
              {t(s.labelKey)}
            </span>
            {s.detail && s.status !== "pending" && (
              <span className="min-w-0 truncate text-sand-500">· {detailText(t, s.detail)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
