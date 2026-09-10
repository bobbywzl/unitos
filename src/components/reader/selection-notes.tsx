"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "@/components/lang-provider";

// Add to notes from a surface that is not the article (SPEC.md §6): the
// distilled page, the extract page, the corpus extract page. Highlighting text
// there shows one pill — Add to notes — and the selection lands as a pending
// note, with the anchor of the point or the quote it was highlighted inside.
//
// The article has its own selection popover (reader-interactions.tsx), which
// skips every surface marked data-selection-popover; these surfaces are those,
// and this is what they offer instead.

/** The quote or point the selection sits inside: the element carrying
    data-quote-key. Null when the selection is elsewhere on the page. */
function quoteKeyAt(range: Range): string | null {
  const node = range.startContainer;
  const start = node instanceof Element ? node : node.parentElement;
  return start?.closest<HTMLElement>("[data-quote-key]")?.dataset.quoteKey ?? null;
}

export function SelectionNotes({
  surface,
  canAdd,
  hint,
  onAdd,
}: {
  /** The surface the selection has to be inside. */
  surface: RefObject<HTMLElement | null>;
  canAdd: boolean;
  /** The pill's tooltip: which section the note lands in. */
  hint: string;
  /** The highlighted text and the key of the quote or point it sits inside. */
  onAdd: (text: string, quoteKey: string | null) => Promise<boolean>;
}) {
  const t = useT();
  const [pick, setPick] = useState<{
    text: string;
    quoteKey: string | null;
    left: number;
    top: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest("[data-selection-notes]")) return;
      setPick(null);
    };
    const onUp = (e: PointerEvent) => {
      if ((e.target as Element).closest("[data-selection-notes]")) return;
      // The selection settles after the release.
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (!selection || selection.rangeCount === 0 || text === "") {
          setPick(null);
          return;
        }
        const range = selection.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) {
          setPick(null);
          return;
        }
        const rects = range.getClientRects();
        const last = rects[rects.length - 1];
        if (!last) {
          setPick(null);
          return;
        }
        setAdded(false);
        setPick({ text, quoteKey: quoteKeyAt(range), left: last.right, top: last.bottom });
      });
    };
    const onScroll = () => setPick(null);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("scroll", onScroll);
    };
  }, [surface]);

  if (!pick || !canAdd) return null;

  async function add() {
    if (!pick || saving) return;
    setSaving(true);
    const ok = await onAdd(pick.text, pick.quoteKey);
    setSaving(false);
    if (!ok) return;
    setAdded(true);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => setPick(null), 1200);
  }

  return (
    <div
      ref={pillRef}
      data-selection-notes
      style={{
        left: Math.min(Math.max(12, pick.left), window.innerWidth - 160),
        top: Math.min(pick.top + 8, window.innerHeight - 48),
      }}
      className="fixed z-40 flex items-center gap-2 rounded-full bg-card px-1.5 py-1.5 shadow-float"
    >
      {added ? (
        <span className="px-2 text-[11.5px] font-semibold text-sage-700">
          {t("panes.addedPendingInNotes")}
        </span>
      ) : (
        <button
          onClick={() => void add()}
          data-track="selection-add-to-notes"
          data-tip={hint}
          disabled={saving}
          className="rounded-full bg-clay px-3 py-1 text-[11.5px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {saving ? t("panes.adding") : t("panes.addToNotes")}
        </button>
      )}
    </div>
  );
}

/** A click on the words: a jump, unless the reader was highlighting them —
    the quotes and points on these pages are selectable, and a click that ends
    a selection belongs to the selection (SPEC.md §6). */
export function jumpUnlessSelecting(e: React.MouseEvent, run: () => void) {
  if ((window.getSelection()?.toString() ?? "").trim() !== "") return;
  run();
}
