"use client";

import { useParams, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import ReactFlow, {
  Background,
  ControlButton,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphEdge, GraphEdgeLink, GraphNode } from "@/lib/types";
import { api } from "@/lib/api";
import { linkPath } from "@/lib/link-scope";
import { useCollab } from "@/components/collab/collab-context";
import { FilmIcon, MaximizeIcon, NotesIcon, PageIcon, QuestionIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { clipWords } from "@/lib/markdown-preview";
import { LinkDetail } from "@/components/graph/link-detail";
import { graphLayout, layoutAspect, seeded, type Point } from "@/components/graph/graph-layout";
import { categoryLabels } from "@/components/reader/document-organize";
// [graph-notes] The notes and the link replies on the graph (graph-notes.tsx).
import {
  CurveMarks,
  NodeNotes,
  NoteEdge,
  PairNotes,
  useNodeSectionDim,
  useNoteOnlyEdges,
  useNotesLit,
  useSyncPinnedPair,
  type NoteEdgeData,
} from "@/components/graph/graph-notes";
import { LinkReplies, LinkReplyCount } from "@/components/graph/link-replies";
import { LinkNoteComposer } from "@/components/graph/link-note-composer";
// [/graph-notes]

// The corpus graph (SPEC.md §13; the release-edu canvas patterns): documents
// as nodes on a pan/zoom canvas, links between them as swept curves. The more
// links between two documents, the thicker and bolder the curve; a pair held
// together only by recommended links draws dashed (marching) until one is
// accepted, and both its documents breathe. Hovering a node spotlights it,
// its links, and its linked documents, and shows its card (title, kind,
// length, links); hovering a curve spotlights the pair and lists its links
// beside the curve; a click pins the list.
// Linked documents sit near each other and unlinked ones in a grid under
// them (graph-layout.ts); the layout is the same on every open, and a node
// the reader dragged stays where they put it (per browser). Nodes float in
// scattered on first open and settle into place, framed in the part of the
// canvas the Stitch box and the side lists leave free. Clicking a node opens
// that document; ⇧-click, or a click while the Stitch box is picking,
// selects it for Stitch instead (SPEC.md §22) — a selected node draws a clay
// ring. Labels keep a readable size on screen when the view zooms out.

// "lit" = part of the hovered neighborhood; "dim" = outside it; "base" = no
// hover anywhere. The spotlight rides a context, never node or edge data:
// rebuilding the arrays on every hover replaces reactflow's elements, which
// can eat a click landing in the same frame.
type Spotlight = "base" | "lit" | "dim";

type HoverState = { nodeId?: string; edgeId?: string } | null;

/** Screen space the overlay keeps for itself over the canvas: the Stitch
    box at the bottom, a side list at the right, a card at the top. The fit
    frames the nodes in what is left. */
export type GraphInsets = { top: number; right: number; bottom: number; left: number };
const NO_INSETS: GraphInsets = { top: 0, right: 0, bottom: 0, left: 0 };

// The node's box in flow units: the dot's row is NODE_H tall and NODE_W
// wide; the label hangs under it, outside the measured box.
const NODE_W = 144;
const NODE_H = 32;
const FIT_MAX_ZOOM = 1.1;
const FIT_MIN_ZOOM = 0.45;
// Labels stay at least this size on screen (until the scale cap).
const LABEL_SCALE_MAX = 1.7;
const LABEL_WIDTH_SCALE_MAX = 1.35;
const labelScale = (zoom: number) => Math.min(LABEL_SCALE_MAX, Math.max(1, 1 / zoom));

// The canvas state the nodes and curves read: the spotlight, the pinned
// curve, the cited documents, and the handlers a curve's link list needs (it
// renders in the floating layer, off the curve, so its own hover has to keep
// the spotlight alive).
const SpotlightContext = createContext<{
  hover: HoverState;
  litIds: Set<string> | null;
  citedIds: Set<string> | null;
  pinnedEdgeId: string | null;
  floatHost: HTMLElement | null;
  insets: GraphInsets;
  hoverEdge: (edgeId: string) => void;
  pinEdge: (edgeId: string) => void;
  scheduleClear: () => void;
  openLink: (link: GraphEdgeLink, documentId: string) => void;
}>({
  hover: null,
  litIds: null,
  citedIds: null,
  pinnedEdgeId: null,
  floatHost: null,
  insets: NO_INSETS,
  hoverEdge: () => {},
  pinEdge: () => {},
  scheduleClear: () => {},
  openLink: () => {},
});

type DocumentNodeData = {
  title: string;
  hasVideo: boolean;
  generated: boolean;
  size: number;
  active: boolean;
  breathing: boolean;
  selected: boolean; // picked for Stitch (SPEC.md §22)
};

type LinkEdgeData = {
  count: number;
  recommendedOnly: boolean;
  links: GraphEdgeLink[];
};

function DocumentNode({ id, data }: NodeProps<DocumentNodeData>) {
  const { litIds, citedIds, hover } = useContext(SpotlightContext);
  const cited = citedIds?.has(id) ?? false;
  const spotlight: Spotlight = litIds === null ? "base" : litIds.has(id) ? "lit" : "dim";
  const sectionDim = useNodeSectionDim(id); // [graph-notes]
  // Cited documents (the last Stitch answer) stay bright while the rest
  // fade; so do the documents a section filter keeps [graph-notes].
  const opacity = spotlight === "dim" ? 0.15 : sectionDim || (litIds === null && citedIds && !cited) ? 0.35 : 1;
  const size = data.size + (data.active ? 2 : 0);
  const breatheDelay = `${(Math.abs(seeded(id, 5)) * 3).toFixed(2)}s`;
  const breatheDur = `${(3.2 + Math.abs(seeded(id, 9)) * 2).toFixed(2)}s`;
  const ring = data.selected
    ? "ring-[3px] ring-clay ring-offset-2 ring-offset-paper"
    : cited
      ? "ring-[3px] ring-[var(--kind-assistant)] ring-offset-2 ring-offset-paper"
      : "";
  return (
    <div className="relative flex h-8 w-36 justify-center transition-opacity duration-300" style={{ opacity }}>
      <Handle type="source" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" style={{ top: 16 }} />
      <Handle type="target" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" style={{ top: 16 }} />
      <span
        className={data.breathing ? "graph-breathe flex h-8 items-center justify-center" : "flex h-8 items-center justify-center"}
        style={data.breathing ? { animationDelay: breatheDelay, animationDuration: breatheDur } : undefined}
      >
        <span
          data-graph-dot
          className={`flex items-center justify-center border-2 border-card transition-[transform,box-shadow] duration-200 ${
            data.generated ? "rounded-[7px]" : "rounded-full"
          } ${
            data.active
              ? "bg-clay shadow-[0_0_20px_color-mix(in_srgb,var(--clay)_55%,transparent)]"
              : data.generated
                ? "bg-sand-600 shadow-[0_0_12px_color-mix(in_srgb,var(--sand-600)_35%,transparent)]"
                : "bg-sage-500 shadow-[0_0_12px_color-mix(in_srgb,var(--sage)_40%,transparent)]"
          } ${spotlight === "lit" ? "scale-110" : ""} ${ring}`}
          style={{ width: size, height: size }}
        >
          {data.hasVideo && <FilmIcon size={Math.max(10, size - 14)} className={data.active ? "text-clay-fg" : "text-sage-fg"} />}
          {data.generated && !data.hasVideo && (
            <PageIcon size={Math.max(10, size - 14)} className={data.active ? "text-clay-fg" : "text-paper"} />
          )}
        </span>
      </span>
      {/* The label hangs under the dot and grows when the view zooms out,
          so it stays readable on screen (--graph-label-scale, set on the
          canvas from the zoom). */}
      <span
        data-graph-label
        className={`graph-node-label absolute top-[36px] left-1/2 line-clamp-2 -translate-x-1/2 text-center leading-snug font-semibold ${
          data.active ? "text-clay-700" : "text-ink"
        }`}
      >
        {data.title}
      </span>
      {/* [graph-notes] The notes chip sits right of the dot, clear of the
          label under it. */}
      <span className="absolute top-1/2 -translate-y-1/2" style={{ left: `calc(50% + ${size / 2 + 4}px)` }}>
        <NodeNotes documentId={id} hovered={hover?.nodeId === id} />
      </span>
    </div>
  );
}

// The clay of a curve from the pair's link count, depth 0..1: one link a
// light line, eight or more the deepest.
function edgeTone(depth: number): string {
  return `color-mix(in srgb, var(--clay-400) ${Math.round((1 - depth) * 100)}%, var(--clay-900))`;
}

/** Where a floating card goes: beside a point of the canvas, kept inside
    the part of the canvas the overlay leaves free. */
function useScreenPoint(p: Point): Point {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  return { x: p.x * zoom + tx, y: p.y * zoom + ty };
}

// A swept curve between two documents (release-edu's branch edge), weight and
// depth from the pair's link count: every link makes the curve wider and its
// clay deeper, deepest at the middle (SPEC.md §13). Accepted links draw clay;
// a recommended-only pair draws sand, dashed, dashes marching until a link is
// accepted. Hovering the curve, or clicking it to pin, lists the pair's links
// beside the curve; a click on a link expands it — why it was made, and the
// passage at each end, with a button that opens the reader there — and pins
// the curve so the list stays. A loop (source === target, SPEC.md §13) is
// the links inside one document: the curve leaves the node's top, rises,
// and returns to the same point, like a loop in graph theory; its pill and
// list sit at the loop's top.
const LOOP_HEIGHT = 64; // the control points' rise above the node's center
const LOOP_HALF_WIDTH = 34;
function LinkEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data }: EdgeProps<LinkEdgeData>) {
  const { hover, pinnedEdgeId } = useContext(SpotlightContext);
  // [graph-notes] A hovered note lights the curves between the documents it quotes.
  const notesLit = useNotesLit();
  const lit = hover
    ? hover.nodeId
      ? source === hover.nodeId || target === hover.nodeId
      : hover.edgeId === id
    : notesLit !== null && notesLit.has(source) && notesLit.has(target);
  const spotlight: Spotlight = hover === null && notesLit === null ? "base" : lit ? "lit" : "dim";
  const count = data?.count ?? 1;
  const recommendedOnly = data?.recommendedOnly ?? false;
  const links = data?.links ?? [];
  const listOpen = links.length > 0 && (hover?.edgeId === id || pinnedEdgeId === id);
  const loop = source === target;
  // The bow runs along the chord's normal, so side-by-side pairs bow too.
  const chord = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
  const bowSize = loop ? 0 : seeded(id, 3) * 40 + chord * 0.12;
  const nx = loop ? 0 : -(targetY - sourceY) / chord;
  const ny = loop ? 0 : (targetX - sourceX) / chord;
  // The pill's and the list's anchor: the curve's middle, or the loop's top.
  const midX = loop ? sourceX : (sourceX + targetX) / 2;
  const midY = loop ? sourceY - LOOP_HEIGHT * 0.75 : (sourceY + targetY) / 2;
  const path = loop
    ? `M ${sourceX} ${sourceY} C ${sourceX - LOOP_HALF_WIDTH} ${sourceY - LOOP_HEIGHT}, ${sourceX + LOOP_HALF_WIDTH} ${sourceY - LOOP_HEIGHT}, ${sourceX} ${sourceY}`
    : `M ${sourceX} ${sourceY} Q ${midX + nx * bowSize} ${midY + ny * bowSize} ${targetX} ${targetY}`;
  // A quadratic curve passes its control point's direction at half the bow.
  const anchor = { x: midX + (nx * bowSize) / 2, y: midY + (ny * bowSize) / 2 };
  const depth = Math.min(1, Math.max(0, count - 1) / 7);
  const width = 1.6 + depth * 6.4 + (spotlight === "lit" ? 0.8 : 0);
  const opacity = spotlight === "dim" ? 0.07 : spotlight === "lit" ? 0.95 : recommendedOnly ? 0.45 : 0.7;
  const gradientId = `edge-${id.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const label = String(count);
  const pillWidth = 14 + label.length * 7;
  return (
    <g style={{ opacity, transition: "opacity 0.25s ease" }}>
      {!recommendedOnly && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={loop ? sourceX : targetX}
            y2={loop ? sourceY - LOOP_HEIGHT : targetY}
          >
            <stop offset="0" stopColor={edgeTone(depth * 0.55)} />
            <stop offset="0.5" stopColor={edgeTone(depth)} />
            <stop offset="1" stopColor={edgeTone(depth * 0.55)} />
          </linearGradient>
        </defs>
      )}
      <path
        d={path}
        fill="none"
        stroke={recommendedOnly ? "var(--sand-500)" : `url(#${gradientId})`}
        strokeLinecap="round"
        strokeDasharray={recommendedOnly ? "5 7" : undefined}
        className={recommendedOnly ? "graph-dash-march" : undefined}
        style={{ strokeWidth: width, transition: "stroke-width 0.25s ease" }}
      />
      {/* Wide invisible twin so the thin curve is hoverable (wider still
          under a finger, graph rules in globals.css). */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction graph-edge-hit" />
      {count > 1 && (
        // The exact link count on a small pill at the curve's midpoint; it
        // grows with the labels when the view zooms out.
        <g transform={`translate(${anchor.x}, ${loop ? midY : anchor.y})`}>
          <g className="graph-edge-pill">
            <rect x={-pillWidth / 2} y={-9} width={pillWidth} height={18} rx={9} fill="var(--card)" stroke="var(--line)" />
            <text textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="var(--sand-700)">
              {label}
            </text>
          </g>
        </g>
      )}
      {/* [graph-notes] Open replies and notes quoting both, beside the pill. */}
      <CurveMarks pair={id} links={links} x={anchor.x} y={loop ? midY : anchor.y} offset={count > 1 ? pillWidth / 2 : 0} />
      {listOpen && <EdgeLinkList edgeId={id} loop={loop} anchor={loop ? { x: midX, y: midY - 10 } : anchor} links={links} />}
    </g>
  );
}

// [graph-notes] A pair that only notes join: the sage dotted curve.
function NoteEdgeHost(props: EdgeProps<NoteEdgeData>) {
  const { hover, pinnedEdgeId, hoverEdge, scheduleClear } = useContext(SpotlightContext);
  return (
    <NoteEdge
      {...props}
      spotlight={{ hover, pinnedEdgeId, hoverEdge, scheduleClear }}
      renderList={(anchor, children) => (
        <CurveListFrame edgeId={props.id} loop={false} anchor={anchor} wide={false}>
          {children}
        </CurveListFrame>
      )}
    />
  );
}

// A curve's list (SPEC.md §13), drawn in the floating layer over the canvas:
// screen-sized at any zoom, beside the curve, kept inside the part of the
// canvas the Stitch box and the side lists leave free, and a sheet at the
// foot of the canvas on a narrow screen. The link list and a note curve's
// list [graph-notes] both sit in it.
const LIST_W = 288;
const LIST_W_OPEN = 400;
function CurveListFrame({
  edgeId,
  loop,
  anchor,
  wide,
  children,
}: {
  edgeId: string;
  loop: boolean;
  anchor: Point;
  wide: boolean;
  children: ReactNode;
}) {
  const { floatHost, insets, hoverEdge, scheduleClear } = useContext(SpotlightContext);
  const screen = useScreenPoint(anchor);
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  if (!floatHost) return null;
  const narrow = paneW < 640;
  const width = Math.min(wide ? LIST_W_OPEN : LIST_W, paneW - 16);
  const freeTop = insets.top + 8;
  const freeBottom = paneH - insets.bottom - 8;
  // Open toward the side with room: under the curve in the upper half of
  // the free canvas, above it in the lower half; above a loop's top, so it
  // never covers the node and its title — beside the loop when the top of
  // the canvas has no room.
  const roomAbove = screen.y - 12 - freeTop;
  const roomBelow = freeBottom - screen.y - 12;
  const MIN_ROOM = 160;
  const wantAbove = loop || screen.y > (freeTop + freeBottom) / 2;
  const place: "above" | "below" | "beside" =
    wantAbove && roomAbove >= MIN_ROOM
      ? "above"
      : !loop && roomBelow >= MIN_ROOM
        ? "below"
        : !loop
          ? roomAbove >= roomBelow
            ? "above"
            : "below"
          : "beside";
  const maxLeft = Math.max(8, paneW - insets.right - width - 8);
  const left = Math.min(Math.max(screen.x - width / 2, 8), maxLeft);
  const besideLeft = screen.x + 40 + width <= paneW - insets.right - 8 ? screen.x + 40 : Math.max(8, screen.x - 40 - width);
  const besideTop = Math.max(freeTop, screen.y - 24);
  const style: CSSProperties = narrow
    ? { left: 8, right: 8, bottom: insets.bottom + 8, maxHeight: "55%" }
    : place === "above"
      ? { left, width, bottom: paneH - screen.y + 12, maxHeight: Math.max(80, roomAbove) }
      : place === "below"
        ? { left, width, top: screen.y + 12, maxHeight: Math.max(80, roomBelow) }
        : { left: besideLeft, width, top: besideTop, maxHeight: Math.max(80, freeBottom - besideTop) };
  return createPortal(
    <div
      onMouseEnter={() => hoverEdge(edgeId)}
      onMouseLeave={scheduleClear}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-track-surface="graph-links"
      className="graph-float-in pointer-events-auto absolute flex flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card/95 p-2 shadow-float backdrop-blur-md"
      style={style}
    >
      {children}
    </div>,
    floatHost,
  );
}

// A curve's link list: every link's description, the quote at each end with
// its document's name, and, for a recommended link, Accept and Dismiss. An
// expanded link shows its detail, its replies, and Note on this link; the
// notes quoting both documents follow the links [graph-notes].
function EdgeLinkList({ edgeId, loop, anchor, links }: { edgeId: string; loop: boolean; anchor: Point; links: GraphEdgeLink[] }) {
  const { pinEdge, openLink } = useContext(SpotlightContext);
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  // A recommended link accepted or dismissed from the list (SPEC.md §13):
  // the row answers at once, and the refresh brings the graph's own data.
  const { canEdit } = useCollab();
  const router = useRouter();
  const { notebookId } = useParams<{ notebookId?: string }>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [decideError, setDecideError] = useState<string | null>(null);
  async function decide(linkId: string, accept: boolean) {
    if (busyId) return;
    setBusyId(linkId);
    setDecideError(null);
    try {
      if (accept) await api(linkPath(linkId, notebookId), "PATCH", { accept: true });
      else await api(linkPath(linkId, notebookId), "DELETE");
      (accept ? setAccepted : setDismissed)((prev) => new Set(prev).add(linkId));
      router.refresh();
    } catch (err) {
      setDecideError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusyId(null);
    }
  }
  const count = links.length;
  return (
    <CurveListFrame edgeId={edgeId} loop={loop} anchor={anchor} wide={openId !== null}>
      <p className="px-2 pt-0.5 pb-1 text-[11px] font-bold tracking-[0.06em] text-sand-600 uppercase">
        {loop
          ? count === 1
            ? t("panes.graphLoopLinkOne")
            : t("panes.graphLoopLinks", { count })
          : count === 1
            ? t("panes.graphPairLinkOne")
            : t("panes.graphPairLinks", { count })}
      </p>
      {decideError && <p className="px-2 text-[11px] text-red-500">{decideError}</p>}
      {links.map((l) => {
        if (dismissed.has(l.id)) return null;
        const open = openId === l.id;
        const recommended = l.recommended && !accepted.has(l.id);
        return (
          <div key={l.id} className={open ? "rounded-xl bg-sand-100/70" : undefined}>
            <button
              onClick={() => {
                setOpenId(open ? null : l.id);
                if (!open) pinEdge(edgeId);
              }}
              data-track="graph-link-expand"
              data-tip={t(open ? "panes.linkCollapse" : "panes.linkExpand")}
              aria-expanded={open}
              className="flex w-full flex-col items-start gap-0.5 rounded-xl px-2 py-1.5 text-left hover:bg-clay-100"
            >
              <span className="text-[12.5px] leading-snug font-semibold text-ink">
                {l.reason ?? clipWords(l.quotedText, 60)}
              </span>
              {/* Each quote names its document, so a pair linked both ways
                  reads plainly; a loop's quotes are all one document's. */}
              {!open && l.reason && <QuoteLine title={loop ? null : l.fromTitle} quote={l.quotedText} tone="text-sand-600" />}
              {!open && l.toQuotedText && <QuoteLine title={loop ? null : l.toTitle} quote={l.toQuotedText} tone="text-sand-500" />}
              <LinkReplyCount link={l} />
            </button>
            {recommended && (
              <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5">
                <span className="rounded-full border border-dashed border-clay-300 px-2 text-[10.5px] font-semibold text-clay-700">
                  {t("panes.graphLinkRecommended")}
                </span>
                {canEdit && (
                  <span className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => void decide(l.id, true)}
                      data-track="link-accept"
                      disabled={busyId !== null}
                      data-tip={t("panes.acceptLinkTitle")}
                      className="rounded-full bg-sage-600 px-2.5 py-0.5 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
                    >
                      {t("panes.acceptLink")}
                    </button>
                    <button
                      onClick={() => void decide(l.id, false)}
                      data-track="link-dismiss"
                      disabled={busyId !== null}
                      data-tip={t("panes.dismissLinkTitle")}
                      className="rounded-full border border-line px-2 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                    >
                      {t("panes.dismissLink")}
                    </button>
                  </span>
                )}
              </div>
            )}
            {open && (
              <div className="px-2 pt-1 pb-2">
                {/* The row's title already is the reason, when there is one. */}
                <LinkDetail link={l} showReason={!l.reason} onOpen={(documentId) => openLink(l, documentId)} />
                <LinkReplies link={l} />
                <LinkNoteComposer linkId={l.id} />
              </div>
            )}
          </div>
        );
      })}
      <PairNotes pair={edgeId} />
    </CurveListFrame>
  );
}

