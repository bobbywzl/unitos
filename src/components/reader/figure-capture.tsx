"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/components/lang-provider";

// A figure the page draws with scripts comes over through a browser render
// (lib/parse/render-page.ts). While one runs, the reader shows the figure's
// place — above the caption left without it — with a small moving picture
// and "Unitos is moving Figure 4 over…"; when it fails, the same place says
// why and offers to try again; when no browser is configured, it says which
// variable to set (SPEC.md §15). The document bar drives the run and this
// store carries its state to the reader; the reader's Try again asks the
// bar to run it once more.

export type FigureCapture = {
  documentId: string;
  status: "running" | "failed";
  // failed: why — the render's error, or null when the render reported
  // nothing and the figure still did not come through.
  error: string | null;
};

// The render's state as the document stores it (Document.figureRenderAt,
// figureRenderError), and whether this deployment has a browser at all.
export type FigureRenderInfo = {
  attemptedAt: string | null;
  error: string | null;
  browser: boolean;
};

let current: FigureCapture | null = null;
const listeners = new Set<() => void>();
const handlers = new Map<string, () => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFigureCapture(next: FigureCapture | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/** The run for this document, if one is running or just failed. */
export function useFigureCapture(documentId: string | undefined): FigureCapture | null {
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return state && documentId && state.documentId === documentId ? state : null;
}

/** The document bar registers how to run a capture for a document; the
    reader's Try again calls it. */
export function registerFigureCaptureHandler(documentId: string, run: () => void): () => void {
  handlers.set(documentId, run);
  return () => {
    if (handlers.get(documentId) === run) handlers.delete(documentId);
  };
}

export function requestFigureCapture(documentId: string): void {
  handlers.get(documentId)?.();
}

// A picture frame with a small image sliding into it, over and over: the
// figure on its way. Still under reduced motion (globals.css).
export function MovingFigureIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="figure-moving-icon shrink-0"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <g className="figure-moving-icon-slide">
        <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
        <path d="M6 16l3.5-3.5 2.5 2.5 3-3.5L18 16" />
      </g>
    </svg>
  );
}

/** The figure's place above a caption left without it. */
export function FigurePlace({
  documentId,
  label,
  render,
}: {
  documentId: string;
  label: string;
  render: FigureRenderInfo;
}) {
  const t = useT();
  const capture = useFigureCapture(documentId);
  // A run just started or is about to: the bar runs one on open when no
  // render has run for the document and a browser is configured.
  const running = capture?.status === "running" || (capture === null && render.browser && render.attemptedAt === null);
  const shell = "figure-place my-6 flex items-center gap-3 rounded-2xl px-4 py-3 text-[13px] leading-snug";
  if (running) {
    return (
      <div role="status" aria-live="polite" className={`${shell} bg-sage-100 text-sage-800`}>
        <MovingFigureIcon size={18} />
        <span className="thinking-label font-medium">{t("panes.figureMoving", { label })}</span>
      </div>
    );
  }
  if (!render.browser) {
    return (
      <div className={`${shell} bg-sand-100 text-sand-700`}>
        <MovingFigureIcon size={18} />
        <span>{t("panes.figureMoveNoBrowser", { label })}</span>
      </div>
    );
  }
  const reason = capture?.error ?? render.error;
  const message = reason
    ? t("panes.figureMoveFailed", { label, reason })
    : t("panes.figureMoveMissing", { label });
  return (
    <div role="alert" className={`${shell} bg-red-50 text-red-800`}>
      <MovingFigureIcon size={18} />
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        data-track="figure-capture-retry"
        onClick={() => requestFigureCapture(documentId)}
        className="shrink-0 rounded-full bg-card px-2.5 py-1 text-[12px] font-semibold text-red-800 shadow-soft hover:bg-red-100"
      >
        {t("panes.figureTryAgain")}
      </button>
    </div>
  );
}
