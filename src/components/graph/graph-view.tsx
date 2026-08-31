"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { FilmIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The corpus graph (SPEC.md §13; the release-edu canvas patterns): documents
// as nodes on a pan/zoom canvas, links between them as swept curves. The more
// links between two documents, the thicker and bolder the curve; a pair held
// together only by recommended links draws dashed (marching) until one is
// accepted, and both its documents breathe. Hovering a node spotlights it,
// its links, and its linked documents; hovering a curve spotlights the pair.
// Nodes float in scattered on first open and settle into place. Clicking a
// node opens that document.

// Deterministic pseudo-random in [-1, 1] from a string (release-edu's jitter):
// the same corpus always scatters, bows, and breathes the same way.
function seeded(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 999) * 2 - 1;
}

// "lit" = part of the hovered neighborhood; "dim" = outside it; "base" = no
// hover anywhere. The spotlight rides a context, never node or edge data:
// rebuilding the arrays on every hover replaces reactflow's elements, which
// can eat a click landing in the same frame.
type Spotlight = "base" | "lit" | "dim";

type HoverState = { nodeId?: string; edgeId?: string } | null;

const SpotlightContext = createContext<{ hover: HoverState; litIds: Set<string> | null }>({
  hover: null,
  litIds: null,
});

type DocumentNodeData = {
  title: string;
  hasVideo: boolean;
  degree: number;
  active: boolean;
  breathing: boolean;
};

type LinkEdgeData = {
  count: number;
  recommendedOnly: boolean;
};

function DocumentNode({ id, data }: NodeProps<DocumentNodeData>) {
  const { litIds } = useContext(SpotlightContext);
  const spotlight: Spotlight = litIds === null ? "base" : litIds.has(id) ? "lit" : "dim";
  const size = Math.min(32, 16 + data.degree * 2.5) + (data.active ? 2 : 0);
  const breatheDelay = `${(Math.abs(seeded(id, 5)) * 3).toFixed(2)}s`;
  const breatheDur = `${(3.2 + Math.abs(seeded(id, 9)) * 2).toFixed(2)}s`;
  return (
    <div
      className="flex w-36 flex-col items-center gap-1 transition-opacity duration-300"
      style={{ opacity: spotlight === "dim" ? 0.15 : 1 }}
    >
      <Handle type="source" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" style={{ top: 16 }} />
      <Handle type="target" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" style={{ top: 16 }} />
      <span
        className={data.breathing ? "graph-breathe flex h-8 items-center justify-center" : "flex h-8 items-center justify-center"}
        style={data.breathing ? { animationDelay: breatheDelay, animationDuration: breatheDur } : undefined}
      >
        <span
          className={`flex items-center justify-center rounded-full border-2 border-card transition-[transform,box-shadow] duration-200 ${
            data.active
              ? "bg-clay shadow-[0_0_20px_color-mix(in_srgb,var(--clay)_55%,transparent)]"
              : "bg-sage-500 shadow-[0_0_12px_color-mix(in_srgb,var(--sage)_40%,transparent)]"
          } ${spotlight === "lit" ? "scale-110" : ""}`}
          style={{ width: size, height: size }}
        >
          {data.hasVideo && <FilmIcon size={Math.max(10, size - 16)} className={data.active ? "text-clay-fg" : "text-sage-fg"} />}
        </span>
      </span>
      <span
        className={`line-clamp-2 text-center text-[11px] leading-snug font-semibold ${
          data.active ? "text-clay-700" : "text-ink"
        }`}
      >
        {data.title}
      </span>
    </div>
  );
}