function QuoteLine({ title, quote, tone }: { title: string | null; quote: string; tone: string }) {
  return (
    <span className={`text-[11px] leading-snug ${tone}`}>
      {title && (
        <span className="mr-1 inline-block max-w-[9rem] truncate rounded-full bg-sand-200/80 px-1.5 align-bottom text-[10px] font-semibold text-sand-700">
          {title}
        </span>
      )}
      {clipWords(quote, 60)}
    </span>
  );
}

const nodeTypes = { document: DocumentNode };
const edgeTypes = { link: LinkEdge, note: NoteEdgeHost };

// A node's card (GR-14): the full title, what the document is, its length,
// and its links, beside the hovered or focused node. It says what a click
// does, since a click leaves the graph for the reader.
function NodeCard({
  node,
  counts,
  picking,
}: {
  node: GraphNode | null;
  counts: { accepted: number; recommended: number } | undefined;
  picking: boolean;
}) {
  const { floatHost, insets } = useContext(SpotlightContext);
  const t = useT();
  // The card waits a beat, so a pointer crossing the canvas does not flash a
  // card on every node it passes. Its own state: the canvas does not render
  // again when it shows.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), 220);
    return () => window.clearTimeout(timer);
  }, []);
  const position = useStore((s) => (node ? s.nodeInternals.get(node.id)?.position : undefined));
  const screen = useScreenPoint(position ? { x: position.x + NODE_W / 2, y: position.y + NODE_H / 2 } : { x: 0, y: 0 });
  const zoom = useStore((s) => s.transform[2]);
  const paneW = useStore((s) => s.width);
  if (!floatHost || !shown || !node || !position) return null;
  const accepted = counts?.accepted ?? 0;
  const recommended = counts?.recommended ?? 0;
  const width = Math.min(260, paneW - 16);
  const gap = 22 * Math.max(zoom, 0.6);
  const right = screen.x + gap + width <= paneW - insets.right - 8;
  const left = right ? screen.x + gap : Math.max(8, screen.x - gap - width);
  const kind = node.kind ? categoryLabels(t).kind(node.kind) : null;
  const facts1 = [
    kind,
    node.blockCount !== undefined
      ? t("panes.graphCardBlocks", { n: node.blockCount, s: node.blockCount === 1 ? "" : "s" })
      : null,
  ].filter(Boolean);
  const linkLine = [
    t("panes.graphCardLinks", { n: accepted, s: accepted === 1 ? "" : "s" }),
    recommended > 0 ? t("panes.graphCardRecommended", { n: recommended }) : null,
  ].filter(Boolean);
  return createPortal(
    <div
      role="tooltip"
      className="graph-float-in pointer-events-none absolute flex flex-col gap-1 rounded-2xl border border-line bg-card/95 px-3.5 py-2.5 shadow-float backdrop-blur-md"
      style={{ left, top: Math.max(insets.top + 8, screen.y - 18), width }}
    >
      <p className="text-[13px] leading-snug font-semibold text-ink">{node.title}</p>
      {facts1.length > 0 && <p className="text-[11.5px] text-sand-600">{facts1.join(" · ")}</p>}
      <p className="text-[11.5px] text-sand-600">{linkLine.join(" · ")}</p>
      <p className="mt-0.5 text-[11px] text-sand-500">{t(picking ? "panes.graphCardPick" : "panes.graphCardOpen")}</p>
    </div>,
    floatHost,
  );
}

