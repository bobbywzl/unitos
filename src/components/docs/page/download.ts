import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import katex from "katex";
import { fontStack } from "@/components/docs/fonts";
import { insertContext, insertT, toast } from "@/components/docs/insert/context";
import { levelsOf, styleOf, tocEntries } from "@/components/docs/insert/toc";
import { flushDocument } from "@/components/docs/layer/flush";
import { PX_PER_PT } from "@/components/docs/page/geometry";
import { readStyles, STYLE_ORDER, styleFont } from "@/components/docs/toolbar/styles";
import { fragmentToMarkdown } from "@/components/docs/typing/markdown";
import { deriveBlocks } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";
import { KATEX_MACROS } from "@/lib/katex";

// File > Download (SPEC.md §29). Microsoft Word comes from the server
// (/api/documents/[documentId]/export); the web page, Markdown, and plain
// text are made here from the page; PDF is the print dialog's Save as PDF.

export type DownloadFormat = "docx" | "pdf" | "txt" | "html" | "md";

/** The document's title, as the project's list has it. */
export function documentTitle(editor: Editor): string {
  const ctx = insertContext(editor);
  return ctx?.documents.find((d) => d.id === ctx.documentId)?.title ?? insertT(editor)("docsPage.untitled");
}

/** Save `blob` as `name`; the browser swaps what a file name cannot hold. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Each uploaded image as a data address, so the file shows it anywhere. */
async function imageData(editor: Editor): Promise<Map<string, string>> {
  const srcs = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image" && String(node.attrs.src).startsWith("/api/images/")) srcs.add(node.attrs.src);
  });
  const pairs = await Promise.all(
    [...srcs].map(async (src) => {
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      return [src, data] as const;
    }),
  );
  return new Map(pairs.filter((p) => p !== null));
}

/** Plain text: one line per paragraph, as the paragraph index reads it. */
function plainText(editor: Editor): string {
  return deriveBlocks(editor.getJSON() as RichNode)
    .filter((b) => b.type !== "FIGURE")
    .map((b) => b.text)
    .join("\n");
}

/** Markdown, its images at the end as data addresses, as Google Docs writes them. */
function markdown(editor: Editor, images: Map<string, string>): string {
  let md = fragmentToMarkdown(editor.state.doc.content);
  const refs: string[] = [];
  for (const [src, data] of images) {
    const key = `image${refs.length + 1}`;
    md = md.replaceAll(`](${src})`, `][${key}]`);
    refs.push(`[${key}]: <${data}>`);
  }
  return [md, ...refs].join("\n\n") + "\n";
}

const STYLE_SELECTOR = {
  normal: "p",
  title: 'p[data-doc-style="title"]',
  subtitle: 'p[data-doc-style="subtitle"]',
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
} as const;

// What the page's style sheet draws that the editor's HTML leaves out.
const PAGE_CSS = `
body { margin: 72px auto; padding: 0 16px; color: #000; counter-reset: footnote footnote-text; }
p, h1, h2, h3, h4, h5, h6 { margin: 0; white-space: pre-wrap; tab-size: 48px; }
img { max-width: 100%; height: auto; }
img[data-align="center"] { display: block; margin: 0 auto; }
img[data-align="right"] { display: block; margin-left: auto; }
table { border-collapse: collapse; }
td, th { border: 1pt solid #000; padding: 5pt; vertical-align: top; text-align: left; font-weight: inherit; }
[data-valign="middle"] { vertical-align: middle; }
[data-valign="bottom"] { vertical-align: bottom; }
ol ol { list-style-type: lower-alpha; }
ol ol ol { list-style-type: lower-roman; }
ul[data-type="taskList"] { list-style: none; padding-left: 0; }
ul[data-type="taskList"] li { display: flex; gap: 8px; }
ul:not([data-list-style="CHECKLIST_NO_STRIKETHROUGH"]) > li[data-checked="true"] p { text-decoration: line-through; color: #666; }
[data-font-weight] { font-weight: var(--docs-weight); }
pre { padding: 8pt 10pt; background: #f1f3f4; font: 10pt/1.45 "Courier New", monospace; white-space: pre-wrap; }
blockquote { margin: 0 0 0 36pt; padding-left: 12pt; border-left: 3px solid #dadce0; }
sup[data-footnote-ref] { counter-increment: footnote; }
sup[data-footnote-ref]::after { content: counter(footnote); }
[data-footnotes] { margin-top: 24pt; padding-top: 6pt; border-top: 1px solid #000; }
[data-footnotes] p { font-size: 10pt; }
[data-footnote] { counter-increment: footnote-text; }
[data-footnote] > p:first-child::before { content: counter(footnote-text) " "; }
[data-page-break] { break-after: page; }
`;

