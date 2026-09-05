"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import type { TKey } from "@/lib/i18n/dictionaries";

// Reader views: Normal shows one document; Side by Side and Top and Bottom
// show two panes, each with the full tool set. The choice lives in the URL —
// a fresh open is Normal. Links whose two ends are visible in the two panes
// draw as dashed lines between the marks. The bar between the panes drags to
// change how they share the reader, like the notes tray's bar; the split is
// remembered per browser, one per view kind.

export type ReaderViewKind = "normal" | "side" | "stack";

// The first pane's share of the reader, 0.2 to 0.8; 0.5 is the default.
const SPLIT_STORE = "unitos-pane-split";
const SPLIT_DEFAULT = 0.5;
const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.8;

function clampSplit(split: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split));
}

function readStoredSplit(view: ReaderViewKind): number {
  try {
    const stored = Number(localStorage.getItem(`${SPLIT_STORE}:${view}`));
    return Number.isFinite(stored) && stored > 0 ? clampSplit(stored) : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

function storeSplit(view: ReaderViewKind, split: number) {
  try {
    localStorage.setItem(`${SPLIT_STORE}:${view}`, String(split));
  } catch {
    // Storage can be unavailable (private mode); the split then lives in memory only.
  }
}

const VIEW_LABEL: Record<ReaderViewKind, TKey> = {
  normal: "panes.viewNormal",
  side: "panes.viewSide",
  stack: "panes.viewStack",
};

function ViewGlyph({ kind, size = 15 }: { kind: ReaderViewKind; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      {kind === "side" && <path d="M12 4v16" />}
      {kind === "stack" && <path d="M3 12h18" />}
    </svg>
  );
}

type Line = { x1: number; y1: number; x2: number; y2: number };

// Dashed lines between link ends visible in both panes. Ends are found by
// data-link-id; lines update on scroll, resize, and content changes, and skip
// ends scrolled out of their pane.
function LinkLines({
  containerRef,
  paneOneRef,
  paneTwoRef,
  vertical,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  paneOneRef: React.RefObject<HTMLDivElement | null>;
  paneTwoRef: React.RefObject<HTMLDivElement | null>;
  vertical: boolean;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const linesRef = useRef("");

  useEffect(() => {
    const container = containerRef.current;
    const one = paneOneRef.current;
    const two = paneTwoRef.current;
    if (!container || !one || !two) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const crect = container.getBoundingClientRect();
      const oneRect = one.getBoundingClientRect();
      const twoRect = two.getBoundingClientRect();
      const collect = (pane: HTMLElement) => {
        const out = new Map<string, DOMRect>();
        for (const el of pane.querySelectorAll<HTMLElement>("[data-link-id]")) {
          const id = el.dataset.linkId;
          if (id && !out.has(id)) out.set(id, el.getBoundingClientRect());
        }
        return out;
      };
      const ends = collect(one);
      const others = collect(two);
      const inside = (r: DOMRect, p: DOMRect) =>
        r.bottom > p.top + 8 && r.top < p.bottom - 8 && r.right > p.left && r.left < p.right;
      const next: Line[] = [];
      for (const [id, ra] of ends) {
        const rb = others.get(id);
        if (!rb) continue;
        if (!inside(ra, oneRect) || !inside(rb, twoRect)) continue;
        next.push(
          vertical
            ? {
                x1: ra.left + ra.width / 2 - crect.left,
                y1: ra.bottom - crect.top,
                x2: rb.left + rb.width / 2 - crect.left,
                y2: rb.top - crect.top,
              }
            : {
                x1: ra.right - crect.left,
                y1: ra.top + ra.height / 2 - crect.top,
                x2: rb.left - crect.left,
                y2: rb.top + rb.height / 2 - crect.top,
              },
        );
      }
      const fingerprint = next.map((l) => `${l.x1},${l.y1},${l.x2},${l.y2}`).join(";");
      if (fingerprint !== linesRef.current) {
        linesRef.current = fingerprint;
        setLines(next);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    const settle = setTimeout(schedule, 400); // marks paint after hydration
    window.addEventListener("resize", schedule);
    // Pane scrollers do not bubble scroll; capture catches them from here.
    container.addEventListener("scroll", schedule, true);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(container);
    // A dragged split resizes both panes without the container moving.
    resizeObserver.observe(one);
    resizeObserver.observe(two);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(container, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", schedule);
      container.removeEventListener("scroll", schedule, true);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearTimeout(settle);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [containerRef, paneOneRef, paneTwoRef, vertical]);

  if (lines.length === 0) return null;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full print:hidden">
      {lines.map((l, i) => (
        <line key={i} className="link-line" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
    </svg>
  );
}

export function ReaderPanes({
  notebookId,
  view,
  paneOneId,
  paneTwoId,
  documents,
  paneOne,
  paneTwo,
}: {
  notebookId: string;
  view: ReaderViewKind;
  paneOneId: string;
  paneTwoId: string | null;
  documents: { id: string; title: string }[];
  paneOne: React.ReactNode;
  paneTwo: React.ReactNode | null;
}) {
  const t = useT();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const paneOneRef = useRef<HTMLDivElement>(null);
  const paneTwoRef = useRef<HTMLDivElement>(null);
  // The first pane's share of the reader. Post-hydration restore on purpose:
  // localStorage is client-only, so the SSR pass renders the default.
  const [split, setSplit] = useState(SPLIT_DEFAULT);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (view === "normal") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplit(readStoredSplit(view));
  }, [view]);

  function applySplit(next: number) {
    const clamped = clampSplit(next);
    setSplit(clamped);
    storeSplit(view, clamped);
  }

  // Drag the bar: the pointer's place along the container is the split.
  function startSplitResize(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    const vertical = view === "stack";
    let latest = split;
    setResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = vertical ? "row-resize" : "col-resize";
    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const along = vertical
        ? (ev.clientY - rect.top) / rect.height
        : (ev.clientX - rect.left) / rect.width;
      latest = clampSplit(along);
      setSplit(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setResizing(false);
      storeSplit(view, latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  function go(next: ReaderViewKind, nextPaneTwo?: string) {
    const params = new URLSearchParams();
    params.set("doc", paneOneId);
    if (next !== "normal") {
      params.set("view", next);
      params.set(
        "doc2",
        nextPaneTwo ??
          paneTwoId ??
          documents.find((d) => d.id !== paneOneId)?.id ??
          paneOneId,
      );
    }
    setMenu(false);
    router.push(`/n/${notebookId}?${params.toString()}`);
  }

  return (
    <div
      ref={containerRef}
      data-track-surface="reader"
      className={`relative flex h-full min-h-0 min-w-0 ${view === "stack" ? "flex-col" : "flex-row"}`}
    >
      {/* Bottom-left: clear of the article menu (top-left) and the sticky
          Distill controls (top-right). */}
      <div ref={menuRef} className="absolute bottom-4 left-4 z-30 print:hidden">
        <button
          onClick={() => setMenu((v) => !v)}
          data-track="view"
          aria-label={t("panes.readerView")}
          data-tip={t("panes.readerView")}
          className="flex items-center justify-center rounded-full bg-sand-100 p-2 text-sand-600 shadow-soft hover:text-clay-800"
        >
          <ViewGlyph kind={view} />
        </button>
        <Presence show={menu} exit="menu">
        {menu && (
          <div className="menu-in absolute bottom-full left-0 mb-1.5 flex w-44 flex-col rounded-2xl bg-card p-1.5 shadow-float">
            {(["normal", "side", "stack"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => go(kind)}
                data-track={`view:${kind}`}
                className={`flex items-center gap-2.5 rounded-full px-2.5 py-1.5 text-left text-[12px] ${
                  view === kind
                    ? "bg-clay-100 font-semibold text-clay-800"
                    : "text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                }`}
              >
                <ViewGlyph kind={kind} size={13} />
                {t(VIEW_LABEL[kind])}
              </button>
            ))}
          </div>
        )}
        </Presence>
      </div>

      {/* In a split view the first pane takes its share and the second the
          rest; while the bar drags, no transition, so the panes follow the
          pointer. */}
      <div
        ref={paneOneRef}
        className={`relative min-h-0 min-w-0 ${
          view === "normal" ? "flex-1" : resizing ? "shrink-0" : "pane-split shrink-0"
        }`}
        style={
          view === "side"
            ? { width: `${split * 100}%` }
            : view === "stack"
              ? { height: `${split * 100}%` }
              : undefined
        }
      >
        {paneOne}
      </div>
      {view !== "normal" && paneTwo && (
        <>
          {/* The bar between the panes: drag to resize, arrow keys nudge,
              double-click resets. It floats over the divider line, so the
              layout gains no width. */}
          <div
            role="separator"
            aria-orientation={view === "stack" ? "horizontal" : "vertical"}
            aria-label={t("panes.resizePanes")}
            data-tip={t("panes.resizePanesTitle")}
            tabIndex={0}
            onPointerDown={startSplitResize}
            onDoubleClick={() => applySplit(SPLIT_DEFAULT)}
            onKeyDown={(e) => {
              const less = view === "stack" ? "ArrowUp" : "ArrowLeft";
              const more = view === "stack" ? "ArrowDown" : "ArrowRight";
              if (e.key === less) {
                e.preventDefault();
                applySplit(split - 0.02);
              }
              if (e.key === more) {
                e.preventDefault();
                applySplit(split + 0.02);
              }
            }}
            className={`group relative z-30 shrink-0 outline-none print:hidden ${
              view === "stack"
                ? "-my-[5px] h-[10px] cursor-row-resize"
                : "-mx-[5px] w-[10px] cursor-col-resize"
            }`}
          >
            <span
              aria-hidden
              className={`absolute rounded-full bg-line transition-colors group-hover:bg-clay-300 group-focus-visible:bg-clay-400 ${
                view === "stack"
                  ? "inset-x-0 top-1/2 h-px -translate-y-1/2 group-hover:h-[3px] group-focus-visible:h-[3px]"
                  : "inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover:w-[3px] group-focus-visible:w-[3px]"
              }`}
            />
          </div>
          <div ref={paneTwoRef} className="relative min-h-0 min-w-0 flex-1">
            {/* Below the pane's assistant pill (top-4 left-4), never over it. */}
            <div className="absolute top-14 left-4 z-30 max-w-[45%] print:hidden">
              <select
                value={paneTwoId ?? ""}
                onChange={(e) => go(view, e.target.value)}
                aria-label={t("panes.secondPaneDocument")}
                className="w-full truncate rounded-full bg-sand-100 px-3 py-1.5 text-xs font-semibold text-sand-700 shadow-soft outline-none"
              >
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title.length > 48 ? `${d.title.slice(0, 48)}…` : d.title}
                  </option>
                ))}
              </select>
            </div>
            {paneTwo}
          </div>
          <LinkLines
            containerRef={containerRef}
            paneOneRef={paneOneRef}
            paneTwoRef={paneTwoRef}
            vertical={view === "stack"}
          />
        </>
      )}
    </div>
  );
}