// The key (GR-12): what each mark means and the gestures, behind the ?
// button with the zoom controls, so it never sits under the Stitch box.
function GraphKey({ onClose }: { onClose: () => void }) {
  const t = useT();
  const row = (mark: ReactNode, key: Parameters<typeof t>[0]) => (
    <li className="flex items-center gap-2.5">
      <span className="flex w-7 shrink-0 items-center justify-center">{mark}</span>
      <span>{t(key)}</span>
    </li>
  );
  const dot = (cls: string) => <span className={`block size-3.5 border-2 border-card ${cls}`} />;
  const line = (dashed: boolean, w: number) => (
    <svg width="28" height="10" aria-hidden>
      <path d="M2 5 Q14 1 26 5" fill="none" stroke={dashed ? "var(--sand-500)" : "var(--clay-600)"} strokeWidth={w} strokeDasharray={dashed ? "4 4" : undefined} strokeLinecap="round" />
    </svg>
  );
  return (
    <div
      role="dialog"
      aria-label={t("panes.graphKeyTitle")}
      className="graph-float-in pointer-events-auto absolute top-3 left-14 z-30 w-[300px] max-w-[calc(100%-72px)] rounded-2xl border border-line bg-card/95 p-3.5 text-[12px] text-sand-700 shadow-float backdrop-blur-md"
    >
      <div className="mb-2 flex items-center">
        <p className="flex-1 text-[11px] font-bold tracking-[0.06em] text-sand-600 uppercase">{t("panes.graphKeyTitle")}</p>
        <button onClick={onClose} aria-label={t("common.close")} className="flex size-6 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100">
          ✕
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {row(dot("rounded-full bg-clay"), "panes.graphKeyOpen")}
        {row(dot("rounded-full bg-sage-500"), "panes.graphKeyDocument")}
        {row(dot("rounded-[4px] bg-sand-600"), "panes.graphKeyGenerated")}
        {row(line(false, 3), "panes.graphKeyLinks")}
        {row(line(true, 2), "panes.graphKeyRecommended")}
        {row(
          <svg width="24" height="20" aria-hidden>
            <circle cx="12" cy="17" r="3" fill="var(--sage-500)" />
            <path d="M12 15 C2 -3, 22 -3, 12 15" fill="none" stroke="var(--clay-600)" strokeWidth={2} />
          </svg>,
          "panes.graphKeyLoop",
        )}
        {row(dot("rounded-full bg-sage-500 ring-2 ring-[var(--kind-assistant)] ring-offset-1 ring-offset-card"), "panes.graphKeyCited")}
        {/* [graph-notes] The note curve and the node's notes chip. */}
        {row(
          <svg width="28" height="10" aria-hidden>
            <path d="M2 5 Q14 1 26 5" fill="none" stroke="var(--sage-500)" strokeWidth={2.2} strokeDasharray="1.5 6" strokeLinecap="round" />
          </svg>,
          "graphNotes.noteCurveHint",
        )}
        {row(
          <span className="flex items-center gap-1 rounded-full bg-sage-100 px-1.5 py-px text-[10px] font-semibold tabular-nums text-sage-800">
            <NotesIcon size={10} />2
          </span>,
          "graphNotes.nodeNotesTitle",
        )}
      </ul>
      <p className="mt-2.5 border-t border-line pt-2 text-[11.5px] leading-relaxed text-sand-600">{t("panes.graphGestures")}</p>
    </div>
  );
}

