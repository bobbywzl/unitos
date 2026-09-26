"use client";

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Mapping, StepMap } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentIcon, LinkIcon, UnlinkIcon } from "@/components/icons";
import {
  CHAIN_BUTTON,
  EXTRACT_CHIP,
  MARK_CHIP,
  TOOL_KEY,
  TOOL_PLUS_KEY,
  ToolSymbol,
  anchorClass,
  type Highlight,
} from "@/components/reader/block-view";
import { aroundPageStarts, FIGURE, findIndexed, posInBlock } from "@/components/docs/layer/anchor";
import { PAGE_FLASH_EVENT } from "@/components/docs/layer/events";
import { annotationKindColor } from "@/lib/annotations/kind";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { MARK_SWEPT_EVENT, type MarkSweptDetail } from "@/lib/mark-sweep";

// The Unitos layer over the page editor (SPEC.md §29): the reader's marks —
// notes, annotations, links, and extractions — painted
// over the rich text as decorations, with the reader's classes
// (block-view.tsx markedText). The text never changes: a mark's chips are
// data-anchor-skip widgets, and a press opens what it opens in the reader.

/** `add`: paint these over the painted marks instead of in their place. */
export type MarksMeta = { highlights: Record<string, Highlight[]>; t: TFunc; add?: boolean };

export const annotationMarksKey = new PluginKey<DecorationSet>("docsAnnotationMarks");

type Chip = { kind: "tool" | "comment" | "link-start" | "link-end" | "extract"; highlight: Highlight };

function chipWidget({ kind, highlight: h }: Chip, t: TFunc) {
  return () => {
    const button = document.createElement("button");
    button.type = "button";
    button.contentEditable = "false";
    button.setAttribute("data-anchor-skip", "");
    const look = (className: string, tip: string, open: string, track?: string) => {
      button.className = className;
      button.setAttribute("aria-label", tip);
      button.setAttribute("data-tip", tip);
      button.dataset.docsOpen = open;
      if (track) button.setAttribute("data-track", track);
    };
    let symbol: React.ReactNode = null;
    if (kind === "tool" && h.tool) {
      const tip = t((h.plus ? TOOL_PLUS_KEY : TOOL_KEY)[h.tool]);
      look(`${MARK_CHIP} mark-chip-${h.tool}${h.plus ? " mark-chip-plus" : ""}`, tip, "annotation", "tool-chip");
      // The pointer on the symbol shows the log, as on the words (SPEC.md §21).
      button.dataset.hoverSource = h.sourceId ?? "";
      symbol = <ToolSymbol tool={h.tool} plus={h.plus} size={10} />;
    } else if (kind === "comment") {
      look(`comment-dot ${MARK_CHIP} mark-chip-comment`, t("panes.openComment"), "annotation", "comment-icon");
      symbol = <CommentIcon size={10} />;
    } else if (kind === "link-end") {
      // A completed link's chain goes to the other end; the linked words stay text to edit.
      look(CHAIN_BUTTON, h.linkTitle ? t("panes.linkedTo", { title: h.linkTitle }) : t("panes.linked"), "link");
      button.dataset.href = h.href ?? "";
      symbol = <LinkIcon size={10} />;
    } else if (kind === "link-start") {
      look(CHAIN_BUTTON, t("panes.linkToOtherTexts"), "start-link", "link-chip");
      symbol = <UnlinkIcon size={10} />;
    } else {
      look(EXTRACT_CHIP, t("panes.extractOpenCard", { label: h.extractLabel ?? "" }), "extract", "extract-chip");
      button.textContent = h.extractLabel ?? "";
      button.dataset.extractId = h.extractId ?? "";
    }
    if (kind === "tool" || kind === "comment" || kind === "link-start") button.dataset.sourceId = h.sourceId ?? "";
    if (symbol) {
      const root = createRoot(button);
      root.render(symbol);
      (button as HTMLButtonElement & { __root?: Root }).__root = root;
    }
    return button;
  };
}

/** The kinds the layer paints; formatting, terms, and web links are the editor's. */
const PAINTED = new Set<Highlight["kind"]>(["anchor", "pending-link", "salience", "simplify", "extract", "link"]);

/** One stretch of words under the same highlights, drawn as block-view.tsx
    markedText draws it: a link wins, else the smallest anchor names the mark. */
