"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import type { TKey } from "@/lib/i18n/dictionaries";

// Reader views: Normal shows one document; Side by Side and Top and Bottom
// show two panes, each with the full tool set. The choice lives in the URL —
// a fresh open is Normal. Links whose two ends are visible in the two panes
// draw as dashed lines between the marks.
//
// A split view is its own layout (SPEC.md §6): each pane's chrome is one row
// at its top (the pane header: the pane's document, the article menu, the
// search, Distill), the two panes fill the browser exactly, and the tray is a
// screen to their right that the workspace scrolls to (workspace.tsx).

export type ReaderViewKind = "normal" | "side" | "stack";

// One URL per reader view: ?doc= for the first pane; a split view adds
// ?view= and ?doc2= for the second (page.tsx reads them).
export function viewHref(
  notebookId: string,
  view: ReaderViewKind,
  paneOneId: string,
  paneTwoId: string | null,
): string {
  const params = new URLSearchParams();
  params.set("doc", paneOneId);
  if (view !== "normal") {
    params.set("view", view);
    params.set("doc2", paneTwoId ?? paneOneId);
  }
  return `/n/${notebookId}?${params.toString()}`;
}

// The pane header of a split view: one row at the top of the pane, above
// its scroller, never over the text. The reader and the video pane both
// render it; the reader adds its article menu and Distill to the row. It
// follows the strip's cut like the column (globals.css .pane-header), so
// its controls stay in the visible part of the pane.
export const PANE_HEADER =
  "pane-header relative z-30 flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3 print:hidden";

// The document one pane shows, chosen in the pane header of a split view.
// Choosing changes the URL, so the choice survives a refresh like the view.
export function PaneDocumentSelect({
  notebookId,
  view,
  pane,
  paneOneId,
  paneTwoId,
  documents,
}: {
  notebookId: string;
  view: ReaderViewKind;
  pane: "one" | "two";
  paneOneId: string;
  paneTwoId: string | null;
  documents: { id: string; title: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const value = pane === "one" ? paneOneId : (paneTwoId ?? paneOneId);
  return (
    <select
      value={value}
      onChange={(e) =>
        router.push(
          pane === "one"
            ? viewHref(notebookId, view, e.target.value, paneTwoId)
            : viewHref(notebookId, view, paneOneId, e.target.value),
        )
      }
      data-track={`pane-document:${pane}`}
      aria-label={t("panes.paneDocument")}
      data-tip={t("panes.paneDocumentTitle")}
      className="min-w-0 max-w-[50%] shrink truncate rounded-full bg-sand-100 px-3 py-1.5 text-xs font-semibold text-sand-700 shadow-soft outline-none hover:text-clay-800"
    >
      {documents.map((d) => (
        <option key={d.id} value={d.id}>
          {d.title.length > 48 ? `${d.title.slice(0, 48)}…` : d.title}
        </option>
      ))}
    </select>
  );
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

  function go(next: ReaderViewKind) {
    setMenu(false);
    router.push(
      viewHref(
        notebookId,
        next,
        paneOneId,
        paneTwoId ?? documents.find((d) => d.id !== paneOneId)?.id ?? paneOneId,
      ),
    );
  }

  return (
    <div
      ref={containerRef}
      data-track-surface="reader"
      // Top and Bottom with the tray in view: the strip hides the panes' left
      // part, and each article column centers in what is visible (globals.css
      // .reader-column). Side by Side panes are narrower than the column, so
      // they keep their place and the first pane peeks from under the edge.
      style={
        { "--reader-cut": view === "stack" ? "var(--strip-cut, 0px)" : "0px" } as React.CSSProperties
      }
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

      {/* Each pane is a column: the pane header (a split view) above the
          scroller. The pane's document is chosen in that header. */}
      <div ref={paneOneRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {paneOne}
      </div>
      {view !== "normal" && paneTwo && (
        <>
          <div aria-hidden className={view === "stack" ? "h-px shrink-0 bg-line" : "w-px shrink-0 bg-line"} />
          <div ref={paneTwoRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
