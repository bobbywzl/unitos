"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  ReactFlowProvider,
  useNodesState,
  useUpdateNodeInternals,
  type Connection,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { useT } from "@/components/lang-provider";
import { SparkleIcon, TrashIcon } from "@/components/icons";
import { BUCKET_WIDTH, topBucketOf, type Structure, type StructureConnection } from "@/lib/structure";
import { BucketBox } from "@/components/structure/bucket-box";
import {
  endOfHandle,
  useStructure,
  type StructureBlock,
} from "@/components/structure/structure-context";

// The structure canvas (SPEC.md §32): every top bucket a node, drawn by its
// header; a bucket inside another draws inside its node. A connection is a
// curve between the handles of its two ends — a bucket's header or a piece
// row, in whichever node they sit — with its label on the curve; a click on
// the label opens the connection card: the label, the comment, Delete. A
// drag from one end's handle to another's draws a new connection. Pan and
// zoom as the graph: drag empty space to pan, scroll to pan, pinch or
// Ctrl/Cmd+wheel to zoom.

type BucketNodeData = { bucketId: string };
// reversed: the curve runs from the connection's second end to its first
// (the second end stands to the left), so the arrow is at the curve's start.
type ConnectionEdgeData = { connection: StructureConnection; reversed: boolean };

// The room between two top buckets, in px, under which they count as one
// column: their connection joins their right sides.
const SIDE_GAP = 24;

function BucketNode({ id, data }: NodeProps<BucketNodeData>) {
  const { structure } = useStructure();
  const updateNodeInternals = useUpdateNodeInternals();
  // The handles move when pieces come and go or a piece opens: reactflow
  // measures them again.
  const shape =
    structure.pieces.filter((p) => topBucketOf(structure, p.bucketId) === id)
      .length + structure.buckets.length;
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, shape, updateNodeInternals]);
  return <BucketBox bucketId={data.bucketId} depth={0} />;
}

