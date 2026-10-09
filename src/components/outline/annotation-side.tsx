"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { LocateIcon } from "@/components/icons";
import {
  annotationReferenceHref,
  type ParsedAnnotationReference,
  type ReferencedAnnotation,
} from "@/lib/annotation-reference";
import { ANNOTATION_KIND_KEY, annotationKindColor } from "@/lib/annotations/kind";
import { stripSimplifyMarkers } from "@/lib/sentences";

// The annotation beside the note (SPEC.md §6): on the notes full page a click
// on an annotation reference opens the annotation next to the note it was
// clicked in, instead of leaving for the reader. The notes column never moves:
// the annotation stands in the free room on its right when the window has
// it (WIDE), else over the page at the bottom right. The board's
// open note hosts the panel beside its card; anywhere else on the page the
// page frame does. One annotation open at a time; the next click takes its
// place; ✕ closes it.

/** anchor: the row the reference was opened from; the annotation stands
    level with it where it stands beside the notes. */
export type AnnotationSideRef = ParsedAnnotationReference & { label: string; anchor?: Element | null };

type AnnotationSide = {
  side: AnnotationSideRef | null;
  open: (ref: AnnotationSideRef) => void;
  close: () => void;
  /** Who draws the panel: the page frame, or the board's open note. */
  host: "page" | "board";
  setHost: (host: "page" | "board") => void;
};

const AnnotationSideContext = createContext<AnnotationSide | null>(null);

/** The annotation side of the notes full page; null anywhere else, where a
    reference click jumps to the reader instead. */
export function useAnnotationSide(): AnnotationSide | null {
  return useContext(AnnotationSideContext);
}

/** The notes full page's frame: the centered column, and beside it the
    annotation an annotation reference opened. */
export function NotesPageFrame({ children }: { children: React.ReactNode }) {
  const [side, setSide] = useState<AnnotationSideRef | null>(null);
  const [host, setHost] = useState<"page" | "board">("page");
  const value: AnnotationSide = {
    side,
    open: setSide,
    close: () => setSide(null),
    host,
    setHost,
  };
  return (
    <AnnotationSideContext.Provider value={value}>
      <main className="mx-auto w-full max-w-[760px] px-6 pt-[26px] pb-24">
        <div className="relative">
          {children}
          {side && host === "page" && (
            <SidePlace anchor={side.anchor}>
              <AnnotationSidePanel side={side} onClose={() => setSide(null)} />
            </SidePlace>
          )}
        </div>
      </main>
    </AnnotationSideContext.Provider>
  );
}

/** Where the annotation sticks as the page scrolls (`top-6`). */
const STICKY_TOP = 24;

/** A window wide enough for the annotation beside the 760 px notes column. */
const WIDE = "(min-width: 1400px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(WIDE);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/** Where the annotation stands. Wide: in the right gutter of the column it
    sits in (that column is `relative`), its top level with the row it was
    opened from, then sticky as the page scrolls. Narrow: over the page at
    the bottom right, above the Undo pill. Either way nothing on the page
    moves. */
