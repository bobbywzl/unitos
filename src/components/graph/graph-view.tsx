"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  type EdgeProps,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { FilmIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The corpus graph (SPEC.md §13; the release-edu tree pattern): documents as
// nodes on a pan/zoom canvas, links between them as swept curves. The more
// links between two documents, the thicker and bolder the curve; a pair held
// together only by recommended links draws dashed until one is accepted.
// Clicking a node opens that document.

function DocumentNode({ data }: NodeProps<{ title: string; hasVideo: boolean; degree: number; active: boolean }>) {
  const size = Math.min(30, 14 + data.degree * 3);
  return (
    <div className="flex w-36 flex-col items-center gap-1.5">
      <Handle type="source" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" />
      <Handle type="target" position={Position.Top} className="!pointer-events-none !h-1 !w-1 !opacity-0" />
      <span
        className={`flex items-center justify-center rounded-full ${
          data.active ? "bg-clay shadow-[0_0_18px_rgba(198,113,57,0.5)]" : "bg-sage-500 shadow-[0_0_12px_rgba(143,160,115,0.45)]"
        }`}
        style={{ width: size, height: size }}
      >
        {data.hasVideo && <FilmIcon size={Math.max(10, size - 14)} className="text-white" />}
      </span>
      <span className="line-clamp-2 text-center text-[11px] leading-snug font-semibold text-ink">
        {data.title}
      </span>
    </div>
  );
}

// A swept curve between two documents (release-edu's branch edge), weight from
// the pair's link count.
function LinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<{ count: number; recommendedOnly: boolean }>) {
  const count = data?.count ?? 1;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const bow = ((hash % 100) / 100 - 0.5) * 70 + (targetX - sourceX) * 0.18;
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const path = `M ${sourceX} ${sourceY} Q ${midX + bow} ${midY} ${targetX} ${targetY}`;
  const width = Math.min(9, 1.2 + count * 1.4);
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="var(--clay)"
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={data?.recommendedOnly ? "6 7" : undefined}
        opacity={data?.recommendedOnly ? 0.45 : 0.65}
      />
      {count > 1 && (
        <text
          x={midX + bow / 2}
          y={midY}
          textAnchor="middle"
          dy={-4}
          className="fill-[--sand-600] text-[10px] font-semibold"
        >
          {count}
        </text>
      )}
    </g>
  );
}

const nodeTypes = { document: DocumentNode };
const edgeTypes = { link: LinkEdge };

export default function GraphView({
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

  const { flowNodes, flowEdges } = useMemo(() => {
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + e.accepted + e.recommended);
      degree.set(e.b, (degree.get(e.b) ?? 0) + e.accepted + e.recommended);
    }
    // A circle reads clearly at corpus scale and never tangles; nodes stay
    // draggable for hand arrangement.
    const radius = Math.max(180, nodes.length * 46);
    const flowNodes = nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, nodes.length) - Math.PI / 2;
      return {
        id: n.id,
        type: "document",
        position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
        data: {
          title: n.title,
          hasVideo: n.hasVideo,
          degree: degree.get(n.id) ?? 0,
          active: n.id === activeDocumentId,
        },
      };
    });
    const flowEdges = edges.map((e) => ({
      id: `${e.a}|${e.b}`,
      source: e.a,
      target: e.b,
      type: "link",
      data: { count: e.accepted + e.recommended, recommendedOnly: e.accepted === 0 },
    }));
    return { flowNodes, flowEdges };
  }, [nodes, edges, activeDocumentId]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        defaultNodes={flowNodes}
        defaultEdges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          router.push(`/n/${notebookId}?doc=${node.id}`);
          onOpenDocument();
        }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        panOnDrag
        zoomOnPinch
        zoomOnScroll
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.25, duration: 400 }} />
      </ReactFlow>
      <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-card/90 px-4 py-1.5 text-[11px] text-sand-600 shadow-soft">
        {t("panes.graphHint")}
      </p>
    </ReactFlowProvider>
  );
}
