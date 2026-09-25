"use client";

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { createRoot, type Root } from "react-dom/client";
import { CommentIcon, LinkIcon, UnlinkIcon } from "@/components/icons";
import {
  CHAIN_BUTTON,
  MARK_CHIP,
  TOOL_KEY,
  TOOL_PLUS_KEY,
  ToolSymbol,
  anchorClass,
  type Highlight,
} from "@/components/reader/block-view";
import { findBlock, posInBlock } from "@/components/docs/layer/anchor";
import { PAGE_FLASH_EVENT } from "@/components/docs/layer/events";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { MARK_SWEPT_EVENT, type MarkSweptDetail } from "@/lib/mark-sweep";

// The Unitos layer over the page editor (SPEC.md §29): the marks the reader
// paints on an article — notes, annotations, links, extractions, and the
// selection tint under the open toolbar — painted over the rich text as
// ProseMirror decorations. They never change the text: the classes are the
// reader's (block-view.tsx markedText), the chips at a mark's end are
// data-anchor-skip widgets outside the document, and a press on a mark opens
// what it opens in the reader, through the same window events. Offsets are
// the paragraph index's (layer/anchor.ts), so a mark sits on the words its
// anchor names. Every decoration maps through each edit until the next
// repaint, so a mark follows the words while they are typed.

export type MarksMeta = { highlights: Record<string, Highlight[]>; t: TFunc };

export const annotationMarksKey = new PluginKey<DecorationSet>("docsAnnotationMarks");

type Chip = { kind: "tool" | "comment" | "link-start" | "link-end" | "extract"; highlight: Highlight };

function chipWidget(chip: Chip, t: TFunc) {
  return () => {
    const button = document.createElement("button");
    button.type = "button";
    button.contentEditable = "false";
    button.setAttribute("data-anchor-skip", "");
    const h = chip.highlight;
    let root: Root | null = null;
    if (chip.kind === "tool" && h.tool) {
      const tip = t((h.plus ? TOOL_PLUS_KEY : TOOL_KEY)[h.tool]);
      button.className = `${MARK_CHIP} mark-chip-${h.tool}${h.plus ? " mark-chip-plus" : ""}`;
      button.setAttribute("aria-label", tip);
      button.setAttribute("data-tip", tip);
      button.setAttribute("data-track", "tool-chip");
      button.dataset.docsOpen = "annotation";
      button.dataset.sourceId = h.sourceId ?? "";
      // The pointer resting on the symbol shows the conversation's log, as
      // on its words (SPEC.md §21).
      button.dataset.hoverSource = h.sourceId ?? "";
      root = createRoot(button);
      root.render(<ToolSymbol tool={h.tool} plus={h.plus} size={10} />);
    } else if (chip.kind === "comment") {
      button.className = `comment-dot ${MARK_CHIP} mark-chip-comment`;
      button.setAttribute("aria-label", t("panes.openComment"));
      button.setAttribute("data-tip", t("panes.openComment"));
      button.setAttribute("data-track", "comment-icon");
      button.dataset.docsOpen = "annotation";
      button.dataset.sourceId = h.sourceId ?? "";
      root = createRoot(button);
      root.render(<CommentIcon size={10} />);
    } else if (chip.kind === "link-end") {
      // A completed link's chain: the press goes to the other end, as the
      // reader's chain does. The linked words themselves stay text to edit.
      const tip = h.linkTitle ? t("panes.linkedTo", { title: h.linkTitle }) : t("panes.linked");
      button.className = CHAIN_BUTTON;
      button.setAttribute("aria-label", tip);
      button.setAttribute("data-tip", tip);
      button.dataset.docsOpen = "link";
      button.dataset.href = h.href ?? "";
      root = createRoot(button);
      root.render(<LinkIcon size={10} />);
    } else if (chip.kind === "link-start") {
      button.className = CHAIN_BUTTON;
      button.setAttribute("aria-label", t("panes.linkToOtherTexts"));
      button.setAttribute("data-tip", t("panes.linkToOtherTexts"));
      button.setAttribute("data-track", "link-chip");
      button.dataset.docsOpen = "start-link";
      button.dataset.sourceId = h.sourceId ?? "";
      root = createRoot(button);
      root.render(<UnlinkIcon size={10} />);
    } else {
      button.className =
        "mx-0.5 inline-flex h-4 items-center rounded-full bg-clay-100 px-1.5 align-text-top text-[9.5px] font-bold text-clay-700 hover:bg-clay-200 hover:text-clay-800";
      button.textContent = h.extractLabel ?? "";
      button.setAttribute("aria-label", t("panes.extractOpenCard", { label: h.extractLabel ?? "" }));
      button.setAttribute("data-tip", t("panes.extractOpenCard", { label: h.extractLabel ?? "" }));
      button.setAttribute("data-track", "extract-chip");
      button.dataset.docsOpen = "extract";
      button.dataset.extractId = h.extractId ?? "";
    }
    if (root) (button as HTMLButtonElement & { __root?: Root }).__root = root;
    return button;
  };
}

