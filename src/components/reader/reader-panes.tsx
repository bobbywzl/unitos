"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import type { Imported } from "@/components/docs/docs-editor";
import { importLineParts } from "@/components/docs/import-line";
import { clipWords } from "@/lib/markdown-preview";
import { Presence } from "@/components/presence";
import type { TKey } from "@/lib/i18n/dictionaries";
import { useJumpParamCleanup } from "@/components/reader/jump-param";
import { useEscapeLayer } from "@/lib/escape-layers";
import { CommentIcon } from "@/components/icons";
import { FEEDBACK_OPEN_EVENT } from "@/components/feedback-button";
import { api } from "@/lib/api";

// Reader views: Normal shows one document; Side by Side and Top and Bottom
// show two panes, each with the full tool set. The choice lives in the URL —
// a fresh open is Normal. Links whose two ends are visible in the two panes
// draw as dashed lines between the marks. The bar between the panes drags to
// change how they share the reader, like the notes tray's bar; the split is
// remembered per browser, one per view kind.
//
// A split view is its own layout (SPEC.md §6): each pane's chrome is one row
// at its top (the pane header: the pane's document, the article menu, the
// search, Extract), the two panes fill the browser exactly, and the tray is a
// screen to their right that the workspace scrolls to (workspace.tsx).

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
// its scroller, never over the text. The reader renders it — for a video
// document too, through the video pane — and adds its article menu and
// Extract to the row for an article. It follows the strip's cut like the
// column (globals.css .pane-header), so its controls stay in the visible
// part of the pane.
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
  imported = null,
}: {
  notebookId: string;
  view: ReaderViewKind;
  pane: "one" | "two";
  paneOneId: string;
  paneTwoId: string | null;
  documents: { id: string; title: string }[];
  /** The pane's document, when it is an import: its import line goes in
      the tooltip, since the pane hides the page editor's title row. */
  imported?: Imported | null;
}) {
  const t = useT();
  const origin = imported ? importLineParts(imported, t).map((part) => part.text).join(" · ") : "";
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
      data-tip={origin ? `${t("panes.paneDocumentTitle")}\n${origin}` : t("panes.paneDocumentTitle")}
      className="min-w-0 max-w-[50%] shrink truncate rounded-full bg-sand-100 px-3 py-1.5 text-xs font-semibold text-sand-700 shadow-soft outline-none hover:text-clay-800"
    >
      {documents.map((d) => (
        <option key={d.id} value={d.id}>
          {clipWords(d.title, 48)}
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
  missing = null,
}: {
  notebookId: string;
  view: ReaderViewKind;
  paneOneId: string;
  paneTwoId: string | null;
  documents: { id: string; title: string }[];
  paneOne: React.ReactNode;
  paneTwo: React.ReactNode | null;
  // The address named a document this project does not hold (page.tsx):
  // its title and Add back when the project held it once, else the plain
  // notice. The first document opens in its place.
  missing?: { documentId: string; title: string | null; canAddBack: boolean } | null;
}) {
  const t = useT();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Below md the views are rows of the bottom bar's More menu
  // (workspace.tsx, data-reader-view-slot): floating, the Reader view button
  // stood on the article's bottom-left lines.
  const phone = useSyncExternalStore(subscribePhone, readPhone, () => false);
  // At md and up the button is the rail's last button, under Extract:
  // floating at the pane's bottom left it lay on the first words of the last
  // lines on a tablet and a landscape phone.
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  const [rail, setRail] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // The bar mounts with the reader, in the same commit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBarSlot(document.querySelector<HTMLElement>("[data-reader-view-slot]"));
    setRail(document.querySelector<HTMLElement>('nav[data-nudge="rail"]'));
  }, []);
  const inBar = phone && barSlot !== null;
  const inRail = !phone && rail !== null;
  const portalTo = inBar ? barSlot : inRail ? rail : null;
  // A phone has no room for Side by Side (195 and 147 px columns): the menu
  // offers Normal and Top and Bottom, and a Side by Side address opens as
  // Top and Bottom.
  const views: ReaderViewKind[] = phone ? ["normal", "stack"] : ["normal", "side", "stack"];
  useEffect(() => {
    if (!phone || view !== "side") return;
    router.replace(viewHref(notebookId, "stack", paneOneId, paneTwoId));
  }, [phone, view, router, notebookId, paneOneId, paneTwoId]);
  const [missingClosed, setMissingClosed] = useState<string | null>(null);
  const [addingBack, setAddingBack] = useState(false);
  const [addBackError, setAddBackError] = useState<string | null>(null);
  async function addBack(documentId: string) {
    if (addingBack) return;
    setAddingBack(true);
    setAddBackError(null);
    try {
      await api(`/api/notebooks/${notebookId}/documents`, "POST", { documentId });
      router.refresh();
    } catch (err) {
      setAddBackError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setAddingBack(false);
    }
  }
  const containerRef = useRef<HTMLDivElement>(null);
  // A jump's ?src, ?block, ?link drop once the reader moves on (jump-param.ts).
  useJumpParamCleanup(containerRef);
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
    // A held-down drag that never gets a clean pointerup — the pointer is
    // canceled by the browser, or the window loses focus while the button is
    // still down (alt-tab, a native dialog) — left the whole page unable to
    // select or copy text: nothing else ever cleared body.style.userSelect.
    // pointercancel and blur are both a release too.
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setResizing(false);
      storeSplit(view, latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
  }

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);
  // Escape closes the menu as one layer (lib/escape-layers.ts).
  useEscapeLayer(menu, () => setMenu(false));

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

  // One row per view: the menu's rows, and below md the rows of the bar's
  // More menu (workspace.tsx), which holds them in its slot.
  const viewRows = views.map((kind) => (
    <button
      key={kind}
      onClick={() => go(kind)}
      data-track={`view:${kind}`}
      className={`flex items-center gap-2.5 rounded-full px-2.5 py-1.5 text-left text-[12px] ${
        view === kind ? "bg-clay-100 font-semibold text-clay-800" : "text-sand-700 hover:bg-clay-100 hover:text-clay-800"
      }`}
    >
      <ViewGlyph kind={kind} size={13} />
      {t(VIEW_LABEL[kind])}
    </button>
  ));

  // Bottom-left: clear of the article menu (top-left) and the sticky
  // Extract controls (top-right). Below md with the sheet open
  // (data-sheet-open, workspace.tsx), bottom-right: the sheet cuts the
  // reader short, which brings its bottom-left up to the page editor's
  // Show the outline at the canvas's top-left. While the menu is open it
  // stands at z-40, the layer of the app's menus (docs/css/layer.css), over
  // the page editor's header, which a short reader brings under the menu.
  // Below md its rows stand in the bar's More menu instead (inBar).
  const viewControl = (
    <div
      ref={menuRef}
      className={
        portalTo
          ? "relative"
          : `absolute bottom-4 left-4 max-md:in-data-sheet-open:right-4 max-md:in-data-sheet-open:left-auto print:hidden ${
              menu ? "z-40" : "z-30"
            }`
      }
    >
      <button
        onClick={() => setMenu((v) => !v)}
        data-track="view"
        aria-label={t("panes.readerView")}
        data-tip={t("panes.readerView")}
        aria-expanded={menu}
        className={
          portalTo
            ? "flex size-[38px] items-center justify-center rounded-full text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            : "flex items-center justify-center rounded-full bg-sand-100 p-2 text-sand-600 shadow-soft hover:text-clay-800"
        }
      >
        <ViewGlyph kind={view} />
      </button>
      <Presence show={menu} exit="menu">
      {menu && (
        <div
          className={`menu-in absolute z-40 flex w-44 flex-col rounded-2xl bg-card p-1.5 shadow-float ${
            inBar
              ? "right-0 bottom-full mb-2.5"
              : inRail
                ? "right-full bottom-0 mr-2"
                : "bottom-full left-0 mb-1.5 max-md:in-data-sheet-open:right-0 max-md:in-data-sheet-open:left-auto"
          }`}
        >
          {viewRows}
          {/* Feedback at md and up: its floating button lay on the rail's
              Extract on a short screen (EDGE13-02). Below md it is a row of
              the bar's More menu. */}
          {inRail && <div className="my-1 border-t border-line" />}
          {inRail && (
            <button
              onClick={() => {
                setMenu(false);
                window.dispatchEvent(new Event(FEEDBACK_OPEN_EVENT));
              }}
              data-track="feedback-open"
              className="flex items-center gap-2.5 rounded-full px-2.5 py-1.5 text-left text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              <CommentIcon size={13} />
              {t("works.feedback")}
            </button>
          )}
        </div>
      )}
      </Presence>
    </div>
  );

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
      {inBar ? createPortal(viewRows, barSlot) : portalTo ? createPortal(viewControl, portalTo) : viewControl}

      {missing && missingClosed !== missing.documentId && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-6 z-[70] flex justify-center px-4 print:hidden"
        >
          <div className="pop-in pointer-events-auto flex max-w-lg flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-2.5 text-[13px] text-sand-700 shadow-float">
            <span className="min-w-0">
              {missing.title
                ? t("panes.missingDocumentNamed", { title: missing.title })
                : t("panes.missingDocument")}
            </span>
            {missing.canAddBack && (
              <button
                type="button"
                onClick={() => void addBack(missing.documentId)}
                disabled={addingBack}
                data-track="missing-add-back"
                className="rounded-full bg-clay px-3 py-1 text-[12px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-60"
              >
                {addingBack ? t("common.loading") : t("panes.historyAddBack")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setMissingClosed(missing.documentId)}
              aria-label={t("common.close")}
              className="rounded-full px-1.5 text-sand-500 hover:text-clay-800"
            >
              ✕
            </button>
            {addBackError && <span className="w-full text-[11px] text-clay-700">{addBackError}</span>}
          </div>
        </div>
      )}

      {/* Each pane is a column: the pane header (a split view) above the
          scroller. In a split view the first pane takes its share and the
          second the rest; while the bar drags, no transition, so the panes
          follow the pointer. */}
      <div
        ref={paneOneRef}
        className={`relative flex min-h-0 min-w-0 flex-col ${
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

// Below md (Tailwind's md, 48rem): a phone's layout, with the bottom bar.
const PHONE_QUERY = "(width < 48rem)";
function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function readPhone() {
  return window.matchMedia(PHONE_QUERY).matches;
}
