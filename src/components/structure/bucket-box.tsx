"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Handle, Position } from "reactflow";
import { MoreIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { BUCKET_HUES, BUCKET_WIDTH, bucketPieces, childBuckets, type BucketHue } from "@/lib/structure";
import { PieceRow } from "@/components/structure/piece-row";
import { BUCKET_HUE_VAR, handleId, isOpenConnectionEnd, PIECE_DRAG_TYPE, useStructure } from "@/components/structure/structure-context";

// One bucket (SPEC.md §32): its header — the title, the description, the
// hue bar, the menu — then its pieces in order, then the buckets inside it.
// The header is what drags the node on the canvas (.bucket-drag). A piece
// dragged over the body shows a drop line where it would land; a drop
// places it there. A bucket inside a bucket draws the same, smaller.

const MAX_BODY = 560;

export function BucketBox({ bucketId, depth }: { bucketId: string; depth: number }) {
  const t = useT();
  const { structure, canEdit, ops, dragging, setDragging, selectedConnectionId } = useStructure();
  const bucket = structure.buckets.find((b) => b.id === bucketId);
  const pieces = bucketPieces(structure, bucketId);
  const children = childBuckets(structure, bucketId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // A new bucket opens with its title box ready.
  const [editingTitle, setEditingTitle] = useState(() => Boolean(bucket && bucket.title === "" && canEdit));
  const [editingDescription, setEditingDescription] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // reactflow draws a node hidden until it has measured it, and a hidden
  // box takes no focus: the focus waits a beat.
  useEffect(() => {
    if (!editingTitle) return;
    const timer = setTimeout(() => titleRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [editingTitle]);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (!bucket) return null;
  const hue = bucket.color ? BUCKET_HUE_VAR[bucket.color] : null;
  const end = { kind: "bucket" as const, id: bucketId };
  // An end of the open connection: the ring says what its curve joins.
  const joined = isOpenConnectionEnd(structure, selectedConnectionId, end);

  // Where a dragged piece lands: before the row the pointer is over the top
  // half of, else after it.
  function indexAt(e: DragEvent): number {
    const list = listRef.current;
    if (!list) return pieces.length;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-piece-row]")];
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) return i;
    }
    return rows.length;
  }
  function onDragOver(e: DragEvent) {
    if (!canEdit || !dragging) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(indexAt(e));
  }
  function onDrop(e: DragEvent) {
    if (!canEdit || !dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const blockId = e.dataTransfer.getData(PIECE_DRAG_TYPE) || dragging.blockId;
    let index = indexAt(e);
    // A piece moved down its own bucket lands one row earlier than counted,
    // since its own row leaves the list.
    const own = pieces.findIndex((p) => p.blockId === blockId);
    if (own !== -1 && own < index) index -= 1;
    ops.placeBlock(blockId, bucketId, index);
    setDropIndex(null);
    setDragging(null);
  }

  const parentChoices = structure.buckets.filter((b) => b.id !== bucketId && !isInside(structure.buckets, b.id, bucketId));

  return (
    <div
      className={`structure-bucket flex flex-col rounded-[18px] border bg-card shadow-float ${
        dropIndex !== null || joined ? "border-clay ring-2 ring-clay/30" : "border-line"
      }`}
      style={{ width: depth === 0 ? BUCKET_WIDTH : undefined }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
      }}
      onDrop={onDrop}
    >
      <div className={`bucket-drag relative flex items-start gap-2 rounded-t-[18px] px-3.5 pt-3 pb-2 ${canEdit && depth === 0 ? "cursor-grab active:cursor-grabbing" : ""}`}>
        <Handle type="target" position={Position.Left} id={handleId("l", end)} className="structure-handle" style={{ top: 18 }} />
        <Handle type="source" position={Position.Right} id={handleId("r", end)} className="structure-handle" style={{ top: 18 }} />
        <span className="mt-1 h-4 w-1.5 shrink-0 rounded-full" style={{ background: hue ?? "var(--sand-300)" }} aria-hidden />
        <div className="min-w-0 flex-1">
          {editingTitle && canEdit ? (
            <input
              ref={titleRef}
              data-structure-field
              defaultValue={bucket.title}
              placeholder={t("structure.bucketTitlePlaceholder")}
              aria-label={t("structure.bucketTitle")}
              onBlur={(e) => {
                ops.renameBucket(bucketId, e.target.value.trim());
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="nodrag w-full rounded-lg bg-sand-100 px-2 py-0.5 font-display text-[15px] outline-none"
            />
          ) : (
            <button
              onClick={() => canEdit && setEditingTitle(true)}
              data-track="bucket-rename"
              data-tip={canEdit ? t("structure.bucketRenameTitle") : undefined}
              className="nodrag block w-full truncate text-left font-display text-[15px] leading-tight hover:text-clay-800"
            >
              {bucket.title || <span className="text-sand-500">{t("structure.bucketUntitled")}</span>}
            </button>
          )}
          {editingDescription && canEdit ? (
            <textarea
              data-structure-field
              autoFocus
              defaultValue={bucket.description}
              placeholder={t("structure.bucketDescriptionPlaceholder")}
              aria-label={t("structure.bucketDescription")}
              rows={2}
              onBlur={(e) => {
                ops.describeBucket(bucketId, e.target.value.trim());
                setEditingDescription(false);
              }}
              className="nodrag mt-1 w-full resize-none rounded-lg bg-sand-100 px-2 py-1 text-[12px] outline-none"
            />
          ) : (
            (bucket.description || canEdit) && (
              <button
                onClick={() => canEdit && setEditingDescription(true)}
                data-track="bucket-describe"
                className="nodrag mt-0.5 block w-full text-left text-[12px] leading-snug text-sand-600 hover:text-clay-800"
              >
                {bucket.description || <span className="text-sand-400">{t("structure.bucketDescriptionPlaceholder")}</span>}
              </button>
            )
          )}
        </div>
        <span className="mt-0.5 shrink-0 rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">{pieces.length}</span>
        {canEdit && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              data-track="bucket-menu"
              aria-label={t("structure.bucketMenu")}
              data-tip={t("structure.bucketMenu")}
              className="nodrag flex size-6 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
            >
              <MoreIcon size={13} />
            </button>
            {menuOpen && (
              <div className="nodrag nopan menu-in absolute top-full right-0 z-20 mt-1 flex w-[220px] flex-col gap-0.5 rounded-2xl border border-line bg-card p-1.5 shadow-float">
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <span className="mr-auto text-[11px] text-sand-500">{t("structure.bucketColor")}</span>
                  {BUCKET_HUES.map((h) => (
                    <button
                      key={h}
                      onClick={() => ops.colorBucket(bucketId, bucket.color === h ? null : (h as BucketHue))}
                      data-track={`bucket-color:${h}`}
                      aria-label={h}
                      className={`size-4 rounded-full border-2 ${bucket.color === h ? "border-ink" : "border-transparent"}`}
                      style={{ background: BUCKET_HUE_VAR[h] }}
                    />
                  ))}
                </div>
                <MenuButton
                  onClick={() => {
                    ops.addBucket(bucketId);
                    setMenuOpen(false);
                  }}
                  track="bucket-add-inside"
                  label={t("structure.bucketAddInside")}
                />
                {parentChoices.length > 0 && (
                  <label className="flex flex-col gap-0.5 px-2 py-1 text-[11px] text-sand-500">
                    {t("structure.bucketPutInside")}
                    <select
                      value={bucket.parentId ?? ""}
                      onChange={(e) => {
                        ops.nestBucket(bucketId, e.target.value || null);
                        setMenuOpen(false);
                      }}
                      className="rounded-lg bg-sand-100 px-2 py-1 text-[12px] text-ink outline-none"
                    >
                      <option value="">{t("structure.bucketOnCanvas")}</option>
                      {parentChoices.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title || t("structure.bucketUntitled")}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {pieces.length > 0 && (
                  <MenuButton
                    onClick={() => {
                      for (const p of pieces) ops.unplaceBlock(p.blockId);
                      setMenuOpen(false);
                    }}
                    track="bucket-empty"
                    label={t("structure.bucketEmpty")}
                  />
                )}
                <MenuButton
                  onClick={() => {
                    setMenuOpen(false);
                    ops.removeBucket(bucketId);
                  }}
                  track="bucket-remove"
                  label={t("structure.bucketRemove")}
                  icon={<TrashIcon size={11} />}
                  danger
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div
        ref={listRef}
        className="nowheel flex flex-col gap-1 overflow-y-auto px-2 pb-2"
        style={{ maxHeight: depth === 0 ? MAX_BODY : undefined }}
      >
        {pieces.length === 0 && children.length === 0 && (
          <p className={`rounded-xl border border-dashed px-3 py-3 text-center text-[11.5px] ${dropIndex !== null ? "border-clay text-clay-800" : "border-line text-sand-500"}`}>
            {t(canEdit ? "structure.bucketEmptyHint" : "structure.bucketEmptyViewer")}
          </p>
        )}
        {pieces.map((p, i) => (
          <div key={p.blockId} className="relative">
            {dropIndex === i && <DropLine />}
            <PieceRow piece={p} />
          </div>
        ))}
        {dropIndex === pieces.length && pieces.length > 0 && (
          <div className="relative h-1">
            <DropLine />
          </div>
        )}
        {children.length > 0 && (
          <div className="mt-1 flex flex-col gap-2 pl-2">
            {children.map((c) => (
              <BucketBox key={c.id} bucketId={c.id} depth={depth + 1} />
            ))}
          </div>
        )}
        {canEdit && depth === 0 && children.length === 0 && pieces.length > 0 && (
          <button
            onClick={() => ops.addBucket(bucketId)}
            data-track="bucket-add-inside"
            className="nodrag mt-0.5 flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-[11px] text-sand-500 hover:bg-clay-100 hover:text-clay-800"
          >
            <PlusIcon size={10} />
            {t("structure.bucketAddInside")}
          </button>
        )}
      </div>
    </div>
  );
}

function DropLine() {
  return <span aria-hidden className="pointer-events-none absolute inset-x-1 -top-[3px] z-10 h-[3px] rounded-full bg-clay" />;
}

function MenuButton({ onClick, track, label, icon, danger }: { onClick: () => void; track: string; label: string; icon?: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      data-track={track}
      className={`flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-[12px] hover:bg-clay-100 hover:text-clay-800 ${danger ? "text-red-600" : "text-sand-700"}`}
    >
      {icon}
      {label}
    </button>
  );
}

/** True when `id` sits inside `ancestorId`, at any depth. */
function isInside(buckets: { id: string; parentId: string | null }[], id: string, ancestorId: string): boolean {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  let p = byId.get(id)?.parentId ?? null;
  for (let i = 0; p && i < buckets.length; i++) {
    if (p === ancestorId) return true;
    p = byId.get(p)?.parentId ?? null;
  }
  return false;
}
