"use client";

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useMemo, useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { SparkleIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { DocIcon, OutlineIcon } from "@/components/docs/icons";
import { importedOf } from "@/components/docs/insert/figure";
import { ArrowBackIcon } from "@/components/docs/insert/icons";
import { flashInPage } from "@/components/docs/layer/events";
import { scrollParent } from "@/components/docs/page/geometry";
import { usePageRect } from "@/components/docs/page/ruler";
import { OUTLINE_MAX, OUTLINE_MIN, usePageState, type PageStore } from "@/components/docs/page/store";
import { useContents } from "@/components/reader/contents-menu";
import type { ContentsEntry } from "@/lib/contents";

// The tabs & outlines panel (SPEC.md §29), Google Docs' left panel: the
// document's one tab ("Tab 1") and under it the document's headings — the
// Title and Heading 1–6, never the Subtitle — each nested under the heading
// above it. The heading that owns the top of the view is marked blue as the
// page scrolls; a press on an item scrolls to its heading and puts the caret
// there. On an import, the contents (SPEC.md §26) stand under the headings:
// the stored parts, each a jump that flashes where the part starts, or the
// ask to generate them. While the panel is closed, a small button at the
// canvas's top left opens it.

type OutlineItem = { pos: number; level: number; depth: number; text: string };

/** The document's outline: the Title (level 0) and the headings, each nested
    under the nearest item above it with a lower level. Empty headings are
    left out. */
function outlineOf(doc: PMNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  const open: number[] = [];
  doc.descendants((node, pos) => {
    const isHeading = node.type.name === "heading";
    const isTitle = node.type.name === "paragraph" && node.attrs.docStyle === "title";
    if (isHeading || isTitle) {
      const level = isHeading ? Number(node.attrs.level) || 1 : 0;
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) {
        while (open.length > 0 && open[open.length - 1] >= level) open.pop();
        items.push({ pos, level, depth: open.length, text });
        open.push(level);
      }
      return false;
    }
    return !node.isTextblock;
  });
  return items;
}

/** The stored contents parts where their paragraphs stand, in reading
    order, a level 2 part under the level 1 part before it. A part whose
    paragraph is gone is left out. */
function partsOf(doc: PMNode, parts: ContentsEntry[]): OutlineItem[] {
  if (parts.length === 0) return [];
  const wanted = new Set(parts.map((p) => p.blockId));
  const at = new Map<string, number>();
  doc.descendants((node, pos) => {
    const id: unknown = node.attrs.blockId;
    if (typeof id === "string" && wanted.has(id) && (node.isTextblock || node.isAtom)) at.set(id, pos);
    return !node.isTextblock && !node.isAtom;
  });
  let top = false;
  return parts
    .flatMap((part) => {
      const pos = at.get(part.blockId);
      return pos === undefined ? [] : [{ pos, part }];
    })
    .sort((a, b) => a.pos - b.pos)
    .map(({ pos, part }) => {
      const depth = part.level === 2 && top ? 1 : 0;
      if (depth === 0) top = true;
      return { pos, level: part.level, depth, text: part.title };
    });
}

/** The editor's document, read again a frame after each change. */
function useDoc(editor: Editor): PMNode {
  const [doc, setDoc] = useState(() => editor.state.doc);
  useEffect(() => {
    let frame = 0;
    const onUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setDoc(editor.state.doc);
      });
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor]);
  return doc;
}

/** The item at the top of the view: the last one whose top has passed the
    view's top. */
function useCurrent(editor: Editor, items: OutlineItem[], viewTop: number): number {
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      let found = -1;
      for (let i = 0; i < items.length; i++) {
        const dom = editor.view.nodeDOM(items[i].pos);
        if (!(dom instanceof HTMLElement)) continue;
        if (dom.getBoundingClientRect().top <= viewTop + 48) found = i;
        else break;
      }
      setCurrent(found);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    schedule();
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [editor, items, viewTop]);
  return current;
}

/** Scroll an item's paragraph to near the top of the view and put the
    caret at its start (a figure takes no caret). Returns its element. */
function goTo(editor: Editor, item: OutlineItem, viewTop: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(item.pos);
  const chain = editor.chain().focus(undefined, { scrollIntoView: false });
  if (editor.state.doc.nodeAt(item.pos)?.isTextblock) chain.setTextSelection(item.pos + 1);
  chain.run();
  if (!(dom instanceof HTMLElement)) return null;
  const scroller = scrollParent(dom);
  if (scroller) scroller.scrollTop += dom.getBoundingClientRect().top - viewTop - 24;
  return dom;
}

/** The items as the panel lists them: nested by depth, the current one
    marked. */
