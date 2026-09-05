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
            // One link carries every style over its run, innermost last.
            const styleTags = href?.startsWith(STYLE_HREF) ? href.slice(STYLE_HREF.length).split("+") : null;
            if (styleTags) {
              const color = styleTags.find((tag) => STYLE_CLASS[tag]);
              let painted = <>{linkChildren}</>;
              if (color) painted = <span className={STYLE_CLASS[color]}>{painted}</span>;
              if (styleTags.includes("u")) painted = <u>{painted}</u>;
              return painted;
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
