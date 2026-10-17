"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCollab } from "@/components/collab/collab-context";
import { PlusIcon, UndoIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { failureLine, noReason } from "@/components/assistant/failure";
import { splitStreamError, splitStreamNote } from "@/lib/derive/config";
import {
  BUCKET_GAP,
  BUCKET_WIDTH,
  emptyStructure,
  newId,
  pieceHash,
  piecePreview,
  readStructure,
  tidy,
  type BucketHue,
  type Structure,
  type StructureBody,
  type StructureEnd,
} from "@/lib/structure";
import {
  StructureProvider,
  type PieceAnnotation,
  type PieceToolRun,
  type StructureBlock,
  type StructureContextValue,
  type StructureOps,
} from "@/components/structure/structure-context";
import { StructureBox } from "@/components/structure/structure-box";
import { UnsortedTray } from "@/components/structure/unsorted-tray";

// reactflow loads only when the structure opens — the workspace bundle
// stays lean (the graph does the same).
const StructureCanvas = dynamic(() => import("@/components/structure/structure-canvas"), {
  ssr: false,
  loading: () => null,
});

// Breakwork (SPEC.md §32): the full-screen overlay over the reader. The
// document's blocks sorted into buckets on a canvas; the structure
// assistant on the left; the unsorted blocks on the right. This component
// owns the structure: it loads it, applies every change the parts ask for,
// keeps an undo stack, and saves a moment after each change. A save names
// the rev it was built on; a 409 means another editor saved first, so the
// server's copy replaces this one and the reader makes the change again.

const SAVE_DELAY_MS = 500;
const UNDO_MAX = 50;
// The blocks a structure sorts: text, never a page marker or the video block.
const NEVER = new Set(["PAGE", "VIDEO"]);

export function StructureOverlay({
  notebookId,
  documentId,
  title,
  blocks,
  annotationsByBlock,
  onClose,
  onOpenBlock,
}: {
  notebookId: string;
  documentId: string;
  title: string;
  blocks: StructureBlock[];
  annotationsByBlock: Record<string, PieceAnnotation[]>;
  onClose: () => void;
  /** Jumps to the block in the reader (the overlay closes first); with a
      source id, opens that annotation's card. */
  onOpenBlock: (blockId: string, sourceId?: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedConnectionId, selectConnection] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ blockId: string } | null>(null);
  const [toolRuns, setToolRuns] = useState<Record<string, PieceToolRun>>({});
  const undoStack = useRef<StructureBody[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const structureRef = useRef<Structure | null>(null);
  structureRef.current = structure;
  const dirty = useRef(false);

  const sortable = useMemo(() => blocks.filter((b) => !NEVER.has(b.type) && b.text.trim() !== ""), [blocks]);
  const blockMap = useMemo(() => new Map(sortable.map((b) => [b.id, b])), [sortable]);
  const blockOrder = useMemo(() => sortable.map((b) => b.id), [sortable]);

  // Load.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/notebooks/${notebookId}/documents/${documentId}/structure`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { structure?: unknown; error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? t("common.requestFailedStatus", { status: res.status }));
        if (!cancelled) setStructure(readStructure(body?.structure));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("common.requestFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, documentId, t]);

  // Save: a moment after the last change, the whole structure, against the
  // rev it was built on.
  const save = useCallback(async () => {
    const current = structureRef.current;
    if (!current || !canEdit) return;
    dirty.current = false;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/documents/${documentId}/structure`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRev: current.rev,
          buckets: current.buckets,
          pieces: current.pieces,
          connections: current.connections,
        }),
      });
      const body = (await res.json().catch(() => null)) as { structure?: unknown; error?: string } | null;
      if (res.status === 409) {
        const server = readStructure(body?.structure);
        undoStack.current = [];
        setUndoDepth(0);
        setStructure(server);
        setNotice(body?.error ?? t("api.structureStale"));
        setSaveState("saved");
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? t("common.requestFailedStatus", { status: res.status }));
      const saved = readStructure(body?.structure);
      // The rev moves on; the buckets stay this page's, which may have
      // changed again since the request left.
      setStructure((s) => (s ? { ...s, rev: saved.rev } : s));
      setSaveState(dirty.current ? "saving" : "saved");
      if (dirty.current) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
      }
    } catch (err) {
      setSaveState("failed");
      setNotice(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }, [notebookId, documentId, canEdit, t]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  // Leaving: a pending save goes at once.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (dirty.current) void save();
      }
    },
    [save],
  );

  /** One change: the structure before it goes on the undo stack. */
  const change = useCallback(
    (update: (s: StructureBody) => StructureBody) => {
      if (!canEdit) return;
      setStructure((current) => {
        if (!current) return current;
        const { v, rev, ...body } = current;
        undoStack.current = [...undoStack.current.slice(-(UNDO_MAX - 1)), body];
        setUndoDepth(undoStack.current.length);
        return { v, rev, ...tidy(update(body)) };
      });
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setUndoDepth(undoStack.current.length);
    setStructure((current) => (current ? { v: current.v, rev: current.rev, ...previous } : current));
    scheduleSave();
  }, [scheduleSave]);

  const ops = useMemo<StructureOps>(() => {
    const pieceOf = (blockId: string) => {
      const block = blockMap.get(blockId);
      return block ? { hash: pieceHash(block.text), preview: piecePreview(block.text) } : null;
    };
    return {
      addBucket: (parentId, title = "") => {
        let id = "";
        change((s) => {
          id = newId("b", new Set(s.buckets.map((b) => b.id)));
          const siblings = s.buckets.filter((b) => b.parentId === parentId);
          // A new top bucket lands to the right of the rightmost one.
          const tops = s.buckets.filter((b) => !b.parentId);
          const x = parentId ? 0 : tops.length === 0 ? 0 : Math.max(...tops.map((b) => b.x)) + BUCKET_WIDTH + BUCKET_GAP;
          return {
            ...s,
            buckets: [
              ...s.buckets,
              { id, title, description: "", parentId, x, y: 0, color: null, order: siblings.length },
            ],
          };
        });
        return id;
      },
      renameBucket: (id, title) =>
        change((s) => ({ ...s, buckets: s.buckets.map((b) => (b.id === id ? { ...b, title } : b)) })),
      describeBucket: (id, description) =>
        change((s) => ({ ...s, buckets: s.buckets.map((b) => (b.id === id ? { ...b, description } : b)) })),
      colorBucket: (id, color: BucketHue | null) =>
        change((s) => ({ ...s, buckets: s.buckets.map((b) => (b.id === id ? { ...b, color } : b)) })),
      removeBucket: (id) =>
        change((s) => {
          // The buckets inside it go with it; their blocks become unsorted.
          const gone = new Set<string>([id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const b of s.buckets) {
              if (b.parentId && gone.has(b.parentId) && !gone.has(b.id)) {
                gone.add(b.id);
                grew = true;
              }
            }
          }
          return {
            buckets: s.buckets.filter((b) => !gone.has(b.id)),
            pieces: s.pieces.filter((p) => !gone.has(p.bucketId)),
            connections: s.connections,
          };
        }),
      nestBucket: (id, parentId) =>
        change((s) => {
          const siblings = s.buckets.filter((b) => b.parentId === parentId && b.id !== id);
          const tops = s.buckets.filter((b) => !b.parentId && b.id !== id);
          const x = parentId ? 0 : tops.length === 0 ? 0 : Math.max(...tops.map((b) => b.x)) + BUCKET_WIDTH + BUCKET_GAP;
          return {
            ...s,
            buckets: s.buckets.map((b) =>
              b.id === id ? { ...b, parentId, order: siblings.length, ...(parentId ? {} : { x, y: 0 }) } : b,
            ),
          };
        }),
      moveBucket: (id, x, y) =>
        change((s) => ({ ...s, buckets: s.buckets.map((b) => (b.id === id ? { ...b, x, y } : b)) })),
      placeBlock: (blockId, bucketId, index) =>
        change((s) => {
          const fresh = pieceOf(blockId);
          const existing = s.pieces.find((p) => p.blockId === blockId);
          if (!fresh && !existing) return s;
          const others = s.pieces.filter((p) => p.blockId !== blockId);
          const inBucket = others.filter((p) => p.bucketId === bucketId).sort((a, b) => a.order - b.order);
          const at = index === undefined ? inBucket.length : Math.max(0, Math.min(index, inBucket.length));
          const piece = {
            blockId,
            hash: existing?.hash ?? fresh!.hash,
            preview: existing?.preview ?? fresh!.preview,
            label: existing?.label ?? "",
            bucketId,
            order: at,
          };
          inBucket.splice(at, 0, piece);
          const reordered = inBucket.map((p, i) => ({ ...p, order: i }));
          return { ...s, pieces: [...others.filter((p) => p.bucketId !== bucketId), ...reordered] };
        }),
      unplaceBlock: (blockId) => change((s) => ({ ...s, pieces: s.pieces.filter((p) => p.blockId !== blockId) })),
      labelPiece: (blockId, label) =>
        change((s) => ({ ...s, pieces: s.pieces.map((p) => (p.blockId === blockId ? { ...p, label } : p)) })),
      connect: (from: StructureEnd, to: StructureEnd) => {
        if (from.kind === to.kind && from.id === to.id) return null;
        let id: string | null = null;
        change((s) => {
          const same = s.connections.find(
            (c) =>
              (c.from.kind === from.kind && c.from.id === from.id && c.to.kind === to.kind && c.to.id === to.id) ||
              (c.from.kind === to.kind && c.from.id === to.id && c.to.kind === from.kind && c.to.id === from.id),
          );
          if (same) {
            id = same.id;
            return s;
          }
          id = newId("c", new Set(s.connections.map((c) => c.id)));
          return { ...s, connections: [...s.connections, { id, from, to, label: "", comment: "", byAssistant: false }] };
        });
        return id;
      },
      updateConnection: (id, patch) =>
        change((s) => ({ ...s, connections: s.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeConnection: (id) => change((s) => ({ ...s, connections: s.connections.filter((c) => c.id !== id) })),
    };
  }, [change, blockMap]);

  /** The assistant's proposal, applied whole (one undo step). */
  const applyProposal = useCallback(
    (proposed: StructureBody) => {
      change(() => proposed);
    },
    [change],
  );

  const openBlock = useCallback(
    (blockId: string, sourceId?: string) => {
      onOpenBlock(blockId, sourceId);
    },
    [onOpenBlock],
  );

  // Explain or Simplify on a whole block, from the piece: the derive route
  // stores the annotation as the reader's own tool would, and the output
  // streams under the piece. The reader's marks arrive with the refresh.
  const runTool = useCallback(
    (blockId: string, kind: "explain" | "simplify") => {
      const block = blockMap.get(blockId);
      if (!block) return;
      setToolRuns((runs) => ({ ...runs, [blockId]: { kind, text: "", streaming: true, error: null } }));
      void (async () => {
        try {
          const res = await fetch("/api/derive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: kind === "explain" ? "EXPLAIN" : "SIMPLIFY",
              documentId,
              notebookId,
              anchor: { blockId, startOffset: 0, endOffset: block.text.length, quotedText: block.text },
            }),
          });
          if (!res.ok || !res.body) {
            const detail = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(detail?.error ?? noReason(res, t));
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let raw = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            raw += decoder.decode(value, { stream: true });
            const live = splitStreamNote(splitStreamError(raw).text).text;
            setToolRuns((runs) => ({ ...runs, [blockId]: { kind, text: live, streaming: true, error: null } }));
          }
          const { text: withoutError, error } = splitStreamError(raw);
          const { text } = splitStreamNote(withoutError);
          setToolRuns((runs) => ({
            ...runs,
            [blockId]: { kind, text, streaming: false, error: error ?? (text.trim() ? null : t("reader.emptyResponse")) },
          }));
          router.refresh();
        } catch (err) {
          setToolRuns((runs) => ({
            ...runs,
            [blockId]: { kind, text: "", streaming: false, error: failureLine(err, t) },
          }));
        }
      })();
    },
    [blockMap, documentId, notebookId, router, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A card or a text box closes first.
      if (selectedConnectionId) {
        selectConnection(null);
        return;
      }
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest("[data-structure-field]")) {
        document.activeElement.blur();
        return;
      }
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, selectedConnectionId]);

  // Every notice fades.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const shown = structure ?? emptyStructure();
  const placed = shown.pieces.filter((p) => blockMap.has(p.blockId)).length;

  const value: StructureContextValue = {
    structure: shown,
    blocks: blockMap,
    blockOrder,
    annotationsByBlock,
    canEdit,
    ops,
    selectedConnectionId,
    selectConnection,
    dragging,
    setDragging,
    openBlock,
    runTool,
    toolRuns,
  };

  // The overlay stands over the whole page, out of the pane's own stacking
  // context, so the tray, the rail, and the reader's cards stay under it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <StructureProvider value={value}>
      <div data-track-surface="reader" className="graph-overlay-in fixed inset-0 z-50 flex flex-col bg-paper">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3 max-md:flex-wrap">
          <span className="font-display text-[18px]">{t("structure.structure")}</span>
          <span className="min-w-0 truncate text-[13px] text-sand-600" title={title}>
            {title}
          </span>
          <span className="mr-auto shrink-0 text-[13px] text-sand-500">
            {t("structure.counts", { buckets: shown.buckets.length, placed, total: blockOrder.length })}
          </span>
          {canEdit && (
            <>
              <span className="text-[11px] text-sand-500">
                {saveState === "saving" ? t("common.saving") : saveState === "failed" ? t("structure.saveFailed") : t("common.saved")}
              </span>
              <button
                onClick={undo}
                disabled={undoDepth === 0}
                data-track="structure-undo"
                data-tip={t("structure.undoTitle")}
                className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              >
                <UndoIcon size={13} />
                {t("structure.undo")}
              </button>
              <button
                onClick={() => ops.addBucket(null)}
                data-track="structure-add-bucket"
                data-tip={t("structure.addBucketTitle")}
                className="flex items-center gap-1.5 rounded-full bg-clay px-3.5 py-1.5 text-[13px] font-semibold text-clay-fg hover:bg-clay-600"
              >
                <PlusIcon size={13} />
                {t("structure.addBucket")}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            data-track="structure-close"
            aria-label={t("common.close")}
            data-tip={t("common.close")}
            className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>
        {notice && <p className="border-b border-line px-5 py-2 text-xs text-sand-600">{notice}</p>}
        <div className="flex min-h-0 flex-1">
          <StructureBox notebookId={notebookId} documentId={documentId} onApply={applyProposal} />
          <div className="relative min-h-0 min-w-0 flex-1">
            {loadError ? (
              <p className="flex h-full items-center justify-center px-8 text-center text-sm text-red-600">{loadError}</p>
            ) : structure ? (
              <StructureCanvas />
            ) : null}
          </div>
          <UnsortedTray />
        </div>
      </div>
    </StructureProvider>,
    document.body,
  );
}
