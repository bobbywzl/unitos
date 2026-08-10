import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { outboundFetch } from "@/lib/outbound-fetch";
import { sanitizeHtml } from "@/lib/parse/sanitize";
import type { ParsedBlock, ParsedDocument } from "@/lib/parse/types";

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function listText(el: Element): string {
  return [...el.querySelectorAll(":scope > li")]
    .map((li) => `• ${normalizeText(li.textContent ?? "")}`)
    .join("\n");
}

function tableText(el: Element): string {
  return [...el.querySelectorAll("tr")]
    .map((tr) =>
      [...tr.querySelectorAll("td,th")].map((c) => normalizeText(c.textContent ?? "")).join("\t"),
    )
    .join("\n");
}

export async function parseUrl(url: string): Promise<ParsedDocument> {
  const res = await outboundFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Unitos/1.0)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const rawHtml = await res.text();

  const dom = new JSDOM(rawHtml, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.content) throw new Error("Could not extract readable content");

  const contentDom = new JSDOM(`<body>${article.content}</body>`);
  const body = contentDom.window.document.body;
  const blocks: ParsedBlock[] = [];

  const emit = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = normalizeText(el.textContent ?? "");
      if (!text) return;
      const level = Math.min(3, Number(tag[1]));
      blocks.push({ type: "HEADING", text, html: `<h${level}>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h${level}>` });
    } else if (tag === "p" || tag === "blockquote") {
      const text = normalizeText(el.textContent ?? "");
      if (text) blocks.push({ type: "PARAGRAPH", text });
    } else if (tag === "ul" || tag === "ol") {
      const text = listText(el);
      if (text) blocks.push({ type: "LIST", text, html: sanitizeHtml(el.outerHTML, url) });
    } else if (tag === "table") {
      const text = tableText(el);
      if (text) blocks.push({ type: "TABLE", text, html: sanitizeHtml(el.outerHTML, url) });
    } else if (tag === "pre") {
      const text = (el.textContent ?? "").trimEnd();
      if (text) blocks.push({ type: "CODE", text });
    } else if (tag === "figure" || tag === "img") {
      const img = tag === "img" ? el : el.querySelector("img");
      const caption = tag === "figure" ? normalizeText(el.querySelector("figcaption")?.textContent ?? "") : "";
      const alt = normalizeText(img?.getAttribute("alt") ?? "");
      const text = caption || alt || "Figure";
      if (img?.getAttribute("src")) {
        blocks.push({ type: "FIGURE", text, html: sanitizeHtml(el.outerHTML, url) });
      } else if (caption) {
        blocks.push({ type: "PARAGRAPH", text: caption });
      }
    } else {
      for (const child of el.children) emit(child);
    }
  };
  for (const child of body.children) emit(child);

  return {
    title: article.title ? normalizeText(article.title) : null,
    blocks: blocks.filter((b) => b.text.trim().length > 0),
  };
}