function OutlineList({
  items,
  current,
  onPick,
}: {
  items: OutlineItem[];
  current: number;
  onPick: (item: OutlineItem) => void;
}) {
  const t = useT();
  return (
    <ol className="docs-outline-list">
      {items.map((item, i) => (
        <li key={`${item.pos}-${i}`}>
          <button
            type="button"
            className={`docs-outline-item${item.depth === 0 ? " docs-outline-top" : ""}${i === current ? " docs-outline-current" : ""}`}
            style={{ paddingLeft: 21 + 12 * item.depth }}
            aria-label={t("docsPage.outlineLevel", { text: item.text, n: item.depth + 1 })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item)}
          >
            <span className="docs-outline-text">{item.text}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** An import's contents under the headings: the stored parts, each a jump
    that flashes where the part starts; with none stored, the ask and
    Generate contents (an editor), as the Contents menu has them. */
function OutlineContents({
  editor,
  doc,
  documentId,
  viewTop,
}: {
  editor: Editor;
  doc: PMNode;
  documentId: string;
  viewTop: number;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const { state, reading, readError, generating, generateError, generate } = useContents(documentId, true);
  const parts = state?.generated ? state.parts : null;
  const items = useMemo(() => (parts ? partsOf(doc, parts) : []), [doc, parts]);
  const current = useCurrent(editor, items, viewTop);
  return (
    <section aria-label={t("reader.contents")}>
      <div className="docs-outline-header">{t("reader.contents")}</div>
      {reading && <p className="docs-outline-note">{t("common.loading")}</p>}
      {readError && <p className="docs-outline-note docs-outline-error">{readError}</p>}
      {parts &&
        (parts.length === 0 ? (
          <p className="docs-outline-note">{t("reader.contentsEmpty")}</p>
        ) : (
          <>
            <p className="docs-outline-note">{t("reader.contentsDisclaimer")}</p>
            <OutlineList
              items={items}
              current={current}
              onPick={(item) => {
                const dom = goTo(editor, item, viewTop);
                if (dom) flashInPage(dom);
              }}
            />
          </>
        ))}
      {state && !state.generated &&
        (canEdit ? (
          <>
            <p className="docs-outline-note">{t("reader.contentsAsk")}</p>
            <div className="docs-outline-action">
              <button
                type="button"
                className="docs-button-primary"
                disabled={generating}
                data-tip={t("reader.contentsGenerateTitle")}
                data-track="contents-generate"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void generate()}
              >
                {generating ? <SpinnerIcon size={14} className="animate-spin" /> : <SparkleIcon size={14} />}
                {t(generating ? "reader.contentsBuilding" : "reader.contentsGenerate")}
              </button>
            </div>
            {generateError && (
              <p className="docs-outline-note docs-outline-error">{t("reader.contentsFailed", { reason: generateError })}</p>
            )}
            <p className="docs-outline-note">{t("reader.contentsDisclaimer")}</p>
          </>
        ) : (
          <p className="docs-outline-note">{t("reader.contentsViewer")}</p>
        ))}
    </section>
  );
}

/** Show tabs & outlines, at Google Docs' place at the canvas's top left
    (32 px in beside the vertical ruler, else 50), always there. While the
    page would come under it (the cards move the page left), it moves left
    with the page, down to the canvas's edge, and then stands over the page's
    margin. */
export function OutlineButton({ editor, store, ruler }: { editor: Editor; store: PageStore; ruler: boolean }) {
  const t = useT();
  const setup = usePageState(store, (s) => s.setup);
  const scale = usePageState(store, (s) => s.scale);
  const page = usePageRect(editor, [setup, scale]);
  const home = ruler ? 32 : 50;
  const left = page ? Math.max(ruler ? 20 : 4, Math.min(home, page.x - 16 - 36)) : home;
  return (
    <button
      type="button"
      className="docs-outline-open"
      style={{ left }}
      aria-label={t("docsPage.showOutline")}
      data-tip={t("docsPage.showOutline")}
      data-track="docs:outline-open"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => store.set({ outlineOpen: true })}
    >
      <OutlineIcon size={20} />
    </button>
  );
}

export function OutlinePanel({
  editor,
  store,
  left,
  height,
  viewTop,
}: {
  editor: Editor;
  store: PageStore;
  left: number;
  height: number;
  /** The view's top below the header, client px. */
  viewTop: number;
}) {
  const t = useT();
  const width = usePageState(store, (s) => s.outlineWidth);
  const doc = useDoc(editor);
  const items = useMemo(() => outlineOf(doc), [doc]);
  const current = useCurrent(editor, items, viewTop);
  const imported = importedOf(editor);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);

  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let next = width;
    const onMove = (ev: PointerEvent) => {
      next = Math.max(OUTLINE_MIN, Math.min(OUTLINE_MAX, width + ev.clientX - x0));
      setDraftWidth(next);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setDraftWidth(null);
      store.set({ outlineWidth: next });
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const shown = draftWidth ?? width;
  return (
    <nav
      className="docs-outline"
      style={{ left, width: shown, height }}
      aria-label={t("docsPage.tabsOutlines")}
      data-edit-control
    >
      <div className="docs-outline-hat">
        <button
          type="button"
          className="docs-outline-close"
          aria-label={t("docsPage.hideOutline")}
          data-tip={t("docsPage.hideOutline")}
          data-track="docs:outline-close"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => store.set({ outlineOpen: false })}
        >
          <ArrowBackIcon size={24} />
        </button>
      </div>
      <div className="docs-outline-scroll">
        <div className="docs-outline-header">{t("docsPage.documentTabs")}</div>
        <div className="docs-outline-tab" aria-current="page">
          <DocIcon size={20} />
          <span className="docs-outline-tab-name">{t("docsPage.firstTab")}</span>
        </div>
        {items.length === 0 ? (
          <p className="docs-outline-empty">{t("docsPage.outlineEmpty")}</p>
        ) : (
          <OutlineList items={items} current={current} onPick={(item) => void goTo(editor, item, viewTop)} />
        )}
        {imported && <OutlineContents editor={editor} doc={doc} documentId={imported.documentId} viewTop={viewTop} />}
      </div>
      <div
        className="docs-outline-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("docsPage.resizePanel")}
        onPointerDown={startResize}
      />
    </nav>
  );
}