/** The kinds the layer paints; the document's own formatting, terms, and web
    links are the editor's to draw. */
const PAINTED = new Set<Highlight["kind"]>(["anchor", "selection", "pending-link", "salience", "simplify", "extract", "link"]);

/** One stretch of words under the same highlights, as block-view.tsx
    markedText draws it: a link over everything, else the smallest anchor
    names the mark (stacked anchors underline double), and the selection tint
    rides on top. */
function segmentAttrs(covering: Highlight[], blockId: string, t: TFunc): Record<string, string> {
  const link = covering.find((h) => h.kind === "link");
  const anchors = covering.filter((h) => h.kind === "anchor");
  const anchor =
    anchors.length > 1 ? anchors.reduce((n, h) => (h.end - h.start < n.end - n.start ? h : n)) : anchors[0];
  const salience = covering.find((h) => h.kind === "salience");
  const simplify = covering.find((h) => h.kind === "simplify");
  const extract = covering.find((h) => h.kind === "extract");
  const selection = covering.find((h) => h.kind === "selection" || h.kind === "pending-link");
  const selectionClass = selection
    ? selection.kind === "pending-link"
      ? " link-pending-mark"
      : " selection-mark"
    : "";
  const attrs: Record<string, string> = {};
  // A mark made in this session sweeps in once (globals.css mark-sweep); the
  // plugin's view reports the end, and the next repaint drops the class.
  const sweep = (h: Highlight | undefined) => {
    if (!h?.fresh || h.leaving) return "";
    attrs["data-sweep"] = `${blockId}:${h.start}:${h.end}`;
    if (h.freshDelay) attrs.style = `animation-delay: ${h.freshDelay}ms`;
    return " mark-sweep";
  };
  if (anchor?.sourceId) attrs["data-source-id"] = anchor.sourceId;
  if (link) {
    // The linked words stay text to edit; the chain at their end goes to the
    // other end.
    if (link.linkId) attrs["data-link-id"] = link.linkId;
    const tip = [link.linkTitle ? t("panes.linkedTo", { title: link.linkTitle }) : null, link.linkReason]
      .filter((s): s is string => Boolean(s))
      .join("\n");
    if (tip) attrs["data-tip"] = tip;
    attrs.class = `link-mark rounded-[4px]${sweep(link)}${selectionClass}`;
    return attrs;
  }
  const leaving = Boolean(anchor?.leaving);
  const focusable = Boolean(anchor?.annotation && anchor.sourceId && !leaving);
  const noteMark = !anchor?.annotation && anchor?.noteId && !leaving ? anchor.noteId : null;
  const extractMark = extract && !focusable && !noteMark ? extract : null;
  if (focusable) {
    attrs["data-docs-open"] = "annotation";
    attrs["data-tip"] = t("panes.viewAnnotation");
  } else if (noteMark) {
    attrs["data-docs-open"] = "note";
    attrs["data-note-id"] = noteMark;
    attrs["data-tip"] = t("panes.viewNote");
  } else if (extractMark) {
    attrs["data-docs-open"] = "extract";
    attrs["data-extract-id"] = extractMark.extractId ?? "";
    attrs["data-tip"] = t("panes.extractOpenCard", { label: extractMark.extractLabel ?? "" });
  }
  const markClass = simplify
    ? "simplify-mark"
    : anchor
      ? anchorClass(anchor)
      : extract
        ? extract.extractOrigin
          ? "extract-origin-mark"
          : "extract-mark"
        : salience
          ? "salience-mark"
          : "";
  attrs.class = `${markClass}${selectionClass}${anchors.length > 1 ? " hl-stacked" : ""}${sweep(simplify ?? anchor ?? extract ?? salience)}${leaving ? " mark-out" : ""} rounded-[4px]${focusable || noteMark || extractMark ? " annotation-mark" : ""}`;
  return attrs;
}