function segmentAttrs(covering: Highlight[], blockId: string, t: TFunc): Record<string, string> {
  const link = covering.find((h) => h.kind === "link");
  const anchors = covering.filter((h) => h.kind === "anchor");
  const anchor =
    anchors.length > 1 ? anchors.reduce((n, h) => (h.end - h.start < n.end - n.start ? h : n)) : anchors[0];
  const salience = covering.find((h) => h.kind === "salience");
  const simplify = covering.find((h) => h.kind === "simplify");
  const extract = covering.find((h) => h.kind === "extract");
  // The page draws its own selection (SPEC.md §29, The caret): only a link
  // waiting for its other end is painted here.
  const selectionClass = covering.some((h) => h.kind === "pending-link") ? " link-pending-mark" : "";
  // Every Unitos mark says so: print leaves them out (css/page.css).
  const attrs: Record<string, string> = { "data-unitos-mark": "" };
  // A new mark sweeps in once; the flash plugin's view reports the end.
  const sweep = (h: Highlight | undefined) => {
    if (!h?.fresh || h.leaving) return "";
    attrs["data-sweep"] = `${blockId}:${h.start}:${h.end}`;
    if (h.freshDelay) attrs.style = `animation-delay: ${h.freshDelay}ms`;
    return " mark-sweep";
  };
  if (anchor?.sourceId) attrs["data-source-id"] = anchor.sourceId;
  const leaving = Boolean(anchor?.leaving);
  const focusable = Boolean(anchor?.annotation && anchor.sourceId && !leaving);
  const noteMark = !anchor?.annotation && anchor?.noteId && !leaving ? anchor.noteId : null;
  const extractMark = extract && !focusable && !noteMark ? extract : null;
  // A click on the words opens what the mark names.
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

/** The objects on a line of their own a mark takes whole: a figure and an
    equation. Their words are not the page's text, so the mark is the
    object's ring and its label chip, as the reader draws them
    (block-view.tsx HighlightLabel). */
const WHOLE = new Set([FIGURE, "blockMath"]);

/** The color a mark on an object rings in: its tool's kind color, a
    highlight's hue, the comment color, else a note's clay (SPEC.md §6). */
function ringColor(h: Highlight): string {
  if (h.annotation && h.tool) return annotationKindColor(h.tool, null);
  if (h.color) return annotationKindColor("highlight", h.color);
  if (h.annotation && h.comment) return annotationKindColor("comment", null);
  return "var(--clay-400)";
}

/** The label chip of an object's marks: the annotations' labels ("A1 · A2")
    behind the tool's symbol, or a highlight's dot. A press opens the
    annotation, or the note; a press on a label, its own. The object carries
    the ring's data-source-id, so a jump to that mark finds the object; each
    other mark's label carries its own, and a jump to it flashes the object
    (flashDecorations). */
function labelWidget(anchors: Highlight[], color: string, ringSource: string | null, t: TFunc) {
  return () => {
    const focusable = anchors.find((h) => h.annotation && h.sourceId);
    const note = anchors.find((h) => !h.annotation && h.noteId);
    const toolAnchor = anchors.find((h) => h.tool);
    const labels = anchors.map((h) => h.figureLabel).filter((l): l is string => Boolean(l));
    const text = labels.length > 0 ? labels.join(" · ") : t("panes.highlighted");
    const button = document.createElement("button");
    button.type = "button";
    button.contentEditable = "false";
    button.className = "docs-object-label";
    button.setAttribute("data-anchor-skip", "");
    button.setAttribute("data-track", "figure-label");
    const tip = focusable ? t("panes.figureAnnotatedTitle", { text }) : t("panes.figureHighlightedTitle", { text });
    button.setAttribute("aria-label", tip);
    button.setAttribute("data-tip", tip);
    if (focusable?.sourceId) {
      button.dataset.docsOpen = "annotation";
      button.dataset.hoverSource = focusable.sourceId;
    } else if (note?.noteId) {
      button.dataset.docsOpen = "note";
      button.dataset.noteId = note.noteId;
    }
    const labeled = anchors.filter((h) => h.figureLabel);
    const root = createRoot(button);
    root.render(
      <>
        {toolAnchor?.tool ? (
          <ToolSymbol tool={toolAnchor.tool} plus={toolAnchor.plus} size={11} />
        ) : (
          <span aria-hidden className="docs-object-dot" style={{ background: color }} />
        )}
        {labeled.length === 0 ? (
          text
        ) : (
          <span>
            {labeled.map((h, i) => (
              <Fragment key={h.sourceId ?? i}>
                {i > 0 && " · "}
                <span
                  {...(h.sourceId && h.sourceId !== ringSource ? { "data-source-id": h.sourceId } : {})}
                  {...(h.annotation && h.sourceId
                    ? { "data-docs-open": "annotation", "data-hover-source": h.sourceId }
                    : h.noteId
                      ? { "data-docs-open": "note", "data-note-id": h.noteId }
                      : {})}
                >
                  {h.figureLabel}
                </span>
              </Fragment>
            ))}
          </span>
        )}
      </>,
    );
    (button as HTMLButtonElement & { __root?: Root }).__root = root;
    return button;
  };
}

/** A mark on a figure or an equation: the object rings in the kind color
    (a node decoration, with data-source-id for jumps and flashes), and its
    label chip stands before it, right of the text column, level with its
    top. */
function objectMarks(node: PMNode, pos: number, highlights: Highlight[], t: TFunc): Decoration[] {
  const anchors = highlights.filter((h) => h.kind === "anchor" && !h.leaving);
  if (anchors.length === 0) return [];
  // The card open on it, else an annotation, names the ring's color.
  const lead = anchors.find((h) => h.open) ?? anchors.find((h) => h.annotation && h.sourceId) ?? anchors[0];
  const sourceId = lead.sourceId ?? anchors.find((h) => h.sourceId)?.sourceId;
  const color = ringColor(lead);
  const attrs: Record<string, string> = {
    class: "docs-object-mark",
    style: `--docs-object-ring: ${color}`,
    "data-unitos-mark": "",
  };
  if (sourceId) attrs["data-source-id"] = sourceId;
  const key = anchors
    .map((h) => [h.sourceId, h.noteId, h.annotation ? 1 : 0, h.figureLabel, h.tool, h.plus ? 1 : 0].join(":"))
    .join(",");
  return [
    Decoration.node(pos, pos + node.nodeSize, attrs),
    Decoration.widget(pos, labelWidget(anchors, color, sourceId ?? null, t), {
      // After a page's spacer at the same place: the chip stands on the object's page.
      side: 1,
      ignoreSelection: true,
      stopEvent: () => true,
      key: `object-label:${color}:${sourceId ?? ""}:${key}`,
      destroy: (dom) => {
        const root = (dom as HTMLElement & { __root?: Root }).__root;
        if (root) queueMicrotask(() => root.unmount());
      },
    }),
  ];
}

function build(doc: PMNode, highlights: Record<string, Highlight[]>, t: TFunc): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (WHOLE.has(node.type.name)) {
      const id = node.attrs.blockId as string | null;
      if (id && highlights[id]) decorations.push(...objectMarks(node, pos, highlights[id], t));
      return false;
    }
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
      const to = posInBlock(node, pos, end, true);
      if (to <= from) continue;
      // A mark paints the words on both sides of a page start, never the page start.
      const attrs = segmentAttrs(covering, id, t);
      for (const [a, b] of aroundPageStarts(doc, from, to)) {
        decorations.push(Decoration.inline(a, b, attrs, { inclusiveStart: false, inclusiveEnd: false }));
      }
    }
    // The chips at each mark's end.
    let side = 1;
    for (const h of painted) {
      const at = posInBlock(node, pos, h.end, true);
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

// A jump to a mark or a paragraph flashes it (SPEC.md §6): the reader raises
// PAGE_FLASH_EVENT on the element, and the flash is a decoration.

const FLASH_MS = 2000;
const flashKey = new PluginKey<DecorationSet>("docsFlash");
type FlashMeta = { add: Decoration[] } | { remove: string };
let flashCount = 0;

function flashDecorations(view: EditorView, target: HTMLElement, id: string): Decoration[] {
  const spec = { flash: id };
  const { doc } = view.state;
  // A paragraph, a figure, or an equation: the whole node flashes.
  const blockId = target.dataset.blockId;
  if (blockId && !target.dataset.sourceId && !target.dataset.linkId) {
    const block = findIndexed(doc, blockId);
    if (!block) return [];
    return [Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: "anchor-flash" }, spec)];
  }
  // A mark: every piece of it.
  const sourceId = target.dataset.sourceId;
  const linkId = target.dataset.linkId;
  const pieces = sourceId
    ? [...view.dom.querySelectorAll<HTMLElement>(`[data-source-id="${CSS.escape(sourceId)}"]`)]
    : linkId
      ? [...view.dom.querySelectorAll<HTMLElement>(`[data-link-id="${CSS.escape(linkId)}"]`)]
      : [target];
  const out: Decoration[] = [];
  let from = Infinity;
  let to = -Infinity;
  for (const piece of pieces) {
    try {
      const start = view.posAtDOM(piece, 0);
      // An object a mark takes whole (a figure's ring, or its label chip,
      // which stands right before it): the node flashes.
      const node = doc.nodeAt(start);
      if (node && !node.isInline && (view.nodeDOM(start) === piece || piece.closest(".docs-object-label"))) {
        out.push(Decoration.node(start, start + node.nodeSize, { class: "anchor-flash" }, spec));
        continue;
      }
      from = Math.min(from, start);
      to = Math.max(to, view.posAtDOM(piece, piece.childNodes.length));
    } catch {
      // Not in the text (a widget): nothing to flash there.
    }
  }
  if (to > from) {
    for (const [a, b] of aroundPageStarts(doc, from, to)) out.push(Decoration.inline(a, b, { class: "anchor-flash" }, spec));
  }
  return out;
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
      // A new mark's sweep ended: the reader paints it at rest (lib/mark-sweep.ts).
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

