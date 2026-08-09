"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SourceInput } from "@/lib/anchors/input";
import { Markdown } from "@/components/markdown";
import type { BlockData, Highlight } from "@/components/reader/block-view";
import { Reader } from "@/components/reader/reader";

type Anchor = Omit<SourceInput, "documentId">;
type Popover = { anchor: Anchor; x: number; y: number };
type ExplainBubble = {
  x: number;
  y: number;
  text: string;
  streaming: boolean;
  error: string | null;
};

// Client layer over the reader: selection capture, popover, EXPLAIN bubble,
// SIMPLIFY in-place swaps, SALIENCE overlay toggle, EXTRACT, jump-to-anchor.
export function ReaderInteractions({
  documentId,
  notebookId,
  sectionChoices,
  title,
  blocks,
  anchorHighlights,
  salienceByBlock,
  hasSalience,
}: {
  documentId: string;
  notebookId: string;
  sectionChoices: { id: string; label: string }[];
  title: string;
  blocks: BlockData[];
  anchorHighlights: Record<string, { sourceId: string; start: number; end: number }[]>;
  salienceByBlock: Record<string, { start: number; end: number }[]>;
  hasSalience: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [bubble, setBubble] = useState<ExplainBubble | null>(null);
  const [busy, setBusy] = useState(false);
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [salienceOn, setSalienceOn] = useState(false);
  const [salienceBusy, setSalienceBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Selection → block-relative offsets via data-block-id (SPEC.md §5). DOM ranges are never persisted.
  const captureSelection = useCallback((): Popover | null => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;

    const blockOf = (node: Node): HTMLElement | null => {
      const el = node instanceof HTMLElement ? node : node.parentElement;
      return el?.closest("[data-block-id]") ?? null;
    };
    const startBlock = blockOf(range.startContainer);
    if (!startBlock) return null;
    const blockId = startBlock.dataset.blockId;
    if (!blockId) return null;

    const preRange = document.createRange();
    preRange.selectNodeContents(startBlock);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;

    const inBlockRange = document.createRange();
    inBlockRange.selectNodeContents(startBlock);
    inBlockRange.setStart(range.startContainer, range.startOffset);
    if (startBlock.contains(range.endContainer)) {
      inBlockRange.setEnd(range.endContainer, range.endOffset);
    }
    const quotedText = inBlockRange.toString();
    if (!quotedText.trim()) return null;
    const endOffset = startOffset + quotedText.length;

    const blockText = startBlock.textContent ?? "";
    const prefix = blockText.slice(Math.max(0, startOffset - 32), startOffset);
    const suffix = blockText.slice(endOffset, endOffset + 32);

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      anchor: { blockId, startOffset, endOffset, quotedText, prefix, suffix },
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.bottom - containerRect.top + container.scrollTop + 6,
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMouseUp = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-selection-popover]")) return;
      requestAnimationFrame(() => {
        const captured = captureSelection();
        setPopover(captured);
        if (captured) {
          // The assistant panel's Selection scope tracks the latest selection.
          window.dispatchEvent(
            new CustomEvent("dissect:selection", {
              detail: { documentId, ...captured.anchor },
            }),
          );
        }
      });
    };
    container.addEventListener("mouseup", onMouseUp);
    return () => container.removeEventListener("mouseup", onMouseUp);
  }, [captureSelection, documentId]);

  // Source chip navigation: ?src=<sourceId> scrolls to the anchor and flashes it.
  const src = searchParams.get("src");
  useEffect(() => {
    if (!src) return;
    const container = containerRef.current;
    if (!container) return;
    let attempts = 0;
    const tryScroll = () => {
      const el = container.querySelector<HTMLElement>(`[data-source-id="${src}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("anchor-flash");
        setTimeout(() => el.classList.remove("anchor-flash"), 2000);
      } else if (attempts++ < 10) {
        setTimeout(tryScroll, 200);
      }
    };
    tryScroll();
  }, [src]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }

  async function addToSection(sectionId: string) {
    if (!popover || busy) return;
    setBusy(true);
    try {
      await api("/api/notes", "POST", {
        sectionId,
        content: popover.anchor.quotedText,
        source: { documentId, ...popover.anchor },
      });
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function deriveBody(type: string, anchor: Anchor) {
    return JSON.stringify({
      type,
      documentId,
      notebookId,
      anchor: {
        blockId: anchor.blockId,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
      },
    });
  }

  // EXPLAIN: stream into an annotation bubble at the selection (SPEC.md §4).
  async function explain() {
    if (!popover || busy) return;
    const { anchor, x, y } = popover;
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    setBubble({ x, y, text: "", streaming: true, error: null });
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: deriveBody("EXPLAIN", anchor),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Derive failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setBubble((b) => (b ? { ...b, text: b.text + chunk } : b));
      }
      setBubble((b) => (b ? { ...b, streaming: false } : b));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Derive failed";
      setBubble((b) => (b ? { ...b, streaming: false, error: message } : b));
    }
  }

  // SIMPLIFY: swap the block in place, streaming. Ephemeral; click the block to revert (SPEC.md §6).
  async function simplify() {
    if (!popover || busy) return;
    const { anchor } = popover;
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    setSwaps((s) => ({ ...s, [anchor.blockId]: "" }));
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: deriveBody("SIMPLIFY", anchor),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Derive failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setSwaps((s) => ({ ...s, [anchor.blockId]: (s[anchor.blockId] ?? "") + chunk }));
      }
    } catch (err) {
      setSwaps((s) => {
        const next = { ...s };
        delete next[anchor.blockId];
        return next;
      });
      showToast(err instanceof Error ? err.message : "Simplify failed");
    }
  }

  // EXTRACT: pending note in a section; AI proposes the section (SPEC.md §4).
  async function extract() {
    if (!popover || busy) return;
    if (sectionChoices.length === 0) {
      showToast("Add a section first. Extract needs a section to propose.");
      return;
    }
    const { anchor } = popover;
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    setBusy(true);
    showToast("Extracting…");
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: deriveBody("EXTRACT", anchor),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `Extract failed (${res.status})`);
      setToast(null);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  // SALIENCE: toggleable overlay, off by default; computed once per notebook+document (SPEC.md §6).
  async function toggleSalience() {
    if (salienceBusy) return;
    if (hasSalience || Object.keys(salienceByBlock).length > 0) {
      setSalienceOn(!salienceOn);
      return;
    }
    setSalienceBusy(true);
    showToast("Computing salience…");
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SALIENCE", documentId, notebookId }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `Salience failed (${res.status})`);
      setToast(null);
      setSalienceOn(true);
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Salience failed");
    } finally {
      setSalienceBusy(false);
    }
  }

  // Merge anchor and salience layers per block.
  const highlightsByBlock: Record<string, Highlight[]> = {};
  for (const [blockId, list] of Object.entries(anchorHighlights)) {
    highlightsByBlock[blockId] = list.map((h) => ({ ...h, kind: "anchor" as const }));
  }
  if (salienceOn) {
    for (const [blockId, list] of Object.entries(salienceByBlock)) {
      const existing = highlightsByBlock[blockId] ?? [];
      highlightsByBlock[blockId] = [
        ...existing,
        ...list.map((h) => ({ sourceId: null, start: h.start, end: h.end, kind: "salience" as const })),
      ];
    }
  }

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-2 z-10 float-right mr-3 flex items-center gap-2">
        {toast && (
          <span className="rounded-md bg-neutral-900/90 px-2 py-1 text-xs text-white dark:bg-white/90 dark:text-neutral-900">
            {toast}
          </span>
        )}
        <button
          onClick={() => void toggleSalience()}
          disabled={salienceBusy}
          className={`rounded-full border px-2.5 py-1 text-xs shadow-sm disabled:opacity-40 ${
            salienceOn
              ? "border-violet-400 bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300"
              : "border-neutral-300 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          }`}
          title="Toggle the salience overlay"
        >
          {salienceBusy ? "Salience…" : "Salience"}
        </button>
      </div>

      <Reader
        title={title}
        blocks={blocks}
        highlightsByBlock={highlightsByBlock}
        swaps={swaps}
        onRevertSwap={(blockId) =>
          setSwaps((s) => {
            const next = { ...s };
            delete next[blockId];
            return next;
          })
        }
      />

      {popover && (
        <div
          data-selection-popover
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-20 -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          style={{ left: popover.x, top: popover.y }}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={() => void explain()}
              className="rounded bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Explain
            </button>
            <button
              onClick={() => void simplify()}
              className="rounded bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Simplify
            </button>
            <button
              onClick={() => void extract()}
              disabled={busy}
              className="rounded bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200 disabled:opacity-40 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Extract
            </button>
            {sectionChoices.length > 0 && (
              <select
                disabled={busy}
                value=""
                onChange={(e) => {
                  if (e.target.value) void addToSection(e.target.value);
                }}
                className="rounded bg-neutral-100 px-1 py-1 text-xs dark:bg-neutral-800"
                title="Add the selection to a section as a manual note"
              >
                <option value="" disabled>
                  Add to…
                </option>
                {sectionChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => setPopover(null)}
              className="px-1.5 text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {bubble && (
        <div
          data-selection-popover
          className="absolute z-20 w-96 max-w-[85%] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50 p-3 shadow-lg dark:border-amber-800 dark:bg-neutral-900"
          style={{ left: bubble.x, top: bubble.y }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {bubble.streaming ? "Explaining…" : "Explanation"}
            </span>
            <button
              onClick={() => setBubble(null)}
              className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {bubble.error ? (
            <p className="text-sm text-red-600">{bubble.error}</p>
          ) : bubble.text ? (
            <div className="max-h-80 overflow-y-auto">
              <Markdown>{bubble.text}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-neutral-400">…</p>
          )}
        </div>
      )}
    </div>
  );
}
