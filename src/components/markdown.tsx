"use client";

import type { Element as HastElement, ElementContent, Root as HastRoot, Text as HastText } from "hast";
import type { List, Root } from "mdast";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CommentIcon, LinkIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { isVisualizationImage, openVisualization } from "@/components/reader/visualization-viewer";
import { imageWidth } from "@/lib/note-markup";
import { parseAnnotationReference, type ParsedAnnotationReference } from "@/lib/annotation-reference";
import { linkHost } from "@/lib/note-links";
import { sourceOfQuote } from "@/lib/notes/quote-sources";
import { splitHits } from "@/lib/search-hits";
import type { SourceChip } from "@/lib/types";

// AI text cites document blocks as [block <id>] — the tags the model sees in
// its document context. They render as ¶ chips that scroll the reader to the
// block and flash it (the reader listens for dissect:flash-block).
const BLOCK_TAG = /\[block ([a-zA-Z0-9]+)\]/g;

function linkifyBlockTags(text: string): string {
  return text.replace(BLOCK_TAG, "[¶](#dissect-block-$1)");
}

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
  children,
  onOpen,
}: {
  href: string;
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
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      <span className="note-link-card-icon">
        <CommentIcon size={14} />
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
  const jump = (e: { currentTarget: Element }) => {
    if (source.orphaned) return;
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
      data-tip={source.orphaned ? t("outline.quoteUnresolved") : t("outline.quoteJump")}
      data-track="note-quote-jump"
    >
      {quoteChildren}
      <span className="note-quote-source">
        <AnchorGlyph />
        <span className="truncate">
          {source.documentTitle}
          {source.orphaned ? ` · ${t("outline.unresolvedLabel")}` : ""}
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

function Link({ node, href, children: linkChildren, ...props }: Override<"a">) {
  const { onAnnotationReference } = useContext(MarkdownData);
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
  const blockId = href?.startsWith("#dissect-block-") ? href.slice("#dissect-block-".length) : null;
  if (blockId) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId } }))}
        data-tip={t("panels.jumpToBlock")}
        className="mx-0.5 inline-flex size-[18px] items-center justify-center rounded-full bg-clay-100 align-text-bottom text-[11px] font-semibold text-clay-800 no-underline hover:bg-clay-200"
      >
        ¶
      </button>
    );
  }
  // An annotation reference (lib/annotation-reference.ts): the row opens
  // the annotation beside the note, or in the reader.
  const reference = parseAnnotationReference(href);
  if (reference && href) {
    const label = hastText(node);
    return (
      <AnnotationReferenceCard
        href={href}
        onOpen={() => {
          if (onAnnotationReference) {
            onAnnotationReference({ ...reference, label });
            return;
          }
          window.getSelection()?.removeAllRanges();
          router.push(href);
          // Already on that document: the push changes nothing, so the
          // mark flashes and the annotation opens from here.
          if (reference.sourceId) {
            window.dispatchEvent(
              new CustomEvent("dissect:flash-source", { detail: { sourceId: reference.sourceId } }),
            );
            window.dispatchEvent(
              new CustomEvent("dissect:open-annotation", { detail: { sourceId: reference.sourceId } }),
            );
          }
        }}
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

const components: Components = { blockquote: QuoteBlock, li: ListItem, input: TaskInput, img: Image, a: Link };

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
    () => (needle ? [rehypeLinkCards, () => rehypeSearchHits(needle)] : [rehypeLinkCards]),
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