/** The chips a highlight carries at its end, in the reader's order. */
function chipsOf(h: Highlight): Chip[] {
  const chips: Chip[] = [];
  const live = h.kind === "anchor" && h.sourceId && !h.leaving;
  if (live && h.tool) chips.push({ kind: "tool", highlight: h });
  if (live && h.comment) chips.push({ kind: "comment", highlight: h });
  if (live && h.color) chips.push({ kind: "link-start", highlight: h });
  if (h.kind === "extract" && h.extractLabel) chips.push({ kind: "extract", highlight: h });
  if (h.kind === "link" && h.href) chips.push({ kind: "link-end", highlight: h });
  return chips;
}

function build(doc: PMNode, highlights: Record<string, Highlight[]>, t: TFunc): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const id = node.attrs.blockId as string | null;
    const painted = (id ? (highlights[id] ?? []) : []).filter((h) => h.end > h.start && PAINTED.has(h.kind));
    if (!id || painted.length === 0) return false;
    const points = [...new Set(painted.flatMap((h) => [h.start, h.end]))].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const [start, end] = [points[i], points[i + 1]];
      const covering = painted.filter((h) => h.start <= start && h.end >= end);
      if (covering.length === 0) continue;
      const from = posInBlock(node, pos, start);
      const to = posInBlock(node, pos, end);
      if (to <= from) continue;
      decorations.push(
        Decoration.inline(from, to, segmentAttrs(covering, id, t), { inclusiveStart: false, inclusiveEnd: false }),
      );
    }
    // The chips at each mark's end.
    let side = 1;
    for (const h of painted) {
      const at = posInBlock(node, pos, h.end);
      for (const chip of chipsOf(h)) {
        decorations.push(
          Decoration.widget(at, chipWidget(chip, t), {
            side: side++,
            ignoreSelection: true,
            stopEvent: () => true,
            key: `${chip.kind}:${h.sourceId ?? h.extractId ?? h.linkId ?? ""}:${h.start}:${h.end}:${h.plus ? 1 : 0}`,
            destroy: (dom) => {
              const root = (dom as HTMLElement & { __root?: Root }).__root;
              if (root) queueMicrotask(() => root.unmount());
            },
          }),
        );
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

// ── The flash ────────────────────────────────────────────────────────────
// A jump to a mark or a paragraph flashes it (SPEC.md §6): the reader
// raises PAGE_FLASH_EVENT on the element, and the flash is a decoration over
// the same words, gone after FLASH_MS.

const FLASH_MS = 2000;
const flashKey = new PluginKey<DecorationSet>("docsFlash");
type FlashMeta = { add: Decoration[] } | { remove: string };
let flashCount = 0;

function flashDecorations(view: EditorView, target: HTMLElement, id: string): Decoration[] {
  const spec = { flash: id };
  // A paragraph: the whole node flashes.
  const blockId = target.dataset.blockId;
  if (blockId && !target.dataset.sourceId && !target.dataset.linkId) {
    const block = findBlock(view.state.doc, blockId);
    if (!block) return [];
    return [Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: "anchor-flash" }, spec)];
  }
  // A mark: every piece of it — a mark over two runs of text draws as two
  // spans.
  const sourceId = target.dataset.sourceId;
  const linkId = target.dataset.linkId;
  const pieces = sourceId
    ? [...view.dom.querySelectorAll<HTMLElement>(`[data-source-id="${CSS.escape(sourceId)}"]`)]
    : linkId
      ? [...view.dom.querySelectorAll<HTMLElement>(`[data-link-id="${CSS.escape(linkId)}"]`)]
      : [target];
  let from = Infinity;
  let to = -Infinity;
  for (const piece of pieces) {
    try {
      from = Math.min(from, view.posAtDOM(piece, 0));
      to = Math.max(to, view.posAtDOM(piece, piece.childNodes.length));
    } catch {
      // Not in the text (a widget): nothing to flash there.
    }
  }
  return to > from ? [Decoration.inline(from, to, { class: "anchor-flash" }, spec)] : [];
}