function SidePlace({ children, anchor }: { children: React.ReactNode; anchor?: Element | null }) {
  const wide = useWide();
  const gutterRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState(0);
  useLayoutEffect(() => {
    const gutter = gutterRef.current;
    const panel = panelRef.current;
    if (!wide || !gutter || !panel) return;
    // Level with the row, and whole inside the window: a row near the
    // window's bottom lifts the annotation as far as it takes.
    const place = () => {
      const want = anchor?.isConnected ? anchor.getBoundingClientRect().top : STICKY_TOP;
      const top = Math.max(STICKY_TOP, Math.min(want, window.innerHeight - STICKY_TOP - panel.offsetHeight));
      setLevel(Math.max(0, Math.round(top - gutter.getBoundingClientRect().top)));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [wide, anchor]);
  if (wide) {
    return (
      <div ref={gutterRef} className="absolute top-0 left-[calc(100%+24px)] h-full w-[min(360px,calc(50vw-412px))]">
        <div ref={panelRef} className="sticky top-6" style={{ marginTop: level }}>
          {children}
        </div>
      </div>
    );
  }
  return createPortal(
    <div className="fixed inset-x-4 bottom-20 z-[70] flex max-h-[55vh] flex-col md:inset-x-auto md:right-6 md:w-[360px] [&>aside]:min-h-0">
      {children}
    </div>,
    document.body,
  );
}

/** The board's open note draws the panel beside its card while it is open:
    mounted, it takes the panel from the page frame; unmounted, it gives it
    back. Renders nothing while no annotation is open. */
export function AnnotationSideHost() {
  const ctx = useAnnotationSide();
  const setHost = ctx?.setHost;
  useEffect(() => {
    if (!setHost) return;
    setHost("board");
    return () => setHost("page");
  }, [setHost]);
  if (!ctx?.side) return null;
  return (
    <SidePlace anchor={ctx.side.anchor}>
      <AnnotationSidePanel side={ctx.side} onClose={ctx.close} />
    </SidePlace>
  );
}

// The annotations the side loaded on this page, by annotation and document.
const seen = new Map<string, ReferencedAnnotation>();

/** The annotation itself: its kind, the words it is anchored to, its text,
    and the jump to it in the reader. */
export function AnnotationSidePanel({ side, onClose }: { side: AnnotationSideRef; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { annotationId, documentId } = side;
  // What the fetch answered, for the annotation it was asked for: another
  // reference's answer never shows under this one.
  const key = `${annotationId}:${documentId}`;
  // An annotation shown before draws at once from the copy kept then, while
  // the fetch brings it up to date.
  const [loaded, setLoaded] = useState<{ key: string; annotation?: ReferencedAnnotation; error?: string } | null>(
    () => {
      const kept = seen.get(key);
      return kept ? { key, annotation: kept } : null;
    },
  );
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    const kept = seen.get(key);
    if (kept) setLoaded({ key, annotation: kept });
  }
  const annotation = loaded?.key === key ? (loaded.annotation ?? null) : null;
  const error = loaded?.key === key ? (loaded.error ?? null) : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/annotations/${annotationId}?doc=${encodeURIComponent(documentId)}`);
        // Gone: deleted, and History keeps it (SPEC.md §12). A try again
        // would never load it, so the line says where it is.
        if (res.status === 404) {
          seen.delete(key);
          if (!cancelled) setLoaded({ key, error: t("outline.annotationGone") });
          return;
        }
        if (!res.ok) throw new Error(`annotation ${annotationId}: ${res.status}`);
        const data = (await res.json()) as ReferencedAnnotation;
        seen.set(key, data);
        if (!cancelled) setLoaded({ key, annotation: data });
      } catch (err) {
        console.error(err);
        // A copy shown before stays; nothing shown yet says so.
        if (!cancelled && !seen.has(key)) setLoaded({ key, error: t("common.notLoaded") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [annotationId, documentId, key, t]);

  function jump() {
    if (!annotation) return;
    const href = annotationReferenceHref(side.notebookId, {
      annotationId: annotation.id,
      documentId: annotation.documentId ?? documentId,
      sourceId: annotation.sourceId,
      kind: annotation.kind,
    });
    router.push(href);
  }

  // A highlight with no comment stores its quote as its content: the quote
  // says it all, so the body stays out.
  const body =
    annotation && annotation.content !== (annotation.quotedText ?? "")
      ? annotation.kind === "simplify"
        ? stripSimplifyMarkers(annotation.content)
        : annotation.content
      : "";

  return (
    <aside
      data-annotation-side=""
      className="content-in flex max-h-[calc(100vh-48px)] flex-col overflow-hidden rounded-2xl border bg-card p-4 shadow-soft"
      // The border is the annotation's kind color (SPEC.md §6), as everywhere.
      style={{ borderColor: annotation ? annotationKindColor(annotation.kind, annotation.color) : "var(--line)" }}
    >
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {annotation ? t(ANNOTATION_KIND_KEY[annotation.kind]) : t("outline.annotationReference")}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {annotation && annotation.sourceId && !annotation.orphaned && (
            <button
              type="button"
              onClick={jump}
              data-track="annotation-side-jump"
              aria-label={t("outline.annotationJump")}
              data-tip={t("outline.annotationJump")}
              className="flex size-7 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
            >
              <LocateIcon size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            data-track="annotation-side-close"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="flex size-7 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
          >
            ✕
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p className={`text-[12px] ${error === t("outline.annotationGone") ? "text-sand-700" : "text-red-500"}`}>{error}</p>
        )}
        {!annotation && !error && <p className="text-[12px] text-sand-500">{t("common.loading")}</p>}
        {annotation && (
          <>
            {annotation.quotedText && (
              <blockquote className="my-0 mb-2 border-l-2 border-clay-300 pl-3 text-[13px] leading-[20px] text-sand-700">
                {annotation.quotedText}
              </blockquote>
            )}
            {body && (
              <Markdown breaks>{body}</Markdown>
            )}
            {annotation.conversation.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5">
                {annotation.conversation.map((turn, i) =>
                  turn.role === "user" ? (
                    <p key={i} className="self-end rounded-2xl bg-clay-100 px-3 py-1.5 text-[13px] text-ink">
                      {turn.content}
                    </p>
                  ) : (
                    <Markdown key={i} breaks>
                      {turn.content}
                    </Markdown>
                  ),
                )}
              </div>
            )}
            {annotation.documentTitle && (
              <p className="mt-2 text-[11px] text-sand-500">{annotation.documentTitle}</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
