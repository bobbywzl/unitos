import type { BlockType } from "@prisma/client";

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
  kind: "anchor" | "salience" | "term";
  definition?: string; // glossary hover text, kind "term" only
};

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
    const anchor = covering.find((h) => h.kind === "anchor");
    const salience = covering.find((h) => h.kind === "salience");
    const term = covering.find((h) => h.kind === "term");
    if (anchor || salience) {
      parts.push(
        <mark
          key={from}
          data-source-id={anchor?.sourceId ?? undefined}
          className={
            anchor
              ? "anchor-mark rounded-sm bg-amber-200/70 dark:bg-amber-500/30"
              : "rounded-sm bg-violet-200/60 dark:bg-violet-500/25"
          }
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
          className="glossary-term cursor-help border-b border-dotted border-neutral-400 dark:border-neutral-500"
        >
          {segment}
        </span>,
      );
    }
  }
  return parts;
}

// Text blocks render block.text verbatim so DOM text content matches stored text
// (anchor offsets depend on this, SPEC.md §5). Tables and figures render sanitized html.
// A swap replaces the block content in place (SIMPLIFY, ephemeral); click to revert.
export function BlockView({
  block,
  highlights = [],
  swap,
  onRevertSwap,
}: {
  block: BlockData;
  highlights?: Highlight[];
  swap?: string;
  onRevertSwap?: (blockId: string) => void;
}) {
  const shared = "reader-block";

  if (swap !== undefined) {
    return (
      <div
        data-block-id={block.id}
        title="Simplified. Click to revert."
        onClick={() => onRevertSwap?.(block.id)}
        className={`${shared} my-2.5 cursor-pointer border-l-4 border-sky-400 pl-3 leading-7 whitespace-pre-wrap`}
      >
        {swap || "…"}
      </div>
    );
  }

  const content = highlights.length > 0 ? markedText(block.text, highlights) : block.text;
  const anchorIds = highlights.filter((h) => h.kind === "anchor" && h.sourceId);
  const htmlHighlighted = anchorIds.length > 0 ? "ring-2 ring-amber-300 dark:ring-amber-600" : "";
  const firstSourceId = anchorIds[0]?.sourceId ?? undefined;

  switch (block.type) {
    case "HEADING": {
      const level = headingLevel(block.html);
      const cls =
        level === 1
          ? "mt-8 mb-3 text-2xl font-semibold"
          : level === 2
            ? "mt-6 mb-2 text-xl font-semibold"
            : "mt-5 mb-2 text-base font-semibold";
      if (level === 1) return <h1 data-block-id={block.id} className={`${shared} ${cls}`}>{content}</h1>;
      if (level === 2) return <h2 data-block-id={block.id} className={`${shared} ${cls}`}>{content}</h2>;
      return <h3 data-block-id={block.id} className={`${shared} ${cls}`}>{content}</h3>;
    }
    case "PARAGRAPH":
      return (
        <p data-block-id={block.id} className={`${shared} my-2.5 leading-7 whitespace-pre-wrap`}>
          {content}
        </p>
      );
    case "LIST":
      return (
        <div data-block-id={block.id} className={`${shared} my-2.5 leading-7 whitespace-pre-wrap pl-4`}>
          {content}
        </div>
      );
    case "CODE":
    case "EQUATION":
      return (
        <pre
          data-block-id={block.id}
          className={`${shared} my-3 overflow-x-auto rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-800`}
        >
          {content}
        </pre>
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
          <div
            data-block-id={block.id}
            data-source-id={firstSourceId}
            className={`${shared} reader-figure my-4 ${htmlHighlighted}`}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        );
      }
      return (
        <p data-block-id={block.id} data-source-id={firstSourceId} className={`${shared} my-3 text-sm italic text-neutral-500 ${htmlHighlighted}`}>
          {content}
        </p>
      );
  }
}
