"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SourceInput } from "@/lib/anchors/input";
import { Markdown } from "@/components/markdown";

type Anchor = Omit<SourceInput, "documentId">;
type Popover = { anchor: Anchor; x: number; y: number };
type ExplainBubble = {
  x: number;
  y: number;
  text: string;
  streaming: boolean;
  error: string | null;
};

// Client layer over the server-rendered reader: selection capture, popover,
// EXPLAIN streaming bubble, jump-to-anchor.
export function ReaderInteractions({
  documentId,
  notebookId,
  sectionChoices,
  children,
}: {
  documentId: string;
  notebookId: string;
  sectionChoices: { id: string; label: string }[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [bubble, setBubble] = useState<ExplainBubble | null>(null);
  const [busy, setBusy] = useState(false);

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

    // Offset of the range start within the block's text content.
    const preRange = document.createRange();
    preRange.selectNodeContents(startBlock);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;

    // Clamp the selection to the start block (one anchor = one block).
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
      // Clicks inside the popover or bubble must not re-capture (and must not close them).
      if (event.target instanceof Element && event.target.closest("[data-selection-popover]")) return;
      // Let the browser finish adjusting the selection first.
      requestAnimationFrame(() => setPopover(captureSelection()));
    };
    container.addEventListener("mouseup", onMouseUp);
    return () => container.removeEventListener("mouseup", onMouseUp);
  }, [captureSelection]);

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
        body: JSON.stringify({
          type: "EXPLAIN",
          documentId,
          notebookId,
          anchor: {
            blockId: anchor.blockId,
            startOffset: anchor.startOffset,
            endOffset: anchor.endOffset,
          },
        }),
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

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-y-auto">
      {children}

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
            {sectionChoices.length > 0 && (
              <>
                <span className="px-1 text-xs text-neutral-500">Add to</span>
                {sectionChoices.slice(0, 3).map((s) => (
                  <button
                    key={s.id}
                    disabled={busy}
                    onClick={() => void addToSection(s.id)}
                    className="rounded bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200 disabled:opacity-40 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  >
                    {s.label}
                  </button>
                ))}
                {sectionChoices.length > 3 && (
                  <select
                    disabled={busy}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void addToSection(e.target.value);
                    }}
                    className="rounded bg-neutral-100 px-1 py-1 text-xs dark:bg-neutral-800"
                  >
                    <option value="" disabled>
                      more…
                    </option>
                    {sectionChoices.slice(3).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
              </>
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
