"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SourceInput } from "@/lib/anchors/input";

type Popover = {
  anchor: Omit<SourceInput, "documentId">;
  x: number;
  y: number;
};

// Client layer over the server-rendered reader: selection capture, popover, jump-to-anchor.
export function ReaderInteractions({
  documentId,
  sectionChoices,
  children,
}: {
  documentId: string;
  sectionChoices: { id: string; label: string }[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
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
      // Clicks inside the popover must not re-capture (and must not close it).
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
          {sectionChoices.length === 0 ? (
            <p className="px-2 py-1 text-xs text-neutral-500">Add a section first.</p>
          ) : (
            <div className="flex items-center gap-1">
              <span className="px-1.5 text-xs text-neutral-500">Add to</span>
              {sectionChoices.slice(0, 4).map((s) => (
                <button
                  key={s.id}
                  disabled={busy}
                  onClick={() => void addToSection(s.id)}
                  className="rounded bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200 disabled:opacity-40 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                >
                  {s.label}
                </button>
              ))}
              {sectionChoices.length > 4 && (
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
                  {sectionChoices.slice(4).map((s) => (
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
          )}
        </div>
      )}
    </div>
  );
}
