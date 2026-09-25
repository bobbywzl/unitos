import type { Fragment, Mark, Node as PMNode } from "@tiptap/pm/model";
import { CHIP_NODE_TYPES } from "@/lib/docs/schema";

// Paste from Markdown and Copy as Markdown (SPEC.md §29, typing), the two
// commands Google Docs offers while Enable Markdown is on: Markdown on the
// clipboard becomes headings, emphasis, lists, links, code, quotes, rules,
// and tables; a selection goes out as Markdown text.

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u) || u.startsWith("/") || u.startsWith("#")) return u;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`;
  return null;
}

/** Inline Markdown as HTML: code, links, bold and italic, strikethrough. */
function inline(md: string): string {
  const codes: string[] = [];
  let s = md.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const href = safeUrl(url.replaceAll("&amp;", "&"));
    return href ? `<a href="${escapeHtml(href)}">${text}</a>` : m;
  });
  s = s.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, "<strong><em>$2</em></strong>");
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>");
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[^~])~(?=\S)([^~]*?\S)~(?!~)/g, "$1<s>$2</s>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

type ListLine = { indent: number; ordered: boolean; task: boolean | null; text: string };

function listLine(line: string): ListLine | null {
  const m = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
  if (!m) return null;
  return {
    indent: m[1].replace(/\t/g, "    ").length,
    ordered: /\d/.test(m[2]),
    task: m[3] ? m[4].toLowerCase() === "x" : null,
    text: m[5],
  };
}

function listHtml(lines: ListLine[]): string {
  let i = 0;
  const build = (indent: number): string => {
    const first = lines[i];
    const task = first.task !== null;
    const tag = task ? 'ul data-type="taskList"' : first.ordered ? "ol" : "ul";
    const close = first.ordered && !task ? "ol" : "ul";
    let out = `<${tag}>`;
    while (i < lines.length && lines[i].indent >= indent) {
      const line = lines[i];
      if (line.indent > indent) {
        out = out.replace(/<\/li>$/, "") + build(line.indent) + "</li>";
        continue;
      }
      i++;
      out += task
        ? `<li data-type="taskItem" data-checked="${line.task ? "true" : "false"}"><p>${inline(line.text)}</p></li>`
        : `<li><p>${inline(line.text)}</p></li>`;
    }
    return `${out}</${close}>`;
  };
  let html = "";
  while (i < lines.length) html += build(lines[i].indent);
  return html;
}

function tableHtml(rows: string[]): string {
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const [head, , ...body] = rows;
  const th = cells(head)
    .map((c) => `<th><p>${inline(c)}</p></th>`)
    .join("");
  const trs = body.map((r) => `<tr>${cells(r).map((c) => `<td><p>${inline(c)}</p></td>`).join("")}</tr>`).join("");
  return `<table><tr>${th}</tr>${trs}</table>`;
}

/** Markdown as HTML the page editor reads. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let html = "";
  let para: string[] = [];
  const flush = () => {
    if (para.length) html += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```\s*([\w#+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      html += `<pre><code${lang}>${escapeHtml(code.join("\n"))}</code></pre>`;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      html += "<hr>";
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      i--;
      html += `<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      i--;
      html += tableHtml(rows);
      continue;
    }
    if (listLine(line)) {
      flush();
      const items: ListLine[] = [];
      while (i < lines.length && listLine(lines[i])) items.push(listLine(lines[i++]) as ListLine);
      i--;
      html += listHtml(items);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.replace(/\s{2,}$/, ""));
  }
  flush();
  return html;
}

// ── Out: a selection as Markdown ────────────────────────────────────────

function wrap(text: string, marks: readonly Mark[]): string {
  // Spaces stay outside the delimiters: "** bold**" is not bold in Markdown.
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? ["", "", text, ""];
  if (!core) return text;
  let out = core;
  const has = (name: string) => marks.some((m) => m.type.name === name);
  if (has("code")) return `${lead}\`${out}\`${trail}`;
  if (has("bold") && has("italic")) out = `***${out}***`;
  else if (has("bold")) out = `**${out}**`;
  else if (has("italic")) out = `*${out}*`;
  if (has("strike")) out = `~~${out}~~`;
  const link = marks.find((m) => m.type.name === "link");
  if (link) out = `[${out}](${String(link.attrs.href)})`;
  return `${lead}${out}${trail}`;
}

/** The footnotes' numbers in the Markdown being written, in the order the
    text cites them: [^1] at the number, [^1]: at the footnote. */
let cited = new Map<string, number>();
const citation = (id: unknown) => `[^${cited.get(String(id)) ?? cited.set(String(id), cited.size + 1).size}]`;

function inlineMd(node: PMNode): string {
  let out = "";
  node.forEach((child) => {
    if (child.isText) out += wrap(child.text ?? "", child.marks);
    else if (child.type.name === "hardBreak") out += "  \n";
    else if (child.type.name === "inlineMath") out += `$${String(child.attrs.latex ?? "")}$`;
    else if (child.type.name === "footnoteReference") out += citation(child.attrs.footnoteId);
    else if (CHIP_NODE_TYPES.has(child.type.name)) out += String(child.attrs.label ?? "");
  });
  return out;
}

function blockMd(node: PMNode, indent = ""): string {
  switch (node.type.name) {
    case "heading":
      return `${"#".repeat(Number(node.attrs.level) || 1)} ${inlineMd(node)}`;
    case "paragraph":
      return inlineMd(node);
    case "codeBlock":
      return "```" + (node.attrs.language ?? "") + "\n" + node.textContent + "\n```";
    case "horizontalRule":
      return "---";
    case "blockMath":
      return `$$\n${String(node.attrs.latex ?? "")}\n$$`;
    case "blockquote": {
      const inner: string[] = [];
      node.forEach((c) => inner.push(blockMd(c)));
      return inner
        .join("\n\n")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    }
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const lines: string[] = [];
      let n = Number(node.attrs.start) || 1;
      node.forEach((item) => {
        const marker =
          node.type.name === "orderedList" ? `${n++}.` : node.type.name === "taskList" ? `- [${item.attrs.checked ? "x" : " "}]` : "-";
        let first = true;
        item.forEach((child) => {
          if (first) lines.push(`${indent}${marker} ${blockMd(child)}`);
          else lines.push(blockMd(child, `${indent}   `));
          first = false;
        });
      });
      return lines.join("\n");
    }
    case "table": {
      const rows: string[] = [];
      node.forEach((row, _o, r) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(cell.textContent.replace(/\|/g, "\\|").replace(/\n/g, " ")));
        rows.push(`| ${cells.join(" | ")} |`);
        if (r === 0) rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
      });
      return rows.join("\n");
    }
    case "image":
      return `![${String(node.attrs.alt ?? "")}](${String(node.attrs.src ?? "")})`;
    case "footnotes": {
      const notes: string[] = [];
      node.forEach((note) => {
        const paragraphs: string[] = [];
        note.forEach((p) => paragraphs.push(inlineMd(p)));
        notes.push(`${citation(note.attrs.footnoteId)}: ${paragraphs.join("\n\n    ")}`);
      });
      return notes.join("\n");
    }
    default:
      return node.textContent;
  }
}

/** A document slice's content as Markdown. */
export function fragmentToMarkdown(content: Fragment): string {
  cited = new Map();
  const parts: string[] = [];
  content.forEach((node) => {
    if (node.isInline) parts.push(node.isText ? wrap(node.text ?? "", node.marks) : "");
    else parts.push(blockMd(node));
  });
  return parts.join(content.firstChild?.isInline ? "" : "\n\n");
}