/** The web page: the editor's HTML with the document's named styles, its
    images inside, its equations as MathML, and its tables of contents drawn. */
function webPage(editor: Editor, title: string, images: Map<string, string>): string {
  const page = new DOMParser().parseFromString(editor.getHTML(), "text/html");
  const body = page.body;
  for (const el of body.querySelectorAll<HTMLElement>("[data-latex]")) {
    el.innerHTML = katex.renderToString(el.dataset.latex ?? "", {
      output: "mathml",
      displayMode: el.tagName === "DIV",
      throwOnError: false,
      macros: { ...KATEX_MACROS },
    });
  }
  // A heading or a bookmark is the target of the links to it.
  for (const el of body.querySelectorAll("[data-block-id], [data-bookmark]")) {
    el.id = el.getAttribute("data-block-id") ?? el.getAttribute("data-bookmark") ?? "";
  }
  for (const a of body.querySelectorAll('a[href^="#heading="], a[href^="#bookmark="]')) {
    a.setAttribute("href", `#${a.getAttribute("href")?.split("=")[1]}`);
  }
  for (const a of body.querySelectorAll('a[href^="/"]')) a.setAttribute("href", new URL(a.getAttribute("href") ?? "", location.origin).href);
  for (const img of body.querySelectorAll("img")) {
    const data = images.get(img.getAttribute("src") ?? "");
    if (data) img.setAttribute("src", data);
  }
  const tocs: PMNode[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableOfContents") tocs.push(node);
    return !node.isTextblock;
  });
  body.querySelectorAll("[data-toc]").forEach((el, i) => {
    if (!tocs[i]) return;
    for (const entry of tocEntries(editor.state.doc, levelsOf(tocs[i]))) {
      const line = el.appendChild(page.createElement("p"));
      line.style.marginLeft = `${(entry.level - 1) * 18}pt`;
      const words = line.appendChild(page.createElement(styleOf(tocs[i]) === "links" ? "a" : "span"));
      words.textContent = entry.text;
      if (words instanceof HTMLAnchorElement) words.href = `#${entry.blockId}`;
    }
  });
  const styles = readStyles(editor.state.doc);
  const named = STYLE_ORDER.map((style) => {
    const s = styles[style];
    const underline = s.underline ? " text-decoration: underline;" : "";
    return `${STYLE_SELECTOR[style]} { font: ${s.italic ? "italic " : ""}${s.bold ? 700 : 400} ${s.size}pt ${fontStack(styleFont(styles, style))}; color: ${s.color};${underline} line-height: calc(var(--docs-ls, ${s.lineSpacing}) * 1.15); padding: ${s.spaceBefore}pt 0 ${s.spaceAfter}pt; text-align: ${s.align}; }`;
  });
  const setup = insertContext(editor)?.pageSetup;
  const width = setup ? `body { max-width: ${(setup.width - setup.margins.left - setup.margins.right) * PX_PER_PT}px; }` : "";
  page.title = title;
  const meta = page.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  const css = page.createElement("style");
  css.textContent = [PAGE_CSS, width, ...named].join("\n");
  page.head.prepend(meta);
  page.head.append(css);
  return `<!DOCTYPE html>\n${page.documentElement.outerHTML}\n`;
}

/** Download the document in `format`, named by its title. */
export async function downloadDocument(editor: Editor, format: DownloadFormat): Promise<void> {
  const ctx = insertContext(editor);
  if (!ctx) return;
  if (format === "pdf") {
    toast(ctx.t("docsPage.choosePdf"));
    // The toast shows before the print dialog takes the page.
    window.setTimeout(() => window.print(), 300);
    return;
  }
  const title = documentTitle(editor);
  try {
    if (format === "docx") {
      // The server reads the stored copy: the typing waiting to save goes first.
      await flushDocument(ctx.documentId);
      const res = await fetch(`/api/documents/${ctx.documentId}/export?format=docx`);
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error);
      save(await res.blob(), `${title}.docx`);
    } else if (format === "txt") {
      save(new Blob([plainText(editor)], { type: "text/plain;charset=utf-8" }), `${title}.txt`);
    } else {
      const images = await imageData(editor);
      if (format === "md") save(new Blob([markdown(editor, images)], { type: "text/markdown;charset=utf-8" }), `${title}.md`);
      else save(new Blob([webPage(editor, title, images)], { type: "text/html;charset=utf-8" }), `${title}.html`);
    }
  } catch (err) {
    toast(err instanceof Error && err.message ? err.message : ctx.t("common.requestFailed"));
  }
}