// A swept curve between two documents (release-edu's branch edge), weight from
// the pair's link count. Accepted links draw solid clay; a recommended-only
// pair draws sand, dashed, dashes marching until a link is accepted.
function LinkEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data }: EdgeProps<LinkEdgeData>) {
  const { hover } = useContext(SpotlightContext);
  const lit = hover?.nodeId ? source === hover.nodeId || target === hover.nodeId : hover?.edgeId === id;
  const spotlight: Spotlight = hover === null ? "base" : lit ? "lit" : "dim";
  const count = data?.count ?? 1;
  const recommendedOnly = data?.recommendedOnly ?? false;
  const bow = seeded(id, 3) * 46 + (targetX - sourceX) * 0.14;
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const path = `M ${sourceX} ${sourceY} Q ${midX + bow} ${midY} ${targetX} ${targetY}`;
  const width = Math.min(5, 1.4 + count * 0.7) + (spotlight === "lit" ? 0.8 : 0);
  const opacity = spotlight === "dim" ? 0.07 : spotlight === "lit" ? 0.95 : recommendedOnly ? 0.45 : 0.6;
  const label = String(count);
  const pillWidth = 14 + label.length * 7;
  return (
    <g style={{ opacity, transition: "opacity 0.25s ease" }}>
      <path
        d={path}
        fill="none"
        stroke={recommendedOnly ? "var(--sand-500)" : "var(--clay)"}
        strokeLinecap="round"
        strokeDasharray={recommendedOnly ? "5 7" : undefined}
        className={recommendedOnly ? "graph-dash-march" : undefined}
        style={{ strokeWidth: width, transition: "stroke-width 0.25s ease" }}
      />
      {/* Wide invisible twin so the thin curve is hoverable. */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction" />
      {count > 1 && (
        // The exact link count on a small pill at the curve's midpoint.
        <g transform={`translate(${midX + bow / 2}, ${midY})`}>
          <rect x={-pillWidth / 2} y={-9} width={pillWidth} height={18} rx={9} fill="var(--card)" stroke="var(--line)" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill="var(--sand-700)">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

const nodeTypes = { document: DocumentNode };
const edgeTypes = { link: LinkEdge };

// Ring layout, linked documents adjacent: order nodes by a BFS walk over the
// link graph (highest-degree first), so a pair's curve hugs the ring instead
// of crossing the canvas. Isolated documents have no neighbors to sit beside
// and group at the end of the walk. A touch of per-document radial drift
// keeps the ring from reading mechanical.
function ringLayout(nodes: GraphNode[], adjacency: Map<string, Set<string>>, degree: Map<string, number>): Map<string, { x: number; y: number }> {
  const deg = (id: string) => degree.get(id) ?? 0;
  const order: string[] = [];
  const seen = new Set<string>();
  const starts = [...nodes].sort((a, b) => deg(b.id) - deg(a.id) || a.id.localeCompare(b.id));
  for (const start of starts) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    const queue = [start.id];
    while (queue.length) {
      const cur = queue.shift()!;
      order.push(cur);
      const next = [...(adjacency.get(cur) ?? [])]
        .filter((n) => !seen.has(n))
        .sort((a, b) => deg(b) - deg(a) || a.localeCompare(b));
      for (const n of next) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  const radius = Math.max(190, nodes.length * 44);
  const pos = new Map<string, { x: number; y: number }>();
  order.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / order.length - Math.PI / 2;
    const r = radius + seeded(id, 11) * Math.min(30, radius * 0.1);
    pos.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });
  return pos;
}

function GraphCanvas({
  notebookId,
  activeDocumentId,
  nodes,
  edges,
  onOpenDocument,
}: {
  notebookId: string;
  activeDocumentId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpenDocument: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const flow = useReactFlow();
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<DocumentNodeData>([]);
  // First open: nodes mount scattered, then glide into place (CSS transition
  // while `settling`); edges stay hidden until they land. The phase lives in
  // a ref so a strict-mode double effect run re-renders the scatter instead
  // of skipping straight to the targets.
  const [settling, setSettling] = useState(true);
  const phaseRef = useRef<"scatter" | "settle" | "done">("scatter");
  // Hand-dragged positions survive data refreshes and hover rebuilds.
  const draggedPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [hover, setHover] = useState<{ nodeId?: string; edgeId?: string } | null>(null);

  const { adjacency, degree, breathing } = useMemo(() => {
    const adjacency = new Map<string, Set<string>>();
    const degree = new Map<string, number>();
    const breathing = new Set<string>();
    for (const e of edges) {
      if (!adjacency.has(e.a)) adjacency.set(e.a, new Set());
      if (!adjacency.has(e.b)) adjacency.set(e.b, new Set());
      adjacency.get(e.a)!.add(e.b);
      adjacency.get(e.b)!.add(e.a);
      degree.set(e.a, (degree.get(e.a) ?? 0) + e.accepted + e.recommended);
      degree.set(e.b, (degree.get(e.b) ?? 0) + e.accepted + e.recommended);
      if (e.accepted === 0) {
        breathing.add(e.a);
        breathing.add(e.b);
      }
    }
    return { adjacency, degree, breathing };
  }, [edges]);

  const layout = useMemo(() => ringLayout(nodes, adjacency, degree), [nodes, adjacency, degree]);

  // The hovered neighborhood: the node and its linked documents, or a curve's
  // two endpoints. Everything else dims.
  const litIds = useMemo(() => {
    if (!hover) return null;
    const lit = new Set<string>();
    if (hover.nodeId) {
      lit.add(hover.nodeId);
      for (const n of adjacency.get(hover.nodeId) ?? []) lit.add(n);
    } else if (hover.edgeId) {
      for (const id of hover.edgeId.split("|")) lit.add(id);
    }
    return lit;
  }, [hover, adjacency]);

  useEffect(() => {
    const mk = (n: GraphNode, position: { x: number; y: number }): FlowNode<DocumentNodeData> => ({
      id: n.id,
      type: "document",
      position,
      data: {
        title: n.title,
        hasVideo: n.hasVideo,
        degree: degree.get(n.id) ?? 0,
        active: n.id === activeDocumentId,
        breathing: breathing.has(n.id),
      },
    });
    const target = (n: GraphNode) => draggedPos.current.get(n.id) ?? layout.get(n.id) ?? { x: 0, y: 0 };
    if (phaseRef.current === "scatter") {
      // Scatter → settle (release-edu). The scatter is deterministic, so
      // reopening feels alive but never chaotic.
      setFlowNodes(
        nodes.map((n) =>
          mk(n, {
            x: (layout.get(n.id)?.x ?? 0) + seeded(n.id, 21) * 300,
            y: (layout.get(n.id)?.y ?? 0) + seeded(n.id, 33) * 240,
          }),
        ),
      );
      // Mount-time fitView misses nodes set after mount — frame the scatter
      // now, then refit with a glide once everything lands. Two frames so the
      // scatter paints before the settle transition starts.
      requestAnimationFrame(() => {
        try {
          flow.fitView({ padding: 0.3, maxZoom: 1.1 });
        } catch {
          /* non-critical */
        }
        requestAnimationFrame(() => {
          if (phaseRef.current !== "scatter") return;
          phaseRef.current = "settle";
          setFlowNodes(nodes.map((n) => mk(n, target(n))));
          setTimeout(() => {
            phaseRef.current = "done";
            setSettling(false);
            setTimeout(() => {
              try {
                flow.fitView({ padding: 0.3, maxZoom: 1.1, duration: 500 });
              } catch {
                /* non-critical */
              }
            }, 30);
          }, 950);
        });
      });
      return;
    }
    setFlowNodes(nodes.map((n) => mk(n, target(n))));
  }, [nodes, degree, breathing, layout, activeDocumentId, flow, setFlowNodes]);

  const flowEdges = useMemo<FlowEdge<LinkEdgeData>[]>(
    () =>
      edges.map((e) => ({
        id: `${e.a}|${e.b}`,
        source: e.a,
        target: e.b,
        type: "link",
        data: { count: e.accepted + e.recommended, recommendedOnly: e.accepted === 0 },
      })),
    [edges],
  );

  const spotlight = useMemo(() => ({ hover, litIds }), [hover, litIds]);

  const onNodeDragStop = useCallback((_: unknown, node: FlowNode) => {
    draggedPos.current.set(node.id, node.position);
  }, []);

  return (
    <div className={`corpus-graph relative h-full w-full ${settling ? "graph-settling" : ""}`}>
      <SpotlightContext.Provider value={spotlight}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, node) => {
          router.push(`/n/${notebookId}?doc=${node.id}`);
          onOpenDocument();
        }}
        onNodeMouseEnter={(_, node) => setHover({ nodeId: node.id })}
        onNodeMouseLeave={() => setHover(null)}
        onEdgeMouseEnter={(_, edge) => setHover({ edgeId: edge.id })}
        onEdgeMouseLeave={() => setHover(null)}
        // An edge's mouse-leave is lost when the hovered edge re-renders. Node
        // and edge moves bubble here too, so clear the spotlight only when the
        // pointer is on the pane itself — off every node and edge.
        onPaneMouseMove={(e) => {
          if (e.target instanceof Element && e.target.classList.contains("react-flow__pane")) {
            setHover((h) => (h ? null : h));
          }
        }}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
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
        edgesFocusable={false}
      >
        <Background gap={26} size={1.5} color="var(--sand-300)" />
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.3, maxZoom: 1.1, duration: 400 }} />
      </ReactFlow>
      </SpotlightContext.Provider>
      <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-card/95 px-4 py-1.5 text-[11px] text-sand-600 shadow-soft">
        {t("panes.graphHint")}
      </p>
    </div>
  );
}

export default function GraphView(props: {
  notebookId: string;
  activeDocumentId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpenDocument: () => void;
}) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