function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ConnectionEdgeData>) {
  const t = useT();
  const { selectedConnectionId, selectConnection } = useStructure();
  const connection = data?.connection;
  const reversed = data?.reversed ?? false;
  const open = connection ? selectedConnectionId === connection.id : false;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const lit = open || selected;
  if (!connection) return null;
  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={lit ? "var(--clay)" : "var(--sand-500)"}
        strokeWidth={lit ? 2.5 : 1.75}
        strokeDasharray={
          connection.byAssistant && !connection.label ? "6 5" : undefined
        }
        className="react-flow__edge-path"
        markerEnd={reversed ? undefined : `url(#${lit ? "structure-arrow-lit" : "structure-arrow"})`}
        markerStart={reversed ? `url(#${lit ? "structure-arrow-lit" : "structure-arrow"})` : undefined}
      />
      {/* A wide invisible path takes the click. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="react-flow__edge-interaction"
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex flex-col items-center gap-1.5"
          // The open card stands over the other connections' labels.
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            zIndex: open ? 10 : undefined,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              selectConnection(open ? null : connection.id);
            }}
            data-track="structure-connection"
            data-tip={t("structure.connectionTitle")}
            className={`flex max-w-[220px] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow-soft ${
              lit
                ? "border-clay bg-clay text-clay-fg"
                : "border-line bg-card text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            }`}
          >
            {connection.byAssistant && <SparkleIcon size={10} />}
            <span className="truncate">
              {connection.label || t("structure.connectionUnlabeled")}
            </span>
          </button>
          {open && (
            <ConnectionCard key={connection.id} connection={connection} />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// The connection card: the label, the comment, Delete. Its boxes start from
// the connection as it is when the card opens (the card mounts per open).
function ConnectionCard({ connection }: { connection: StructureConnection }) {
  const t = useT();
  const { structure, blocks, selectConnection, canEdit, ops } = useStructure();
  const [label, setLabel] = useState(connection.label);
  const [comment, setComment] = useState(connection.comment);
  const commit = () => {
    if (!canEdit) return;
    if (label !== connection.label || comment !== connection.comment) {
      ops.updateConnection(connection.id, {
        label: label.trim(),
        comment: comment.trim(),
      });
    }
  };
  return (
    <div
      data-structure-card
      className="menu-in flex w-[300px] flex-col gap-2 rounded-2xl border border-line bg-card/95 p-3 shadow-float backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[11px] leading-snug text-sand-600">
        {t("structure.connectionBetween", {
          from: endName(structure, blocks, connection.from, t),
          to: endName(structure, blocks, connection.to, t),
        })}
      </p>
      {canEdit ? (
        <>
          <input
            data-structure-field
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder={t("structure.connectionLabelPlaceholder")}
            aria-label={t("structure.connectionLabel")}
            className="w-full rounded-xl bg-sand-100 px-3 py-1.5 text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-sand-500"
          />
          <textarea
            data-structure-field
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={commit}
            placeholder={t("structure.connectionCommentPlaceholder")}
            aria-label={t("structure.connectionComment")}
            rows={3}
            className="w-full resize-none rounded-xl bg-sand-100 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                selectConnection(null);
                ops.removeConnection(connection.id);
              }}
              data-track="structure-connection-remove"
              data-tip={t("structure.connectionRemoveTitle")}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            >
              <TrashIcon size={11} />
              {t("common.delete")}
            </button>
            <button
              onClick={() => selectConnection(null)}
              data-track="structure-connection-done"
              className="rounded-full bg-ink px-3 py-1 text-[11px] font-semibold text-paper hover:bg-clay-800"
            >
              {t("common.done")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] font-semibold">
            {connection.label || t("structure.connectionUnlabeled")}
          </p>
          {connection.comment && (
            <p className="text-[12.5px] text-sand-700">{connection.comment}</p>
          )}
        </>
      )}
    </div>
  );
}

// An end by name, so the card says which two things the curve joins: a
// bucket by its title, a piece by its label or the block's first words.
function endName(
  structure: Structure,
  blocks: Map<string, StructureBlock>,
  end: StructureConnection["from"],
  t: ReturnType<typeof useT>,
): string {
  const words = (text: string) => {
    const one = text.replace(/\s+/g, " ").trim();
    return one.length > 60 ? `${one.slice(0, 57).trimEnd()}…` : one;
  };
  if (end.kind === "bucket") {
    const title = structure.buckets.find((b) => b.id === end.id)?.title;
    return t("structure.connectionEndBucket", { name: words(title || t("structure.bucketUntitled")) });
  }
  const piece = structure.pieces.find((p) => p.blockId === end.id);
  const text = piece?.label || blocks.get(end.id)?.text || piece?.preview || "";
  return t("structure.connectionEndPiece", { name: words(text) });
}

const nodeTypes = { bucket: BucketNode };
const edgeTypes = { connection: ConnectionEdge };

function Canvas() {
  const t = useT();
  const { structure, canEdit, ops, selectConnection } = useStructure();
  const tops = useMemo(
    () => structure.buckets.filter((b) => !b.parentId),
    [structure.buckets],
  );

  const [flowNodes, setFlowNodes, onNodesChange] =
    useNodesState<BucketNodeData>([]);
  // The nodes follow the buckets: a new bucket gets a node at its position,
  // a removed one loses its node, and a bucket moved by the assistant's
  // layout moves — but a node the reader is dragging keeps its place.
  const draggingId = useRef<string | null>(null);
  useEffect(() => {
    setFlowNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return tops.map((b) => {
        const existing = byId.get(b.id);
        if (existing && draggingId.current === b.id) return existing;
        const position = { x: b.x, y: b.y };
        if (
          existing &&
          existing.position.x === b.x &&
          existing.position.y === b.y
        )
          return existing;
        return {
          id: b.id,
          type: "bucket",
          position,
          data: { bucketId: b.id },
          dragHandle: ".bucket-drag",
          draggable: canEdit,
        } satisfies FlowNode<BucketNodeData>;
      });
    });
  }, [tops, canEdit, setFlowNodes]);

  // A curve joins the sides of its two ends that face each other, so it
  // runs through the room between the buckets, not back under them: the
  // first end's right side to the second end's left when the second stands
  // to the right; the second's right side to the first's left when it
  // stands to the left (the arrow then sits at the curve's start, so it
  // still points at the second end); both right sides when the two share a
  // column, or a bucket. The nodes' places are read live, so a bucket
  // dragged across another turns its curves as it goes.
  const flowEdges = useMemo<FlowEdge<ConnectionEdgeData>[]>(() => {
    const bucketOfEnd = (end: StructureConnection["from"]) =>
      end.kind === "bucket"
        ? end.id
        : structure.pieces.find((p) => p.blockId === end.id)?.bucketId;
    const xOf = new Map(flowNodes.map((n) => [n.id, n.position.x]));
    return structure.connections.flatMap((c) => {
      const fromBucket = bucketOfEnd(c.from);
      const toBucket = bucketOfEnd(c.to);
      if (!fromBucket || !toBucket) return [];
      const fromTop = topBucketOf(structure, fromBucket);
      const toTop = topBucketOf(structure, toBucket);
      const fromX = xOf.get(fromTop) ?? 0;
      const toX = xOf.get(toTop) ?? 0;
      const fromHandle = (side: "l" | "r") => `${side}|${c.from.kind}|${c.from.id}`;
      const toHandle = (side: "l" | "r") => `${side}|${c.to.kind}|${c.to.id}`;
      const route =
        fromTop !== toTop && fromX + BUCKET_WIDTH + SIDE_GAP <= toX
          ? { source: fromTop, target: toTop, sourceHandle: fromHandle("r"), targetHandle: toHandle("l"), reversed: false }
          : fromTop !== toTop && toX + BUCKET_WIDTH + SIDE_GAP <= fromX
            ? { source: toTop, target: fromTop, sourceHandle: toHandle("r"), targetHandle: fromHandle("l"), reversed: true }
            : { source: fromTop, target: toTop, sourceHandle: fromHandle("r"), targetHandle: toHandle("r"), reversed: false };
      return [
        {
          id: c.id,
          source: route.source,
          target: route.target,
          sourceHandle: route.sourceHandle,
          targetHandle: route.targetHandle,
          type: "connection",
          data: { connection: c, reversed: route.reversed },
        },
      ];
    });
  }, [structure, flowNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const from = endOfHandle(connection.sourceHandle);
      const to = endOfHandle(connection.targetHandle);
      if (!from || !to) return;
      const id = ops.connect(from, to);
      if (id) selectConnection(id);
    },
    [ops, selectConnection],
  );

  return (
    <div className="corpus-graph structure-canvas relative h-full w-full">
      <svg className="absolute size-0">
        <defs>
          <marker
            id="structure-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--sand-500)" />
          </marker>
          <marker
            id="structure-arrow-lit"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--clay)" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_, node) => {
          draggingId.current = node.id;
        }}
        onNodeDragStop={(_, node) => {
          draggingId.current = null;
          ops.moveBucket(
            node.id,
            Math.round(node.position.x),
            Math.round(node.position.y),
          );
        }}
        onConnect={onConnect}
        onPaneClick={() => selectConnection(null)}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        panOnDrag
        panOnScroll
        zoomOnPinch
        zoomOnScroll={false}
        zoomActivationKeyCode={["Meta", "Control"]}
        zoomOnDoubleClick={false}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={canEdit}
        nodesConnectable={canEdit}
        edgesFocusable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
      >
        <Background gap={26} size={1.5} color="var(--sand-300)" />
        <Controls
          showInteractive={false}
          fitViewOptions={{ padding: 0.2, maxZoom: 1, duration: 400 }}
        />
      </ReactFlow>
      {tops.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto max-w-[460px] -translate-y-1/2 px-8 text-center text-sm text-sand-600">
          {t(canEdit ? "structure.empty" : "structure.emptyViewer")}
        </p>
      )}
      <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-full border border-line bg-card/95 px-4 py-1.5 text-[11px] text-sand-600 shadow-soft">
        {t("structure.canvasHint")}
      </p>
    </div>
  );
}

export default function StructureCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
