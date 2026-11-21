"use client";

import type { Element as HastElement, ElementContent, Root as HastRoot, Text as HastText } from "hast";
import type { List, Root } from "mdast";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CommentIcon, LinkIcon, QuoteIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { isVisualizationImage, openVisualization } from "@/components/reader/visualization-viewer";
import { BLOCK_HREF, BLOCKS_HREF, linkifyBlockTags, NOTE_HREF } from "@/lib/block-tags";
import { imageWidth } from "@/lib/note-markup";
import {
  annotationReferenceHref,
  BOX_EMPTY,
  contentEnd,
  parseAnnotationReference,
  type ParsedAnnotationReference,
  type ReferencedAnnotation,
} from "@/lib/annotation-reference";
import { annotationKindColor } from "@/lib/annotations/kind";
import type { AnnotationItem } from "@/lib/types";
import { AnnotationKindIcon } from "@/components/annotation-kind-icon";
import { linkHost } from "@/lib/note-links";
import { sourceOfQuote } from "@/lib/notes/quote-sources";
import { splitHits } from "@/lib/search-hits";
import type { SourceChip } from "@/lib/types";

// AI text cites document blocks as [block <id>] and notes as [note <id>]:
// chips (lib/block-tags.ts). A ¶ chip scrolls the reader to the block and
// flashes it (the reader listens for dissect:flash-block); a chip for blocks
// named together carries their count and flashes each.

// Note style tags: <u> underlines, <clay>/<sage>/<gold>/<plum> color the text
// (the note editor writes them). react-markdown drops raw HTML, so they become
// links the a component override styles.
//
// The tags nest — a colour around an underline around bold — and a link cannot
// hold another link, so converting one tag at a time left the outer one showing
// as "[text](#dissect-style-clay)". Every run of text is emitted once instead,
// with all the styles covering it in its href, so nothing nests: one link per
// run, however many tags wrap it. A markdown link inside a tag is left alone —
// it cannot be wrapped either — and a tag that never closes, or closes out of
// order, stays as it was written.
const STYLE_TAG = /<(\/?)(u|clay|sage|gold|plum)>/g;
const MD_LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/g;
const STYLE_HREF = "#dissect-style-";
const STYLE_CLASS: Record<string, string> = {
  clay: "text-color-clay",
  sage: "text-color-sage",
  gold: "text-color-gold",
  plum: "text-color-plum",
};

/** One run of text under `styles`, as a link the override paints. A markdown
    link inside it stays a link of its own: the styles pass over it. */
function styledRun(text: string, styles: string[]): string {
  if (!text || styles.length === 0) return text;
  const href = `${STYLE_HREF}${styles.join("+")}`;
  let out = "";
  let at = 0;
  MD_LINK.lastIndex = 0;
  for (let m = MD_LINK.exec(text); m; m = MD_LINK.exec(text)) {
    if (m.index > at) out += `[${text.slice(at, m.index)}](${href})`;
    out += m[0];
    at = m.index + m[0].length;
  }
  return at === 0 ? `[${text}](${href})` : out + (at < text.length ? `[${text.slice(at)}](${href})` : "");
}

function linkifyStyleLine(line: string): string {
  const styles: string[] = [];
  let out = "";
  let at = 0;
  STYLE_TAG.lastIndex = 0;
  for (let m = STYLE_TAG.exec(line); m; m = STYLE_TAG.exec(line)) {
    out += styledRun(line.slice(at, m.index), styles);
    const [, closing, tag] = m;
    if (!closing) {
      styles.push(tag);
    } else if (styles[styles.length - 1] === tag) {
      styles.pop();
    } else {
      return line; // out of order: the line stays as it was written
    }
    at = m.index + m[0].length;
  }
  if (styles.length > 0) return line; // a tag that never closes
  return out + line.slice(at);
}

function linkifyStyleTags(text: string): string {
  return text.includes("<") ? text.split("\n").map(linkifyStyleLine).join("\n") : text;
}