// Dragged positions (GR-10), per project and per browser: a convenience the
// reader can lose (private window, cleared storage) without losing work.
const POS_KEY = (notebookId: string) => `unitos-graph-pos:${notebookId}`;
function loadDragged(notebookId: string): Map<string, Point> {
  try {
    const raw = window.localStorage.getItem(POS_KEY(notebookId));
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    const out = new Map<string, Point>();
    if (parsed && typeof parsed === "object") {
      for (const [id, p] of Object.entries(parsed as Record<string, unknown>)) {
        if (p && typeof p === "object" && typeof (p as Point).x === "number" && typeof (p as Point).y === "number") {
          out.set(id, { x: (p as Point).x, y: (p as Point).y });
        }
      }
    }
    return out;
  } catch {
    return new Map();
  }
}
function saveDragged(notebookId: string, positions: Map<string, Point>) {
  try {
    window.localStorage.setItem(POS_KEY(notebookId), JSON.stringify(Object.fromEntries(positions)));
  } catch {
    /* storage off: the drag holds for this open only */
  }
}

// Layouts made this tab, by shape and by the project's documents and pairs.
const layoutCache = new Map<string, Map<string, Point>>();

// The label scale follows the zoom through a CSS variable on the canvas, so
// a zoom re-renders no node.
function LabelScale({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    const s = labelScale(zoom);
    target.current?.style.setProperty("--graph-label-scale", s.toFixed(3));
    target.current?.style.setProperty("--graph-label-width-scale", Math.min(s, LABEL_WIDTH_SCALE_MAX).toFixed(3));
  }, [zoom, target]);
  return null;
}

