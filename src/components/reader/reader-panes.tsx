"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// Reader views: Normal shows one document; Side by Side and Top and Bottom
// show two panes, each with the full tool set. The choice lives in the URL —
// a fresh open is Normal. Links whose two ends are visible in the two panes
// draw as dashed lines between the marks.

export type ReaderViewKind = "normal" | "side" | "stack";

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
      className={`relative flex h-full min-h-0 min-w-0 ${view === "stack" ? "flex-col" : "flex-row"}`}
    >
      {/* Bottom-left: clear of the article menu (top-left) and the sticky
          Distill controls (top-right). */}
      <div ref={menuRef} className="absolute bottom-4 left-4 z-30 print:hidden">
        <button
          onClick={() => setMenu((v) => !v)}
          aria-label={t("panes.readerView")}
          title={t("panes.readerView")}
          className="flex items-center justify-center rounded-full bg-sand-100 p-2 text-sand-600 shadow-soft hover:text-clay-800"
        >
          <ViewGlyph kind={view} />
        </button>
        {menu && (
          <div className="absolute bottom-full left-0 mb-1.5 flex w-44 flex-col rounded-2xl bg-card p-1.5 shadow-float">
            {(["normal", "side", "stack"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => go(kind)}
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
      </div>

      <div ref={paneOneRef} className="relative min-h-0 min-w-0 flex-1">
        {paneOne}
      </div>
      {view !== "normal" && paneTwo && (
        <>
          <div aria-hidden className={view === "stack" ? "h-px shrink-0 bg-line" : "w-px shrink-0 bg-line"} />
          <div ref={paneTwoRef} className="relative min-h-0 min-w-0 flex-1">
            <div className="absolute top-4 left-4 z-30 max-w-[45%] print:hidden">
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
