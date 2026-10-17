"use client";

import { useState, type DragEvent } from "react";
import { Handle, Position } from "reactflow";
import { AnnotationKindIcon } from "@/components/annotation-kind-icon";
import { NotesIcon, SparkleIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { annotationKindColor } from "@/lib/annotations/kind";
import type { StructurePiece } from "@/lib/structure";
import { handleId, PIECE_DRAG_TYPE, pieceHashOf, useStructure, type PieceAnnotation } from "@/components/structure/structure-context";

// One piece (SPEC.md §32): a block placed in a bucket. Folded, the row shows
// the label and the block's first words; a click opens it: the whole block,
// its annotations and notes, and the actions — Open in reader, Explain,
// Simplify. The row drags to another bucket, to another place in its own,
// or to the tray (unsorted). Its handles at the sides take a connection. A
// block whose text changed since the piece was placed says so; a block
// that is gone shows the words the piece kept.

export function PieceRow({ piece }: { piece: StructurePiece }) {
  const t = useT();
  const { blocks, annotationsByBlock, canEdit, ops, setDragging, openBlock, runTool, toolRuns } = useStructure();
  const block = blocks.get(piece.blockId);
  const [open, setOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const annotations = annotationsByBlock[piece.blockId] ?? [];
  const run = toolRuns[piece.blockId];
  const gone = !block;
  const changed = block ? pieceHashOf(block.text) !== piece.hash : false;
  const end = { kind: "piece" as const, id: piece.blockId };

  function onDragStart(e: DragEvent) {
    e.dataTransfer.setData(PIECE_DRAG_TYPE, piece.blockId);
    e.dataTransfer.effectAllowed = "move";
    setDragging({ blockId: piece.blockId });
  }

  return (
    <div
      data-piece-row
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(null)}
      className={`nodrag relative rounded-xl border bg-paper/70 ${open ? "border-line" : "border-transparent hover:border-line"} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <Handle type="target" position={Position.Left} id={handleId("l", end)} className="structure-handle" />
      <Handle type="source" position={Position.Right} id={handleId("r", end)} className="structure-handle" />
      <button
        onClick={() => setOpen((v) => !v)}
        data-track="piece-toggle"
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-sand-400" aria-hidden />
        <span className="min-w-0 flex-1">
          {piece.label && <span className="block truncate text-[12.5px] font-semibold text-ink">{piece.label}</span>}
          <span className={`block text-[12px] leading-snug text-sand-700 ${open ? "" : "line-clamp-2"} ${gone ? "line-through" : ""}`}>
            {block ? (open ? block.text : piece.preview) : piece.preview}
          </span>
        </span>
        {(annotations.length > 0 || block?.type === "FIGURE" || block?.type === "TABLE") && (
          <span className="mt-0.5 flex shrink-0 items-center gap-1">
            {block && (block.type === "FIGURE" || block.type === "TABLE" || block.type === "EQUATION" || block.type === "CODE" || block.type === "HEADING") && (
              <span className="rounded-full bg-sand-200 px-1.5 text-[10px] font-semibold text-sand-600 uppercase">{blockKindLabel(block.type, t)}</span>
            )}
            {annotations.length > 0 && (
              <span className="flex items-center gap-0.5 rounded-full bg-sand-200 px-1.5 text-[10px] font-semibold text-sand-700">
                <NotesIcon size={9} />
                {annotations.length}
              </span>
            )}
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">
          {gone && <p className="text-[11px] text-red-600">{t("structure.pieceGone")}</p>}
          {changed && !gone && <p className="text-[11px] text-sand-500">{t("structure.pieceChanged")}</p>}
          {canEdit &&
            (editingLabel ? (
              <input
                data-structure-field
                autoFocus
                defaultValue={piece.label}
                placeholder={t("structure.pieceLabelPlaceholder")}
                aria-label={t("structure.pieceLabel")}
                onBlur={(e) => {
                  ops.labelPiece(piece.blockId, e.target.value.trim());
                  setEditingLabel(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-full rounded-lg bg-sand-100 px-2 py-1 text-[12px] outline-none"
              />
            ) : (
              <button
                onClick={() => setEditingLabel(true)}
                data-track="piece-label"
                className="self-start rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
              >
                {piece.label ? t("structure.pieceRelabel") : t("structure.pieceAddLabel")}
              </button>
            ))}
          {annotations.length > 0 && (
            <ul className="flex flex-col gap-1">
              {annotations.map((a) => (
                <AnnotationLine key={a.sourceId} blockId={piece.blockId} annotation={a} />
              ))}
            </ul>
          )}
          {run && (
            <div className="rounded-xl border border-line bg-card px-2.5 py-2 text-[12px]" style={{ borderLeftColor: annotationKindColor(run.kind, null), borderLeftWidth: 3 }}>
              <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold text-sand-600 uppercase">
                <AnnotationKindIcon kind={run.kind} size={10} />
                {t(run.kind === "explain" ? "reader.explain" : "reader.simplify")}
                {run.streaming && <SpinnerIcon size={10} className="motion-safe:animate-spin" />}
              </p>
              {run.error ? <p className="text-red-600">{run.error}</p> : <Markdown>{run.text}</Markdown>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {!gone && (
              <button
                onClick={() => openBlock(piece.blockId)}
                data-track="structure-open-block"
                data-tip={t("structure.openBlockTitle")}
                className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("structure.openBlock")}
              </button>
            )}
            {canEdit && !gone && (
              <>
                <ToolButton kind="explain" disabled={run?.streaming === true} onClick={() => runTool(piece.blockId, "explain")} />
                <ToolButton kind="simplify" disabled={run?.streaming === true} onClick={() => runTool(piece.blockId, "simplify")} />
                <button
                  onClick={() => ops.unplaceBlock(piece.blockId)}
                  data-track="piece-unplace"
                  data-tip={t("structure.pieceUnplaceTitle")}
                  className="ml-auto rounded-full px-2 py-0.5 text-[11px] text-sand-500 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("structure.pieceUnplace")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({ kind, disabled, onClick }: { kind: "explain" | "simplify"; disabled: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-track={`structure-${kind}`}
      data-tip={t(kind === "explain" ? "structure.explainTitle" : "structure.simplifyTitle")}
      className="flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
      style={{ color: annotationKindColor(kind, null) }}
    >
      <SparkleIcon size={10} />
      {t(kind === "explain" ? "reader.explain" : "reader.simplify")}
    </button>
  );
}

/** One annotation or note on the block: its kind's symbol in its kind
    color, and its words; a click opens it in the reader. */
function AnnotationLine({ blockId, annotation }: { blockId: string; annotation: PieceAnnotation }) {
  const t = useT();
  const { openBlock } = useStructure();
  const color = annotation.kind === "note" ? "var(--sand-500)" : annotationKindColor(annotation.kind, annotation.color);
  return (
    <li>
      <button
        onClick={() => openBlock(blockId, annotation.sourceId)}
        data-track="structure-open-annotation"
        data-tip={t("structure.openAnnotationTitle")}
        className="flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left text-[11.5px] leading-snug text-sand-700 hover:bg-clay-100"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <span className="mt-0.5 shrink-0" style={{ color }}>
          {annotation.kind === "note" ? <NotesIcon size={10} /> : <AnnotationKindIcon kind={annotation.kind} size={10} />}
        </span>
        <span className="line-clamp-2 min-w-0 flex-1">{annotation.text || kindName(annotation.kind, t)}</span>
      </button>
    </li>
  );
}

function kindName(kind: PieceAnnotation["kind"], t: ReturnType<typeof useT>): string {
  switch (kind) {
    case "highlight":
      return t("structure.kindHighlight");
    case "comment":
      return t("structure.kindComment");
    case "note":
      return t("structure.kindNote");
    case "explain":
      return t("reader.explain");
    case "simplify":
      return t("reader.simplify");
    case "analyze":
      return t("structure.kindAnalyze");
    case "visualize":
      return t("structure.kindVisualize");
    case "assistant":
      return t("structure.kindAssistant");
  }
}

function blockKindLabel(type: string, t: ReturnType<typeof useT>): string {
  switch (type) {
    case "FIGURE":
      return t("reader.coreFigure");
    case "TABLE":
      return t("reader.coreTable");
    case "EQUATION":
      return t("structure.kindEquation");
    case "CODE":
      return t("structure.kindCode");
    case "HEADING":
      return t("structure.kindHeading");
    default:
      return type.toLowerCase();
  }
}