function GraphCanvas({
  notebookId,
  activeDocumentId,
  nodes,
  edges,
  onOpenDocument,
  docHref,
  selectedIds,
  picking = false,
  onToggleSelect,
  insets = NO_INSETS,
  citedIds,
  onClearCited,
}: GraphViewProps) {
  const router = useRouter();
  const t = useT();
  const flow = useReactFlow();
  // The timers below outlive the render that set them: they read the
  // current helper, never the stub reactflow hands out before it is ready.
  const flowRef = useRef(flow);
  useLayoutEffect(() => {
    flowRef.current = flow;
  }, [flow]);
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [floatHost, setFloatHost] = useState<HTMLElement | null>(null);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<DocumentNodeData>([]);
  // First open: nodes mount scattered, then glide into place (CSS transition
  // while `settling`); edges stay hidden until they land. The phase lives in
  // a ref so a strict-mode double effect run re-renders the scatter instead
  // of skipping straight to the targets.
  const [settling, setSettling] = useState(true);
  const phaseRef = useRef<"scatter" | "settle" | "done">("scatter");
  // Hand-dragged positions survive data refreshes, hover rebuilds, and
  // closing the graph (per browser).
  const draggedPos = useRef<Map<string, Point> | null>(null);
  if (draggedPos.current === null) draggedPos.current = typeof window === "undefined" ? new Map() : loadDragged(notebookId);
  // Once the reader pans or zooms, the view is theirs: no automatic refit.
  const userMoved = useRef(false);
  const [hover, setHover] = useState<HoverState>(null);
  // Dragging a node hides its card until the pointer rests again.
  const [dragging, setDragging] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  // A curve's link list lives in the floating layer, off the curve: the
  // leave that fires on the way there waits a beat, and the list's own hover
  // cancels it. A click on a curve pins its list until the pane is clicked.
  const [pinnedEdgeId, setPinnedEdgeId] = useState<string | null>(null);
  const clearTimer = useRef<number | null>(null);
  const cancelClear = useCallback(() => {
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
  }, []);
  const scheduleClear = useCallback(() => {
    cancelClear();
    clearTimer.current = window.setTimeout(() => {
      clearTimer.current = null;
      setHover(null);
    }, 160);
  }, [cancelClear]);
  const hoverEdge = useCallback(
    (edgeId: string) => {
      cancelClear();
      setHover({ edgeId });
    },
    [cancelClear],
  );
  const hoverNode = useCallback(
    (nodeId: string) => {
      cancelClear();
      setHover({ nodeId });
    },
    [cancelClear],
  );
  useEffect(() => cancelClear, [cancelClear]);
  const openLink = useCallback(
    (link: GraphEdgeLink, documentId: string) => {
      router.push(`/n/${notebookId}?doc=${documentId}&link=${link.id}`);
      onOpenDocument();
    },
    [router, notebookId, onOpenDocument],
  );
  const pinEdge = useCallback((edgeId: string) => setPinnedEdgeId(edgeId), []);
  useSyncPinnedPair(pinnedEdgeId); // [graph-notes]
  const notesLit = useNotesLit(); // [graph-notes]
  // Nothing hovered: a pinned curve keeps its pair in the spotlight.
  const shown = useMemo<HoverState>(
    () => hover ?? (pinnedEdgeId ? { edgeId: pinnedEdgeId } : null),
    [hover, pinnedEdgeId],
  );

  const { adjacency, breathing, linkCounts, loops } = useMemo(() => {
    const adjacency = new Map<string, Set<string>>();
    const breathing = new Set<string>();
    const linkCounts = new Map<string, { accepted: number; recommended: number }>();
    const loops = new Set<string>();
    const count = (id: string, e: GraphEdge) => {
      const c = linkCounts.get(id) ?? { accepted: 0, recommended: 0 };
      c.accepted += e.accepted;
      c.recommended += e.recommended;
      linkCounts.set(id, c);
    };
    for (const e of edges) {
      if (!adjacency.has(e.a)) adjacency.set(e.a, new Set());
      if (!adjacency.has(e.b)) adjacency.set(e.b, new Set());
      count(e.a, e);
      if (e.accepted === 0) breathing.add(e.a);
      // A loop (a === b) is no neighbor of its own node: it counts once
      // toward the node's links and never moves it in the layout.
      if (e.a === e.b) {
        loops.add(e.a);
        continue;
      }
      adjacency.get(e.a)!.add(e.b);
      adjacency.get(e.b)!.add(e.a);
      count(e.b, e);
      if (e.accepted === 0) breathing.add(e.b);
    }
    return { adjacency, breathing, linkCounts, loops };
  }, [edges]);

  // The layout reads only which documents exist and which pairs link, so a
  // refresh that changes a title or a count keeps every node in place.
  const layoutKey = useMemo(
    () =>
      JSON.stringify([
        nodes.map((n) => n.id),
        edges.map((e) => [e.a, e.b, e.accepted + e.recommended]),
      ]),
    [nodes, edges],
  );
  // Shaped for the pane: wide on a laptop, tall on a phone. The height
  // leaves the Stitch box's usual room (it opens at 640px and wider), never
  // its live height, so a growing answer never moves a node.
  // Nothing is laid out before the pane has a size; a layout already made
  // for this project and shape is reused (an open, a refresh, a reopen).
  const aspect = paneW > 0 ? layoutAspect(paneW, paneH - (paneW >= 640 ? 230 : 60)) : 0;
  const layout = useMemo(() => {
    if (aspect === 0) return new Map<string, Point>();
    const key = `${aspect}|${layoutKey}`;
    const cached = layoutCache.get(key);
    if (cached) return cached;
    const [ids, pairs] = JSON.parse(layoutKey) as [string[], [string, string, number][]];
    const made = graphLayout(
      ids,
      pairs.map(([a, b, weight]) => ({ a, b, weight })),
      aspect,
    );
    if (layoutCache.size > 12) layoutCache.clear();
    layoutCache.set(key, made);
    return made;
  }, [layoutKey, aspect]);

  // The hovered neighborhood: the node and its linked documents, or a curve's
  // two endpoints. Everything else dims.
  const litIds = useMemo(() => {
    if (!shown) return notesLit; // [graph-notes] a hovered note's documents
    const lit = new Set<string>();
    if (shown.nodeId) {
      lit.add(shown.nodeId);
      for (const n of adjacency.get(shown.nodeId) ?? []) lit.add(n);
    } else if (shown.edgeId) {
      for (const id of shown.edgeId.split("|")) lit.add(id);
    }
    return lit;
  }, [shown, adjacency, notesLit]);

  // A node's flow position is its box's top-left; the layout gives centers.
  const target = useCallback(
    (id: string): Point => {
      const dragged = draggedPos.current?.get(id);
      if (dragged) return dragged;
      const c = layout.get(id) ?? { x: 0, y: 0 };
      return { x: c.x - NODE_W / 2, y: c.y - NODE_H / 2 };
    },
    [layout],
  );

  // The fit (GR-01, BOX-03): frame every node in the part of the pane the
  // overlay leaves free (insets), labels included, at a zoom between
  // FIT_MIN_ZOOM and FIT_MAX_ZOOM. When the nodes do not fit at the least
  // zoom, the view shows the top of the layout, where the linked groups are.
  const insetsRef = useRef(insets);
  const loopsRef = useRef(loops);
  useLayoutEffect(() => {
    insetsRef.current = insets;
    loopsRef.current = loops;
  }, [insets, loops]);
  const fitTo = useCallback(
    (positions: { id: string; x: number; y: number }[], duration = 0) => {
      if (positions.length === 0 || paneW <= 0 || paneH <= 0) return;
      const ins = insetsRef.current;
      const pad = 28;
      const freeL = ins.left + pad;
      const freeR = paneW - ins.right - pad;
      let freeT = ins.top + pad;
      let freeB = paneH - ins.bottom - pad * 0.6;
      // A free area too short to hold anything: use the whole pane.
      if (freeB - freeT < 140) {
        freeT = pad;
        freeB = paneH - pad;
      }
      const aw = Math.max(80, freeR - freeL);
      const ah = freeB - freeT;
      let zoom = 1;
      let bounds = { x0: 0, x1: 0, y0: 0, y1: 0 };
      for (let pass = 0; pass < 2; pass++) {
        const s = labelScale(zoom);
        const halfLabel = (NODE_W / 2) * Math.min(s, LABEL_WIDTH_SCALE_MAX);
        const labelH = 40 * s;
        bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
        for (const p of positions) {
          const cx = p.x + NODE_W / 2;
          const cy = p.y + NODE_H / 2;
          bounds.x0 = Math.min(bounds.x0, cx - halfLabel);
          bounds.x1 = Math.max(bounds.x1, cx + halfLabel);
          bounds.y0 = Math.min(bounds.y0, cy - 20 - (loopsRef.current.has(p.id) ? LOOP_HEIGHT : 0));
          bounds.y1 = Math.max(bounds.y1, cy + 20 + labelH);
        }
        const bw = bounds.x1 - bounds.x0;
        const bh = bounds.y1 - bounds.y0;
        zoom = Math.min(FIT_MAX_ZOOM, Math.max(FIT_MIN_ZOOM, Math.min(aw / bw, ah / bh)));
      }
      const bw = (bounds.x1 - bounds.x0) * zoom;
      const bh = (bounds.y1 - bounds.y0) * zoom;
      const x = freeL + (aw - bw) / 2 - bounds.x0 * zoom;
      const y = bh <= ah ? freeT + (ah - bh) / 2 - bounds.y0 * zoom : freeT - bounds.y0 * zoom;
      try {
        flowRef.current.setViewport({ x, y, zoom }, duration ? { duration } : undefined);
      } catch {
        /* non-critical */
      }
    },
    [paneW, paneH],
  );
  const fitNow = useCallback(
    (duration = 0) => fitTo(flowRef.current.getNodes().map((n) => ({ id: n.id, ...n.position })), duration),
    [fitTo],
  );

  useEffect(() => {
    const mk = (n: GraphNode, position: Point): FlowNode<DocumentNodeData> => {
      const c = linkCounts.get(n.id);
      const degree = (c?.accepted ?? 0) + (c?.recommended ?? 0);
      return {
        id: n.id,
        type: "document",
        position,
        ariaLabel: t("panes.graphNodeLabel", { title: n.title, n: degree, s: degree === 1 ? "" : "s" }),
        data: {
          title: n.title,
          hasVideo: n.hasVideo,
          generated: n.kind === "generated",
          // A longer document draws a bigger dot (√ of its blocks); without
          // a length, the dot grows with the links instead.
          size:
            n.blockCount !== undefined
              ? Math.round(Math.min(34, Math.max(14, 12 + Math.sqrt(n.blockCount) * 1.6)))
              : Math.min(32, 16 + degree * 2.5),
          active: n.id === activeDocumentId,
          breathing: breathing.has(n.id),
          selected: selectedIds?.has(n.id) ?? false,
        },
      };
    };
    if (phaseRef.current === "scatter") {
      // Wait for the pane's size: the first frame is framed for the settled
      // layout, so the nodes glide into a view that already fits them.
      if (paneW <= 0 || paneH <= 0) return;
      const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      fitTo(nodes.map((n) => ({ id: n.id, ...target(n.id) })));
      if (reduce) {
        phaseRef.current = "done";
        setFlowNodes(nodes.map((n) => mk(n, target(n.id))));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the settle ends at once under reduced motion
        setSettling(false);
        return;
      }
      // Scatter → settle (release-edu). The scatter is deterministic, so
      // reopening feels alive but never chaotic.
      setFlowNodes(
        nodes.map((n) =>
          mk(n, {
            x: target(n.id).x + seeded(n.id, 21) * 260,
            y: target(n.id).y + seeded(n.id, 33) * 180,
          }),
        ),
      );
      // Two frames so the scatter paints before the settle transition starts.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (phaseRef.current !== "scatter") return;
          phaseRef.current = "settle";
          setFlowNodes(nodes.map((n) => mk(n, target(n.id))));
          window.setTimeout(() => {
            phaseRef.current = "done";
            setSettling(false);
          }, 950);
        });
      });
      return;
    }
    // [graph-notes] Each node keeps its measured size: a node without one
    // hides its curves until it is measured again, which unmounts a curve's
    // open list — an expanded link, a reply or a note being typed — on every
    // refresh.
    setFlowNodes((prev) => {
      const size = new Map(prev.map((p) => [p.id, { width: p.width, height: p.height }]));
      return nodes.map((n) => ({ ...mk(n, target(n.id)), ...size.get(n.id) }));
    });
  }, [nodes, linkCounts, breathing, target, activeDocumentId, selectedIds, setFlowNodes, paneW, paneH, fitTo, t]);

  // Refit when the free area changes — the Stitch box grows or folds, a
  // side list opens, the window resizes — or documents come and go, as long
  // as the reader has not moved the view.
  const lastFit = useRef<{ key: string; w: number; h: number; ins: GraphInsets } | null>(null);
  useEffect(() => {
    if (phaseRef.current === "scatter" || paneW <= 0) return;
    const prev = lastFit.current;
    lastFit.current = { key: layoutKey, w: paneW, h: paneH, ins: insets };
    if (!prev || userMoved.current) return;
    const changed =
      prev.key !== layoutKey ||
      Math.abs(prev.w - paneW) > 8 ||
      Math.abs(prev.h - paneH) > 8 ||
      Math.abs(prev.ins.bottom - insets.bottom) > 40 ||
      prev.ins.right !== insets.right ||
      prev.ins.top !== insets.top;
    if (changed) {
      const timer = window.setTimeout(() => fitNow(300), prev.key !== layoutKey ? 120 : 0);
      return () => window.clearTimeout(timer);
    }
  }, [insets, paneW, paneH, layoutKey, fitNow, settling]);

  const noteEdges = useNoteOnlyEdges(edges); // [graph-notes]
  const flowEdges = useMemo<FlowEdge<LinkEdgeData | NoteEdgeData>[]>(
    () => [
      ...edges.map((e) => ({
        id: `${e.a}|${e.b}`,
        source: e.a,
        target: e.b,
        type: "link",
        ariaLabel:
          e.a === e.b
            ? t("panes.graphLoopLinks", { count: e.accepted + e.recommended })
            : t("panes.graphPairLinks", { count: e.accepted + e.recommended }),
        data: { count: e.accepted + e.recommended, recommendedOnly: e.accepted === 0, links: e.links },
      })),
      ...noteEdges,
    ],
    [edges, noteEdges, t],
  );

  const spotlight = useMemo(
    () => ({
      hover: shown,
      litIds,
      citedIds: citedIds && citedIds.size > 0 ? citedIds : null,
      pinnedEdgeId,
      floatHost,
      insets,
      hoverEdge,
      pinEdge,
      scheduleClear,
      openLink,
    }),
    [shown, litIds, citedIds, pinnedEdgeId, floatHost, insets, hoverEdge, pinEdge, scheduleClear, openLink],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: FlowNode) => {
      const map = draggedPos.current ?? new Map<string, Point>();
      map.set(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
      draggedPos.current = map;
      saveDragged(notebookId, map);
    },
    [notebookId],
  );

  // Open the document, or pick it for Stitch (SPEC.md §22).
  const activate = useCallback(
    (id: string, pick: boolean) => {
      onClearCited?.();
      if (onToggleSelect && (picking || pick)) {
        onToggleSelect(id);
        return;
      }
      router.push(docHref ? docHref(id) : `/n/${notebookId}?doc=${id}`);
      onOpenDocument();
    },
    [onClearCited, onToggleSelect, picking, router, docHref, notebookId, onOpenDocument],
  );

  // Escape (GR-11) closes the innermost canvas thing first: the key, then a
  // pinned or hovered link list, then a node's card. It marks the event
  // handled, so the overlay keeps itself open. Capture phase: it runs before
  // the overlay's own listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Esc in a text box (a reply or a note on a link) only leaves the box:
      // the overlay blurs it, and the list holding it stays open.
      const target = e.target;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      // A list holding typed words stays, and so does the graph: closing
      // either would throw the words away (✕ still closes the graph).
      const typed = [...(floatHost?.querySelectorAll("textarea, input") ?? [])].some(
        (el) => (el as HTMLTextAreaElement | HTMLInputElement).value.trim() !== "",
      );
      if (keyOpen) setKeyOpen(false);
      else if (pinnedEdgeId && typed) {
        /* kept */
      } else if (pinnedEdgeId) setPinnedEdgeId(null);
      else if (hover) setHover(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keyOpen, pinnedEdgeId, hover, floatHost]);

  // Keyboard (GR-16): Tab reaches nodes and curves; Enter on a node opens it
  // (⇧-Enter picks it), Space picks it; Enter on a curve pins its list.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!(e.target instanceof Element)) return;
      const nodeEl = e.target.closest(".react-flow__node");
      const nodeId = nodeEl?.getAttribute("data-id");
      if (nodeId && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        activate(nodeId, e.key === " " || e.shiftKey);
        return;
      }
      const edgeEl = e.target.closest(".react-flow__edge");
      const edgeId = edgeEl?.getAttribute("data-testid")?.replace(/^rf__edge-/, "");
      if (edgeId && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        setPinnedEdgeId((pinned) => (pinned === edgeId ? null : edgeId));
      }
    },
    [activate],
  );
  const onFocusCapture = useCallback(
    (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !e.target.matches(".react-flow__node")) return;
      const id = e.target.getAttribute("data-id");
      if (id) hoverNode(id);
    },
    [hoverNode],
  );

  // ReactFlow's handlers, stable across hovers so a hover re-renders no more
  // than the spotlight needs.
  const onNodeClick = useCallback(
    (e: ReactMouseEvent, node: FlowNode) => activate(node.id, e.shiftKey || e.metaKey || e.ctrlKey),
    [activate],
  );
  const onNodeMouseEnter = useCallback((_: ReactMouseEvent, node: FlowNode) => hoverNode(node.id), [hoverNode]);
  const onEdgeMouseEnter = useCallback((_: ReactMouseEvent, edge: FlowEdge) => hoverEdge(edge.id), [hoverEdge]);
  const onEdgeClick = useCallback(
    (_: ReactMouseEvent, edge: FlowEdge) => setPinnedEdgeId((pinned) => (pinned === edge.id ? null : edge.id)),
    [],
  );
  const onPaneClick = useCallback(
    (e: ReactMouseEvent) => {
      if (e.target instanceof Element && e.target.classList.contains("react-flow__pane")) {
        setPinnedEdgeId(null);
        setKeyOpen(false);
        onClearCited?.();
      }
    },
    [onClearCited],
  );
  // An edge's mouse-leave is lost when the hovered edge re-renders. Node and
  // edge moves bubble here too, so clear the spotlight only when the pointer
  // is on the pane itself — off every node and edge — after the same beat,
  // so a move from a curve into its link list keeps the list.
  const onPaneMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (e.target instanceof Element && e.target.classList.contains("react-flow__pane")) scheduleClear();
    },
    [scheduleClear],
  );
  // A move with an input event is the reader's; the fit's own moves carry none.
  const onMoveStart = useCallback((e: unknown) => {
    if (e) userMoved.current = true;
  }, []);
  const onNodeDragStart = useCallback(() => setDragging(true), []);
  const onNodeDragStopAll = useCallback(
    (e: ReactMouseEvent, node: FlowNode) => {
      setDragging(false);
      onNodeDragStop(e, node);
    },
    [onNodeDragStop],
  );

  return (
    <div
      ref={wrapRef}
      className={`corpus-graph relative h-full w-full ${settling ? "graph-settling" : ""}`}
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      onBlurCapture={scheduleClear}
    >
      <SpotlightContext.Provider value={spotlight}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStopAll}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={scheduleClear}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={scheduleClear}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onPaneMouseMove={onPaneMouseMove}
        onMoveStart={onMoveStart}
        // Fluid navigation (release-edu): drag empty space to pan, trackpad
        // two-finger scroll pans, pinch or Ctrl/Cmd+wheel zooms. Double-click
        // zoom off — it fires on accidental double-taps of nodes.
        panOnDrag
        panOnScroll
        zoomOnPinch
        zoomOnScroll={false}
        zoomActivationKeyCode={["Meta", "Control"]}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable
        edgesFocusable
      >
        <LabelScale target={wrapRef} />
        <Background gap={26} size={1.5} color="var(--sand-300)" />
        {/* Top left, clear of the Stitch box at the foot of the canvas. */}
        <Controls position="top-left" showInteractive={false} showFitView={false}>
          <ControlButton
            onClick={() => {
              userMoved.current = false;
              fitNow(400);
            }}
            title={t("panes.graphFit")}
            aria-label={t("panes.graphFit")}
            data-track="graph-fit"
          >
            <MaximizeIcon size={13} className="graph-stroke-icon" />
          </ControlButton>
          <ControlButton
            onClick={() => setKeyOpen((v) => !v)}
            title={t("panes.graphKeyTitle")}
            aria-label={t("panes.graphKeyTitle")}
            aria-expanded={keyOpen}
            data-track="graph-key"
          >
            <QuestionIcon size={15} className="graph-stroke-icon" />
          </ControlButton>
        </Controls>
      </ReactFlow>
      {hover?.nodeId && !dragging && (
        <NodeCard
          key={hover.nodeId}
          node={nodes.find((n) => n.id === hover.nodeId) ?? null}
          counts={linkCounts.get(hover.nodeId)}
          picking={picking}
        />
      )}
      </SpotlightContext.Provider>
      {keyOpen && <GraphKey onClose={() => setKeyOpen(false)} />}
      {/* The floating layer: link lists and node cards, screen-sized. */}
      <div ref={setFloatHost} className="pointer-events-none absolute inset-0 z-30 overflow-hidden" />
    </div>
  );
}

type GraphViewProps = {
  notebookId: string;
  activeDocumentId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpenDocument: () => void;
  // Where a node click goes. Default: the reader on that document.
  docHref?: (documentId: string) => string;
  // The nodes picked for Stitch (SPEC.md §22), and the toggle a click runs
  // instead of opening the document: while picking, every click; otherwise
  // a ⇧-click or a ⌘/Ctrl-click.
  selectedIds?: Set<string>;
  picking?: boolean;
  onToggleSelect?: (documentId: string) => void;
  // The screen space the overlay covers over the canvas (the Stitch box, a
  // side list, a card): the fit keeps the nodes out of it.
  insets?: GraphInsets;
  // The documents the last Stitch answer cites: lit until the next command
  // or a click on the canvas (onClearCited).
  citedIds?: Set<string>;
  onClearCited?: () => void;
};

export default function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
