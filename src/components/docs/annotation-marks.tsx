"use client";

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
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
import type { TFunc } from "@/lib/i18n/dictionaries";

// The Unitos layer over the page editor (SPEC.md §29): the marks the reader
// paints on an article — notes, annotations, links, extractions, and the
// selection tint under the open toolbar — painted over the rich text as
// ProseMirror decorations. They never change the text: the classes are the
// reader's (block-view.tsx markedText), the chips at a mark's end are
// data-anchor-skip widgets outside the document, and a press on a mark opens
// what it opens in the reader, through the same window events.

export type MarksMeta = { highlights: Record<string, Highlight[]>; t: TFunc };

export const annotationMarksKey = new PluginKey<DecorationSet>("docsAnnotationMarks");

/** The document position of each character offset of a textblock's words
    (lib/docs/blocks.ts inlineText): text maps one to one, a line break is one
    character at its own position. */
function offsetToPos(node: PMNode, nodePos: number, offset: number): number {
  let text = 0;
  let pos = nodePos + 1;
  let result = pos;
  let done = false;
  node.forEach((child) => {
    if (done) return;
    const len = child.isText ? (child.text ?? "").length : child.type.name === "hardBreak" ? 1 : 0;
    if (offset <= text + len) {
      result = child.isText || child.type.name === "hardBreak" ? pos + (offset - text) : pos;
      done = true;
      return;
    }
    text += len;
    pos += child.nodeSize;
    result = pos;
  });
  return result;
}

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
      button.setAttribute("data-track", "extract-chip");
      button.dataset.docsOpen = "extract";
      button.dataset.extractId = h.extractId ?? "";
    }
    if (root) (button as HTMLButtonElement & { __root?: Root }).__root = root;
    return button;
  };
}

function build(doc: PMNode, highlights: Record<string, Highlight[]>, t: TFunc): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const id = node.attrs.blockId as string | null;
    const list = id ? highlights[id] : undefined;
    if (!list || list.length === 0) return false;
    const at = (offset: number) => offsetToPos(node, pos, offset);
    for (const h of list) {
      if (h.end <= h.start) continue;
      const from = at(h.start);
      const to = at(h.end);
      if (to <= from) continue;
      let cls = "";
      const attrs: Record<string, string> = {};
      if (h.kind === "anchor") {
        cls = `${anchorClass(h)} rounded-[4px]${h.leaving ? " mark-out" : ""}`;
        if (h.sourceId) attrs["data-source-id"] = h.sourceId;
        if (h.annotation && h.sourceId && !h.leaving) {
          attrs["data-docs-open"] = "annotation";
          attrs["data-tip"] = t("panes.viewAnnotation");
          cls += " annotation-mark";
        } else if (!h.annotation && h.noteId && !h.leaving) {
          attrs["data-docs-open"] = "note";
          attrs["data-note-id"] = h.noteId;
          attrs["data-tip"] = t("panes.viewNote");
          cls += " annotation-mark";
        }
      } else if (h.kind === "selection") cls = "selection-mark";
      else if (h.kind === "pending-link") cls = "link-pending-mark";
      else if (h.kind === "salience") cls = "salience-mark";
      else if (h.kind === "simplify") cls = "simplify-mark";
      else if (h.kind === "extract") {
        cls = `${h.extractOrigin ? "extract-origin-mark" : "extract-mark"} annotation-mark`;
        attrs["data-docs-open"] = "extract";
        if (h.extractId) attrs["data-extract-id"] = h.extractId;
      } else if (h.kind === "link") {
        cls = "link-mark rounded-[4px]";
        if (h.linkId) attrs["data-link-id"] = h.linkId;
        const tip = [h.linkTitle ? t("panes.linkedTo", { title: h.linkTitle }) : null, h.linkReason]
          .filter((s): s is string => Boolean(s))
          .join("\n");
        if (tip) attrs["data-tip"] = tip;
      } else {
        // The document's own formatting, terms, and web links are the
        // editor's to draw.
        continue;
      }
      decorations.push(Decoration.inline(from, to, { class: cls, ...attrs }, { inclusiveStart: false, inclusiveEnd: false }));
      // The chips at the mark's end.
      const chips: Chip[] = [];
      if (h.kind === "anchor" && h.tool && h.sourceId && !h.leaving) chips.push({ kind: "tool", highlight: h });
      if (h.kind === "anchor" && h.comment && h.sourceId && !h.leaving) chips.push({ kind: "comment", highlight: h });
      if (h.kind === "anchor" && h.color && h.sourceId && !h.leaving) chips.push({ kind: "link-start", highlight: h });
      if (h.kind === "extract" && h.extractLabel) chips.push({ kind: "extract", highlight: h });
      if (h.kind === "link" && h.href) chips.push({ kind: "link-end", highlight: h });
      chips.forEach((chip, i) => {
        decorations.push(
          Decoration.widget(to, chipWidget(chip, t), {
            side: 1 + i,
            ignoreSelection: true,
            stopEvent: () => true,
            key: `${chip.kind}:${h.sourceId ?? h.extractId ?? ""}:${h.start}:${h.end}`,
            destroy: (dom) => {
              const root = (dom as HTMLElement & { __root?: Root }).__root;
              if (root) queueMicrotask(() => root.unmount());
            },
          }),
        );
      });
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** The marks layer: set its highlights with setMarks(view, meta). */
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
        },
      }),
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
