"use client";

import type { BlockType } from "@prisma/client";
import { useState } from "react";
import { ChartIcon, CommentIcon, LinkIcon, QuestionIcon, SparkleIcon, SummaryIcon, UnlinkIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Equation } from "@/components/reader/equation";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

const CHAIN_BUTTON =
  "link-chain mx-0.5 inline-flex size-[16px] items-center justify-center rounded-full bg-clay-100 align-text-top text-clay-700 hover:bg-clay-200 hover:text-clay-800";
// The symbol at the end of a highlighted text — the tool that made the
// annotation, or the comment bubble. A small round chip on the highlight's
// bottom edge, right after its last character (globals.css .mark-chip);
// clicking it opens the card. SVG only, so the block's DOM text stays exactly
// the stored text (SPEC.md §5).
const MARK_CHIP =
  "mark-chip inline-flex items-center justify-center rounded-full bg-clay-100 text-clay-700 hover:bg-clay-200 hover:text-clay-800";

export type BlockData = {
  id: string;
  type: BlockType;
  text: string;
  html: string | null;
};

export type Highlight = {
  sourceId: string | null;
  start: number;
  end: number;
  kind: "anchor" | "salience" | "simplify" | "term" | "link" | "citation" | "weblink" | "edited" | "style" | "toc" | "extract";
  // kind "style" only
  styleKind?:
    | "bold"
    | "italic"
    | "underline"
    | "code"
    | "color-clay"
    | "color-sage"
    | "color-gold"
    | "color-plum";
  definition?: string; // glossary hover text, kind "term" only
  color?: string | null; // highlight hue ("clay" | "sage" | "gold" | "plum"), kind "anchor" only
  annotation?: boolean; // anchor belongs to an annotation; click focuses its card
  comment?: boolean; // comment annotation: a comment icon renders after the span
  noteId?: string; // owning note; on a regular note's mark, click jumps to the note in the tray
  // The stored AI annotation's tool symbol renders at the end of the span, in
  // every view; the symbol opens the card. Kind "anchor" only.
  tool?: "explain" | "simplify" | "analyze" | "assistant";
  href?: string; // navigation target, kinds "link" and "weblink"
  linkTitle?: string; // the other end's document title, kind "link" only
  linkId?: string; // for arrival flashing via ?link=, kind "link" only
  referenceId?: string; // target reference entry, kind "citation" only
  referenceText?: string; // the reference text, shown on hover, kind "citation" only
  targetBlockId?: string; // Contents entry target: click scrolls to the block, kind "toc" only
  figureLabel?: string | null; // "A1"… label on an annotated figure/table/equation anchor
  // kind "extract": the extraction this span belongs to. The label chip after
  // a passage jumps to the origin; the origin's chip opens the extract card.
  extractId?: string;
  extractLabel?: string;
  extractOrigin?: boolean;
  fresh?: boolean; // made in this session: the mark sweeps in left to right
  freshDelay?: number; // ms before the sweep starts; staggers a layer's spans
};

function anchorClass(color: string | null | undefined): string {
  if (color === "sage") return "hl-sage";
  if (color === "gold") return "hl-gold";
  if (color === "plum") return "hl-plum";
  return "anchor-mark";
}

// Each AI tool's symbol, at the end of its highlighted text — the glyph on
// the toolbar button and on the group label in the Annotations tab.
type ToolKind = "explain" | "simplify" | "analyze" | "assistant";
const TOOL_ICON: Record<ToolKind, (props: { size?: number }) => React.ReactNode> = {
  explain: QuestionIcon,
  simplify: SummaryIcon,
  analyze: ChartIcon,
  assistant: SparkleIcon,
};
const TOOL_KEY: Record<ToolKind, TKey> = {
  explain: "panes.openExplanation",
  simplify: "panes.openSimplified",
  analyze: "panes.openAnalysis",
  assistant: "panes.openConversation",
};