// The note editor nests a list by two spaces a level, whatever the marker
// (lib/note-markup.ts). Markdown nests by the parent item's content column
// instead — three characters under "1. ", two under "- " — so a nested
// numbered item written by the editor came out flat once the note was
// rendered: nested while it was written, a plain second item after Done. The
// lines are re-indented to the columns markdown expects, so the rendered note
// nests exactly as the editor showed it.
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])(\s+)(.*)$/;
const FENCE_LINE = /^\s*(```|~~~)/;

function alignListIndents(text: string): string {
  // The content column of each open level: where a child of that item starts.
  const columns: number[] = [];
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (FENCE_LINE.test(line)) {
        fenced = !fenced;
        columns.length = 0;
        return line;
      }
      if (fenced) return line;
      const item = LIST_ITEM.exec(line);
      if (!item) {
        // A blank line sits inside a list; anything else closes it.
        if (line.trim() !== "") columns.length = 0;
        return line;
      }
      const [, spaces, marker, , body] = item;
      // Two spaces a level, and a level is never skipped.
      const level = Math.min(Math.floor(spaces.length / 2), columns.length);
      const indent = level === 0 ? 0 : columns[level - 1];
      columns.length = level;
      columns.push(indent + marker.length + 1);
      return `${" ".repeat(indent)}${marker} ${body}`;
    })
    .join("\n");
}

// Notes keep their line breaks: a newline typed in the editor stays a line
// break on display, where markdown alone folds single newlines into spaces —
// so the note has the same shape after Done as it had while editing. Two
// trailing spaces make a hard break; a break already marked, a blank line,
// and a fenced code block stay as they are.
function hardBreaks(text: string): string {
  const lines = text.split("\n");
  let fenced = false;
  return lines
    .map((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      const next = lines[i + 1];
      if (next === undefined || line.trim() === "" || next.trim() === "") return line;
      if (line.endsWith("  ") || line.endsWith("\\")) return line;
      return `${line}  `;
    })
    .join("\n");
}

// A dash list (SPEC.md §6): "+ " items, drawn with a dash for a marker, the
// way the note editor draws them (lib/note-markup.ts). Markdown reads "+"
// like "-", so the marker is read back from the source at the first item.
type MdNode = { type: string; children?: MdNode[] };

function remarkDashLists() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = String(file.value ?? "");
    const walk = (node: MdNode) => {
      if (node.type === "list") {
        const list = node as List;
        const at = list.children[0]?.position?.start.offset;
        if (!list.ordered && at !== undefined && source[at] === "+") {
          list.data = { ...list.data, hProperties: { className: ["note-dash"] } };
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree as unknown as MdNode);
  };
}

// A search lights up the words it found (SPEC.md §6): every run of text that
// matches the needle is wrapped in a mark, wherever it sits — a paragraph, a
// list item, a heading, a link, code. The same splitter paints the title row
// and the collapsed line (lib/search-hits.ts), so the whole note lights up
// the same way.
function markHits(children: ElementContent[], needle: string): ElementContent[] {
  const next: ElementContent[] = [];
  for (const child of children) {
    if (child.type === "text") {
      const runs = splitHits(child.value, needle);
      if (runs.length === 1 && !runs[0].hit) {
        next.push(child);
        continue;
      }
      for (const run of runs) {
        const text: HastText = { type: "text", value: run.text };
        next.push(
          run.hit
            ? { type: "element", tagName: "mark", properties: { className: ["search-hit"] }, children: [text] }
            : text,
        );
      }
      continue;
    }
    if (child.type === "element") child.children = markHits(child.children, needle);
    next.push(child);
  }
  return next;
}

function rehypeSearchHits(needle: string) {
  return (tree: HastRoot) => {
    tree.children = tree.children.map((child) => {
      if (child.type === "element") child.children = markHits(child.children, needle);
      return child;
    });
  };
}

// A link on a line of its own — a link dropped into the note, or written as
// its own paragraph — draws as a link card: the link's text, the site under
// it, the whole row a target (SPEC.md §6). A link inside a sentence stays a
// link in the sentence. The paragraph is read here, where the paragraph is
// known; the a override draws the card.
const LINK_CARD = "dataLinkCard";

function rehypeLinkCards() {
  return (tree: HastRoot) => {
    const walk = (node: HastRoot | HastElement) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "p") {
          const kept = child.children.filter((c) => !(c.type === "text" && c.value.trim() === ""));
          const only = kept.length === 1 ? kept[0] : null;
          const href = only?.type === "element" && only.tagName === "a" ? only.properties.href : undefined;
          if (only?.type === "element" && typeof href === "string" && /^https?:\/\//.test(href)) {
            only.properties[LINK_CARD] = "";
            child.properties.className = ["note-link-card-p"];
          }
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

// An annotation reference in a rendered note (SPEC.md §6,
// lib/annotation-reference.ts) draws as one box: the row is the box's head,
// the quote above the row is a quote symbol in the head, and the blocks
// after the row are the box's content. The note's markdown is the quote, the
// row, and the content, one after the other, so the content's end is read
// here: at the block the row's key names (contentEnd), so words written
// under the content stay outside the box; for a row with no key (a
// reference dropped before the box) or a key whose words were edited, at
// the next heading, quote, rule, or row, else the note's end. A reference
// with no content — a highlight that is only its quote — stays the quote
// and the row.
const BOX_HREF = "dataBoxHref";
const BOX_LABEL = "dataBoxLabel";
const BOX_QUOTE = "dataBoxQuote";

/** The annotation reference a block is: a paragraph that is one link to an annotation. */
function referenceRow(node: HastRoot["children"][number]): { href: string; label: string } | null {
  if (node.type !== "element" || node.tagName !== "p") return null;
  const kept = node.children.filter((c) => !(c.type === "text" && c.value.trim() === ""));
  const only = kept.length === 1 ? kept[0] : null;
  if (only?.type !== "element" || only.tagName !== "a") return null;
  const href = only.properties.href;
  if (typeof href !== "string" || !parseAnnotationReference(href)) return null;
  return { href, label: hastText(only) };
}

const blank = (node: HastRoot["children"][number]) => node.type !== "element";
const boxBoundary = (node: HastRoot["children"][number]) =>
  node.type === "element" && (/^(h[1-6]|blockquote|hr)$/.test(node.tagName) || referenceRow(node) !== null);

function rehypeAnnotationBoxes() {
  return (tree: HastRoot) => {
    const kids = tree.children;
    const out: HastRoot["children"] = [];
    for (let i = 0; i < kids.length; i++) {
      const row = referenceRow(kids[i]);
      const reference = row ? parseAnnotationReference(row.href) : null;
      if (!row || !reference || reference.box === BOX_EMPTY) {
        out.push(kids[i]);
        continue;
      }
      // The blocks after the row, to the next row: the content is among them.
      let stop = i + 1;
      while (stop < kids.length && !referenceRow(kids[stop])) stop++;
      const after = kids.slice(i + 1, stop);
      let count = -1;
      if (reference.box) count = contentEnd(reference.box, after.map((n) => (blank(n) ? "" : hastText(n)))) + 1;
      if (count <= 0) {
        // No key, or its words were edited. A highlight with no key keeps
        // its quote and its row: what follows it may be the reader's words.
        if (!reference.box && reference.kind === "highlight") count = 0;
        else {
          const to = after.findIndex(boxBoundary);
          count = to < 0 ? after.length : to;
        }
      }
      const content = after.slice(0, count);
      while (content.length > 0 && blank(content[content.length - 1])) content.pop();
      if (content.every(blank)) {
        out.push(kids[i]);
        continue;
      }
      // The quote right above the row goes into the head.
      let quote = "";
      let last = out.length - 1;
      while (last >= 0 && blank(out[last])) last--;
      const above = last >= 0 ? out[last] : null;
      if (above?.type === "element" && above.tagName === "blockquote") {
        quote = hastText(above).trim();
        out.length = last;
      }
      out.push({
        type: "element",
        tagName: "section",
        properties: { [BOX_HREF]: row.href, [BOX_LABEL]: row.label, [BOX_QUOTE]: quote },
        children: content as ElementContent[],
      });
      i += content.length;
    }
    tree.children = out;
  };
}

function LinkCard({ href, children }: { href: string; children: React.ReactNode }) {
  const host = linkHost(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      data-track="note-link-open"
      className="note-link-card"
    >
      <span className="note-link-card-icon">
        <LinkIcon size={14} />
      </span>
      <span className="note-link-card-text">
        <span className="note-link-card-title">{children}</span>
        {host && <span className="note-link-card-host">{host}</span>}
      </span>
    </a>
  );
}

// An annotation reference (SPEC.md §6, lib/annotation-reference.ts): a link
// to the reader that names an annotation draws as a row — the annotation
// glyph, the reference's text, "Annotation" under it — and a click opens the
// annotation: beside the note on the notes full page (onOpen), else in the
// reader.
function AnnotationReferenceCard({
  href,
  kind,
  children,
  onOpen,
}: {
  href: string;
  /** The annotation's kind: the row's symbol and color (lib/annotations/kind.ts). */
  kind: AnnotationItem["kind"] | null;
  children: React.ReactNode;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <a
      href={href}
      draggable={false}
      data-track="note-annotation-open"
      data-tip={t("outline.annotationReferenceTitle")}
      className="note-link-card note-annotation-ref"
      style={kind ? ({ "--kind": annotationKindColor(kind, null) } as React.CSSProperties) : undefined}
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      <span className="note-link-card-icon">
        {kind && kind !== "highlight" ? <AnnotationKindIcon kind={kind} size={14} /> : <CommentIcon size={14} />}
      </span>
      <span className="note-link-card-text">
        <span className="note-link-card-title">{children}</span>
        <span className="note-link-card-host">{t("outline.annotationReference")}</span>
      </span>
    </a>
  );
}

// The line a checklist item sits on, handed from the item to its box: the
// box's own node carries no position.
const TaskLine = createContext(-1);

// The words of a rendered node, for matching a quote to its source.
function hastText(node: { type: string; value?: string; children?: unknown[] } | undefined): string {
  if (!node) return "";
  if (node.type === "text" && typeof node.value === "string") return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map((child) => hastText(child as { type: string })).join("");
  }
  return "";
}

function AnchorGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5v13M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

// What the element overrides below read: the text as rendered (a list item
// finds its line in it), the note's sources, the notebook, and the two
// callbacks. Handed down by context, so the overrides are defined once.
type MarkdownData = {
  text: string;
  sources?: SourceChip[];
  notebookId?: string;
  onToggleTask?: (line: number, checked: boolean) => void;
  onAnnotationReference?: (ref: ParsedAnnotationReference & { label: string }) => void;
};
const MarkdownData = createContext<MarkdownData>({ text: "" });

// The element overrides. Each is one component defined here, at module level,
// and never inside Markdown: react-markdown mounts an override as a
// component, so a function made on every render is a new component type,
// and React tears the rendered nodes down and builds them again on each
// render of Markdown. That took every click in a note whose card re-rendered
// during the press — a hold's pending state re-renders the card on
// pointerdown — because the pressed node was gone by the release, and the
// browser fires no click then.
type Override<Tag extends keyof React.JSX.IntrinsicElements> = React.JSX.IntrinsicElements[Tag] & ExtraProps;

/** A quote whose words are a source's points back to the reader (SPEC.md §6):
    a click jumps to the source, and the line under the words names the document. */
function QuoteBlock({ node, children: quoteChildren, ...props }: Override<"blockquote">) {
  const { sources, notebookId } = useContext(MarkdownData);
  const t = useT();
  const router = useRouter();
  const source = sources && sources.length > 0 && notebookId ? sourceOfQuote(hastText(node), sources) : null;
  if (!source) return <blockquote {...props}>{quoteChildren}</blockquote>;
  const href = `/n/${notebookId}?doc=${source.documentId}&src=${source.id}`;
  // A source whose document was deleted keeps its quote and has nowhere to jump.
  const deleted = source.documentId === "";
  const jump = (e: { currentTarget: Element }) => {
    if (source.orphaned || deleted) return;
    // A click that ends a selection of the quote's own words belongs
    // to the selection. A selection left elsewhere on the page does
    // not hold the jump.
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.toString().trim() !== "" &&
      e.currentTarget.contains(selection.anchorNode)
    )
      return;
    selection?.removeAllRanges();
    // The reader opens on the source's document (another document
    // remounts the reader, which flashes ?src on mount) and, when it
    // is already open on it, the event flashes the mark at once.
    router.push(href);
    window.dispatchEvent(new CustomEvent("dissect:flash-source", { detail: { sourceId: source.id } }));
  };
  return (
    <blockquote
      {...props}
      className={source.orphaned ? "note-quote-orphaned" : "note-quote-linked"}
      onClick={jump}
      data-tip={
        deleted ? t("outline.quoteDocumentDeleted") : source.orphaned ? t("outline.quoteUnresolved") : t("outline.quoteJump")
      }
      data-track="note-quote-jump"
    >
      {quoteChildren}
      <span className="note-quote-source">
        <AnchorGlyph />
        <span className="truncate">
          {deleted ? t("outline.deletedDocument") : source.documentTitle}
          {source.orphaned && !deleted ? ` · ${t("outline.unresolvedLabel")}` : ""}
        </span>
      </span>
    </blockquote>
  );
}

/** A list item hands its line (from 0) to the checklist box inside it. */
function ListItem({ node, children: itemChildren, ...props }: Override<"li">) {
  const { text } = useContext(MarkdownData);
  const offset = node?.position?.start.offset;
  const line = offset === undefined ? -1 : text.slice(0, offset).split("\n").length - 1;
  return (
    <li {...props}>
      <TaskLine.Provider value={line}>{itemChildren}</TaskLine.Provider>
    </li>
  );
}

function TaskInput({ type, checked }: Override<"input">) {
  const { onToggleTask } = useContext(MarkdownData);
  if (type !== "checkbox") return null;
  return <TaskBox checked={Boolean(checked)} onToggle={onToggleTask} />;
}

// A visualization's image opens the viewer (SPEC.md §20): the picture large,
// in the app, with its caption — the alt text, which the annotation's
// markdown sets to the caption.
function Image({ src, alt }: Override<"img">) {
  const t = useT();
  const source = typeof src === "string" ? src : undefined;
  // A stored SVG, served immutable: next/image has nothing to add.
  if (!isVisualizationImage(source)) {
    // An image in a note sizes itself to the column unless the reader set
    // a width in the editor; the width rides in the url.
    const width = source ? imageWidth(source) : null;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={source}
        alt={alt ?? ""}
        className="note-image"
        // A note is picked up by a hold anywhere on it: the browser's own
        // drag of the picture would take the hold.
        draggable={false}
        loading="lazy"
        style={width === null ? undefined : { width }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => openVisualization({ src: source, caption: alt ?? "" })}
      data-track="visualization-open"
      data-tip={t("reader.openVisualizationTitle")}
      className="block w-full cursor-zoom-in rounded-xl bg-card"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source} alt={alt ?? ""} className="my-0 w-full rounded-xl" />
    </button>
  );
}

// A cited [note <id>] is a note or an annotation (annotations are notes of
// the hidden Annotations section). An annotation opens on its mark: its card
// in the Annotations tab when its document is open, else the reader on its
// document. A note opens in the notes tray.
async function showCitedNote(noteId: string, go: (href: string) => void): Promise<void> {
  const showNote = () => {
    window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } }));
  };
  let annotation: ReferencedAnnotation | null = null;
  try {
    const res = await fetch(`/api/annotations/${encodeURIComponent(noteId)}`);
    if (res.ok) annotation = (await res.json()) as ReferencedAnnotation;
  } catch {
    // Offline or gone: the notes tray is the answer.
  }
  if (!annotation?.documentId) return showNote();
  const here = new URLSearchParams(window.location.search).get("doc");
  if (here === annotation.documentId && annotation.sourceId) {
    const detail = { sourceId: annotation.sourceId };
    window.dispatchEvent(new CustomEvent("dissect:flash-source", { detail }));
    window.dispatchEvent(new CustomEvent("dissect:focus-annotation", { detail }));
    return;
  }
  const notebookId = /^\/n\/([^/?#]+)/.exec(window.location.pathname)?.[1];
  if (!notebookId) return showNote();
  go(
    annotationReferenceHref(notebookId, {
      annotationId: annotation.id,
      documentId: annotation.documentId,
      sourceId: annotation.sourceId,
      kind: annotation.kind,
    }),
  );
}

/** Opens the annotation a reference names: beside the note on the notes
    full page (onAnnotationReference), else in the reader. */
function useOpenReference() {
  const { onAnnotationReference } = useContext(MarkdownData);
  const router = useRouter();
  return (href: string, reference: ParsedAnnotationReference, label: string) => {
    if (onAnnotationReference) {
      onAnnotationReference({ ...reference, label });
      return;
    }
    window.getSelection()?.removeAllRanges();
    router.push(href);
    // Already on that document: the push changes nothing, so the mark
    // flashes and the annotation opens from here.
    if (reference.sourceId) {
      window.dispatchEvent(new CustomEvent("dissect:flash-source", { detail: { sourceId: reference.sourceId } }));
      window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: reference.sourceId } }));
    }
  };
}

const QUOTE_TIP_MAX = 180;

/** The box an annotation reference draws as in a rendered note
    (rehypeAnnotationBoxes): the head names the annotation's kind and opens
    it; the quote symbol in the head stands for the words the annotation is
    anchored to and jumps to them in the reader; the content is the
    annotation's text. Any other section draws as it is. */
function AnnotationBox({ node, children: boxChildren, ...props }: Override<"section">) {
  const { sources, notebookId } = useContext(MarkdownData);
  const t = useT();
  const router = useRouter();
  const openReference = useOpenReference();
  const href = node?.properties[BOX_HREF];
  const reference = typeof href === "string" ? parseAnnotationReference(href) : null;
  if (typeof href !== "string" || !reference) return <section {...props}>{boxChildren}</section>;
  const label = String(node?.properties[BOX_LABEL] ?? "");
  const quote = String(node?.properties[BOX_QUOTE] ?? "");
  const kind = reference.kind;
  // Where the quote symbol jumps: the note's own source for these words
  // (the copy the drop made), else the annotation's anchor. A source whose
  // document was deleted, or whose anchor no longer resolves, has nowhere
  // to jump.
  const source = quote && sources && sources.length > 0 ? sourceOfQuote(quote, sources) : null;
  const target = source
    ? source.orphaned || source.documentId === ""
      ? null
      : { documentId: source.documentId, sourceId: source.id }
    : reference.sourceId
      ? { documentId: reference.documentId, sourceId: reference.sourceId }
      : null;
  const words = quote.replace(/\s+/g, " ");
  const clipped = words.length > QUOTE_TIP_MAX ? `${words.slice(0, QUOTE_TIP_MAX - 1)}…` : words;
  return (
    <section
      data-annotation-box=""
      className="note-annotation-box"
      style={kind ? ({ "--kind": annotationKindColor(kind, null) } as React.CSSProperties) : undefined}
    >
      <header className="note-annotation-box-head">
        <a
          href={href}
          draggable={false}
          data-track="note-annotation-open"
          data-tip={t("outline.annotationReferenceTitle")}
          className="note-annotation-box-name"
          onClick={(e) => {
            e.preventDefault();
            openReference(href, reference, label);
          }}
        >
          <span className="note-annotation-box-icon">
            {kind && kind !== "highlight" ? <AnnotationKindIcon kind={kind} size={13} /> : <CommentIcon size={13} />}
          </span>
          <span className="truncate">{label}</span>
        </a>
        {quote && (
          <button
            type="button"
            data-track="note-annotation-quote"
            data-tip={t(target ? "outline.annotationQuoteJump" : "outline.annotationQuote", { quote: clipped })}
            aria-label={t(target ? "outline.annotationQuoteJump" : "outline.annotationQuote", { quote: clipped })}
            aria-disabled={target ? undefined : true}
            className="note-annotation-box-quote"
            onClick={() => {
              if (!target || !notebookId) return;
              window.getSelection()?.removeAllRanges();
              // The reader opens on the quote's document and flashes the
              // words; already on it, the event flashes them at once.
              router.push(`/n/${notebookId}?doc=${encodeURIComponent(target.documentId)}&src=${encodeURIComponent(target.sourceId)}`);
              window.dispatchEvent(new CustomEvent("dissect:flash-source", { detail: { sourceId: target.sourceId } }));
            }}
          >
            <QuoteIcon size={12} />
          </button>
        )}
      </header>
      <div className="note-annotation-box-body">{boxChildren}</div>
    </section>
  );
}

function Link({ node, href, children: linkChildren, ...props }: Override<"a">) {
  const openReference = useOpenReference();
  const t = useT();
  const router = useRouter();
  // One link carries every style over its run, innermost last.
  const styleTags = href?.startsWith(STYLE_HREF) ? href.slice(STYLE_HREF.length).split("+") : null;
  if (styleTags) {
    const color = styleTags.find((tag) => STYLE_CLASS[tag]);
    let painted = <>{linkChildren}</>;
    if (color) painted = <span className={STYLE_CLASS[color]}>{painted}</span>;
    if (styleTags.includes("u")) painted = <u>{painted}</u>;
    return painted;
  }
  // The ✎ and ¶ chips keep their 18 px inside the line; on a touch screen a
  // transparent 9 px band around each makes a 36 px target (SPEC.md §6).
  const noteId = href?.startsWith(NOTE_HREF) ? href.slice(NOTE_HREF.length) : null;
  if (noteId) {
    return (
      <button
        type="button"
        onClick={() => void showCitedNote(noteId, (href) => router.push(href))}
        data-tip={t("panels.showCitedNote")}
        className="mx-0.5 inline-flex size-[18px] items-center justify-center rounded-full pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-[9px] pointer-coarse:after:content-[''] bg-sage-100 align-text-bottom text-[10px] font-semibold text-sage-800 no-underline hover:bg-sage-200"
      >
        ✎
      </button>
    );
  }
  const blockIds = href?.startsWith(BLOCKS_HREF) ? href.slice(BLOCKS_HREF.length).split(",") : null;
  if (blockIds) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId: blockIds[0], blockIds } }))}
        data-tip={t("panels.jumpToBlocks", { n: blockIds.length })}
        className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center gap-px rounded-full bg-clay-100 px-1.5 align-text-bottom text-[11px] font-semibold text-clay-800 no-underline hover:bg-clay-200"
      >
        ¶<span className="text-[10px] tabular-nums">{blockIds.length}</span>
      </button>
    );
  }
  const blockId = href?.startsWith(BLOCK_HREF) ? href.slice(BLOCK_HREF.length) : null;
  if (blockId) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId } }))}
        data-tip={t("panels.jumpToBlock")}
        className="mx-0.5 inline-flex size-[18px] items-center justify-center rounded-full pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-[9px] pointer-coarse:after:content-[''] bg-clay-100 align-text-bottom text-[11px] font-semibold text-clay-800 no-underline hover:bg-clay-200"
      >
        ¶
      </button>
    );
  }
  // An annotation reference (lib/annotation-reference.ts): the row opens
  // the annotation beside the note, or in the reader.
  const reference = parseAnnotationReference(href);
  if (reference && href) {
    return (
      <AnnotationReferenceCard
        href={href}
        kind={reference.kind}
        onOpen={() => openReference(href, reference, hastText(node))}
      >
        {linkChildren}
      </AnnotationReferenceCard>
    );
  }
  // An outside link (a web source the assistant cites) opens in a new tab;
  // the reader's page stays. A link on a line of its own is a link card
  // (rehypeLinkCards).
  const external = /^https?:\/\//.test(href ?? "");
  if (external && href && node?.properties[LINK_CARD] !== undefined) {
    return <LinkCard href={href}>{linkChildren}</LinkCard>;
  }
  return (
    <a href={href} {...props} draggable={false} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {linkChildren}
    </a>
  );
}

const components: Components = {
  blockquote: QuoteBlock,
  li: ListItem,
  input: TaskInput,
  img: Image,
  a: Link,
  section: AnnotationBox,
};

/** breaks: single newlines render as line breaks (notes). onToggleTask: a
    checklist item's box is a control; a click reports the item's line (from
    0) and its new state, and the caller saves the note (note-card.tsx).
    highlight: the text a search looks for; every match lights up.
    sources, with notebookId: the note's sources; a quote whose words are a
    source's points back to the reader (SPEC.md §6) — a click jumps to the
    source, and the line under the words names the document.
    onAnnotationReference: a click on an annotation reference opens the
    annotation here (the notes full page); unset, it opens the reader. */
export function Markdown({
  children,
  breaks = false,
  onToggleTask,
  highlight,
  sources,
  notebookId,
  onAnnotationReference,
}: {
  children: string;
  breaks?: boolean;
  onToggleTask?: (line: number, checked: boolean) => void;
  highlight?: string;
  sources?: SourceChip[];
  notebookId?: string;
  onAnnotationReference?: (ref: ParsedAnnotationReference & { label: string }) => void;
}) {
  // Lists line up first: hardBreaks reads the lines as they will be nested.
  // Both keep every line, so a line counted here is the same line in children.
  const text = breaks ? hardBreaks(alignListIndents(children)) : alignListIndents(children);
  const needle = highlight?.trim() ?? "";
  const rehypePlugins = useMemo(
    () =>
      needle
        ? [rehypeAnnotationBoxes, rehypeLinkCards, () => rehypeSearchHits(needle)]
        : [rehypeAnnotationBoxes, rehypeLinkCards],
    [needle],
  );
  const data = useMemo<MarkdownData>(
    () => ({ text, sources, notebookId, onToggleTask, onAnnotationReference }),
    [text, sources, notebookId, onToggleTask, onAnnotationReference],
  );
  return (
    <div className="prose prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5">
      <MarkdownData.Provider value={data}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkDashLists]} rehypePlugins={rehypePlugins} components={components}>
          {linkifyStyleTags(linkifyBlockTags(text))}
        </ReactMarkdown>
      </MarkdownData.Provider>
    </div>
  );
}

// A checklist item's box in a rendered note: ticked or clear as the note
// says, and a control when the reader may edit the note.
function TaskBox({ checked, onToggle }: { checked: boolean; onToggle?: (line: number, checked: boolean) => void }) {
  const t = useT();
  const line = useContext(TaskLine);
  if (!onToggle || line < 0) return <span className="note-box" data-checked={checked ? "" : undefined} />;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onToggle(line, !checked)}
      data-track="note-task"
      data-tip={t("outline.taskToggleTitle")}
      className="note-box"
      data-checked={checked ? "" : undefined}
    />
  );
}
