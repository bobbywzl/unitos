import type { LinkSpan, ParsedBlock, StyleSpan } from "@/lib/parse/types";

// Markdown → blocks, for text the model wrote (FORMALIZE articles, SPEC.md
// §11). The input is clean generated markdown, so this parse is deterministic
// — no model pass: headings, paragraphs, lists, code fences, separators,
// blockquotes, and inline bold/italic/code/links. The blocks land in the same
// shape as every parsed document, so every reader tool works on them.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// Inline markdown → plain text + style and link spans over that text. Bold,
// italic, code, and [label](url) links; unmatched markers stay literal.
function parseInline(raw: string): { text: string; styles: StyleSpan[]; links: LinkSpan[] } {
  let text = "";
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  const rx =
    /\*\*((?:[^*]|\*(?!\*))+)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|_([^_\s](?:[^_]*[^_\s])?)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let m = rx.exec(raw); m; m = rx.exec(raw)) {
    text += raw.slice(last, m.index);
    const start = text.length;
    if (m[1] !== undefined) {
      text += m[1];
      styles.push({ start, end: text.length, style: "bold", quotedText: m[1] });
    } else if (m[2] !== undefined || m[3] !== undefined) {
      const body = m[2] ?? m[3];
      text += body;
      styles.push({ start, end: text.length, style: "italic", quotedText: body });
    } else if (m[4] !== undefined) {
      text += m[4];
      styles.push({ start, end: text.length, style: "code", quotedText: m[4] });
    } else {
      text += m[5];
      links.push({ start, end: text.length, quotedText: m[5], href: m[6] });
    }
    last = m.index + m[0].length;
  }
  text += raw.slice(last);
  return { text, styles, links };
}

// Wrapped lines rejoin with a space — except across a CJK boundary, where a
// space would be an insertion: CJK prose has no spaces between words.
const CJK_EDGE = /[⺀-鿿豈-﫿︰-﹏＀-￯]/;
function joinWrapped(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return CJK_EDGE.test(a[a.length - 1]) && CJK_EDGE.test(b[0]) ? a + b : `${a} ${b}`;
}

function spanned(
  type: ParsedBlock["type"],
  inline: { text: string; styles: StyleSpan[]; links: LinkSpan[] },
  html?: string,
): ParsedBlock {
  return {
    type,
    text: inline.text,
    html,
    styles: inline.styles.length > 0 ? inline.styles : undefined,
    links: inline.links.length > 0 ? inline.links : undefined,
  };
}

const LIST_ITEM_RX = /^(\s*)(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/;

export function parseMarkdown(markdown: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    const inline = parseInline(paragraph.reduce(joinWrapped, "").trim());
    paragraph.length = 0;
    if (inline.text) blocks.push(spanned("PARAGRAPH", inline));
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code fence: verbatim until the closing fence.
    if (/^```/.test(trimmed)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence (or end of input)
      const code = body.join("\n").trimEnd();
      if (code.trim()) blocks.push({ type: "CODE", text: code });
      continue;
    }

    if (!trimmed) {
      flush();
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: "SEPARATOR", text: "" });
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = Math.min(3, heading[1].length);
      const inline = parseInline(heading[2].replace(/\s#+$/, "").trim());
      if (inline.text) {
        blocks.push(
          spanned("HEADING", inline, `<h${level}>${escapeHtml(inline.text)}</h${level}>`),
        );
      }
      i++;
      continue;
    }

    // List group: consecutive items; an indented plain line continues its item.
    if (LIST_ITEM_RX.test(line)) {
      flush();
      const items: { indent: number; marker: string; body: string }[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM_RX.exec(lines[i]);
        if (m) {
          items.push({
            indent: Math.min(4, Math.floor(m[1].length / 2)),
            marker: m[3] ? `${m[3]}.` : "-",
            body: m[4].trim(),
          });
          i++;
          continue;
        }
        if (items.length > 0 && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
          const last = items[items.length - 1];
          last.body = joinWrapped(last.body, lines[i].trim());
          i++;
          continue;
        }
        break;
      }
      let text = "";
      const styles: StyleSpan[] = [];
      const links: LinkSpan[] = [];
      items.forEach((item, idx) => {
        if (idx > 0) text += "\n";
        text += `${"  ".repeat(item.indent)}${item.marker} `;
        const inline = parseInline(item.body);
        const base = text.length;
        text += inline.text;
        for (const s of inline.styles) styles.push({ ...s, start: base + s.start, end: base + s.end });
        for (const l of inline.links) links.push({ ...l, start: base + l.start, end: base + l.end });
      });
      blocks.push({
        type: "LIST",
        text,
        styles: styles.length > 0 ? styles : undefined,
        links: links.length > 0 ? links : undefined,
      });
      continue;
    }

    // Blockquote marker strips; the line joins the paragraph like any other.
    paragraph.push(trimmed.replace(/^(?:>\s?)+/, ""));
    i++;
  }
  flush();
  return blocks;
}
