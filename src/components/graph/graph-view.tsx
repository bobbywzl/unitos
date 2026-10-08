"use client";

import { useParams, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
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
import { confirmLinkRemoval, linkRemovable } from "@/components/collab/confirm-link-removal";
import { CommentIcon, FilmIcon, MaximizeIcon, NotesIcon, PageIcon, PlusIcon, QuestionIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { clipWords } from "@/lib/markdown-preview";
import { extendLayout, graphLayout, layoutAspect, seeded, type Point } from "@/components/graph/graph-layout";
import { nodeRoom, placeMarks, type MarkCurve } from "@/lib/graph/curve-place";
import { labelStarts } from "@/lib/graph/label-start";
import { useWantProvenance } from "@/components/graph/provenance-want";
import { markAccepted, unmarkAccepted } from "@/components/graph/accepted-now";
import { categoryLabels } from "@/components/reader/document-organize";
// [graph-notes] The notes and the link replies on the graph (graph-notes.tsx).
import {
  CurveMarks,
  MarkPlacesContext,
  marksWidth,
  noteControl,
  openReplies,
  useGraphNotes,
  NodeNotes,
  NodeNotesRows,
  NoteEdge,
  PairNotes,
  useNodeSectionDim,
  useNoteOnlyEdges,
  useNotesLit,
  useSyncPinnedPair,
  type NoteEdgeData,
} from "@/components/graph/graph-notes";
import { LinkReplyCount } from "@/components/graph/link-replies";
// [/graph-notes]
// [view2] The node card, Find's counts, and the last Stitch answer's links.
import { useGraphContent } from "@/components/graph/graph-content";
import { NodeCardExtras, linkLine } from "@/components/graph/node-card";
import { CoverageRing } from "@/components/graph/coverage"; // [cover4]
// [layer5] The reader's comments on a node, and the reader's documents first at a far zoom.
import { NodeComments, nodeCommentsWidth, useProjectCoverage } from "@/components/graph/coverage";
import { ownCommand } from "@/lib/graph/generated-label"; // [cover4]

// The corpus graph (SPEC.md §13; the release-edu canvas patterns): documents
// as nodes on a pan/zoom canvas, links between them as swept curves. The more
// links between two documents, the thicker and bolder the curve; a pair held
// together only by recommended links draws dashed (marching) until one is
// accepted, and both its documents breathe. Hovering a node spotlights it,
// its links, and its linked documents, and shows its one card (title, kind,
// length, links, its notes); hovering a curve spotlights the pair and lists
// its links beside the curve; a click pins the list, and a click on a link
// opens it in the overlay's side panel at full height.
// Linked documents sit near each other and unlinked ones in a grid under
// them; generated documents sit apart in a row of their own, faded, and their
// provenance links draw only on request (graph-layout.ts, SPEC.md §22). A
// node keeps its place across refreshes and Stitch answers (stored per
// browser), and a node the reader dragged stays where they put it. Nodes float
// in scattered on first open and settle into place, framed in the part of the
// canvas the Stitch box and the side lists leave free. Clicking a node opens
// that document; ⇧-click, or a click while the Stitch box is picking,
// selects it for Stitch instead (SPEC.md §22) — a selected node draws a clay
// ring. Labels keep a readable size on screen when the view zooms out.
// A large project (LARGE_NODES documents, or LARGE_EDGES curves) draws plain:
// solid curves, no marching or breathing, no transitions, only the elements
// in view, and at a far zoom only the labels that matter (REV2-09).
// Keyboard: one Tab stop for the canvas; arrows move between documents, ]
// and [ go through the focused document's curves (REV2-10).

// "lit" = part of the hovered neighborhood; "dim" = outside it; "base" = no
// hover anywhere. The spotlight is CSS (SpotlightStyle): one style element
// names the lit nodes and curves, so a hover renders no node and no curve.
type HoverState = { nodeId?: string; edgeId?: string } | null;

/** Screen space the overlay keeps for itself over the canvas: the Stitch
    box at the bottom, a side list at the right, a card at the top. The fit
    frames the nodes in what is left. */
export type GraphInsets = { top: number; right: number; bottom: number; left: number };
const NO_INSETS: GraphInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const NO_IDS: Set<string> = new Set();

// The node's box in flow units: the dot's row is NODE_H tall and NODE_W
// wide; the label hangs under it, outside the measured box.
const NODE_W = 144;
const NODE_H = 32;
const FIT_MAX_ZOOM = 1.1;
// [chrome6] VIEW6-05: the fit's cap on a pane of WIDE_FIT px and more,
// when it keeps a side list's room (SIDE_ROOM, the overlay's LIST_ROOM) free.
const FIT_MAX_ZOOM_WIDE = 1.3;
const WIDE_FIT = 1200;
const SIDE_ROOM = 412;
const FIT_MIN_ZOOM = 0.45;
// A large project fits every node, however far out (REV2-09).
const FIT_MIN_ZOOM_LARGE = 0.12;
const LARGE_NODES = 60;
const LARGE_EDGES = 120;
// Below this zoom a large project draws only the labels that matter: the
// hovered, picked, cited, and best-linked documents (the card has the title).
const LOD_ZOOM = 0.6;
// How many: one per 60,000 px² of canvas, 4 to 12 (a phone keeps 4 or 5).
const lodKeep = (w: number, h: number) => Math.max(4, Math.min(12, Math.round((w * h) / 60000)));
// Labels stay at least 11px on screen down to the least fit zoom (WALK2-06).
const LABEL_SCALE_MAX = 1 / FIT_MIN_ZOOM;
const LABEL_WIDTH_SCALE_MAX = 1.35;
const labelScale = (zoom: number) => Math.min(LABEL_SCALE_MAX, Math.max(1, 1 / zoom));
// Below this zoom the canvas is quiet (VIEW4-06): no notes chip on a node,
// and a curve's link count and notes pill only while it is lit; the replies
// mark always draws. The counts stay in the cards.
const FAR_ZOOM = 0.7;

/** A node's extent in flow units around its dot's center, label included,
    at a zoom: what the fit frames and what a pinned card keeps in view. */
function nodeExtent(cx: number, cy: number, zoom: number, lodZoom: number, loop: boolean) {
  const lod = zoom < lodZoom;
  const s = lod ? 1 : labelScale(zoom);
  const halfLabel = (NODE_W / 2) * Math.min(s, LABEL_WIDTH_SCALE_MAX);
  // A kept label at a far zoom is 11px on screen, two lines at most.
  const labelH = lod ? 34 / zoom : 40 * s;
  return { x0: cx - halfLabel, x1: cx + halfLabel, y0: cy - 20 - (loop ? LOOP_HEIGHT : 0), y1: cy + 20 + labelH };
}

// Which curve's list is open: the hovered curve, or the pinned one. A tiny
// store outside React state, so a hover renders only the one or two curves
// whose list opens or closes, never every curve (REV2-09).
type CanvasShown = { hover: HoverState; pinnedEdgeId: string | null };
type CanvasStore = {
  get: () => CanvasShown;
  set: (next: CanvasShown) => void;
  subscribe: (listener: () => void) => () => void;
};
function createCanvasStore(): CanvasStore {
  let state: CanvasShown = { hover: null, pinnedEdgeId: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      if (next.hover === state.hover && next.pinnedEdgeId === state.pinnedEdgeId) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
const NO_STORE = createCanvasStore();

// The canvas state the nodes and curves read, all of it slow to change: the
// cited documents, the floating layer, the free area, the drawing mode, and
// the handlers a curve's link list needs (it renders in the floating layer,
// off the curve, so its own hover has to keep the spotlight alive).
const SpotlightContext = createContext<{
  store: CanvasStore;
  citedIds: Set<string> | null;
  floatHost: HTMLElement | null;
  insets: GraphInsets;
  /** A large project: solid curves, no marching or breathing. */
  plain: boolean;
  /** The provenance links of generated documents are drawn (and listed). */
  showProvenance: boolean;
  /** The link open in the overlay's side panel. */
  expandedLinkId: string | null;
  hoverEdge: (edgeId: string) => void;
  pinEdge: (edgeId: string) => void;
  scheduleClear: () => void;
  expandLink: (link: GraphEdgeLink) => void;
}>({
  store: NO_STORE,
  citedIds: null,
  floatHost: null,
  insets: NO_INSETS,
  plain: false,
  showProvenance: false,
  expandedLinkId: null,
  hoverEdge: () => {},
  pinEdge: () => {},
  scheduleClear: () => {},
  expandLink: () => {},
});

/** True while this curve's list shows: hovered, or pinned. */
function useEdgeListOpen(edgeId: string): boolean {
  const { store } = useContext(SpotlightContext);
  return useSyncExternalStore(
    store.subscribe,
    () => {
      const s = store.get();
      return s.hover?.edgeId === edgeId || s.pinnedEdgeId === edgeId;
    },
    () => false,
  );
}

type DocumentNodeData = {
  title: string;
  hasVideo: boolean;
  generated: boolean;
  size: number;
  active: boolean;
  breathing: boolean;
  selected: boolean; // picked for Stitch (SPEC.md §22)
  keepLabel: boolean; // drawn at a far zoom too (lodKeep)
  written: boolean; // [chrome6] a page Stitch wrote in this visit (VIEW6-03)
};

type LinkEdgeData = {
  count: number;
  recommendedOnly: boolean;
  links: GraphEdgeLink[];
};

function DocumentNode({ id, data }: NodeProps<DocumentNodeData>) {
  const { citedIds, plain } = useContext(SpotlightContext);
  const cited = citedIds?.has(id) ?? false;
  const sectionDim = useNodeSectionDim(id); // [graph-notes]
  const { findHits, showProvenance } = useGraphContent(); // [view2]
  // [layer5] Find leaves a generated document dark while the provenance
  // switch is off, as its list and count do (VIEW5-09).
  const found = data.generated && !showProvenance ? 0 : (findHits?.get(id) ?? 0);
  // Cited documents (the last Stitch answer) stay bright while the rest
  // fade; so do the documents a section filter keeps [graph-notes], and the
  // documents Find finds [view2]. The hover spotlight is the canvas's CSS,
  // on the node's wrapper.
  const opacity = sectionDim || (citedIds && !cited) || (findHits && found === 0) ? 0.35 : 1;
  const size = data.size + (data.active ? 2 : 0);
  const breathing = data.breathing && !plain;
  const breatheDelay = `${(Math.abs(seeded(id, 5)) * 3).toFixed(2)}s`;
  const breatheDur = `${(3.2 + Math.abs(seeded(id, 9)) * 2).toFixed(2)}s`;
  const ring = data.selected
    ? "ring-[3px] ring-clay ring-offset-2 ring-offset-paper"
    : cited || data.written
      ? "ring-[3px] ring-[var(--kind-assistant)] ring-offset-2 ring-offset-paper"
      : "";
  return (
    <div className="graph-node-body relative flex h-8 w-36 justify-center" style={opacity < 1 ? { opacity } : undefined}>
      <Handle type="source" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" style={{ top: 16 }} />
      <Handle type="target" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" style={{ top: 16 }} />
      <span
        className={breathing ? "graph-breathe flex h-8 items-center justify-center" : "flex h-8 items-center justify-center"}
        style={breathing ? { animationDelay: breatheDelay, animationDuration: breatheDur } : undefined}
      >
        <span
          data-graph-dot
          className={`flex items-center justify-center border-2 border-card ${
            data.generated ? "rounded-[7px]" : "rounded-full"
          } ${
            data.active
              ? "bg-clay shadow-[0_0_20px_color-mix(in_srgb,var(--clay)_55%,transparent)]"
              : data.generated
                ? "bg-sand-600 shadow-[0_0_12px_color-mix(in_srgb,var(--sand-600)_35%,transparent)]"
                : "bg-sage-500 shadow-[0_0_12px_color-mix(in_srgb,var(--sage)_40%,transparent)]"
          } ${ring}`}
          style={{ width: size, height: size }}
        >
          {data.hasVideo && <FilmIcon size={Math.max(10, size - 14)} className={data.active ? "text-clay-fg" : "text-sage-fg"} />}
          {data.generated && !data.hasVideo && (
            <PageIcon size={Math.max(10, size - 14)} className={data.active ? "text-clay-fg" : "text-paper"} />
          )}
        </span>
      </span>
      {/* [cover4] The share of the document's parts noted (VIEW4-01). */}
      {!data.generated && <CoverageRing documentId={id} size={size} />}
      {/* The label hangs under the dot and grows when the view zooms out,
          so it stays readable on screen (--graph-label-scale, set on the
          canvas from the zoom). At a far zoom of a large project only a
          kept label draws (data-keep-label). */}
      <span
        data-graph-label
        data-keep-label={data.keepLabel || data.selected || cited || data.written || data.active ? "" : undefined}
        className={`graph-node-label absolute top-[36px] left-1/2 line-clamp-2 -translate-x-1/2 text-center leading-snug font-semibold ${
          data.active ? "text-clay-700" : "text-ink"
        }`}
      >
        {data.title}
      </span>
      {/* [graph-notes] The notes chip sits right of the dot, clear of the
          label under it. */}
      <span className="absolute top-1/2 -translate-y-1/2" style={{ left: `calc(50% + ${size / 2 + 4}px)` }}>
        <span className="flex items-center gap-1">
          <NodeNotes documentId={id} />
          {/* [layer5] The reader's open comments (VIEW5-01). */}
          {!data.generated && <NodeComments documentId={id} />}
        </span>
      </span>
      {/* [view2] Find's passages in this document: a clay count left of the dot. */}
      {found > 0 && (
        <span
          data-graph-find-count={found}
          className="absolute top-1/2 -translate-x-full -translate-y-1/2 rounded-full bg-clay px-1.5 py-px text-[10px] font-semibold tabular-nums text-clay-fg"
          style={{ left: `calc(50% - ${size / 2 + 4}px)` }}
        >
          {found}
        </span>
      )}
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
// beside the curve; a click on a link opens it in the side panel — why it was
// made, and the passage at each end, its replies, and Note on this link — and
// pins the curve so the list stays. A loop (source === target, SPEC.md §13)
// is the links inside one document: the curve leaves the node's top, rises,
// and returns to the same point, like a loop in graph theory; its pill and
// list sit at the loop's top. A large project draws the curve in one solid
// tone, without the gradient.
const LOOP_HEIGHT = 64; // the control points' rise above the node's center
const LOOP_HALF_WIDTH = 34;
/** A link curve's control point: the bow runs along the chord's normal, so
    side-by-side pairs bow too. */
function linkControl(id: string, s: Point, e: Point): Point {
  const chord = Math.hypot(e.x - s.x, e.y - s.y) || 1;
  const bowSize = seeded(id, 3) * 40 + chord * 0.12;
  return { x: (s.x + e.x) / 2 - ((e.y - s.y) / chord) * bowSize, y: (s.y + e.y) / 2 + ((e.x - s.x) / chord) * bowSize };
}
function LinkEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data }: EdgeProps<LinkEdgeData>) {
  const { plain, showProvenance, hoverEdge, scheduleClear, pinEdge } = useContext(SpotlightContext);
  const listOpen = useEdgeListOpen(id);
  const count = data?.count ?? 1;
  const recommendedOnly = data?.recommendedOnly ?? false;
  const allLinks = data?.links ?? [];
  const links = showProvenance ? allLinks : allLinks.filter((l) => !l.provenance);
  const loop = source === target;
  // The pill's and the list's anchor: the curve's middle, or the loop's top.
  const midX = loop ? sourceX : (sourceX + targetX) / 2;
  const midY = loop ? sourceY - LOOP_HEIGHT * 0.75 : (sourceY + targetY) / 2;
  const control = loop ? { x: midX, y: midY } : linkControl(id, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  const path = loop
    ? `M ${sourceX} ${sourceY} C ${sourceX - LOOP_HALF_WIDTH} ${sourceY - LOOP_HEIGHT}, ${sourceX + LOOP_HALF_WIDTH} ${sourceY - LOOP_HEIGHT}, ${sourceX} ${sourceY}`
    : `M ${sourceX} ${sourceY} Q ${control.x} ${control.y} ${targetX} ${targetY}`;
  // A quadratic curve passes its control point's direction at half the bow.
  const anchor = { x: (midX + control.x) / 2, y: (midY + control.y) / 2 };
  const depth = Math.min(1, Math.max(0, count - 1) / 7);
  const width = 1.6 + depth * 6.4;
  const gradient = !recommendedOnly && !plain;
  const gradientId = `edge-${id.replace(/[^a-zA-Z0-9]/g, "-")}`;
  // [view2] A pair holding a link the last Stitch answer proposed: a violet halo.
  const { proposedLinkIds } = useGraphContent();
  const proposed = proposedLinkIds.size > 0 && links.some((l) => proposedLinkIds.has(l.id));
  return (
    <g className="graph-curve" data-rec={recommendedOnly ? "" : undefined}>
      {proposed && (
        <path
          d={path}
          fill="none"
          data-graph-proposed={id}
          stroke="var(--kind-assistant)"
          strokeOpacity={0.35}
          strokeLinecap="round"
          style={{ strokeWidth: width + 9 }}
        />
      )}
      {gradient && (
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
        stroke={recommendedOnly ? "var(--sand-500)" : gradient ? `url(#${gradientId})` : edgeTone(depth * 0.8)}
        strokeLinecap="round"
        strokeDasharray={recommendedOnly ? "5 7" : undefined}
        className={recommendedOnly && !plain ? "graph-curve-stroke graph-dash-march" : "graph-curve-stroke"}
        style={{ "--w": `${width}px` } as CSSProperties}
      />
      {/* Wide invisible twin so the thin curve is hoverable (wider still
          under a finger, graph rules in globals.css). */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction graph-edge-hit" />
      {/* The exact link count, the open replies, and the notes quoting both
          [graph-notes], above the nodes and off them (VIEW3-01); they grow
          with the labels when the view zooms out. */}
      <CurveMarks
        pair={id}
        links={links}
        count={count}
        at={loop ? { x: midX, y: midY } : anchor}
        onEnter={() => hoverEdge(id)}
        onLeave={scheduleClear}
        onClick={() => pinEdge(id)}
      />
      {listOpen && links.length > 0 && (
        <EdgeLinkList edgeId={id} loop={loop} anchor={loop ? { x: midX, y: midY - 10 } : anchor} links={links} />
      )}
    </g>
  );
}

// A generated document's provenance (SPEC.md §22), drawn only while the
// reader asks for it: one thin grey dotted curve per source document, no
// pill, no list (the generated page lists its sources in the reader).
function ProvenanceEdge({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const t = useT();
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  return (
    <g className="graph-prov-curve">
      <title>{t("panes.graphProvenanceCurve")}</title>
      <path
        d={`M ${sourceX} ${sourceY} Q ${midX} ${midY - 24} ${targetX} ${targetY}`}
        fill="none"
        stroke="var(--sand-400)"
        strokeWidth={1.2}
        strokeDasharray="2 5"
        strokeLinecap="round"
      />
    </g>
  );
}

// [graph-notes] A pair that only notes join: the sage dotted curve.
function NoteEdgeHost(props: EdgeProps<NoteEdgeData>) {
  const listOpen = useEdgeListOpen(props.id);
  const { hoverEdge, scheduleClear, pinEdge } = useContext(SpotlightContext);
  return (
    <NoteEdge
      {...props}
      listOpen={listOpen}
      marks={{ onEnter: () => hoverEdge(props.id), onLeave: scheduleClear, onClick: () => pinEdge(props.id) }}
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
      data-curve-list={edgeId}
      className="graph-float-in pointer-events-auto absolute flex flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card/95 p-2 shadow-float backdrop-blur-md"
      style={style}
    >
      {children}
    </div>,
    floatHost,
  );
}

// A curve's link list: every link's description, the quote at each end with
// its document's name, and, for a recommended link, Accept and Dismiss. A
// click on a link opens it in the overlay's side panel (its detail, its
// replies, and Note on this link) and pins the curve; the notes quoting both
// documents follow the links [graph-notes].
function EdgeLinkList({ edgeId, loop, anchor, links }: { edgeId: string; loop: boolean; anchor: Point; links: GraphEdgeLink[] }) {
  const { expandLink, expandedLinkId } = useContext(SpotlightContext);
  const t = useT();
  const { proposedLinkIds } = useGraphContent(); // [view2]
  // A recommended link accepted or dismissed from the list (SPEC.md §13):
  // the row answers at once, before the server does, and comes back if the
  // server refuses; the refresh brings the graph's own data.
  const { canEdit } = useCollab();
  const router = useRouter();
  const { notebookId } = useParams<{ notebookId?: string }>();
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [decideError, setDecideError] = useState<string | null>(null);
  async function decide(link: GraphEdgeLink, accept: boolean) {
    const linkId = link.id;
    if (busyIds.has(linkId)) return;
    if (!accept && !confirmLinkRemoval(t, link.replies?.length ?? 0, "dismiss")) return;
    setBusyIds((prev) => new Set(prev).add(linkId));
    setDecideError(null);
    const mark = accept ? setAccepted : setDismissed;
    mark((prev) => new Set(prev).add(linkId));
    // The header counts it at once (WALK4-15).
    if (accept) markAccepted(linkId);
    try {
      if (accept) await api(linkPath(linkId, notebookId), "PATCH", { accept: true });
      else await api(linkPath(linkId, notebookId), "DELETE");
      router.refresh();
    } catch (err) {
      unmarkAccepted(linkId);
      mark((prev) => {
        const next = new Set(prev);
        next.delete(linkId);
        return next;
      });
      setDecideError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(linkId);
        return next;
      });
    }
  }
  const count = links.length;
  return (
    <CurveListFrame edgeId={edgeId} loop={loop} anchor={anchor} wide={false}>
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
      {(proposedLinkIds.size > 0
        ? [...links].sort((a, b) => Number(proposedLinkIds.has(b.id)) - Number(proposedLinkIds.has(a.id)))
        : links
      ).map((l) => {
        if (dismissed.has(l.id)) return null;
        const open = expandedLinkId === l.id;
        const recommended = l.recommended && !accepted.has(l.id);
        return (
          <div key={l.id} className={open ? "rounded-xl bg-sand-100/70" : undefined}>
            {/* [view2] The last Stitch answer's links come first, marked. */}
            {proposedLinkIds.has(l.id) && (
              <p data-graph-from-answer className="px-2 pt-1 text-[10.5px] font-semibold text-[var(--kind-assistant)]">
                {t("graphView.fromLastAnswer")}
              </p>
            )}
            <button
              onClick={() => expandLink(l) /* [lists7] WALK7-05: the list closes */}
              data-track="graph-link-expand"
              data-tip={t("panes.linkExpand")}
              aria-expanded={open}
              className="flex w-full flex-col items-start gap-0.5 rounded-xl px-2 py-1.5 text-left hover:bg-clay-100"
            >
              <span className="text-[12.5px] leading-snug font-semibold text-ink">
                {l.reason ?? clipWords(l.quotedText, 60)}
              </span>
              {/* Each quote names its document, so a pair linked both ways
                  reads plainly; a loop's quotes are all one document's. */}
              {l.reason && <QuoteLine title={loop ? null : l.fromTitle} quote={l.quotedText} tone="text-sand-600" />}
              {l.toQuotedText && <QuoteLine title={loop ? null : l.toTitle} quote={l.toQuotedText} tone="text-sand-500" />}
              {l.provenance && (
                <span className="rounded-full bg-sand-200/80 px-1.5 text-[10px] font-semibold text-sand-700">
                  {t("panes.graphProvenanceTag")}
                </span>
              )}
              <LinkReplyCount link={l} />
            </button>
            {recommended && (
              <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5">
                <span className="rounded-full border border-dashed border-clay-300 px-2 text-[10.5px] font-semibold text-clay-700">
                  {t("panes.graphLinkRecommended")}
                </span>
                {canEdit && !l.crossAccount?.outside && (
                  <span className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => void decide(l, true)}
                      data-track="link-accept"
                      disabled={busyIds.has(l.id)}
                      data-tip={t("panes.acceptLinkTitle")}
                      className="rounded-full bg-sage-600 px-2.5 py-0.5 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
                    >
                      {t("panes.acceptLink")}
                    </button>
                    {linkRemovable(l.crossAccount) && (
                      <button
                        onClick={() => void decide(l, false)}
                        data-track="link-dismiss"
                        disabled={busyIds.has(l.id)}
                        data-tip={t("panes.dismissLinkTitle")}
                        className="rounded-full border border-line px-2 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                      >
                        {t("panes.dismissLink")}
                      </button>
                    )}
                  </span>
                )}
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
// Props reactflow compares by identity: one object each, so a canvas render
// for a hover never re-renders reactflow's node and edge layers.
const ZOOM_KEYS = ["Meta", "Control"];
const PRO_OPTIONS = { hideAttribution: true };
const edgeTypes = { link: LinkEdge, note: NoteEdgeHost, provenance: ProvenanceEdge };

// A node's one card (GR-14, VIEW2-01): the full title, what the document is,
// its length, its links, and its notes [graph-notes], beside the hovered or
// focused node. It says what a click does, since a click leaves the graph for
// the reader. The pointer can move onto the card (to a note) and keep it.
function NodeCard({
  node,
  counts,
  picking,
  onEnter,
  onLeave,
}: {
  node: GraphNode | null;
  counts: { accepted: number; recommended: number } | undefined;
  picking: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { floatHost, insets } = useContext(SpotlightContext);
  const t = useT();
  const { clickSelects, generatedCommands } = useGraphContent(); // [view2]
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
  const paneH = useStore((s) => s.height);
  if (!floatHost || !shown || !node || !position) return null;
  const accepted = counts?.accepted ?? 0;
  const recommended = counts?.recommended ?? 0;
  const width = Math.min(280, paneW - 16);
  // Clear of the node's label, which hangs under the dot as wide as its room.
  const gap = Math.max(22 * Math.max(zoom, 0.6), (NODE_W / 2) * zoom * Math.min(labelScale(zoom), LABEL_WIDTH_SCALE_MAX) + 8);
  const right = screen.x + gap + width <= paneW - insets.right - 8;
  const left = right ? screen.x + gap : Math.max(8, screen.x - gap - width);
  const top = Math.max(insets.top + 8, screen.y - 18);
  const kind = node.kind ? categoryLabels(t).kind(node.kind) : null;
  const facts1 = [
    kind,
    node.blockCount !== undefined
      ? t("panes.graphCardBlocks", { n: node.blockCount, s: node.blockCount === 1 ? "" : "s" })
      : null,
  ].filter(Boolean);

  return createPortal(
    <div
      role="tooltip"
      data-graph-node-card={node.id}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="graph-float-in pointer-events-auto absolute flex flex-col gap-1 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card/95 px-3.5 py-2.5 shadow-float backdrop-blur-md"
      style={{ left, top, width, maxHeight: Math.max(120, paneH - insets.bottom - top - 8) }}
    >
      <p className="text-[13px] leading-snug font-semibold text-ink">{node.title}</p>
      {facts1.length > 0 && <p className="text-[11.5px] text-sand-600">{facts1.join(" · ")}</p>}
      {/* A generated document: the command that wrote it (WALK3-09). */}
      {node.kind === "generated" && generatedCommands.get(node.id) && (
        <p className="line-clamp-2 text-[11.5px] text-sand-600">
          {t("stitch.generatedFrom", { command: generatedCommands.get(node.id) ?? "" })}
        </p>
      )}
      <p className="text-[11.5px] text-sand-600">{linkLine(t, accepted, recommended)}</p>
      {/* [view2] The gist's first words; the notes as rows: one card per node (VIEW2-01). */}
      <NodeCardExtras documentId={node.id} notes={false} />
      <p className="mt-0.5 text-[11px] text-sand-500">
        {t(picking ? "panes.graphCardPick" : clickSelects ? "graphView.cardHintSelect" : "graphView.cardHintOpen")}
      </p>
      {!picking && <NodeNotesRows documentId={node.id} />}
    </div>,
    floatHost,
  );
}

// The key (GR-12): what each mark means and the gestures, behind the ?
// button with the zoom controls, so it never sits under the Stitch box.
/** [chrome6] VIEW6-10, WALK6-10: the key in three groups (documents,
    links, notes and comments), two columns where the canvas has the room,
    and only the marks the canvas draws now: generated documents, their
    provenance, and the cited ring show when they are on the canvas. */
function GraphKey({
  onClose,
  generated,
  provenance,
  cited,
}: {
  onClose: () => void;
  generated: boolean;
  provenance: boolean;
  cited: boolean;
}) {
  const t = useT();
  const { clickSelects } = useGraphContent(); // [view2]
  const row = (mark: ReactNode, key: Parameters<typeof t>[0]) => (
    <li className="flex items-center gap-2">
      <span className="flex w-7 shrink-0 items-center justify-center">{mark}</span>
      <span className="leading-snug">{t(key)}</span>
    </li>
  );
  const group = (title: string, rows: ReactNode) => (
    <div className="mb-2.5 break-inside-avoid">
      <p className="mb-1 text-[10.5px] font-bold tracking-[0.06em] text-sand-500 uppercase">{title}</p>
      <ul className="flex flex-col gap-1">{rows}</ul>
    </div>
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
      data-graph-key
      className="graph-float-in pointer-events-auto absolute top-3 left-14 z-30 max-h-[calc(100%-24px)] w-[540px] max-w-[calc(100%-72px)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card/95 p-3.5 text-[12px] text-sand-700 shadow-float backdrop-blur-md"
    >
      <div className="mb-2 flex items-center">
        <p className="flex-1 text-[11px] font-bold tracking-[0.06em] text-sand-600 uppercase">{t("panes.graphKeyTitle")}</p>
        <button onClick={onClose} aria-label={t("common.close")} className="flex size-6 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100">
          ✕
        </button>
      </div>
      <div className="gap-5 min-[560px]:columns-2">
        {group(
          t("panes.graphDocuments"),
          <>
            {row(dot("rounded-full bg-clay"), "panes.graphKeyOpen")}
            {row(dot("rounded-full bg-sage-500"), "panes.graphKeyDocument")}
            {generated && row(dot("rounded-[4px] bg-sand-600 opacity-50"), "panes.graphKeyGenerated")}
            {cited && row(dot("rounded-full bg-sage-500 ring-2 ring-[var(--kind-assistant)] ring-offset-1 ring-offset-card"), "panes.graphKeyCited")}
          </>,
        )}
        {group(
          t("panes.graphLinks"),
          <>
            {row(line(false, 3), "panes.graphKeyLinks")}
            {row(line(true, 2), "panes.graphKeyRecommended")}
            {row(
              <svg width="24" height="20" aria-hidden>
                <circle cx="12" cy="17" r="3" fill="var(--sage-500)" />
                <path d="M12 15 C2 -3, 22 -3, 12 15" fill="none" stroke="var(--clay-600)" strokeWidth={2} />
              </svg>,
              "panes.graphKeyLoop",
            )}
            {/* The marks on a curve (WALK4-13): the link count, the open
                replies, the notes that quote both documents. */}
            {row(
              <span className="flex h-[18px] items-center rounded-full border border-line bg-card px-1.5 text-[10px] font-semibold tabular-nums text-sand-700">3</span>,
              "graphNotes.keyCurveCount",
            )}
            {row(
              <span className="flex h-[18px] items-center gap-1 rounded-full border-[1.5px] border-[var(--kind-comment)] bg-card px-1.5 text-[10px] font-bold tabular-nums text-[var(--kind-comment)]">
                <CommentIcon size={11} />2
              </span>,
              "graphNotes.keyCurveReplies",
            )}
            {provenance &&
              row(
                <svg width="28" height="10" aria-hidden>
                  <path d="M2 5 Q14 1 26 5" fill="none" stroke="var(--sand-400)" strokeWidth={1.2} strokeDasharray="2 5" strokeLinecap="round" />
                </svg>,
                "panes.graphKeyProvenance",
              )}
          </>,
        )}
        {group(
          t("graphNotes.keyNotesGroup"),
          <>
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
            {row(
              <span className="flex items-center gap-1 rounded-full bg-sage-100 px-1.5 py-px text-[10px] font-semibold tabular-nums text-sage-800">
                <NotesIcon size={10} />2<span className="size-1.5 rounded-full bg-clay" />
              </span>,
              "graphNotes.keyPending",
            )}
            {row(
              <span className="flex h-[18px] items-center gap-1 rounded-full border border-dashed border-sage-500 bg-sage-100 px-1.5 text-[10px] font-semibold tabular-nums text-sage-800">
                <NotesIcon size={11} />2
              </span>,
              "graphNotes.keyCurveNotes",
            )}
            {/* [layer5] The node's comments chip (VIEW5-01 (c)). */}
            {row(
              <span className="flex items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--kind-comment)_12%,var(--card))] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--kind-comment)]">
                <CommentIcon size={10} />2<span aria-hidden>?</span>
              </span>,
              "graphCover.keyComments",
            )}
          </>,
        )}
      </div>
      <p className="border-t border-line pt-2 text-[11.5px] leading-relaxed text-sand-600">
        {t(clickSelects ? "graphView.gesturesSelect" : "graphView.gesturesOpen") /* [view2] */}
        <span className="mt-1 block">{t("graphNotes.keyFar")}</span>
      </p>
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

// Layouts made this tab, by project, shape, and the project's documents and pairs.
const layoutCache = new Map<string, Map<string, Point>>();

// The last layout per project and shape, per browser (WALK2-03): the next
// one keeps every node of it in place and places only new documents. A view
// convenience: lost storage lays the project out fresh.
const LAYOUT_KEY = (notebookId: string, aspect: number) => `unitos-graph-layout:${notebookId}:${aspect}`;
function loadLayout(notebookId: string, aspect: number): Map<string, Point> | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY(notebookId, aspect));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const out = new Map<string, Point>();
    for (const [id, p] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") out.set(id, { x: p[0], y: p[1] });
    }
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}
function saveLayout(notebookId: string, aspect: number, layout: Map<string, Point>) {
  try {
    const flat = Object.fromEntries([...layout].map(([id, p]) => [id, [p.x, p.y]]));
    window.localStorage.setItem(LAYOUT_KEY(notebookId, aspect), JSON.stringify(flat));
  } catch {
    /* storage off: the next change lays the project out fresh */
  }
}

// The zoom drives the label scale and the label level of detail through CSS
// variables and an attribute on the canvas, so a zoom re-renders no node.
function LabelScale({ target, lodZoom }: { target: RefObject<HTMLDivElement | null>; lodZoom: number }) {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const lod = zoom < lodZoom;
    // At a far zoom a large project draws few labels: those keep 11px on
    // screen and their full width, however far out.
    const s = lod ? Math.max(1, 1 / zoom) : labelScale(zoom);
    el.style.setProperty("--graph-label-scale", s.toFixed(3));
    el.style.setProperty("--graph-label-width-scale", (lod ? s * 0.85 : Math.min(s, LABEL_WIDTH_SCALE_MAX)).toFixed(3));
    el.style.setProperty("--graph-zoom", zoom.toFixed(3));
    if (lod) el.setAttribute("data-lod", "");
    else el.removeAttribute("data-lod");
    if (zoom < FAR_ZOOM) el.setAttribute("data-far", "");
    else el.removeAttribute("data-far");
  }, [zoom, target, lodZoom]);
  return null;
}

/** Labels stay inside the canvas (VIEW4-05): a label that would run past
    the canvas's left or right edge slides in, off its dot's center. Its
    text is measured once per label scale and title; a pan moves numbers. */
function LabelEdges({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const [tx, , zoom] = useStore((s) => s.transform);
  const paneW = useStore((s) => s.width);
  const nodeInternals = useStore((s) => s.nodeInternals);
  const measured = useRef(new Map<string, { key: string; w: number }>());
  useEffect(() => {
    const el = target.current;
    if (!el || paneW <= 0) return;
    const frame = requestAnimationFrame(() => {
      const scale = el.style.getPropertyValue("--graph-label-scale");
      for (const [id, n] of nodeInternals) {
        const label = el.querySelector<HTMLElement>(`.react-flow__node[data-id=${JSON.stringify(id)}] [data-graph-label]`);
        if (!label) continue;
        const key = `${scale}|${label.textContent ?? ""}`;
        let m = measured.current.get(id);
        if (!m || m.key !== key) {
          const range = document.createRange();
          range.selectNodeContents(label);
          m = { key, w: range.getBoundingClientRect().width / zoom };
          // A hidden label (a far zoom's) is measured when it shows.
          if (m.w > 0) measured.current.set(id, m);
        }
        const x = n.positionAbsolute?.x ?? n.position.x;
        const center = (x + NODE_W / 2) * zoom + tx;
        const half = (m.w * zoom) / 2;
        const pad = 6;
        const shift = m.w === 0 ? 0 : center - half < pad ? pad - (center - half) : center + half > paneW - pad ? paneW - pad - (center + half) : 0;
        const next = Math.abs(shift) < 0.5 ? "" : `calc(-50% + ${(shift / zoom).toFixed(1)}px) 0`;
        if (label.style.translate !== next) label.style.translate = next;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [target, tx, zoom, paneW, nodeInternals]);
  return null;
}

/** The spotlight (REV2-09): the canvas carries data-spot while anything is
    lit, and each lit node and curve carries data-lit; globals.css dims the
    rest. A hover sets a few attributes, and nothing renders. */
function useSpotlightAttributes(
  root: RefObject<HTMLDivElement | null>,
  nodeIds: Set<string> | null,
  edgeIds: Set<string> | null,
) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (nodeIds) el.setAttribute("data-spot", "");
    else el.removeAttribute("data-spot");
    const lit = new Set<Element>();
    // A spotlight set as the graph opens (Show on graph) comes before the
    // nodes are drawn: look again on the next frames until each is there.
    let raf = 0;
    let frames = 180;
    const apply = () => {
      let missing = false;
      for (const id of nodeIds ?? []) {
        const node = el.querySelector(`.react-flow__node[data-id=${JSON.stringify(id)}]`);
        if (node) lit.add(node);
        else missing = true;
      }
      for (const id of edgeIds ?? []) {
        const edge = el.querySelector(`.react-flow__edge[data-testid=${JSON.stringify(`rf__edge-${id}`)}]`);
        if (edge) lit.add(edge);
        const marks = el.querySelector(`[data-curve-marks=${JSON.stringify(id)}]`);
        if (marks) lit.add(marks);
      }
      for (const e of lit) e.setAttribute("data-lit", "");
      if (missing && frames-- > 0) raf = requestAnimationFrame(apply);
    };
    apply();
    return () => {
      cancelAnimationFrame(raf);
      for (const e of lit) e.removeAttribute("data-lit");
    };
  }, [root, nodeIds, edgeIds]);
}

// The nearest document in an arrow's direction, from a node's center: ahead
// of it, scored by distance with the sideways part counted twice.
function nearestInDirection(from: Point, others: { id: string; p: Point }[], key: string): string | null {
  const dir = key === "ArrowRight" ? [1, 0] : key === "ArrowLeft" ? [-1, 0] : key === "ArrowDown" ? [0, 1] : [0, -1];
  let best: { id: string; score: number } | null = null;
  for (const o of others) {
    const dx = o.p.x - from.x;
    const dy = o.p.y - from.y;
    const ahead = dx * dir[0] + dy * dir[1];
    if (ahead <= 1) continue;
    const side = Math.abs(dx * dir[1] - dy * dir[0]);
    const score = ahead + side * 2;
    if (!best || score < best.score) best = { id: o.id, score };
  }
  return best?.id ?? null;
}

function MinusGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="graph-stroke-icon" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  );
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
  expandedLinkId = null,
  onExpandLink,
  writtenIds = NO_IDS,
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
  const keysHelpId = useId();
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
  // A finger on the canvas: a tap opens no hover card, which would stay up
  // over the next node (WALK3-11); the tap pins the card or picks.
  const touchInput = useRef(false);
  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent) => {
      touchInput.current = e.pointerType === "touch";
      if (touchInput.current) setHover((prev) => (prev?.nodeId ? null : prev));
    },
    [],
  );
  // A view the canvas moves itself (a refit, or a pan that keeps a pinned
  // card's node in view) slides nodes and curves under a pointer that did
  // not move: no hover card opens until the pointer moves (WALK4-01).
  const lastPointer = useRef<Point | null>(null);
  const frozenAt = useRef<Point | null>(null);
  const freezeHover = useCallback(() => {
    if (lastPointer.current) frozenAt.current = lastPointer.current;
  }, []);
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
      setHover((prev) => (prev?.edgeId === edgeId ? prev : { edgeId }));
    },
    [cancelClear],
  );
  const hoverNode = useCallback(
    (nodeId: string) => {
      cancelClear();
      setHover((prev) => (prev?.nodeId === nodeId ? prev : { nodeId }));
    },
    [cancelClear],
  );
  useEffect(() => cancelClear, [cancelClear]);
  const pointerHoverEdge = useCallback(
    (edgeId: string) => {
      if (!frozenAt.current) hoverEdge(edgeId);
    },
    [hoverEdge],
  );
  // A link opens in the overlay's side panel at full height (WALK2-05); with
  // no panel, the reader at the link. [lists7] WALK7-05: the curve's list
  // closes as the panel opens (the curve stays lit as the open link's), so
  // the link never shows twice.
  const expandLink = useCallback(
    (link: GraphEdgeLink) => {
      if (onExpandLink) {
        setPinnedEdgeId(null);
        setHover(null);
        onExpandLink(link.id);
        return;
      }
      router.push(`/n/${notebookId}?doc=${link.fromDocumentId}&link=${link.id}`);
      onOpenDocument();
    },
    [onExpandLink, router, notebookId, onOpenDocument],
  );
  useSyncPinnedPair(pinnedEdgeId); // [graph-notes]
  const notesLit = useNotesLit(); // [graph-notes]
  const content = useGraphContent(); // [view2]
  const focusedId = content.focusedId;
  // Generated documents' provenance links: drawn on request (WALK2-02), the
  // switch kept with the view (WALK3-13).
  const { showProvenance, setShowProvenance, generatedCommands } = content;
  useWantProvenance(showProvenance, "switch"); // COST3-03: their links load when the switch turns on
  // [lists7] WALK7-05: a click on a curve that holds one link opens that
  // link's panel; a curve with more links pins its list.
  const oneLink = useCallback(
    (edgeId: string): GraphEdgeLink | null => {
      if (!onExpandLink) return null;
      const links = edges.find((e) => `${e.a}|${e.b}` === edgeId)?.links.filter((l) => showProvenance || !l.provenance) ?? [];
      return links.length === 1 ? links[0] : null;
    },
    [edges, showProvenance, onExpandLink],
  );
  const pinEdge = useCallback(
    (edgeId: string) => {
      const link = oneLink(edgeId);
      if (link) expandLink(link);
      else setPinnedEdgeId(edgeId);
    },
    [oneLink, expandLink],
  );
  // The curve of the link open in the side panel, however it opened (Show
  // on graph, the Links list, a card's row): its two documents and the
  // curve stay lit while the panel is open (WALK4-04).
  const expandedEdgeId = useMemo(() => {
    if (!expandedLinkId) return null;
    const e = edges.find((x) => x.links.some((l) => l.id === expandedLinkId));
    return e ? `${e.a}|${e.b}` : null;
  }, [edges, expandedLinkId]);
  // Nothing hovered: a pinned curve keeps its pair in the spotlight, then
  // the open link's curve, then the node whose card is pinned [view2].
  const shown = useMemo<HoverState>(
    () =>
      hover ??
      (pinnedEdgeId
        ? { edgeId: pinnedEdgeId }
        : expandedEdgeId
          ? { edgeId: expandedEdgeId }
          : focusedId
            ? { nodeId: focusedId }
            : null),
    [hover, pinnedEdgeId, expandedEdgeId, focusedId],
  );
  // The curves read which list is open from the store, never from a render.
  const [store] = useState(createCanvasStore);
  useLayoutEffect(() => {
    store.set({ hover, pinnedEdgeId });
  }, [store, hover, pinnedEdgeId]);

  const generatedIds = useMemo(() => new Set(nodes.filter((n) => n.kind === "generated").map((n) => n.id)), [nodes]);
  // The curves drawn: every pair with a reader link; a pair only provenance
  // joins only while the reader asks for it.
  const visibleEdges = useMemo(
    () => edges.filter((e) => e.accepted + e.recommended > 0 || (showProvenance && (e.provenance ?? 0) > 0)),
    [edges, showProvenance],
  );
  const large = nodes.length > LARGE_NODES || visibleEdges.length > LARGE_EDGES;
  // [chrome6] WALK6-07: a phone frames every node, as a large project does:
  // below the fit's least zoom it draws only the labels that matter (the
  // kept ones, and a lit one), each 11px on screen. Nothing sits off screen.
  const phoneFit = paneW > 0 && paneW < 640;
  const lodZoom = large ? LOD_ZOOM : phoneFit ? FIT_MIN_ZOOM : 0;
  const minFitZoom = large || phoneFit ? FIT_MIN_ZOOM_LARGE : FIT_MIN_ZOOM;

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
    for (const e of visibleEdges) {
      if (!adjacency.has(e.a)) adjacency.set(e.a, new Set());
      if (!adjacency.has(e.b)) adjacency.set(e.b, new Set());
      count(e.a, e);
      const waiting = e.accepted === 0 && e.recommended > 0;
      if (waiting) breathing.add(e.a);
      // A loop (a === b) is no neighbor of its own node: it counts once
      // toward the node's links and never moves it in the layout.
      if (e.a === e.b) {
        loops.add(e.a);
        continue;
      }
      adjacency.get(e.a)!.add(e.b);
      adjacency.get(e.b)!.add(e.a);
      count(e.b, e);
      if (waiting) breathing.add(e.b);
    }
    return { adjacency, breathing, linkCounts, loops };
  }, [visibleEdges]);
  // At a far zoom of a large project, the best-linked documents keep their labels (lodKeep).
  // [layer5] The documents holding the reader's own words (notes, open
  // comments) first, the most words first; then the best-linked (VIEW5-07).
  const wordsNotes = useGraphNotes()?.view.byDocument;
  const wordsCoverage = useProjectCoverage();
  const keptLabels = useMemo(() => {
    if (lodZoom === 0) return new Set<string>();
    const degree = (id: string) => (linkCounts.get(id)?.accepted ?? 0) + (linkCounts.get(id)?.recommended ?? 0);
    const words = (id: string) =>
      (wordsNotes?.get(id)?.notes.length ?? 0) + (wordsCoverage?.documents[id]?.comments ?? []).filter((c) => c.open).length;
    const keep = lodKeep(paneW, paneH);
    return new Set(
      [...nodes]
        .sort((x, y) => words(y.id) - words(x.id) || degree(y.id) - degree(x.id) || x.id.localeCompare(y.id))
        .slice(0, keep)
        .map((n) => n.id),
    );
  }, [lodZoom, nodes, linkCounts, paneW, paneH, wordsNotes, wordsCoverage]);

  // The layout reads only which documents exist, which are generated, and
  // which pairs link (the reader's links), so a refresh that changes a title
  // or a count keeps every node in place.
  const layoutKey = useMemo(
    () =>
      JSON.stringify([
        nodes.map((n) => n.id),
        edges.filter((e) => e.accepted + e.recommended > 0).map((e) => [e.a, e.b, e.accepted + e.recommended]),
        [...generatedIds],
      ]),
    [nodes, edges, generatedIds],
  );
  // Shaped for the pane: wide on a laptop, tall on a phone. The height
  // leaves the Stitch box's usual room (it opens at 640px and wider), never
  // its live height, so a growing answer never moves a node.
  // Nothing is laid out before the pane has a size; a layout already made
  // for this project and shape is reused (an open, a refresh, a reopen), and
  // a project that changed keeps its old nodes where they were (WALK2-03).
  const aspect = paneW > 0 ? layoutAspect(paneW, paneH - (paneW >= 640 ? 230 : 60)) : 0;
  const layout = useMemo(() => {
    if (aspect === 0) return new Map<string, Point>();
    const key = `${notebookId}|${aspect}|${layoutKey}`;
    const cached = layoutCache.get(key);
    if (cached) return cached;
    const [ids, pairs, apartIds] = JSON.parse(layoutKey) as [string[], [string, string, number][], string[]];
    const layoutEdges = pairs.map(([a, b, weight]) => ({ a, b, weight }));
    const apart = new Set(apartIds);
    const prev = loadLayout(notebookId, aspect);
    const made = (prev && extendLayout(prev, ids, layoutEdges, apart)) ?? graphLayout(ids, layoutEdges, aspect, apart);
    saveLayout(notebookId, aspect, made);
    if (layoutCache.size > 12) layoutCache.clear();
    layoutCache.set(key, made);
    return made;
  }, [layoutKey, aspect, notebookId]);

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
  // A large project fits every node (its far labels are few).
  // [ui5] WALK5-11, [chrome6] VIEW6-03: at every width, with the provenance
  // switch off, generated documents are not drawn: the reader's documents
  // get the canvas. Generated content lists them, and the switch draws them.
  // A page Stitch wrote in this visit (writtenIds) stays drawn, lit, until
  // the graph closes.
  const foldedIds = useMemo(
    () => (writtenIds.size === 0 ? generatedIds : new Set([...generatedIds].filter((id) => !writtenIds.has(id)))),
    [generatedIds, writtenIds],
  );
  const foldGenerated = paneW > 0 && !showProvenance && foldedIds.size > 0 && generatedIds.size < nodes.length;
  const foldRef = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    foldRef.current = foldGenerated ? foldedIds : null;
  }, [foldGenerated, foldedIds]);
  // [/ui5]
  const insetsRef = useRef(insets);
  const loopsRef = useRef(loops);
  const layoutKeyRef = useRef(layoutKey);
  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    insetsRef.current = insets;
    loopsRef.current = loops;
    layoutKeyRef.current = layoutKey;
    nodesRef.current = nodes;
  }, [insets, loops, layoutKey, nodes]);
  // What the last fit framed: the refit below runs when the free area or the
  // documents changed since, whenever that fit ran (WALK2-15).
  const lastFit = useRef<{ key: string; w: number; h: number; ins: GraphInsets; focus: boolean } | null>(null);
  // A pinned card or an open link panel: the view the reader clicked in stays.
  const focusOn = Boolean(focusedId || expandedEdgeId);
  const focusOnRef = useRef(focusOn);
  useLayoutEffect(() => {
    focusOnRef.current = focusOn;
  }, [focusOn]);
  const fitTo = useCallback(
    (all: { id: string; x: number; y: number }[], duration = 0) => {
      // [ui5] WALK5-11: folded generated documents are not framed.
      const fold = foldRef.current;
      const kept = fold ? all.filter((p) => !fold.has(p.id)) : all;
      const positions = kept.length > 0 ? kept : all;
      // [/ui5]
      if (positions.length === 0 || paneW <= 0 || paneH <= 0) return;
      const ins = insetsRef.current;
      lastFit.current = { key: layoutKeyRef.current, w: paneW, h: paneH, ins, focus: focusOnRef.current };
      const pad = 28;
      let freeT = ins.top + pad;
      let freeB = paneH - ins.bottom - pad * 0.6;
      // A free area too short to hold anything: use the whole pane.
      if (freeB - freeT < 140) {
        freeT = pad;
        freeB = paneH - pad;
      }
      const ah = freeB - freeT;
      const minZoom = minFitZoom;
      const frame = (right: number, cap: number) => {
        const freeL = ins.left + pad;
        const aw = Math.max(80, paneW - right - pad - freeL);
        let zoom = 1;
        let bounds = { x0: 0, x1: 0, y0: 0, y1: 0 };
        for (let pass = 0; pass < 3; pass++) {
          bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
          for (const p of positions) {
            const b = nodeExtent(p.x + NODE_W / 2, p.y + NODE_H / 2, zoom, lodZoom, loopsRef.current.has(p.id));
            bounds.x0 = Math.min(bounds.x0, b.x0);
            bounds.x1 = Math.max(bounds.x1, b.x1);
            bounds.y0 = Math.min(bounds.y0, b.y0);
            bounds.y1 = Math.max(bounds.y1, b.y1);
          }
          const bw = bounds.x1 - bounds.x0;
          const bh = bounds.y1 - bounds.y0;
          zoom = Math.min(cap, Math.max(minZoom, Math.min(aw / bw, ah / bh)));
        }
        return { zoom, bounds, freeL, aw };
      };
      // [chrome6] VIEW6-05: on a wide pane, when the documents frame as
      // large left of a side list's room as in the whole width, the fit
      // keeps that room free and zooms up to FIT_MAX_ZOOM_WIDE: a list or a
      // card opening there covers no node and moves none, so the node under
      // the pointer stays between the first click and the second.
      let f = frame(ins.right, FIT_MAX_ZOOM);
      if (paneW >= WIDE_FIT && ins.right <= SIDE_ROOM) {
        const free = ins.right > 0 ? frame(0, FIT_MAX_ZOOM) : f;
        const kept = frame(SIDE_ROOM, FIT_MAX_ZOOM_WIDE);
        if (kept.zoom >= free.zoom - 0.001) f = kept;
      }
      const { zoom, bounds, freeL, aw } = f;
      const bw = (bounds.x1 - bounds.x0) * zoom;
      const bh = (bounds.y1 - bounds.y0) * zoom;
      const x = freeL + (aw - bw) / 2 - bounds.x0 * zoom;
      const y = bh <= ah ? freeT + (ah - bh) / 2 - bounds.y0 * zoom : freeT - bounds.y0 * zoom;
      if (duration) freezeHover();
      try {
        flowRef.current.setViewport({ x, y, zoom }, duration ? { duration } : undefined);
      } catch {
        /* non-critical */
      }
    },
    [paneW, paneH, minFitZoom, lodZoom, freezeHover],
  );
  // The fit frames where the nodes are going, not where a settle has them now.
  const fitNow = useCallback(
    (duration = 0) => fitTo(nodesRef.current.map((n) => ({ id: n.id, ...target(n.id) })), duration),
    [fitTo, target],
  );

  // Generated documents that share a title (five "Stitched page"s): each
  // label takes its command's first words (WALK3-09). Titles that share a
  // long start keep a head of it and the words that differ (VIEW4-05).
  const labelOf = useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of nodes) if (n.kind === "generated") seen.set(n.title, (seen.get(n.title) ?? 0) + 1);
    const out = new Map<string, string>();
    for (const [i, label] of labelStarts(nodes.map((n) => n.title))) out.set(nodes[i].id, label);
    for (const n of nodes) {
      // [cover4] A follow-up's page takes its own command (WALK4-14).
      const stored = generatedCommands.get(n.id);
      const command = stored ? ownCommand(stored) : null;
      if (n.kind === "generated" && (seen.get(n.title) ?? 0) > 1 && command) {
        const head = clipWords(command, 28);
        out.set(n.id, `${n.title} · ${head}${head.length < command.trim().length ? "…" : ""}`);
      }
    }
    return out;
  }, [nodes, generatedCommands]);

  useEffect(() => {
    const mk = (n: GraphNode, position: Point): FlowNode<DocumentNodeData> => {
      const c = linkCounts.get(n.id);
      const degree = (c?.accepted ?? 0) + (c?.recommended ?? 0);
      const generated = n.kind === "generated";
      // The node's name says its links as the cards do: accepted links,
      // then the recommended ones (WALK3-08); a generated document says so.
      const accepted = c?.accepted ?? 0;
      const recommended = c?.recommended ?? 0;
      const named = recommended > 0
        ? t("panes.graphNodeLabelRec", { title: n.title, n: accepted, s: accepted === 1 ? "" : "s", m: recommended })
        : t("panes.graphNodeLabel", { title: n.title, n: accepted, s: accepted === 1 ? "" : "s" });
      return {
        id: n.id,
        type: "document",
        position,
        // A generated document draws faded until the reader asks for the
        // provenance (WALK2-02).
        className: generated ? (writtenIds.has(n.id) ? "graph-generated graph-written" : "graph-generated") : undefined,
        hidden: generated && foldGenerated && foldedIds.has(n.id), // [ui5] WALK5-11, [chrome6] VIEW6-03
        ariaLabel: generated ? t("graphView.generatedNodeLabel", { label: named }) : named,
        data: {
          title: labelOf.get(n.id) ?? n.title,
          hasVideo: n.hasVideo,
          generated,
          // A longer document draws a bigger dot (√ of its blocks); without
          // a length, the dot grows with the links instead.
          size:
            n.blockCount !== undefined
              ? Math.round(Math.min(34, Math.max(14, 12 + Math.sqrt(n.blockCount) * 1.6)))
              : Math.min(32, 16 + degree * 2.5),
          active: n.id === activeDocumentId,
          breathing: breathing.has(n.id),
          selected: selectedIds?.has(n.id) ?? false,
          keepLabel: keptLabels.has(n.id),
          written: writtenIds.has(n.id), // [chrome6]
        },
      };
    };
    if (phaseRef.current === "scatter") {
      // Wait for the pane's size: the first frame is framed for the settled
      // layout, so the nodes glide into a view that already fits them.
      if (paneW <= 0 || paneH <= 0) return;
      const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      fitTo(nodes.map((n) => ({ id: n.id, ...target(n.id) })));
      // A large project lands in place at once: the settle would move every
      // node through hundreds of frames (REV2-09).
      if (reduce || large) {
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
  }, [nodes, linkCounts, breathing, target, activeDocumentId, selectedIds, keptLabels, setFlowNodes, paneW, paneH, fitTo, large, t, labelOf, foldGenerated, foldedIds, writtenIds]);

  // Refit when the free area changes — the Stitch box grows or folds, a
  // side list opens, the window resizes — or documents come and go, as long
  // as the reader has not moved the view. Measured against the last fit, so
  // a box measured while the nodes settle still refits (WALK2-15).
  useEffect(() => {
    const prev = lastFit.current;
    if (!prev || paneW <= 0 || userMoved.current) return;
    const changed =
      prev.key !== layoutKey ||
      Math.abs(prev.w - paneW) > 8 ||
      Math.abs(prev.h - paneH) > 8 ||
      Math.abs(prev.ins.bottom - insets.bottom) > 40 ||
      prev.ins.right !== insets.right ||
      prev.ins.top !== insets.top;
    if (!changed) return;
    // A card or a link panel opening or closing beside the canvas moves no
    // node: the view stays where the reader clicked (WALK4-01), and the
    // reveal below pans only when the card would cover its node.
    const insetsOnly = prev.key === layoutKey && Math.abs(prev.w - paneW) <= 8 && Math.abs(prev.h - paneH) <= 8;
    if (insetsOnly && !settling && (focusOn || prev.focus)) {
      lastFit.current = { ...prev, ins: insets, focus: focusOn };
      return;
    }
    const timer = window.setTimeout(() => fitNow(300), prev.key !== layoutKey ? 120 : 0);
    return () => window.clearTimeout(timer);
  }, [insets, paneW, paneH, layoutKey, fitNow, settling, focusOn]);

  // [ui5] WALK5-11: the switch or a rotation folds or unfolds the generated
  // documents: frame again, unless the reader moved the view.
  const lastFold = useRef(foldGenerated);
  useEffect(() => {
    if (lastFold.current === foldGenerated) return;
    lastFold.current = foldGenerated;
    if (!lastFit.current || userMoved.current) return;
    const timer = window.setTimeout(() => fitNow(300), 0);
    return () => window.clearTimeout(timer);
  }, [foldGenerated, fitNow]);
  // [/ui5]

  // Keep the focus in view (WALK4-01, WALK4-10): the pinned card's node —
  // on a narrow screen with its linked documents, above the card's sheet —
  // or the open link's two documents. Nothing moves when they are in the
  // free area already; else the view pans just enough, zooming out (down to
  // the fit's least zoom) only when they do not fit, and the node first.
  const narrowPane = paneW > 0 && paneW < 640;
  const revealIds = useMemo(() => {
    if (expandedEdgeId) return [...new Set(expandedEdgeId.split("|"))];
    if (!focusedId) return null;
    return narrowPane ? [focusedId, ...(adjacency.get(focusedId) ?? [])] : [focusedId];
  }, [expandedEdgeId, focusedId, narrowPane, adjacency]);
  const revealKey = revealIds?.join(",") ?? "";
  useEffect(() => {
    if (!revealKey || settling || paneW <= 0 || paneH <= 0) return;
    const ids = revealKey.split(",");
    const timer = window.setTimeout(() => {
      const f = flowRef.current;
      const ins = insetsRef.current;
      const pad = 12;
      const free = { l: ins.left + pad, r: paneW - ins.right - pad, t: ins.top + pad, b: paneH - ins.bottom - pad };
      if (free.r - free.l < 80 || free.b - free.t < 60) return;
      let view: { x: number; y: number; zoom: number };
      try {
        view = f.getViewport();
      } catch {
        return;
      }
      const centers = ids.flatMap((id) => {
        const n = f.getNode(id);
        return n ? [{ id, x: n.position.x + NODE_W / 2, y: n.position.y + NODE_H / 2 }] : [];
      });
      if (centers.length === 0) return;
      const extent = (list: typeof centers, zoom: number) => {
        const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
        for (const c of list) {
          const e = nodeExtent(c.x, c.y, zoom, lodZoom, loopsRef.current.has(c.id));
          b.x0 = Math.min(b.x0, e.x0);
          b.x1 = Math.max(b.x1, e.x1);
          b.y0 = Math.min(b.y0, e.y0);
          b.y1 = Math.max(b.y1, e.y1);
        }
        return b;
      };
      const fits = (b: ReturnType<typeof extent>, zoom: number) =>
        (b.x1 - b.x0) * zoom <= free.r - free.l && (b.y1 - b.y0) * zoom <= free.b - free.t;
      let zoom = view.zoom;
      let keep = centers;
      let b = extent(keep, zoom);
      if (!fits(b, zoom)) {
        const minZoom = minFitZoom;
        const z = Math.max(minZoom, Math.min(zoom, (free.r - free.l) / (b.x1 - b.x0), (free.b - free.t) / (b.y1 - b.y0)));
        if (fits(extent(keep, z), z)) zoom = z;
        else keep = centers.slice(0, 1);
        b = extent(keep, zoom);
      }
      // A zoom change keeps the first node's screen point.
      const first = centers[0];
      const sx = first.x * view.zoom + view.x;
      const sy = first.y * view.zoom + view.y;
      let x = sx - first.x * zoom;
      let y = sy - first.y * zoom;
      const shift = (lo: number, hi: number, min: number, max: number) =>
        hi - lo > max - min ? min - lo : lo < min ? min - lo : hi > max ? max - hi : 0;
      x += shift(b.x0 * zoom + x, b.x1 * zoom + x, free.l, free.r);
      y += shift(b.y0 * zoom + y, b.y1 * zoom + y, free.t, free.b);
      if (Math.abs(x - view.x) < 1 && Math.abs(y - view.y) < 1 && Math.abs(zoom - view.zoom) < 0.001) return;
      freezeHover();
      try {
        f.setViewport({ x, y, zoom }, { duration: 300 });
      } catch {
        /* non-critical */
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [revealKey, insets, settling, paneW, paneH, minFitZoom, lodZoom, freezeHover]);

  const noteEdges = useNoteOnlyEdges(visibleEdges); // [graph-notes]
  const flowEdges = useMemo<FlowEdge<LinkEdgeData | NoteEdgeData | undefined>[]>(
    () => [
      ...visibleEdges.map((e): FlowEdge<LinkEdgeData | undefined> => {
        const count = e.accepted + e.recommended;
        if (count === 0) {
          // Provenance only: a thin dotted curve, no list, no Tab stop.
          return { id: `${e.a}|${e.b}`, source: e.a, target: e.b, type: "provenance", focusable: false, ariaLabel: t("panes.graphProvenanceCurve"), data: undefined };
        }
        return {
          id: `${e.a}|${e.b}`,
          source: e.a,
          target: e.b,
          type: "link",
          ariaLabel:
            e.a === e.b
              ? count === 1
                ? t("panes.graphLoopLinkOne")
                : t("panes.graphLoopLinks", { count })
              : count === 1
                ? t("panes.graphPairLinkOne")
                : t("panes.graphPairLinks", { count }),
          data: { count, recommendedOnly: e.accepted === 0, links: e.links },
        };
      }),
      ...noteEdges,
    ],
    [visibleEdges, noteEdges, t],
  );

  // Where each curve's marks sit (VIEW3-01): placed together, off the
  // nodes' rooms and off each other, at the label scale of the zoom.
  const notesView = useGraphNotes()?.view;
  const markCoverage = useProjectCoverage(); // [layer5] the comments chips are rooms too
  const markScale = useStore((s) => Math.round(labelScale(s.transform[2]) * 10) / 10);
  const markPlaces = useMemo(() => {
    const at = new Map(flowNodes.map((n) => [n.id, n.position]));
    const center = (id: string) => {
      const p = at.get(id);
      return p ? { x: p.x + NODE_W / 2, y: p.y + 16 } : null;
    };
    const rooms = flowNodes.flatMap((n) =>
      nodeRoom(n.position.x, n.position.y, markScale, n.data.title, nodeCommentsWidth(markCoverage?.documents[n.id])),
    );
    const curves: MarkCurve[] = [];
    for (const f of flowEdges) {
      if (f.type === "provenance") continue;
      const s = center(f.source);
      const e = center(f.target);
      if (!s || !e) continue;
      const data = f.data as LinkEdgeData | NoteEdgeData | undefined;
      const links = f.type === "link" ? ((data as LinkEdgeData | undefined)?.links ?? []).filter((l) => showProvenance || !l.provenance) : [];
      const count = f.type === "link" ? ((data as LinkEdgeData | undefined)?.count ?? 0) : 0;
      const w = marksWidth(count, openReplies(links), notesView?.byPair.get(f.id)?.length ?? 0);
      if (w === 0) continue;
      const loop = f.source === f.target;
      const c = loop ? null : f.type === "note" ? noteControl(f.id, s, e) : linkControl(f.id, s, e);
      curves.push({
        id: f.id,
        curve: c ? { s, c, e } : null,
        at: { x: s.x, y: s.y - LOOP_HEIGHT * 0.75 },
        w: (w + 6) * markScale,
        h: 22 * markScale,
      });
    }
    // The widest marks first: they have the fewest free places.
    curves.sort((a, b) => b.w - a.w || a.id.localeCompare(b.id));
    return placeMarks(curves, rooms);
  }, [flowNodes, flowEdges, notesView, markScale, showProvenance, markCoverage]);

  // The curves the spotlight lights: a hovered node's, a hovered or pinned
  // curve, or the curves between a hovered note's documents.
  const litEdgeIds = useMemo(() => {
    if (!litIds) return null;
    const lit = new Set<string>();
    for (const e of flowEdges) {
      const on = shown
        ? shown.nodeId
          ? e.source === shown.nodeId || e.target === shown.nodeId
          : shown.edgeId === e.id
        : litIds.has(e.source) && litIds.has(e.target);
      if (on) lit.add(e.id);
    }
    return lit;
  }, [flowEdges, shown, litIds]);

  useSpotlightAttributes(wrapRef, litIds, litEdgeIds);

  const spotlight = useMemo(
    () => ({
      store,
      citedIds: citedIds && citedIds.size > 0 ? citedIds : null,
      floatHost,
      insets,
      plain: large,
      showProvenance,
      expandedLinkId,
      hoverEdge: pointerHoverEdge,
      pinEdge,
      scheduleClear,
      expandLink,
    }),
    [store, citedIds, floatHost, insets, large, showProvenance, expandedLinkId, pointerHoverEdge, pinEdge, scheduleClear, expandLink],
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
      // [view2] A click selects and pins the card; on the selected node it opens.
      if (content.clickSelects && content.focusedId !== id) {
        content.select(id);
        return;
      }
      router.push(docHref ? docHref(id) : `/n/${notebookId}?doc=${id}`);
      onOpenDocument();
    },
    [onClearCited, onToggleSelect, picking, router, docHref, notebookId, onOpenDocument, content],
  );
  // [view2] Option B's way to the card (CLICK_SELECTS false), and a second
  // way in A: a right-click, or a long press on touch.
  const onNodeContextMenu = useCallback(
    (e: ReactMouseEvent, node: FlowNode) => {
      e.preventDefault();
      content.select(node.id);
    },
    [content],
  );

  // Keyboard (GR-16, REV2-10): the canvas is one Tab stop — the roving node
  // holds tabindex 0, every other node and every curve -1 — so Tab leaves
  // the canvas for the controls, the lists, and the Stitch box. Arrows move
  // between documents, ] and [ go through the focused document's curves.
  const rovingRef = useRef<string | null>(null);
  const curveOrigin = useRef<{ nodeId: string; index: number } | null>(null);
  // Set while Escape puts focus back on a curve, so that focus opens no list,
  // and while focus follows the pinned card to a node, so it opens no hover card.
  const quietFocus = useRef(false);
  // [ui5] WALK5-09: a node says whether it is picked (aria-pressed), for a
  // reader who can pick; ReactFlow's node wrapper takes no such prop.
  const pickedRef = useRef<Set<string> | null>(onToggleSelect ? (selectedIds ?? null) : null);
  useLayoutEffect(() => {
    pickedRef.current = onToggleSelect ? (selectedIds ?? new Set()) : null;
  }, [onToggleSelect, selectedIds]);
  // [/ui5]
  const applyRoving = useCallback(() => {
    const root = wrapRef.current;
    if (!root) return;
    const nodeEls = [...root.querySelectorAll<HTMLElement>(".react-flow__node")];
    if (nodeEls.length === 0) return;
    let current = nodeEls.find((el) => el.getAttribute("data-id") === rovingRef.current);
    if (!current) {
      // The open document, else the top-left document in view.
      current =
        nodeEls.find((el) => el.getAttribute("data-id") === activeDocumentId) ??
        nodeEls.reduce((best, el) => {
          const a = el.getBoundingClientRect();
          const b = best.getBoundingClientRect();
          return a.top + a.left * 0.5 < b.top + b.left * 0.5 ? el : best;
        });
      rovingRef.current = current.getAttribute("data-id");
    }
    for (const el of nodeEls) {
      const tab = el === current ? "0" : "-1";
      if (el.getAttribute("tabindex") !== tab) el.setAttribute("tabindex", tab);
      if (el.getAttribute("aria-describedby") !== keysHelpId) el.setAttribute("aria-describedby", keysHelpId);
      // [ui5] WALK5-09
      const picked = pickedRef.current;
      const pressed = picked ? String(picked.has(el.getAttribute("data-id") ?? "")) : null;
      if (pressed === null) el.removeAttribute("aria-pressed");
      else if (el.getAttribute("aria-pressed") !== pressed) el.setAttribute("aria-pressed", pressed);
      // [/ui5]
    }
    for (const el of root.querySelectorAll<SVGElement>(".react-flow__edge[tabindex='0']")) el.setAttribute("tabindex", "-1");
  }, [activeDocumentId, keysHelpId]);
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(applyRoving);
    });
    observer.observe(root.querySelector(".react-flow__viewport") ?? root, { childList: true, subtree: true });
    applyRoving();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [applyRoving]);
  // [ui5] WALK5-09: a pick changes no node's DOM children; say it on the nodes.
  useEffect(() => {
    applyRoving();
  }, [selectedIds, onToggleSelect, applyRoving]);
  // [/ui5]
  const nodeEl = useCallback(
    (id: string) => wrapRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id=${JSON.stringify(id)}]`) ?? null,
    [],
  );
  const edgeEl = useCallback(
    (id: string) => wrapRef.current?.querySelector<SVGElement>(`.react-flow__edge[data-testid=${JSON.stringify(`rf__edge-${id}`)}]`) ?? null,
    [],
  );
  // Focus a document: the view pans to it when it is out of the free area
  // (a pan by keyboard is the reader's move: no refit after it).
  const focusNode = useCallback(
    (id: string) => {
      rovingRef.current = id;
      const node = flowRef.current.getNode(id);
      const root = wrapRef.current?.getBoundingClientRect();
      const el = nodeEl(id);
      const r = el?.getBoundingClientRect();
      const ins = insetsRef.current;
      const out =
        !r ||
        !root ||
        r.left < root.left + ins.left ||
        r.right > root.right - ins.right ||
        r.top < root.top + ins.top ||
        r.bottom > root.bottom - ins.bottom;
      if (out && node) {
        userMoved.current = true;
        flowRef.current.setCenter(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, {
          zoom: flowRef.current.getZoom(),
          duration: 200,
        });
      }
      const go = () => {
        applyRoving();
        nodeEl(id)?.focus({ preventScroll: true });
      };
      if (el) go();
      else requestAnimationFrame(() => requestAnimationFrame(go));
    },
    [nodeEl, applyRoving],
  );
  const focusList = useCallback(
    (edgeId: string) => {
      const go = () =>
        floatHost
          ?.querySelector<HTMLElement>(`[data-curve-list=${JSON.stringify(edgeId)}] button, [data-curve-list=${JSON.stringify(edgeId)}] a[href]`)
          ?.focus();
      requestAnimationFrame(() => requestAnimationFrame(go));
    },
    [floatHost],
  );

  // Escape (GR-11) closes the innermost canvas thing first: the key, then a
  // pinned or hovered link list, then a node's card. It marks the event
  // handled, so the overlay keeps itself open. Capture phase: it runs before
  // the overlay's own listener. Focus goes back where the reader came from:
  // from a list to its curve, from a curve to its document.
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
      const inList = target instanceof Element && target.closest("[data-curve-list]");
      const onCurve = target instanceof Element ? target.closest(".react-flow__edge") : null;
      if (keyOpen) setKeyOpen(false);
      else if (pinnedEdgeId && typed) {
        /* kept */
      } else if (pinnedEdgeId) {
        // The pointer may rest on the list: its hover would keep it open.
        const curve = pinnedEdgeId;
        setPinnedEdgeId(null);
        setHover(null);
        if (inList) {
          // Back on the curve, without its focus opening the list again.
          quietFocus.current = true;
          edgeEl(curve)?.focus();
          quietFocus.current = false;
        }
      } else if (onCurve && curveOrigin.current) {
        setHover(null);
        focusNode(curveOrigin.current.nodeId);
      } else if (hover) setHover(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keyOpen, pinnedEdgeId, hover, floatHost, edgeEl, focusNode]);

  // Enter on a node opens it (⇧-Enter picks it), Space picks it; arrows move
  // to the nearest document that way; ] and [ go to the node's next and
  // previous curve. Enter on a curve pins its list and moves focus into it.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!(e.target instanceof Element)) return;
      const nodeTarget = e.target.closest(".react-flow__node");
      const nodeId = nodeTarget?.getAttribute("data-id");
      const edgeTarget = e.target.closest(".react-flow__edge");
      const edgeId = edgeTarget?.getAttribute("data-testid")?.replace(/^rf__edge-/, "");
      if (nodeId && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        activate(nodeId, e.key === " " || e.shiftKey);
        return;
      }
      // [view2] With a card pinned, ← and → walk the card's links
      // (node-card.tsx); ↑ and ↓ still move between documents.
      if (nodeId && content.focusedId && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (nodeId && e.key.startsWith("Arrow")) {
        e.preventDefault();
        e.stopPropagation();
        const all = flowRef.current.getNodes().map((n) => ({ id: n.id, p: { x: n.position.x + NODE_W / 2, y: n.position.y + NODE_H / 2 } }));
        const from = all.find((n) => n.id === nodeId);
        const next = from && nearestInDirection(from.p, all.filter((n) => n.id !== nodeId), e.key);
        if (next) focusNode(next);
        return;
      }
      if ((e.key === "]" || e.key === "[") && (nodeId || edgeId)) {
        const origin = nodeId ?? curveOrigin.current?.nodeId ?? edgeId?.split("|")[0];
        if (!origin) return;
        const curves = flowEdges.filter((f) => f.type !== "provenance" && (f.source === origin || f.target === origin));
        if (curves.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const at = nodeId ? -1 : (curveOrigin.current?.nodeId === origin ? curveOrigin.current.index : -1);
        const index = (at + (e.key === "]" ? 1 : -1) + curves.length) % curves.length;
        curveOrigin.current = { nodeId: origin, index };
        const id = curves[index].id;
        hoverEdge(id);
        edgeEl(id)?.focus();
        return;
      }
      if (edgeId && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const pinning = pinnedEdgeId !== edgeId;
        setPinnedEdgeId(pinning ? edgeId : null);
        if (pinning) focusList(edgeId);
      }
    },
    [activate, focusNode, flowEdges, hoverEdge, edgeEl, pinnedEdgeId, focusList, content.focusedId],
  );
  // [view2] The card walked to another document while focus sat on a node:
  // focus follows the card, so Enter opens the document it shows.
  useEffect(() => {
    if (!focusedId) return;
    const active = document.activeElement;
    if (!(active instanceof Element) || !active.matches(".react-flow__node")) return;
    if (active.getAttribute("data-id") === focusedId) return;
    // Quietly: the card shows the document, so no hover card opens over it.
    quietFocus.current = true;
    focusNode(focusedId);
    quietFocus.current = false;
  }, [focusedId, focusNode]);
  const onFocusCapture = useCallback(
    (e: FocusEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.matches(".react-flow__node")) {
        const id = e.target.getAttribute("data-id");
        if (!id) return;
        if (rovingRef.current !== id) {
          rovingRef.current = id;
          applyRoving();
        }
        curveOrigin.current = null;
        if (!quietFocus.current && !touchInput.current) hoverNode(id);
      } else if (e.target.matches(".react-flow__edge")) {
        const id = e.target.getAttribute("data-testid")?.replace(/^rf__edge-/, "");
        if (id && !quietFocus.current) hoverEdge(id);
      }
    },
    [hoverNode, hoverEdge, applyRoving],
  );

  // ReactFlow's handlers, stable across hovers so a hover re-renders no more
  // than the spotlight needs.
  const onNodeClick = useCallback(
    (e: ReactMouseEvent, node: FlowNode) => activate(node.id, e.shiftKey || e.metaKey || e.ctrlKey),
    [activate],
  );
  const onNodeMouseEnter = useCallback(
    (_: ReactMouseEvent, node: FlowNode) => {
      if (!touchInput.current && !frozenAt.current) hoverNode(node.id);
    },
    [hoverNode],
  );
  const onEdgeMouseEnter = useCallback((_: ReactMouseEvent, edge: FlowEdge) => pointerHoverEdge(edge.id), [pointerHoverEdge]);
  const onEdgeClick = useCallback(
    (_: ReactMouseEvent, edge: FlowEdge) => {
      if (edge.type === "provenance") return;
      const link = oneLink(edge.id); // [lists7] WALK7-05
      if (link) expandLink(link);
      else setPinnedEdgeId((pinned) => (pinned === edge.id ? null : edge.id));
    },
    [oneLink, expandLink],
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
  const hoveredNodeId = hover?.nodeId;

  return (
    <div
      ref={wrapRef}
      className={`corpus-graph relative h-full w-full ${settling ? "graph-settling" : ""}`}
      data-large={large ? "" : undefined}
      data-provenance={showProvenance ? "" : undefined}
      onKeyDown={onKeyDown}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={(e) => {
        if (e.pointerType !== "mouse") return;
        touchInput.current = false;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        const f = frozenAt.current;
        if (f && Math.hypot(e.clientX - f.x, e.clientY - f.y) >= 4) frozenAt.current = null;
      }}
      onFocusCapture={onFocusCapture}
      onBlurCapture={scheduleClear}
    >
      <p id={keysHelpId} className="sr-only">
        {t("panes.graphKeysHelp")}
      </p>
      <SpotlightContext.Provider value={spotlight}>
      <MarkPlacesContext.Provider value={markPlaces}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStopAll}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu /* [view2] */}
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
        zoomActivationKeyCode={ZOOM_KEYS}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={PRO_OPTIONS}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable
        edgesFocusable
        // Our own keys and their description (graphKeysHelp), not reactflow's.
        disableKeyboardA11y
        // A large project draws only what is in view (REV2-09).
        onlyRenderVisibleElements={large}
      >
        <LabelScale target={wrapRef} lodZoom={lodZoom} />
        <LabelEdges target={wrapRef} />
        <Background gap={26} size={1.5} color="var(--sand-300)" />
        {/* Top left, clear of the Stitch box at the foot of the canvas. The
            zoom buttons carry the UI language's names (WALK2-17). */}
        <Controls position="top-left" showInteractive={false} showFitView={false} showZoom={false}>
          <ControlButton onClick={() => flowRef.current.zoomIn({ duration: 200 })} title={t("panes.graphZoomIn")} aria-label={t("panes.graphZoomIn")} data-track="graph-zoom-in">
            <PlusIcon size={14} className="graph-stroke-icon" />
          </ControlButton>
          <ControlButton onClick={() => flowRef.current.zoomOut({ duration: 200 })} title={t("panes.graphZoomOut")} aria-label={t("panes.graphZoomOut")} data-track="graph-zoom-out">
            <MinusGlyph size={14} />
          </ControlButton>
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
          {generatedIds.size > 0 && (
            <ControlButton
              onClick={() => setShowProvenance(!showProvenance)}
              title={t(showProvenance ? "panes.graphProvenanceHide" : "panes.graphProvenanceShow")}
              aria-label={t("panes.graphProvenanceShow")}
              aria-pressed={showProvenance}
              data-track="graph-provenance"
              className={showProvenance ? "graph-control-on" : undefined}
            >
              <PageIcon size={13} className="graph-stroke-icon" />
            </ControlButton>
          )}
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
      </MarkPlacesContext.Provider>
      {hoveredNodeId && hoveredNodeId !== focusedId /* [view2] its card is pinned */ && !dragging && (
        <NodeCard
          key={hoveredNodeId}
          node={nodes.find((n) => n.id === hoveredNodeId) ?? null}
          counts={linkCounts.get(hoveredNodeId)}
          picking={picking}
          onEnter={() => hoverNode(hoveredNodeId)}
          onLeave={scheduleClear}
        />
      )}
      </SpotlightContext.Provider>
      {keyOpen && (
        <GraphKey
          onClose={() => setKeyOpen(false)}
          generated={generatedIds.size > 0 && (showProvenance || writtenIds.size > 0 || !foldGenerated)}
          provenance={showProvenance && generatedIds.size > 0}
          cited={(citedIds?.size ?? 0) > 0}
        />
      )}
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
  // A link clicked in a curve's list opens in the overlay's side panel
  // (WALK2-05); expandedLinkId is the one open there.
  expandedLinkId?: string | null;
  onExpandLink?: (linkId: string) => void;
  // [chrome6] VIEW6-03: generated documents that appeared while the graph
  // was open (a page Stitch just wrote): drawn and lit with the switch off.
  writtenIds?: Set<string>;
};

export default function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
