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
  attachedDocuments,
  title,
  blocks,
  anchorHighlights,
  salienceByBlock,
  hasSalience,
  termsByBlock,
  linksByBlock,
}: {
  documentId: string;
  notebookId: string;
  sectionChoices: { id: string; label: string }[];
  attachedDocuments: { id: string; title: string }[];
  title: string;
  blocks: BlockData[];
  anchorHighlights: Record<
    string,
    { sourceId: string; start: number; end: number; color: string | null; annotation: boolean }[]
  >;
  salienceByBlock: Record<string, { start: number; end: number }[]>;
  hasSalience: boolean;
  termsByBlock: Record<string, { start: number; end: number; definition: string }[]>;
  linksByBlock: Record<
    string,
    { linkId: string; start: number; end: number; toDocumentId: string; toTitle: string }[]
  >;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  // The popover's submenus (section list, link targets) are custom lists, not
  // native selects: the popover preventDefaults mousedown to keep the text
  // selection alive, which also keeps a native select from ever opening.
  const [submenu, setSubmenu] = useState<null | "add" | "link">(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [bubble, setBubble] = useState<ExplainBubble | null>(null);
  const [busy, setBusy] = useState(false);
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const swapsRef = useRef<Record<string, string>>({});
  swapsRef.current = swaps;
  const [salienceOn, setSalienceOn] = useState(false);
  const [salienceBusy, setSalienceBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switching documents client-side keeps this component mounted. Every piece
  // of selection-scoped state references the old document's blocks — drop it,
  // or a stale anchor writes an annotation into the wrong document.
  // Adjust-during-render, same pattern as useOutline's tree reset.
  const [prevDocumentId, setPrevDocumentId] = useState(documentId);
  if (prevDocumentId !== documentId) {
    setPrevDocumentId(documentId);
    setPopover(null);
    setSubmenu(null);
    setBubble(null);
    setEditingBlockId(null);
    setCommentDraft("");
  }

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
    // A simplified block displays swapped text; offsets against it would not
    // match the stored block text. No selection tools there.
    if (swapsRef.current[blockId] !== undefined) return null;

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
    // Clamp so the pill and its submenus stay inside the pane.
    const rawX = rect.left + rect.width / 2 - containerRect.left;
    const margin = Math.min(350, containerRect.width / 2);
    return {
      anchor: { blockId, startOffset, endOffset, quotedText, prefix, suffix },
      x: Math.max(margin, Math.min(rawX, containerRect.width - margin)),
      y: rect.bottom - containerRect.top + container.scrollTop + 6,
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMouseUp = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-selection-popover]")) return;
      // A drag that started inside the comment box can end over the article —
      // that is text editing, not a new selection.
      if (document.activeElement?.closest("[data-selection-popover]")) return;
      requestAnimationFrame(() => {
        const captured = captureSelection();
        setPopover(captured);
        setSubmenu(null);
        setCommentDraft("");
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

  // Scroll to an anchor and flash it. Retries while the refreshed tree paints.
  const flashSource = useCallback((sourceId: string) => {
    const container = containerRef.current;
    if (!container) return;
    let attempts = 0;
    const tryScroll = () => {
      const el = container.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("anchor-flash");
        setTimeout(() => el.classList.remove("anchor-flash"), 2000);
      } else if (attempts++ < 10) {
        setTimeout(tryScroll, 200);
      }
    };
    tryScroll();
  }, []);

  // Source chip navigation: ?src=<sourceId> scrolls to the anchor and flashes it.
  const src = searchParams.get("src");
  useEffect(() => {
    if (src) flashSource(src);
  }, [src, flashSource]);

  // Jump from the Annotations panel: works even when ?src is already this anchor.
  useEffect(() => {
    const onFlash = (e: Event) => {
      const { sourceId } = (e as CustomEvent<{ sourceId: string | null }>).detail;
      if (sourceId) flashSource(sourceId);
    };
    window.addEventListener("dissect:flash-source", onFlash);
    return () => window.removeEventListener("dissect:flash-source", onFlash);
  }, [flashSource]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Add failed");
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

  // Manual annotation: highlight (color, content = quote) or comment (user text).
  // Lands ACCEPTED in the hidden Annotations section; the anchor paints the text.
  async function annotate(input: { color?: string; comment?: string }) {
    if (!popover || busy) return;
    if (input.comment !== undefined && !input.comment.trim()) return;
    const { anchor } = popover;
    setBusy(true);
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          documentId,
          anchor,
          color: input.color,
          comment: input.comment,
        }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Annotation failed (${res.status})`);
      }
      setPopover(null);
      setSubmenu(null);
      setCommentDraft("");
      window.getSelection()?.removeAllRanges();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Annotation failed");
    } finally {
      setBusy(false);
    }
  }

  // Cross-document link: the selection becomes a hyperlink to another attached
  // document. Recorded in the edit history; heals like any other anchor.
  async function createLink(toDocumentId: string) {
    if (!popover || busy) return;
    const { anchor } = popover;
    setBusy(true);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDocumentId: documentId, toDocumentId, anchor }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Link failed (${res.status})`);
      }
      setPopover(null);
      setSubmenu(null);
      window.getSelection()?.removeAllRanges();
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Link failed");
    } finally {
      setBusy(false);
    }
  }

  // Block editing: every save lands as a TEXT_EDIT in the edit history.
  function startEdit(blockId: string) {
    setPopover(null);
    setSubmenu(null);
    setEditingBlockId(blockId);
  }

  async function saveBlockEdit(blockId: string, text: string) {
    const res = await fetch(`/api/blocks/${blockId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      showToast(detail?.error ?? `Edit failed (${res.status})`);
      return;
    }
    setEditingBlockId(null);
    router.refresh();
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

  // Merge anchor, salience, term, and link layers per block.
  const highlightsByBlock: Record<string, Highlight[]> = {};
  for (const [blockId, list] of Object.entries(anchorHighlights)) {
    highlightsByBlock[blockId] = list.map((h) => ({ ...h, kind: "anchor" as const }));
  }
  for (const [blockId, list] of Object.entries(linksByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((l) => ({
        sourceId: null,
        start: l.start,
        end: l.end,
        kind: "link" as const,
        href: `/n/${notebookId}?doc=${l.toDocumentId}`,
        linkTitle: l.toTitle,
      })),
    ];
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
  for (const [blockId, list] of Object.entries(termsByBlock)) {
    const existing = highlightsByBlock[blockId] ?? [];
    highlightsByBlock[blockId] = [
      ...existing,
      ...list.map((h) => ({
        sourceId: null,
        start: h.start,
        end: h.end,
        kind: "term" as const,
        definition: h.definition,
      })),
    ];
  }

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-4 z-10 float-right mr-4 flex items-center gap-2">
        {toast && (
          <span className="rounded-full bg-ink/90 px-3 py-1.5 text-xs text-paper">{toast}</span>
        )}
        <button
          onClick={() => void toggleSalience()}
          disabled={salienceBusy}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-soft disabled:opacity-40 ${
            salienceOn
              ? "bg-sage-200 text-sage-800"
              : "bg-sand-100 text-sand-600 hover:text-clay-800"
          }`}
          title="Toggle the salience overlay"
        >
          {salienceBusy ? "Salience…" : salienceOn ? "Salience on" : "Salience"}
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
        editingBlockId={editingBlockId}
        onStartEdit={startEdit}
        onSaveEdit={saveBlockEdit}
        onCancelEdit={() => setEditingBlockId(null)}
      />

      {popover && (
        <div
          data-selection-popover
          onMouseDown={(e) => {
            // Keep the text selection alive under the popover — but let fields
            // take focus, or the comment box could never place a caret.
            const target = e.target as HTMLElement;
            if (target.closest("textarea, input")) return;
            e.preventDefault();
          }}
          className="absolute z-20 flex -translate-x-1/2 flex-col items-center gap-1.5"
          style={{ left: popover.x, top: popover.y }}
        >
          <div className="flex items-center gap-0.5 rounded-full bg-card p-1.5 shadow-float">
            <button
              onClick={() => void explain()}
              className="rounded-full bg-clay px-4 py-[7px] text-[13px] font-semibold text-clay-fg hover:bg-clay-600"
            >
              Explain
            </button>
            <button
              onClick={() => void simplify()}
              className="rounded-full px-[13px] py-[7px] text-[13px] text-sand-800 hover:bg-clay-100 hover:text-clay-800"
            >
              Simplify
            </button>
            <button
              onClick={() => void extract()}
              disabled={busy}
              className="rounded-full px-[13px] py-[7px] text-[13px] text-sand-800 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
            >
              Extract
            </button>
            {sectionChoices.length > 0 && (
              <button
                disabled={busy}
                onClick={() => setSubmenu(submenu === "add" ? null : "add")}
                aria-expanded={submenu === "add"}
                className={`rounded-full px-[13px] py-[7px] text-[13px] disabled:opacity-40 ${
                  submenu === "add"
                    ? "bg-clay-100 text-clay-800"
                    : "text-sand-800 hover:bg-clay-100 hover:text-clay-800"
                }`}
                title="Add the selection to a section as a manual note"
              >
                Add to ▾
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => setSubmenu(submenu === "link" ? null : "link")}
              aria-expanded={submenu === "link"}
              className={`rounded-full px-[13px] py-[7px] text-[13px] disabled:opacity-40 ${
                submenu === "link"
                  ? "bg-clay-100 text-clay-800"
                  : "text-sand-800 hover:bg-clay-100 hover:text-clay-800"
              }`}
              title="Link this passage to another document"
            >
              Link ▾
            </button>
            <button
              onClick={() => setPopover(null)}
              className="flex size-[30px] items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
              aria-label="Close"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          <div className="flex w-full items-center gap-1.5">
            <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-card p-2 shadow-float">
              {(["clay", "sage", "gold", "plum"] as const).map((color) => (
                <button
                  key={color}
                  disabled={busy}
                  onClick={() =>
                    void annotate({ color, comment: commentDraft.trim() || undefined })
                  }
                  aria-label={`Highlight in ${color}`}
                  title={`Highlight in ${color}${commentDraft.trim() ? " with your note" : ""}`}
                  className="size-[22px] rounded-full transition-transform hover:scale-110 disabled:opacity-40"
                  style={{
                    background:
                      color === "clay"
                        ? "var(--clay-400)"
                        : color === "sage"
                          ? "var(--sage-500)"
                          : color === "gold"
                            ? "#d9a54a"
                            : "#a78bfa",
                  }}
                />
              ))}
            </div>
            <form
              className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-card p-1.5 shadow-float"
              onSubmit={(e) => {
                e.preventDefault();
                if (commentDraft.trim()) void annotate({ comment: commentDraft });
              }}
            >
              <input
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Comment…"
                aria-label="Comment on this passage"
                className="w-40 min-w-0 flex-1 bg-transparent px-2.5 text-[13px] outline-none placeholder:text-sand-500"
              />
              <button
                type="submit"
                disabled={busy || !commentDraft.trim()}
                className="rounded-full bg-clay px-3.5 py-[5px] text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                Save
              </button>
            </form>
          </div>

          {submenu === "add" && (
            <div className="flex max-h-60 w-64 flex-col overflow-y-auto rounded-2xl bg-card py-1 shadow-float">
              {sectionChoices.map((s) => (
                <button
                  key={s.id}
                  disabled={busy}
                  onClick={() => void addToSection(s.id)}
                  className="truncate px-4 py-2 text-left text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {submenu === "link" && (
            <div className="flex max-h-60 w-64 flex-col overflow-y-auto rounded-2xl bg-card py-1 shadow-float">
              {attachedDocuments.filter((d) => d.id !== documentId).length === 0 ? (
                <p className="px-4 py-2 text-[13px] text-sand-600">
                  Attach another document to link to it.
                </p>
              ) : (
                attachedDocuments
                  .filter((d) => d.id !== documentId)
                  .map((d) => (
                    <button
                      key={d.id}
                      disabled={busy}
                      onClick={() => void createLink(d.id)}
                      className="truncate px-4 py-2 text-left text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                    >
                      {d.title}
                    </button>
                  ))
              )}
            </div>
          )}
        </div>
      )}

      {bubble && (
        <div
          data-selection-popover
          className="absolute z-20 w-96 max-w-[85%] -translate-x-1/2 rounded-[24px] bg-card p-4 shadow-float"
          style={{ left: bubble.x, top: bubble.y }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
              {bubble.streaming ? "Explaining…" : "Explanation"}
            </span>
            <button
              onClick={() => setBubble(null)}
              className="text-xs text-sand-500 hover:text-clay-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {bubble.error ? (
            <p className="text-sm text-red-600">{bubble.error}</p>
          ) : bubble.text ? (
            <div className="max-h-80 overflow-y-auto text-sm">
              <Markdown>{bubble.text}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-sand-500">…</p>
          )}
        </div>
      )}
    </div>
  );
}