// A chip takes no room in the line (css/layer.css): the chips that end on one
// line stand side by side after the text column, in the text's order.
function chipRowsPlugin() {
  return new Plugin({
    view(view) {
      let frame = 0;
      const lay = () => {
        frame = 0;
        let row = { parent: null as Element | null, top: NaN, n: 0 };
        for (const chip of view.dom.querySelectorAll<HTMLElement>("button[data-docs-open]")) {
          const same = chip.offsetParent === row.parent && Math.abs(chip.offsetTop - row.top) < 4;
          row = same ? { ...row, n: row.n + 1 } : { parent: chip.offsetParent, top: chip.offsetTop, n: 0 };
          const at = `${row.n * 20}px`;
          if (chip.style.getPropertyValue("--docs-chip-at") !== at) chip.style.setProperty("--docs-chip-at", at);
        }
      };
      const update = () => {
        if (!frame) frame = requestAnimationFrame(lay);
      };
      update();
      return { update, destroy: () => cancelAnimationFrame(frame) };
    },
  });
}

/** A paragraph a change took out and put back as it was (Ctrl+Shift+↑ and ↓
    move one so) loses its marks in the mapping: they go where it went. */
function keepMoved(tr: Transaction, before: DecorationSet, after: DecorationSet): DecorationSet {
  if (before === DecorationSet.empty) return after;
  const start = tr.before.content.findDiffStart(tr.doc.content);
  const end = tr.before.content.findDiffEnd(tr.doc.content);
  if (start === null || !end) return after;
  const old = new Map<string, { node: PMNode; pos: number }>();
  tr.before.nodesBetween(start, Math.max(start, end.a), (node, pos) => {
    if (node.isTextblock && typeof node.attrs.blockId === "string") old.set(node.attrs.blockId, { node, pos });
    return !node.isTextblock;
  });
  let next = after;
  tr.doc.nodesBetween(start, Math.max(start, end.b), (node, pos) => {
    if (!node.isTextblock) return true;
    const was = old.get(node.attrs.blockId as string);
    if (!was || !node.eq(was.node)) return false;
    const marks = before.find(was.pos + 1, was.pos + node.nodeSize - 1);
    if (marks.length === 0) return false;
    // What stood before its old place gives way to what stands before its new one.
    const moved = DecorationSet.create(tr.before, marks).map(new Mapping([new StepMap([0, was.pos, pos])]), tr.doc);
    next = next.remove(next.find(pos + 1, pos + node.nodeSize - 1)).add(tr.doc, moved.find());
    return false;
  });
  return next;
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
            if (meta?.add) return set.add(tr.doc, build(tr.doc, meta.highlights, meta.t).find());
            if (meta) return build(tr.doc, meta.highlights, meta.t);
            return tr.docChanged ? keepMoved(tr, set, set.map(tr.mapping, tr.doc)) : set;
          },
        },
        props: {
          decorations(state) {
            return annotationMarksKey.getState(state);
          },
          handleDOMEvents: {
            // A click on a mark opens what it opens; the browser's selection
            // tells a click from the end of a drag (the editor's is stale).
            // A chip is the page's own click handler's.
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
      chipRowsPlugin(),
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
  // An object's label chip names its annotation by data-hover-source alone.
  const sourceId = el.dataset.sourceId ?? el.dataset.hoverSource;
  if (kind === "annotation" && sourceId) {
    window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId } }));
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