function headingLevel(html: string | null): 1 | 2 | 3 {
  const m = html?.match(/^<h([1-3])/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : 2;
}

// Split block text into plain and <mark> segments. Declarative painting: highlights are part
// of the React tree, never DOM mutation after render (anchor offsets stay stable).
function markedText(text: string, highlights: Highlight[], t: TFunc) {
  const bounds = new Set<number>([0, text.length]);
  for (const h of highlights) {
    bounds.add(Math.max(0, Math.min(h.start, text.length)));
    bounds.add(Math.max(0, Math.min(h.end, text.length)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const covering = highlights.filter((h) => h.start <= from && h.end >= to);
    const segment = text.slice(from, to);
    if (covering.length === 0) {
      parts.push(segment);
      continue;
    }
    const link = covering.find((h) => h.kind === "link");
    const citation = covering.find((h) => h.kind === "citation");
    const weblink = covering.find((h) => h.kind === "weblink");
    const toc = covering.find((h) => h.kind === "toc");
    const edited = covering.some((h) => h.kind === "edited");
    const bold = covering.some((h) => h.kind === "style" && h.styleKind === "bold");
    const italic = covering.some((h) => h.kind === "style" && h.styleKind === "italic");
    const underlined = covering.some((h) => h.kind === "style" && h.styleKind === "underline");
    const code = covering.some((h) => h.kind === "style" && h.styleKind === "code");
    const colored = covering.find((h) => h.kind === "style" && h.styleKind?.startsWith("color-"));
    const editedClass = `${edited ? " edited-text" : ""}${bold ? " font-bold" : ""}${italic ? " italic" : ""}${underlined ? " underline" : ""}${colored ? ` text-${colored.styleKind}` : ""}${code ? " code-mark" : ""}`;
    const anchors = covering.filter((h) => h.kind === "anchor");
    const anchor =
      anchors.length > 1
        ? anchors.reduce((n, h) => (h.end - h.start < n.end - n.start ? h : n))
        : anchors[0];
    const salience = covering.find((h) => h.kind === "salience");
    const simplify = covering.find((h) => h.kind === "simplify");
    const term = covering.find((h) => h.kind === "term");
    const extract = covering.find((h) => h.kind === "extract");
    if (link) {
      parts.push(
        <a
          key={from}
          href={link.href}
          data-link-id={link.linkId}
          data-source-id={anchor?.sourceId ?? undefined}
          data-tip={link.linkTitle ? t("panes.linkedTo", { title: link.linkTitle }) : undefined}
          className={`link-mark rounded-[4px]${editedClass}`}
        >
          {segment}
        </a>,
      );
      // A completed link carries a closed chain at its right side.
      if (link.end === to) {
        parts.push(
          <a
            key={`chain-${from}`}
            href={link.href}
            data-anchor-skip
            aria-label={link.linkTitle ? t("panes.linkedTo", { title: link.linkTitle }) : t("panes.linked")}
            data-tip={link.linkTitle ? t("panes.linkedTo", { title: link.linkTitle }) : t("panes.linked")}
            className={CHAIN_BUTTON}
          >
            <LinkIcon size={10} />
          </a>,
        );
      }
    } else if (citation) {
      // In-text citation: click jumps to its entry in the References section.
      parts.push(
        <a
          key={from}
          href={`#reference-${citation.referenceId}`}
          data-source-id={anchor?.sourceId ?? undefined}
          data-tip={citation.referenceText}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("dissect:open-reference", {
                detail: { referenceId: citation.referenceId, origin: e.currentTarget },
              }),
            );
          }}
          className={`citation-mark rounded-[4px]${editedClass}`}
        >
          {segment}
        </a>,
      );
    } else if (toc) {
      // Contents entry: click scrolls the reader to its section heading.
      parts.push(
        <a
          key={from}
          href={`#block-${toc.targetBlockId}`}
          data-source-id={anchor?.sourceId ?? undefined}
          data-tip={t("panes.jumpToSection")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("dissect:flash-block", {
                detail: { blockId: toc.targetBlockId },
              }),
            );
          }}
          className={`toc-mark rounded-[4px]${editedClass}`}
        >
          {segment}
        </a>,
      );
    } else if (weblink) {
      // URL-shaped text: a plain hyperlink out of the app.
      parts.push(
        <a
          key={from}
          href={weblink.href}
          target="_blank"
          rel="noopener noreferrer"
          data-source-id={anchor?.sourceId ?? undefined}
          className={`weblink-mark${editedClass}`}
        >
          {segment}
        </a>,
      );
    } else if (anchor || salience || simplify || extract) {
      const focusable = anchor?.annotation && anchor.sourceId;
      // A regular note's mark: click jumps to the note in the tray — the
      // link between quote and note works both ways.
      const noteMark = !anchor?.annotation && anchor?.noteId ? anchor.noteId : null;
      // A comment's icon sits right after its span; SVG only, so the block's
      // DOM text stays exactly the stored text (SPEC.md §5).
      const commentEnding = covering.find(
        (h) => h.kind === "anchor" && h.comment && h.sourceId && h.end === to,
      );
      const markClass = simplify
        ? "simplify-mark"
        : anchor
          ? anchorClass(anchor.color)
          : extract
            ? extract.extractOrigin
              ? "extract-origin-mark"
              : "extract-mark"
            : "salience-mark";
      // The highlight that gave the segment its class also decides the sweep:
      // fresh marks sweep in left to right (globals.css .mark-sweep).
      const painted = simplify ?? anchor ?? extract ?? salience;
      parts.push(
        <mark
          key={from}
          data-source-id={anchor?.sourceId ?? undefined}
          data-tip={focusable ? t("panes.viewAnnotation") : noteMark ? t("panes.viewNote") : undefined}
          onClick={
            focusable
              ? (e) => {
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent("dissect:open-annotation", {
                      detail: { sourceId: anchor.sourceId },
                    }),
                  );
                }
              : noteMark
                ? (e) => {
                    e.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("dissect:show-note", { detail: { noteId: noteMark } }),
                    );
                  }
                : undefined
          }
          className={`${markClass}${anchors.length > 1 ? " hl-stacked" : ""}${painted?.fresh ? " mark-sweep" : ""} rounded-[4px] ${focusable || noteMark ? "annotation-mark" : ""}${editedClass}`}
          style={
            painted?.fresh && painted.freshDelay
              ? { animationDelay: `${painted.freshDelay}ms` }
              : undefined
          }
        >
          {segment}
        </mark>,
      );
      // An extract span carries its label chip right after the span: a
      // passage's chip jumps back to the origin phrase; the origin's chip
      // opens the extract card. The chip's label is DOM text the stored block
      // text does not have — data-anchor-skip keeps it out of anchor offsets
      // (SPEC.md §5).
      const extractEnding = covering.find(
        (h) => h.kind === "extract" && h.end === to && h.extractLabel,
      );
      if (extractEnding) {
        parts.push(
          <button
            key={`extract-${from}`}
            type="button"
            data-anchor-skip
            data-track="extract-chip"
            aria-label={
              extractEnding.extractOrigin
                ? t("panes.extractStartedHere", { label: extractEnding.extractLabel ?? "" })
                : t("panes.extractJumpToOrigin", { label: extractEnding.extractLabel ?? "" })
            }
            data-tip={
              extractEnding.extractOrigin
                ? t("panes.extractStartedHereDetails", { label: extractEnding.extractLabel ?? "" })
                : t("panes.extractJumpToOrigin", { label: extractEnding.extractLabel ?? "" })
            }
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("dissect:extract-chip", {
                  detail: {
                    extractId: extractEnding.extractId,
                    origin: Boolean(extractEnding.extractOrigin),
                    element: e.currentTarget,
                  },
                }),
              );
            }}
            className="mx-0.5 inline-flex h-4 items-center rounded-full bg-clay-100 px-1.5 align-text-top text-[9.5px] font-bold text-clay-700 hover:bg-clay-200 hover:text-clay-800"
          >
            {extractEnding.extractLabel}
          </button>,
        );
      }
      // A stored AI annotation's tool symbol sits at the end of its span —
      // explain, simplify, or assistant — and opens the card.
      const toolEnding = covering.find(
        (h) => h.kind === "anchor" && h.tool && h.sourceId && h.end === to,
      );
      if (toolEnding?.tool) {
        const ToolIcon = TOOL_ICON[toolEnding.tool];
        parts.push(
          <button
            key={`tool-${from}`}
            type="button"
            data-anchor-skip
            data-track="tool-chip"
            aria-label={t(TOOL_KEY[toolEnding.tool])}
            data-tip={t(TOOL_KEY[toolEnding.tool])}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("dissect:open-annotation", {
                  detail: { sourceId: toolEnding.sourceId },
                }),
              );
            }}
            className={MARK_CHIP}
          >
            <ToolIcon size={10} />
          </button>,
        );
      }
      if (commentEnding) {
        parts.push(
          <button
            key={`comment-${from}`}
            type="button"
            data-anchor-skip
            data-track="comment-icon"
            aria-label={t("panes.openComment")}
            data-tip={t("panes.openComment")}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("dissect:open-annotation", {
                  detail: { sourceId: commentEnding.sourceId },
                }),
              );
            }}
            className={`comment-dot ${MARK_CHIP}`}
          >
            <CommentIcon size={10} />
          </button>,
        );
      }
      // A highlight's broken chain starts a link from it: the next text the
      // reader highlights — this article or another — completes the link.
      const linkStart = covering.find(
        (h) => h.kind === "anchor" && h.color && h.sourceId && h.end === to,
      );
      if (linkStart) {
        parts.push(
          <button
            key={`link-start-${from}`}
            type="button"
            data-anchor-skip
            data-track="link-chip"
            aria-label={t("panes.linkToOtherTexts")}
            data-tip={t("panes.linkToOtherTexts")}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("dissect:start-link", {
                  detail: { sourceId: linkStart.sourceId, origin: e.currentTarget },
                }),
              );
            }}
            className={CHAIN_BUTTON}
          >
            <UnlinkIcon size={10} />
          </button>,
        );
      }
    } else if (term) {
      // Glossary term: hover for the definition; press for the selection
      // toolbar on the term, with Extract recommended. Dispatched on mousedown
      // so the toolbar survives the selection capture on mouseup.
      parts.push(
        <span
          key={from}
          data-tip={
            term.definition
              ? `${term.definition}\n\n${t("panes.clickForTools")}`
              : t("panes.clickForTools")
          }
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("dissect:term-tools", {
                detail: { start: term.start, end: term.end, origin: e.currentTarget },
              }),
            );
          }}
          className={`glossary-term cursor-pointer border-b-2 border-dotted border-clay-400 hover:border-clay-600${editedClass}`}
        >
          {segment}
        </span>,
      );
    } else {
      // Only decoration layers (edited, bold, italic) cover this segment.
      parts.push(
        editedClass ? (
          <span key={from} className={editedClass.trim()}>
            {segment}
          </span>
        ) : (
          segment
        ),
      );
    }
  }
  return parts;
}

