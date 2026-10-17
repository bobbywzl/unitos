"use client";

import { useMemo, useState, type DragEvent } from "react";
import { SearchIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { PIECE_DRAG_TYPE, useStructure } from "@/components/structure/structure-context";

// The unsorted tray (SPEC.md §32): every block of the document not yet in
// a bucket, in reading order. A row drags into a bucket; a piece dragged
// here leaves its bucket. Find narrows the list to the blocks whose words
// match. A click on a row opens the block's whole text.

export function UnsortedTray() {
  const t = useT();
  const { structure, blocks, blockOrder, canEdit, ops, dragging, setDragging } = useStructure();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const placed = useMemo(() => new Set(structure.pieces.map((p) => p.blockId)), [structure.pieces]);
  const unsorted = useMemo(() => blockOrder.filter((id) => !placed.has(id)), [blockOrder, placed]);
  const q = query.trim().toLowerCase();
  const shown = q ? unsorted.filter((id) => blocks.get(id)!.text.toLowerCase().includes(q)) : unsorted;

  function onDragOver(e: DragEvent) {
    if (!canEdit || !dragging || !placed.has(dragging.blockId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(true);
  }
  function onDrop(e: DragEvent) {
    if (!canEdit || !dragging) return;
    e.preventDefault();
    const blockId = e.dataTransfer.getData(PIECE_DRAG_TYPE) || dragging.blockId;
    ops.unplaceBlock(blockId);
    setOver(false);
    setDragging(null);
  }

  return (
    <aside
      className={`flex w-[320px] shrink-0 flex-col border-l border-line bg-card/60 max-lg:hidden ${over ? "bg-clay-100/60" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="font-display text-[15px]">{t("structure.unsorted")}</span>
        <span className="rounded-full bg-sand-200 px-1.5 text-[11px] font-semibold tabular-nums text-sand-700">{unsorted.length}</span>
      </div>
      <p className="px-4 pb-2 text-[11px] text-sand-500">{t(canEdit ? "structure.unsortedHint" : "structure.unsortedViewer")}</p>
      <label className="mx-4 mb-2 flex items-center gap-2 rounded-full bg-sand-100 px-3 py-1.5">
        <SearchIcon size={12} className="shrink-0 text-sand-500" />
        <input
          data-structure-field
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("structure.unsortedFind")}
          aria-label={t("structure.unsortedFind")}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-sand-500"
        />
      </label>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
        {unsorted.length === 0 && <p className="px-2 py-4 text-center text-[12px] text-sand-500">{t("structure.unsortedEmpty")}</p>}
        {unsorted.length > 0 && shown.length === 0 && <p className="px-2 py-4 text-center text-[12px] text-sand-500">{t("structure.unsortedNoMatch")}</p>}
        {shown.map((id) => {
          const block = blocks.get(id)!;
          const open = openId === id;
          return (
            <div
              key={id}
              draggable={canEdit}
              onDragStart={(e) => {
                e.dataTransfer.setData(PIECE_DRAG_TYPE, id);
                e.dataTransfer.effectAllowed = "move";
                setDragging({ blockId: id });
              }}
              onDragEnd={() => setDragging(null)}
              className={`rounded-xl border bg-card px-2.5 py-1.5 ${open ? "border-line" : "border-transparent hover:border-line"} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              <button onClick={() => setOpenId(open ? null : id)} data-track="unsorted-toggle" aria-expanded={open} className="flex w-full items-start gap-2 text-left">
                <span className="mt-[3px] shrink-0 rounded-full bg-sand-200 px-1.5 text-[9.5px] font-semibold text-sand-600 uppercase">
                  {block.type === "PARAGRAPH" ? "¶" : block.type.slice(0, 3)}
                </span>
                <span className={`min-w-0 flex-1 text-[12px] leading-snug text-sand-700 ${open ? "" : "line-clamp-2"}`}>{block.text}</span>
              </button>
              {open && canEdit && structure.buckets.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {structure.buckets.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        ops.placeBlock(id, b.id);
                        setOpenId(null);
                      }}
                      data-track="unsorted-place"
                      data-tip={t("structure.unsortedPlaceTitle", { bucket: b.title || t("structure.bucketUntitled") })}
                      className="max-w-full truncate rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                    >
                      {b.title || t("structure.bucketUntitled")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
