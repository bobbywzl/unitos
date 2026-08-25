import type { BlockType } from "@prisma/client";
import { LinkIcon, UnlinkIcon } from "@/components/icons";
import { Equation } from "@/components/reader/equation";

const CHAIN_BUTTON =
  "link-chain mx-0.5 inline-flex size-[16px] items-center justify-center rounded-full bg-clay-100 align-text-top text-clay-700 hover:bg-clay-200 hover:text-clay-800";

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
  styleKind?: "bold" | "italic" | "underline" | "code"; // kind "style" only
  definition?: string; // glossary hover text, kind "term" only
  color?: string | null; // highlight hue ("clay" | "sage" | "gold" | "plum"), kind "anchor" only
  annotation?: boolean; // anchor belongs to an annotation; click focuses its card
  comment?: boolean; // comment annotation: a comment icon renders after the span
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
};

function anchorClass(color: string | null | undefined): string {
  if (color === "sage") return "hl-sage";
  if (color === "gold") return "hl-gold";
  if (color === "plum") return "hl-plum";
  return "anchor-mark";
}

function headingLevel(html: string | null): 1 | 2 | 3 {
  const m = html?.match(/^<h([1-3])/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : 2;
}

// Split block text into plain and <mark> segments. Declarative painting: highlights are part
// of the React tree, never DOM mutation after render (anchor offsets stay stable).
function markedText(text: string, highlights: Highlight[]) {
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
    const editedClass = `${edited ? " edited-text" : ""}${bold ? " font-bold" : ""}${italic ? " italic" : ""}${underlined ? " underline" : ""}${code ? " code-mark" : ""}`;
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
          title={link.linkTitle ? `Linked: ${link.linkTitle}` : undefined}
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
            aria-label={link.linkTitle ? `Linked: ${link.linkTitle}` : "Linked"}
            title={link.linkTitle ? `Linked: ${link.linkTitle}` : "Linked"}
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
          title={citation.referenceText}
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
          title="Jump to this section"
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
      parts.push(
        <mark
          key={from}
          data-source-id={anchor?.sourceId ?? undefined}
          title={focusable ? "Click to view the annotation" : undefined}
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
              : undefined
          }
          className={`${markClass}${anchors.length > 1 ? " hl-stacked" : ""} rounded-[4px] ${focusable ? "annotation-mark" : ""}${editedClass}`}
        >
          {segment}
        </mark>,
      );
      // An extract span carries its label chip right after the span: a
      // passage's chip jumps back to the origin phrase; the origin's chip
      // opens the extract card. SVG-free inline button, so the block's DOM
      // text stays exactly the stored text (SPEC.md §5).
      const extractEnding = covering.find(
        (h) => h.kind === "extract" && h.end === to && h.extractLabel,
      );
      if (extractEnding) {
        parts.push(
          <button
            key={`extract-${from}`}
            type="button"
            aria-label={
              extractEnding.extractOrigin
                ? `Extract ${extractEnding.extractLabel} started here`
                : `Jump to the phrase Extract ${extractEnding.extractLabel} started from`
            }
            title={
              extractEnding.extractOrigin
                ? `Extract ${extractEnding.extractLabel} started here. Click for details`
                : `Jump to the phrase Extract ${extractEnding.extractLabel} started from`
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
      if (commentEnding) {
        parts.push(
          <button
            key={`comment-${from}`}
            type="button"
            aria-label="Open the comment"
            title="Open the comment"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("dissect:open-annotation", {
                  detail: { sourceId: commentEnding.sourceId },
                }),
              );
            }}
            className="comment-dot mx-0.5 inline-flex size-[16px] items-center justify-center rounded-full bg-clay-100 align-text-top text-clay-700 hover:bg-clay-200 hover:text-clay-800"
          >
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
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
            aria-label="Link to other texts"
            title="Link to other texts"
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
          title={term.definition ? `${term.definition}\n\nClick for tools` : "Click for tools"}
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
// annotation cards. Outside the block element, so the block's DOM text stays
// exactly the stored text (SPEC.md §5).
function HighlightLabel({ anchors }: { anchors: Highlight[] }) {
  const focusable = anchors.find((h) => h.annotation && h.sourceId);
  const color = anchors.find((h) => h.color)?.color ?? "clay";
  const labels = anchors.map((h) => h.figureLabel).filter((l): l is string => Boolean(l));
  const text = labels.length > 0 ? labels.join(" · ") : "Highlighted";
  return (
    <button
      onClick={
        focusable?.sourceId
          ? () =>
              window.dispatchEvent(
                new CustomEvent("dissect:open-annotation", {
                  detail: { sourceId: focusable.sourceId },
                }),
              )
          : undefined
      }
      title={
        focusable ? `${text} — annotated. Click to open it in Annotations` : `${text} — highlighted`
      }
      className="absolute top-2 right-0 z-10 flex translate-x-[calc(100%+10px)] items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[10.5px] font-semibold text-sand-700 shadow-soft hover:text-clay-800"
    >
      <span aria-hidden className="size-2 rounded-full" style={{ background: LABEL_DOT[color] ?? LABEL_DOT.clay }} />
      {text}
    </button>
  );
}

// Text blocks render block.text verbatim so DOM text content matches stored text
// (anchor offsets depend on this, SPEC.md §5). Tables and figures render sanitized html.
export function BlockView({
  block,
  highlights = [],
}: {
  block: BlockData;
  highlights?: Highlight[];
}) {
  const shared = "reader-block";

  const content = highlights.length > 0 ? markedText(block.text, highlights) : block.text;
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
          Video: {block.text}
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
      return (
        <p data-block-id={block.id} data-source-id={firstSourceId} className={`${shared} my-4 text-sm text-sand-600 italic ${htmlHighlighted}`}>
          {content}
        </p>
      );
  }
}