const LABEL_DOT: Record<string, string> = {
  clay: "var(--clay-400)",
  sage: "var(--sage-500)",
  gold: "#d9a54a",
  plum: "#a78bfa",
};

// A highlighted figure, table, or equation gets a side label instead of text
// marks: it sits to the right of the block and jumps to the annotation. The
// label shows the block's annotation ids ("A1"), matching the chips on the
// annotation cards, behind the symbol of the tool that made the annotation
// (a color dot for a plain highlight). Outside the block element, so the
// block's DOM text stays exactly the stored text (SPEC.md §5).
function HighlightLabel({ anchors }: { anchors: Highlight[] }) {
  const t = useT();
  const focusable = anchors.find((h) => h.annotation && h.sourceId);
  const noteMark = anchors.find((h) => !h.annotation && h.noteId);
  const color = anchors.find((h) => h.color)?.color ?? "clay";
  const tool = anchors.find((h) => h.tool)?.tool;
  const ToolIcon = tool ? TOOL_ICON[tool] : null;
  const labels = anchors.map((h) => h.figureLabel).filter((l): l is string => Boolean(l));
  const text = labels.length > 0 ? labels.join(" · ") : t("panes.highlighted");
  return (
    <button
      data-track="figure-label"
      onClick={
        focusable?.sourceId
          ? () =>
              window.dispatchEvent(
                new CustomEvent("dissect:open-annotation", {
                  detail: { sourceId: focusable.sourceId },
                }),
              )
          : noteMark?.noteId
            ? () =>
                window.dispatchEvent(
                  new CustomEvent("dissect:show-note", {
                    detail: { noteId: noteMark.noteId },
                  }),
                )
            : undefined
      }
      data-tip={
        focusable
          ? t("panes.figureAnnotatedTitle", { text })
          : t("panes.figureHighlightedTitle", { text })
      }
      className="absolute top-2 right-0 z-10 flex translate-x-[calc(100%+10px)] items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[10.5px] font-semibold text-sand-700 shadow-soft hover:text-clay-800"
    >
      {ToolIcon ? (
        <ToolIcon size={11} />
      ) : (
        <span aria-hidden className="size-2 rounded-full" style={{ background: LABEL_DOT[color] ?? LABEL_DOT.clay }} />
      )}
      {text}
    </button>
  );
}

