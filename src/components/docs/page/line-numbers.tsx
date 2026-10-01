"use client";

import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useState, type RefObject } from "react";
import { useT } from "@/components/lang-provider";
import type { PageFrame } from "@/components/docs/page/geometry";
import { usePageState, type PageStore } from "@/components/docs/page/store";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import type { PageSetup } from "@/lib/docs/schema";
import "./line-numbers.css";

// Tools > Line numbers (SPEC.md §29), Google Docs' and Word's: each line of
// the text numbered in the left margin, from 1 on each page (Restart each
// page) or on through the document (Continuous). The numbers are the lines
// the browser drew, measured after each change: a paragraph's lines, a
// heading's, a list item's, a code block's, and an empty paragraph's one
// line. A table, a figure, the footnotes, and a paragraph with Suppress line
// numbers (ext/line-numbers.ts) take none. Each page's numbers stand in its
// sheet, so print keeps them beside their lines. Pageless shows none.

export type LineNumbering = NonNullable<PageSetup["lineNumbers"]>;

/** A numbered line: its top and height in px at 100% from its page's top. */
export type NumberedLine = { top: number; height: number; n: number };

/** Blocks whose lines take no number. */
const UNNUMBERED = new Set(["table", "footnotes", "figure", "tableOfContents"]);
/** The room between a number and the text, in px (Word's Auto: 0.25 in). */
const GAP = 24;

/** The lines of the page's text, numbered, by the sheet each stands on. */
function measure(view: EditorView, page: HTMLElement, mode: LineNumbering): NumberedLine[][] {
  const sheets = [...page.querySelectorAll<HTMLElement>("[data-docs-page-sheet]")].map((s) => ({
    top: s.offsetTop,
    bottom: s.offsetTop + s.offsetHeight,
  }));
  const out: NumberedLine[][] = sheets.map(() => []);
  if (sheets.length === 0) return out;
  const box = page.getBoundingClientRect();
  // The page's zoom: its drawn width over its width at 100%.
  const k = page.offsetWidth > 0 ? box.width / page.offsetWidth : 1;
  const range = document.createRange();
  let n = 0;
  let last: { sheet: number; top: number } | null = null;
  const place = (top: number, bottom: number) => {
    const y = (top - box.top) / k;
    const height = (bottom - top) / k;
    const mid = y + height / 2;
    const sheet = sheets.findIndex((s) => mid >= s.top && mid < s.bottom);
    if (sheet < 0) return;
    // A run-in heading shares its line with the paragraph under it: one number.
    if (last && last.sheet === sheet && Math.abs(last.top - y) < 2) return;
    if (mode === "page" && last?.sheet !== sheet) n = 0;
    n += 1;
    last = { sheet, top: y };
    out[sheet].push({ top: y - sheets[sheet].top, height, n });
  };
  view.state.doc.descendants((node, pos) => {
    if (UNNUMBERED.has(node.type.name)) return false;
    if (!node.isTextblock) return true;
    if (node.attrs.suppressLineNumbers === true) return false;
    const dom = view.nodeDOM(pos);
    // A folded heading's section is not drawn.
    if (!(dom instanceof HTMLElement) || dom.offsetParent === null) return false;
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent || text.parentElement?.closest(".docs-spacer")) continue;
      range.selectNodeContents(text);
      for (const r of range.getClientRects()) if (r.height > 0) rects.push(r);
    }
    // An empty paragraph is one line.
    if (rects.length === 0) {
      const r = dom.getBoundingClientRect();
      if (r.height > 0) rects.push(r);
    }
    rects.sort((a, b) => a.top - b.top);
    let line: { top: number; bottom: number } | null = null;
    for (const r of rects) {
      // A piece that overlaps the line by half its height is on that line.
      if (line && r.top < line.bottom - Math.min(r.height, line.bottom - line.top) / 2) {
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
        continue;
      }
      if (line) place(line.top, line.bottom);
      line = { top: r.top, bottom: r.bottom };
    }
    if (line) place(line.top, line.bottom);
    return false;
  });
  return out;
}

/** The numbered lines of the page `page` draws, by sheet; null when the
    document shows no line numbers. Measured again after each change to the
    text or its layout, once the change has settled. */
