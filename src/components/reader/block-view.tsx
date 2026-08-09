import type { BlockType } from "@prisma/client";

export type BlockData = {
  id: string;
  type: BlockType;
  text: string;
  html: string | null;
};

function headingLevel(html: string | null): 1 | 2 | 3 {
  const m = html?.match(/^<h([1-3])/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : 2;
}

// Text blocks render block.text verbatim so DOM text content matches stored text
// (anchor offsets depend on this, SPEC.md §5). Tables and figures render sanitized html.
export function BlockView({ block }: { block: BlockData }) {
  const shared = "reader-block";
  switch (block.type) {
    case "HEADING": {
      const level = headingLevel(block.html);
      const cls =
        level === 1
          ? "mt-8 mb-3 text-2xl font-semibold"
          : level === 2
            ? "mt-6 mb-2 text-xl font-semibold"
            : "mt-5 mb-2 text-base font-semibold";
      if (level === 1) return <h1 data-block-id={block.id} className={`${shared} ${cls}`}>{block.text}</h1>;
      if (level === 2) return <h2 data-block-id={block.id} className={`${shared} ${cls}`}>{block.text}</h2>;
      return <h3 data-block-id={block.id} className={`${shared} ${cls}`}>{block.text}</h3>;
    }
    case "PARAGRAPH":
      return (
        <p data-block-id={block.id} className={`${shared} my-2.5 leading-7 whitespace-pre-wrap`}>
          {block.text}
        </p>
      );
    case "LIST":
      return (
        <div data-block-id={block.id} className={`${shared} my-2.5 leading-7 whitespace-pre-wrap pl-4`}>
          {block.text}
        </div>
      );
    case "CODE":
    case "EQUATION":
      return (
        <pre
          data-block-id={block.id}
          className={`${shared} my-3 overflow-x-auto rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-800`}
        >
          {block.text}
        </pre>
      );
    case "TABLE":
      if (block.html) {
        return (
          <div
            data-block-id={block.id}
            className={`${shared} reader-table my-3 overflow-x-auto text-sm`}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        );
      }
      return (
        <pre data-block-id={block.id} className={`${shared} my-3 overflow-x-auto font-mono text-sm`}>
          {block.text}
        </pre>
      );
    case "FIGURE":
      if (block.html) {
        return (
          <div
            data-block-id={block.id}
            className={`${shared} reader-figure my-4`}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        );
      }
      return (
        <p data-block-id={block.id} className={`${shared} my-3 text-sm italic text-neutral-500`}>
          {block.text}
        </p>
      );
  }
}
