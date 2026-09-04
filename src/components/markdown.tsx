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

// Markdown as one plain line, for small previews (Visual cards, overlay
// captions) where rendered markdown has no room.
export function markdownPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(BLOCK_TAG, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/<\/?(?:u|clay|sage|gold|plum)>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function Markdown({ children }: { children: string }) {
  const t = useT();
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
        {linkifyStyleTags(linkifyBlockTags(children))}
      </ReactMarkdown>
    </div>
  );
}
