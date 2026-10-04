"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useT } from "@/components/lang-provider";
import { PAGE_EVENT, pageStore, usePageState } from "@/components/docs/page/store";
import type { PageSetup } from "@/lib/docs/schema";

// A PDF import read pageless (SPEC.md §30). On a pane where Fit draws its
// pages small (the notes tray beside a small window, a phone), its words are
// hard to read; in Viewing the reader may read them wrapped to the pane, as
// the Pageless format draws a page. It is a view of this browser, kept per
// document: the document's page setup never changes, nothing is saved, and
// Editing and Suggesting draw the pages again. A bar over the page offers
// it; Search the menus has Read pageless and Show pages.

/** Fit under this scale offers to read pageless. */
const OFFER_BELOW = 0.75;

export type Reflow = "pageless" | "pages";

const reflowKey = (documentId: string) => `unitos-docs-reflow:${documentId}`;

/** The reader's choice for this document in this browser; null before one. */
export function storedReflow(documentId: string): Reflow | null {
  try {
    const choice = localStorage.getItem(reflowKey(documentId));
    return choice === "pageless" || choice === "pages" ? choice : null;
  } catch {
    return null;
  }
}

function storeReflow(documentId: string, choice: Reflow): void {
  try {
    localStorage.setItem(reflowKey(documentId), choice);
  } catch {
    // Kept for this visit only.
  }
}

/** The reader's choice, kept per document, and the commands' event. */
export function useReflow(editor: Editor | null, documentId: string, applies: boolean): [Reflow | null, (choice: Reflow) => void] {
  const [choice, setChoice] = useState<Reflow | null>(() => (applies ? storedReflow(documentId) : null));
  const choose = (next: Reflow) => {
    setChoice(next);
    storeReflow(documentId, next);
  };
  useEffect(() => {
    if (!editor || !applies) return;
    const dom = editor.view.dom;
    const on = (e: Event) => {
      const next: Reflow = (e as CustomEvent<boolean>).detail ? "pageless" : "pages";
      setChoice(next);
      storeReflow(documentId, next);
    };
    dom.addEventListener(PAGE_EVENT.reflow, on);
    return () => dom.removeEventListener(PAGE_EVENT.reflow, on);
  }, [editor, documentId, applies]);
  return [choice, choose];
}

/** The bar over the page: the offer while Fit draws the pages small, and
    Show pages while the words read pageless. */
export function ReflowBar({
  editor,
  documentId,
  setup,
  choice,
  reflowed,
  onChoose,
}: {
  editor: Editor;
  documentId: string;
  setup: PageSetup;
  choice: Reflow | null;
  reflowed: boolean;
  onChoose: (choice: Reflow) => void;
}) {
  const t = useT();
  // The page's scale as the canvas works it out (Fit).
  const scale = usePageState(pageStore(editor, documentId, setup), (s) => s.scale);
  const pill = "rounded-full bg-clay px-3 py-1 text-[11.5px] font-semibold text-clay-fg hover:bg-clay-600";
  const quiet = "rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800";
  const bar = "mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-card px-3.5 py-2 text-[12.5px] text-sand-700 shadow-soft print:hidden";
  const shown = reflowed || (choice === null && scale < OFFER_BELOW);
  const ref = useRef<HTMLDivElement>(null);
  const clear = useClearOfOutline(ref, shown, scale);
  if (reflowed) {
    return (
      <div ref={ref} data-reflow-bar data-edit-control className={bar} style={clear}>
        <span>{t("docsPage.reflowOn")}</span>
        <button type="button" data-track="docs:show-pages" onClick={() => onChoose("pages")} className={quiet}>
          {t("docsPage.showPages")}
        </button>
      </div>
    );
  }
  if (choice !== null || scale >= OFFER_BELOW) return null;
  return (
    <div ref={ref} data-reflow-bar data-edit-control className={bar} style={clear}>
      <span>{t("docsPage.reflowAsk", { n: Math.round(scale * 100) })}</span>
      <button type="button" data-track="docs:read-pageless" onClick={() => onChoose("pageless")} className={pill}>
        {t("docsPage.readPageless")}
      </button>
      <button type="button" data-track="docs:keep-pages" onClick={() => onChoose("pages")} className={quiet}>
        {t("docsPage.keepPages")}
      </button>
    </div>
  );
}

/** The bar's words start right of Show tabs & outlines (outline.tsx) when
    the button stands over the bar's left end: on a narrow pane the page,
    and the bar with it, reach the canvas's edge, where the button is. */
function useClearOfOutline(ref: RefObject<HTMLDivElement | null>, shown: boolean, scale: number) {
  const [pad, setPad] = useState(0);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!shown || !bar) return;
    const measure = () => {
      const button = bar.closest("[data-docs-editor]")?.querySelector<HTMLElement>(".docs-outline-open");
      if (!button) return setPad(0);
      const b = button.getBoundingClientRect();
      const r = bar.getBoundingClientRect();
      // The room the button takes from the bar's left end, and a gap.
      setPad(b.right > r.left && b.left < r.right ? Math.ceil(b.right - r.left) + 8 : 0);
    };
    measure();
    // The button moves with the page (the cards move the page left).
    const button = bar.closest("[data-docs-editor]")?.querySelector(".docs-outline-open");
    const moved = new MutationObserver(measure);
    if (button) moved.observe(button, { attributes: true, attributeFilter: ["style"] });
    const resized = new ResizeObserver(measure);
    resized.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      moved.disconnect();
      resized.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, shown, scale]);
  return pad > 0 ? { paddingLeft: pad } : undefined;
}