function flashPlugin() {
  return new Plugin<DecorationSet>({
    key: flashKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
        const meta = tr.getMeta(flashKey) as FlashMeta | undefined;
        if (meta && "add" in meta) next = next.add(tr.doc, meta.add);
        if (meta && "remove" in meta) {
          next = next.remove(next.find(undefined, undefined, (spec) => spec.flash === meta.remove));
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return flashKey.getState(state);
      },
    },
    view(view) {
      const onFlash = (e: Event) => {
        if (!(e.target instanceof HTMLElement)) return;
        const id = `flash-${++flashCount}`;
        const add = flashDecorations(view, e.target, id);
        if (add.length === 0) return;
        view.dispatch(view.state.tr.setMeta(flashKey, { add }).setMeta("addToHistory", false));
        window.setTimeout(() => {
          if (view.isDestroyed) return;
          view.dispatch(view.state.tr.setMeta(flashKey, { remove: id }).setMeta("addToHistory", false));
        }, FLASH_MS);
      };
      // A fresh mark's sweep ended: the reader forgets it is fresh
      // (lib/mark-sweep.ts), and the next repaint paints it at rest.
      const onAnimationEnd = (e: AnimationEvent) => {
        if (e.animationName !== "mark-sweep" || !(e.target instanceof HTMLElement)) return;
        const [blockId, start, end] = (e.target.dataset.sweep ?? "").split(":");
        if (!blockId) return;
        window.dispatchEvent(
          new CustomEvent<MarkSweptDetail>(MARK_SWEPT_EVENT, {
            detail: { blockId, start: Number(start), end: Number(end) },
          }),
        );
      };
      view.dom.addEventListener(PAGE_FLASH_EVENT, onFlash);
      view.dom.addEventListener("animationend", onAnimationEnd);
      return {
        destroy() {
          view.dom.removeEventListener(PAGE_FLASH_EVENT, onFlash);
          view.dom.removeEventListener("animationend", onAnimationEnd);
        },
      };
    },
  });
}

/** The marks layer: set its highlights with a MarksMeta on annotationMarksKey. */
export const AnnotationMarks = Extension.create({
  name: "docsAnnotationMarks",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: annotationMarksKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(annotationMarksKey) as MarksMeta | undefined;
            if (meta) return build(tr.doc, meta.highlights, meta.t);
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: {
          decorations(state) {
            return annotationMarksKey.getState(state);
          },
          handleDOMEvents: {
            // A click on a mark opens what the mark opens. The editor reads
            // its new caret only after the click, so the browser's selection
            // says whether this was a click or the end of a drag over words.
            // A chip is a widget the editor leaves alone: the page's own
            // click handler opens it.
            click(_view, event) {
              const target = event.target instanceof Element ? event.target : null;
              if (!target?.closest("[data-docs-open]") || target.closest("[data-anchor-skip]")) return false;
              if (!(window.getSelection()?.isCollapsed ?? true)) return false;
              if (openMarkAt(target)) event.stopPropagation();
              return false;
            },
          },
        },
      }),
      flashPlugin(),
    ];
  },
});

/** A press on a mark or a chip: what it opens in the reader, it opens here —
    an annotation's card, a note in the tray, an extraction's match card, a
    link's other end. Returns true when the press was a mark's. */
export function openMarkAt(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-docs-open]") : null;
  if (!el) return false;
  const kind = el.dataset.docsOpen;
  if (kind === "annotation" && el.dataset.sourceId) {
    window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: el.dataset.sourceId } }));
    return true;
  }
  if (kind === "note" && el.dataset.noteId) {
    window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId: el.dataset.noteId } }));
    return true;
  }
  if (kind === "extract" && el.dataset.extractId) {
    window.dispatchEvent(
      new CustomEvent("dissect:extract-chip", { detail: { extractId: el.dataset.extractId, element: el } }),
    );
    return true;
  }
  if (kind === "start-link" && el.dataset.sourceId) {
    window.dispatchEvent(
      new CustomEvent("dissect:start-link", { detail: { sourceId: el.dataset.sourceId, origin: el } }),
    );
    return true;
  }
  if (kind === "link" && el.dataset.href) {
    window.location.assign(el.dataset.href);
    return true;
  }
  return false;
}
