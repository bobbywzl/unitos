"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/components/lang-provider";

// AI text cites document blocks as [block <id>] — the tags the model sees in
// its document context. They render as ¶ chips that scroll the reader to the
// block and flash it (the reader listens for dissect:flash-block).
const BLOCK_TAG = /\[block ([a-zA-Z0-9]+)\]/g;

function linkifyBlockTags(text: string): string {
  return text.replace(BLOCK_TAG, "[¶](#dissect-block-$1)");
}

// Note style tags: <u> underlines, <clay>/<sage>/<gold>/<plum> color the text
// (the note editor writes them). react-markdown drops raw HTML, so they
// become links the a component override styles. Innermost tags convert first,
// so markdown inside a tag still renders; a tag spanning lines stays raw.
const STYLE_TAG = /<(u|clay|sage|gold|plum)>((?:(?!<\/?(?:u|clay|sage|gold|plum)>)[^\n])+?)<\/\1>/g;
const STYLE_HREF = "#dissect-style-";
const STYLE_CLASS: Record<string, string> = {
  clay: "text-color-clay",
  sage: "text-color-sage",
  gold: "text-color-gold",
  plum: "text-color-plum",
};

function linkifyStyleTags(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(STYLE_TAG, (_, tag: string, inner: string) => `[${inner}](${STYLE_HREF}${tag})`);
    if (next === out) break;
    out = next;
  }
  return out;
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

// Markdown as one plain line, for small previews (Visual cards, overlay
// captions, collapsed notes) where rendered markdown has no room. An image
// reads as its alt text: a preview line has no room for a picture and none
// for a URL.
export function markdownPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(BLOCK_TAG, "")
    // A dropped image reads as its alt — the file's name — never its URL.
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/<\/?(?:u|clay|sage|gold|plum)>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** breaks: single newlines render as line breaks (notes). */
export function Markdown({ children, breaks = false }: { children: string; breaks?: boolean }) {
  const t = useT();
  const text = breaks ? hardBreaks(children) : children;
  return (
    <div className="prose prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren, ...props }) => {
            const styleTag = href?.startsWith(STYLE_HREF) ? href.slice(STYLE_HREF.length) : null;
            if (styleTag === "u") return <u>{linkChildren}</u>;
            if (styleTag && STYLE_CLASS[styleTag]) {
              return <span className={STYLE_CLASS[styleTag]}>{linkChildren}</span>;
            }
            const blockId = href?.startsWith("#dissect-block-")
              ? href.slice("#dissect-block-".length)
              : null;
            if (blockId) {
              return (
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("dissect:flash-block", { detail: { blockId } }),
                    )
                  }
                  data-tip={t("panels.jumpToBlock")}
                  className="mx-0.5 inline-flex size-[18px] items-center justify-center rounded-full bg-clay-100 align-text-bottom text-[11px] font-semibold text-clay-800 no-underline hover:bg-clay-200"
                >
                  ¶
                </button>
              );
            }
            return (
              <a href={href} {...props}>
                {linkChildren}
              </a>
            );
          },
        }}
      >
        {linkifyStyleTags(linkifyBlockTags(text))}
      </ReactMarkdown>
    </div>
  );
}