// A PDF figure's visual: its page rendered by the figure image route. alt is
// empty and the image hides on error (page null, old document), so the block's
// DOM text stays exactly the caption (SPEC.md §5).
function FigureImage({ documentId, blockId }: { documentId: string; blockId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/documents/${documentId}/figure/${blockId}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="mb-3 max-h-[28rem] object-contain"
    />
  );
}

// Text blocks render block.text verbatim so DOM text content matches stored text
// (anchor offsets depend on this, SPEC.md §5). Tables and figures render sanitized html.
export function BlockView({
  block,
  highlights = [],
  documentId,
}: {
  block: BlockData;
  highlights?: Highlight[];
  documentId?: string;
}) {
  const t = useT();
  const shared = "reader-block";

  const content = highlights.length > 0 ? markedText(block.text, highlights, t) : block.text;
  const anchorIds = highlights.filter((h) => h.kind === "anchor" && h.sourceId);
  const figureAnchors = highlights.filter((h) => h.kind === "anchor");
  const htmlHighlighted = anchorIds.length > 0 ? "rounded-lg ring-2 ring-clay-300" : "";
  const firstSourceId = anchorIds[0]?.sourceId ?? undefined;

  switch (block.type) {
    case "HEADING": {
      const level = headingLevel(block.html);
      const cls =
        level === 1
          ? "mt-10 mb-3 text-[26px]"
          : level === 2
            ? "mt-8 mb-2.5 text-[22px]"
            : "mt-6 mb-2.5 text-[20px]";
      if (level === 1) return <h1 data-block-id={block.id} className={`${shared} ${cls}`}>{content}</h1>;
      if (level === 2) return <h2 data-block-id={block.id} className={`${shared} ${cls}`}>{content}</h2>;
      return <h3 data-block-id={block.id} className={`${shared} ${cls}`}>{content}</h3>;
    }
    case "PARAGRAPH":
      return (
        <p data-block-id={block.id} className={`${shared} my-4 whitespace-pre-wrap`}>
          {content}
        </p>
      );
    case "LIST":
      return (
        <div data-block-id={block.id} className={`${shared} my-4 pl-5 whitespace-pre-wrap`}>
          {content}
        </div>
      );
    case "CODE":
      return (
        <pre
          data-block-id={block.id}
          className={`${shared} my-4 overflow-x-auto rounded-2xl bg-sand-200 p-4 text-sm`}
        >
          {content}
        </pre>
      );
    case "EQUATION":
      return (
        <div className="relative">
          <div
            data-block-id={block.id}
            data-math-block
            data-source-id={firstSourceId}
            className={`${shared} my-4 ${htmlHighlighted}`}
          >
            <Equation tex={block.text} />
          </div>
          {figureAnchors.length > 0 && <HighlightLabel anchors={figureAnchors} />}
        </div>
      );
    case "SEPARATOR":
      return (
        <div data-block-id={block.id} className={`${shared} my-8`} aria-hidden>
          <hr className="border-t border-line" />
        </div>
      );
    // Video documents render in the video pane; these cases keep the switch
    // total for the odd place a video block meets the text renderer.
    case "TRANSCRIPT":
      return (
        <p data-block-id={block.id} className={`${shared} my-4 whitespace-pre-wrap`}>
          {content}
        </p>
      );
    case "VIDEO":
      return (
        <p data-block-id={block.id} className={`${shared} my-4 text-sm text-sand-600 italic`}>
          {t("panes.videoBlock", { text: block.text })}
        </p>
      );
    // Handwritten pages render through PageBlock in the reader (SPEC.md §16);
    // this case keeps the switch total for the odd place a PAGE block meets
    // the plain block renderer.
    case "PAGE":
      if (documentId) {
        return (
          <div data-block-id={block.id} className={`${shared} my-6`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/documents/${documentId}/page/${block.id}`}
              alt=""
              loading="lazy"
              draggable={false}
              className="w-full rounded-xl shadow-soft"
            />
          </div>
        );
      }
      return (
        <p data-block-id={block.id} className={`${shared} my-4 text-sm text-sand-600 italic`}>
          {content}
        </p>
      );
    case "TABLE":
      if (block.html) {
        return (
          <div className="relative">
            <div
              data-block-id={block.id}
              data-source-id={firstSourceId}
              className={`${shared} reader-table my-3 overflow-x-auto text-sm ${htmlHighlighted}`}
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
            {figureAnchors.length > 0 && <HighlightLabel anchors={figureAnchors} />}
          </div>
        );
      }
      return (
        <div className="relative">
          <pre data-block-id={block.id} data-source-id={firstSourceId} className={`${shared} my-3 overflow-x-auto font-mono text-sm ${htmlHighlighted}`}>
            {content}
          </pre>
          {figureAnchors.length > 0 && <HighlightLabel anchors={figureAnchors} />}
        </div>
      );
    case "FIGURE":
      if (block.html) {
        return (
          <div className="relative">
            <div
              data-block-id={block.id}
              data-source-id={firstSourceId}
              className={`${shared} reader-figure my-4 ${htmlHighlighted}`}
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
            {figureAnchors.length > 0 && <HighlightLabel anchors={figureAnchors} />}
          </div>
        );
      }
      // A PDF figure: the image route renders its page; the caption stays the
      // block's only DOM text (SPEC.md §5). Without a documentId, or when the
      // route 404s (page null), only the caption renders.
      if (documentId) {
        return (
          <div className="relative">
            <div
              data-block-id={block.id}
              data-source-id={firstSourceId}
              className={`${shared} reader-figure my-4 ${htmlHighlighted}`}
            >
              <FigureImage documentId={documentId} blockId={block.id} />
              <p className="text-sm text-sand-600 italic">{content}</p>
            </div>
            {figureAnchors.length > 0 && <HighlightLabel anchors={figureAnchors} />}
          </div>
        );
      }
      return (
        <p data-block-id={block.id} data-source-id={firstSourceId} className={`${shared} my-4 text-sm text-sand-600 italic ${htmlHighlighted}`}>
          {content}
        </p>
      );
  }
}