export function useLineNumbers(editor: Editor, page: RefObject<HTMLElement | null>, mode: LineNumbering | null): NumberedLine[][] | null {
  const [lines, setLines] = useState<NumberedLine[][] | null>(null);
  useEffect(() => {
    const el = page.current;
    if (!mode || !el) return;
    let timer: number | null = null;
    let frame = 0;
    const run = () => {
      timer = null;
      frame = requestAnimationFrame(() => {
        if (!editor.isDestroyed) setLines(measure(editor.view, el, mode));
      });
    };
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(run, 120);
    };
    schedule();
    editor.on("update", schedule);
    // Pagination, a folded heading, an image loading: the lines move.
    const mutations = new MutationObserver(schedule);
    mutations.observe(editor.view.dom, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class"] });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(editor.view.dom);
    document.fonts.addEventListener("loadingdone", schedule);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      editor.off("update", schedule);
      mutations.disconnect();
      sizes.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, [editor, page, mode]);
  return mode ? lines : null;
}

/** One page's line numbers, in its left margin. */
export function LineNumberColumn({ lines, frame }: { lines: NumberedLine[]; frame: PageFrame }) {
  return (
    <div className="docs-line-numbers" style={{ width: Math.max(0, frame.left - GAP) }}>
      {lines.map((line) => (
        <span key={`${line.n}:${line.top}`} className="docs-line-number" style={{ top: line.top, height: line.height, lineHeight: `${line.height}px` }}>
          {line.n}
        </span>
      ))}
    </div>
  );
}

/** Every paragraph the selection touches has Suppress line numbers. */
function selectionSuppressed(editor: Editor): boolean {
  let all = true;
  let any = false;
  const { state } = editor;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
      any = true;
      if (node.attrs.suppressLineNumbers !== true) all = false;
      return false;
    });
  }
  return any && all;
}

/** Tools > Line numbers: Show line numbers, Restart each page or
    Continuous, and Suppress line numbers on the selected paragraphs. */
export function LineNumbersDialog({ editor, store, onClose }: { editor: Editor; store: PageStore; onClose: () => void }) {
  const t = useT();
  const setup = usePageState(store, (s) => s.setup);
  const [show, setShow] = useState(Boolean(setup.lineNumbers));
  const [mode, setMode] = useState<LineNumbering>(setup.lineNumbers ?? "continuous");
  const [suppressed] = useState(() => selectionSuppressed(editor));
  const [suppress, setSuppress] = useState(suppressed);

  const apply = () => {
    const next = show ? mode : null;
    if ((setup.lineNumbers ?? null) !== next) void store.saveSetup({ ...store.get().setup, lineNumbers: next });
    if (suppress !== suppressed) editor.chain().focus().setSuppressLineNumbers(suppress).run();
    onClose();
  };

  return (
    <ToolbarDialog
      title={t("docsPage.lineNumbers")}
      onClose={onClose}
      className="docs-small-dialog docs-line-numbers-dialog"
      closeButton={false}
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <button type="button" className="docs-tb-button docs-tb-button-primary" data-track="docs:line-numbers:apply" onClick={apply}>
            {t("docs.apply")}
          </button>
        </>
      }
    >
      <div className="docs-setup-body">
        <label className="docs-setup-radio">
          <input type="checkbox" checked={show} data-track="docs:line-numbers:show" onChange={(e) => setShow(e.target.checked)} />
          {t("docsPage.showLineNumbers")}
        </label>
        <fieldset className="docs-setup-group docs-line-numbers-modes" disabled={!show}>
          {(["page", "continuous"] as const).map((value) => (
            <label key={value} className="docs-setup-radio">
              <input
                type="radio"
                name="docs-line-numbers"
                checked={mode === value}
                data-track={`docs:line-numbers:${value}`}
                onChange={() => setMode(value)}
              />
              {t(value === "page" ? "docsPage.restartEachPage" : "docsPage.continuous")}
            </label>
          ))}
        </fieldset>
        <label className="docs-setup-radio">
          <input type="checkbox" checked={suppress} data-track="docs:line-numbers:suppress" onChange={(e) => setSuppress(e.target.checked)} />
          {t("docsPage.suppressInSelection")}
        </label>
      </div>
    </ToolbarDialog>
  );
}
