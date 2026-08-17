import type { BlockType } from "@prisma/client";
import { Equation } from "@/components/reader/equation";

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
  kind: "anchor" | "salience" | "simplify" | "term" | "link" | "edited" | "style";
  styleKind?: "bold" | "italic" | "underline"; // kind "style" only
  definition?: string; // glossary hover text, kind "term" only
  color?: string | null; // highlight hue ("clay" | "sage" | "gold" | "plum"), kind "anchor" only
  annotation?: boolean; // anchor belongs to an annotation; click focuses its card
  href?: string; // navigation target, kind "link" only
  linkTitle?: string; // the other end's document title, kind "link" only
  linkId?: string; // for arrival flashing via ?link=, kind "link" only
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
    const edited = covering.some((h) => h.kind === "edited");
    const bold = covering.some((h) => h.kind === "style" && h.styleKind === "bold");
    const italic = covering.some((h) => h.kind === "style" && h.styleKind === "italic");
    const underlined = covering.some((h) => h.kind === "style" && h.styleKind === "underline");
    const editedClass = `${edited ? " edited-text" : ""}${bold ? " font-bold" : ""}${italic ? " italic" : ""}${underlined ? " underline" : ""}`;
    const anchors = covering.filter((h) => h.kind === "anchor");
    const anchor =
      anchors.length > 1
        ? anchors.reduce((n, h) => (h.end - h.start < n.end - n.start ? h : n))
        : anchors[0];
    const salience = covering.find((h) => h.kind === "salience");
    const simplify = covering.find((h) => h.kind === "simplify");
    const term = covering.find((h) => h.kind === "term");
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
    } else if (anchor || salience || simplify) {
      const focusable = anchor?.annotation && anchor.sourceId;
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
                    new CustomEvent("dissect:focus-annotation", {
                      detail: { sourceId: anchor.sourceId },
                    }),
                  );
                }
              : undefined
          }
          className={`${anchor ? anchorClass(anchor.color) : salience ? "salience-mark" : "simplify-mark"}${anchors.length > 1 ? " hl-stacked" : ""} rounded-[4px] ${focusable ? "annotation-mark" : ""}${editedClass}`}
        >
          {segment}
        </mark>,
      );
    } else if (term) {
      // Glossary term: hover for the definition (SPEC.md §8 Phase 7).
      parts.push(
        <span
          key={from}
          title={term.definition}
          className={`glossary-term cursor-help border-b-2 border-dotted border-clay-400${editedClass}`}
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

// A highlighted figure gets a side label instead of text marks: it sits to the
// right of the figure and jumps to the annotation. Outside the block element,
// so the block's DOM text stays exactly the stored text (SPEC.md §5).
function HighlightLabel({ anchors }: { anchors: Highlight[] }) {
  const focusable = anchors.find((h) => h.annotation && h.sourceId);
  const color = anchors.find((h) => h.color)?.color ?? "clay";
  return (
    <button
      onClick={
        focusable?.sourceId
          ? () =>
              window.dispatchEvent(
                new CustomEvent("dissect:focus-annotation", {
                  detail: { sourceId: focusable.sourceId },
                }),
              )
          : undefined
      }
      title={focusable ? "Highlighted. Click to open it in Annotations" : "Highlighted"}
      className="absolute top-2 right-0 z-10 flex translate-x-[calc(100%+10px)] items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[10.5px] font-semibold text-sand-700 shadow-soft hover:text-clay-800"
    >
      <span aria-hidden className="size-2 rounded-full" style={{ background: LABEL_DOT[color] ?? LABEL_DOT.clay }} />
      Highlighted
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
    case "TABLE":
      if (block.html) {
        return (
          <div
            data-block-id={block.id}
            data-source-id={firstSourceId}
            className={`${shared} reader-table my-3 overflow-x-auto text-sm ${htmlHighlighted}`}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        );
      }
      return (
        <pre data-block-id={block.id} data-source-id={firstSourceId} className={`${shared} my-3 overflow-x-auto font-mono text-sm ${htmlHighlighted}`}>
          {content}
        </pre>
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
