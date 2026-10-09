// The Markdown and text file benchmark: Markdown and plain text files parsed
// in-process the way an add parses them (markdownFileText, then
// parseMarkdownDocument, lib/parse/markdown-document.ts), then converted
// into an import's rich text the way convertImport does (lib/docs/import.ts,
// lib/parse/ingest.ts), each scored against a reference built without the
// code under test (scripts/parse-bench/markdown-ref.py).
//
//   npx tsx scripts/parse-bench/markdown.mts [--set spec|md|txt] [--only id,id]
//     [--baseline] [--save-baseline] [--worst n] [--detail id] [--json out.json]
//
// The sets:
// - spec: the CommonMark 0.31.2 spec examples and the GFM extension examples
//   (tables, task lists, strikethrough, autolinks), each scored against the
//   spec's expected HTML. An example's id is commonmark-<n> or gfm-<n>.
// - md: Markdown files from public repositories (READMEs, docs, changelogs,
//   CJK docs, math, front matter, raw HTML, very long files, MDX-like docs
//   with components, Jupyter notebook exports, Obsidian notes, MkDocs,
//   Hugo, and MyST dialects), scored against markdown-it's reading of the
//   same file.
// - txt: plain text files (Project Gutenberg books, plays, and poems, RFCs,
//   logs, licenses, build files, AsciiDoc, org-mode, and reST saved as
//   .txt, subtitles, CSV, a one-line file, mixed scripts, the Vim tutor in
//   eleven legacy encodings, ISO-2022-JP, UTF-16 and Windows-1252 copies, a
//   paragraph-per-line copy), scored against the file's own words decoded in the
//   encoding the corpus names, and, where there is one, the structure of
//   the same book's HTML edition (Project Gutenberg's), an RFC's section
//   headings, or a log's lines.
//
// The corpus is scripts/parse-bench/markdown-corpus.json: every file's URL
// (pinned to a commit), license, and what it exercises. The files are other
// people's, so they are never committed: the first run fetches them into
// .bench/markdown/ and builds the references there (python3 with
// markdown-it-py and mdit-py-plugins).
//
// What is scored, per file, for the parse's blocks and for the import's
// rich text (an import past the size guard stays a block document, and its
// import is its blocks):
// - words: word F1 of the output against the reference (a word is a run of
//   letters and digits; each Han or kana character is a word). lost: words
//   of the reference the output does not have; extra: words the output has
//   that the reference does not (a duplicate counts).
// - structure: units (a heading, a paragraph, a quote, a list item at its
//   depth and kind, a code block, a table cell at its column, a separator,
//   display math) matched by their words; a match counts when its kind is
//   right too. A heading's kind is right when it stands where the
//   reference's does against the heading before it (deeper, the same, or
//   higher): an import's Title is above every heading. Markdown: F1 over
//   units. Text: the share of the reference's units found (the reference
//   holds only what it knows: a twin's paragraphs and headings, an RFC's
//   headings, a log's lines).
// - order: of the matched units, the share that stand in the reference's
//   order (longest increasing run).
// - breaks: of the matched units whose line breaks the reference knows (a
//   verse's lines, a code block's lines, a paragraph that has none), the
//   share whose breaks fall at the same words. A hard-wrapped paragraph
//   kept as its wrapped lines fails here.
// - links: F1 of [text, target] pairs. A web or mail link's target is its
//   address (ours: a link span, or a citation's reference); a link to a
//   heading of the file is "#" and the heading's words. A relative link
//   (another file) is text by design, and is not counted.
// - score: the mean of the numbers that apply.
// - ms: parse time, and the import's.
//
// Baseline: scripts/parse-bench/markdown-baseline.json holds each file's and
// each example's scores (numbers only). --baseline lists every file or
// example whose score dropped by more than 0.01 and exits 1 when one did;
// --save-baseline writes the run.
import "../eval/env";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { markdownFileText, parseMarkdownDocument } = await import("@/lib/parse/markdown-document");
const { resolveContentsLinks } = await import("@/lib/parse/url");
const { richTextFromImport } = await import("@/lib/docs/import");
const { sanitizeRichText } = await import("@/lib/docs/schema");
const { deriveBlocks } = await import("@/lib/docs/blocks");
type ParsedBlock = import("@/lib/parse/types").ParsedBlock;
type RichNode = import("@/lib/docs/schema").RichNode;

const ROOT = join(import.meta.dirname, "..", "..");
const BENCH = join(ROOT, ".bench", "markdown");
const CORPUS = join(import.meta.dirname, "markdown-corpus.json");
const BASELINE = join(import.meta.dirname, "markdown-baseline.json");
const REF_SCRIPT = join(import.meta.dirname, "markdown-ref.py");
// The size guard of an import (lib/parse/ingest.ts IMPORT_MAX_ROWS,
// IMPORT_MAX_JSON_BYTES): past either, the add keeps a block document.
const IMPORT_MAX_ROWS = 1_500;
const IMPORT_MAX_JSON_BYTES = 1_500_000;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const set = value("--set");
const worst = value("--worst") ? Number(value("--worst")) : 15;
const detail = value("--detail");

// ── The corpus and its references ───────────────────────────────────────────

type Entry = { id: string; kind: "md" | "txt"; name: string; url?: string; encoding?: string; lines?: boolean; twin?: string; derive?: { from: string; as: string } };
const corpus = JSON.parse(readFileSync(CORPUS, "utf8")) as { spec: { id: string }[]; files: Entry[] };
const refPath = (id: string) => join(BENCH, "refs", `${id}.json`);
const needRefs = [...corpus.spec.map((s) => refPath(`spec-${s.id}`)), ...corpus.files.map((f) => refPath(f.id))].some((p) => !existsSync(p));
if (needRefs) {
  console.log("Fetching the corpus and building the references (python3 markdown-ref.py)");
  execFileSync("python3", ["-I", REF_SCRIPT], { stdio: "inherit" });
}

type Unit = { k: string; l: number; t: string; br: number[] | null; lt?: string; row?: number; col?: number; title?: boolean };
type Ref = { units: Unit[]; links: [string, string][]; figures: string[]; title?: string; text?: string; optional?: string[]; headingsOnly?: boolean; twin?: boolean; sha256?: string };
type SpecCase = Ref & { n: number; section: string; extension: string | null; md: string };

// ── Words ───────────────────────────────────────────────────────────────────

const CJK = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}";
const WORD_RX = new RegExp(`[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}\\p{M}])+`, "gu");
const words = (text: string): string[] => text.replace(/­/g, "").match(WORD_RX) ?? [];
const key = (text: string) => words(text).join(" ");

function bag(tokens: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tokens) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}
/** optional: words the output may hold or not (an RFC's page furniture):
    an output word past the reference's count is not extra while an
    optional copy of it is left. */
function wordScore(ref: string[], ours: string[], optional: Map<string, number> = new Map()) {
  const a = bag(ref);
  const b = bag(ours);
  let both = 0;
  let extra = 0;
  const lostWords: string[] = [];
  const extraWords: string[] = [];
  for (const [w, n] of a) {
    const m = b.get(w) ?? 0;
    both += Math.min(n, m);
    if (n > m) lostWords.push(...Array(Math.min(3, n - m)).fill(w));
  }
  for (const [w, m] of b) {
    const n = a.get(w) ?? 0;
    const over = Math.max(0, m - n - (optional.get(w) ?? 0));
    extra += over;
    if (over > 0) extraWords.push(...Array(Math.min(3, over)).fill(w));
  }
  const p = both + extra ? both / (both + extra) : ref.length ? 0 : 1;
  const r = ref.length ? both / ref.length : 1;
  return { f1: p + r > 0 ? (2 * p * r) / (p + r) : 0, lost: ref.length - both, extra, lostWords, extraWords };
}

// ── Our units: from the parse's blocks, and from the import's rich text ─────

/** Text with each inline formula as its TeX between dollar signs, as the
    reference holds it. */
function withMath(block: ParsedBlock): string {
  if (!block.math?.length) return block.text;
  let out = "";
  let at = 0;
  for (const m of [...block.math].sort((a, b) => a.start - b.start)) {
    out += block.text.slice(at, m.start) + `$${m.latex}$`;
    at = m.end;
  }
  return out + block.text.slice(at);
}

function breaksOf(text: string): number[] {
  const parts = text.split("\n");
  const out: number[] = [];
  let n = 0;
  for (const part of parts.slice(0, -1)) {
    n += words(part).length;
    if (n > 0 && out.at(-1) !== n) out.push(n);
  }
  const total = words(text).length;
  return out.filter((b) => b > 0 && b < total);
}

type Ours = { units: Unit[]; links: [string, string][]; figures: string[] };

// A link into the file scores as "#" and its target's words; a link to the
// web, written as a citation (the walk's reference for a link in the text),
// as its reference's address.
const targetKey = (text: string) => `#${text.replace(/\s+/g, " ").trim().toLowerCase()}`;

function unitsFromBlocks(blocks: ParsedBlock[], title: string | null, refUrls: Map<string, string>): Ours {
  const units: Unit[] = [];
  const links: [string, string][] = [];
  const figures: string[] = [];
  const fragmentText = new Map<string, string>();
  for (const b of blocks) if (b.fragment !== undefined && !fragmentText.has(b.fragment)) fragmentText.set(b.fragment, b.text);
  if (title) units.push({ k: "h", l: 0, t: title, br: [], title: true });
  for (const b of blocks) {
    for (const l of b.links ?? []) {
      const target = l.targetFragment !== undefined ? fragmentText.get(l.targetFragment) : undefined;
      if (l.href) links.push([b.text.slice(l.start, l.end), l.href]);
      else if (target !== undefined) links.push([b.text.slice(l.start, l.end), targetKey(target)]);
    }
    for (const c of b.citations ?? []) {
      const url = refUrls.get(c.refId);
      if (url) links.push([b.text.slice(c.start, c.end), url]);
    }
    const text = withMath(b);
    switch (b.type) {
      case "HEADING": {
        const level = Number(/^<h([1-6])/i.exec(b.html ?? "")?.[1] ?? 1);
        units.push({ k: "h", l: level, t: text.replace(/\s+/g, " ").trim(), br: breaksOf(text) });
        break;
      }
      case "PARAGRAPH":
        units.push({ k: /class="[^"]*\bquote\b/.test(b.html ?? "") ? "q" : "p", l: 0, t: text.replace(/\s+/g, " ").trim(), br: breaksOf(text) });
        break;
      case "LIST": {
        for (const line of text.split("\n")) {
          const m = /^( *)(?:(\d+[.)]|[a-zA-Z][.)]|[ivxlcdm]+[.)]|[-*•◦▪‣–])\s?)?\s*([☐☑]\s?)?(.*)$/.exec(line);
          if (!m || !m[4].trim()) continue;
          const lt = m[3] ? "task" : m[2] && /^[-*•◦▪‣–]$/.test(m[2]) ? "ul" : m[2] ? "ol" : "ul";
          units.push({ k: "li", l: Math.floor(m[1].length / 2) + 1, t: m[4].trim(), br: [], lt });
        }
        break;
      }
      case "CODE":
        units.push({ k: "code", l: 0, t: b.text, br: null });
        break;
      case "TABLE":
        // A table's links and images are in its html: a block document
        // draws the table from it.
        for (const m of (b.html ?? "").matchAll(/<a\b[^>]*?\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
          links.push([m[2].replace(/<[^>]*>/g, ""), m[1].replace(/&amp;/g, "&")]);
        }
        for (const m of (b.html ?? "").matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)) figures.push(m[1].replace(/&amp;/g, "&"));
        text.split("\n").forEach((row, r) =>
          row.split("\t").forEach((cell, c) => {
            if (cell.trim()) units.push({ k: "cell", l: 0, t: cell.trim(), br: [], row: r + 1, col: c + 1 });
          }),
        );
        break;
      case "EQUATION":
        units.push({ k: "math", l: 0, t: b.text, br: null });
        break;
      case "SEPARATOR":
        units.push({ k: "hr", l: 0, t: "", br: null });
        break;
      case "FIGURE": {
        for (const m of (b.html ?? "").matchAll(/<(?:img|source|video)\b[^>]*?\bsrc="([^"]+)"/g)) figures.push(m[1].replace(/&amp;/g, "&"));
        break;
      }
      default:
        if (text.trim()) units.push({ k: "p", l: 0, t: text.replace(/\s+/g, " ").trim(), br: breaksOf(text) });
    }
  }
  return { units, links, figures };
}

function unitsFromRich(doc: RichNode, figureHtml: Map<string, string | null>, refUrls: Map<string, string>): Ours {
  const units: Unit[] = [];
  let links: [string, string][] = [];
  const figures: string[] = [];
  const blockText = new Map<string, string>();
  type Ctx = { lists: string[]; quote: boolean; cell: { row: number; col: number } | null };
  const inlineText = (node: RichNode): string => {
    let out = "";
    let link: { href: string; start: number } | null = null;
    const close = () => {
      if (link) links.push([out.slice(link.start), link.href]);
      link = null;
    };
    for (const child of node.content ?? []) {
      const mark = child.marks?.find((m) => m.type === "link" || m.type === "citation");
      const href = mark?.type === "citation" ? refUrls.get(String(mark.attrs?.refId)) : mark?.attrs?.href;
      if (typeof href === "string") {
        const current = link as { href: string; start: number } | null;
        if (!current || current.href !== href) {
          close();
          link = { href, start: out.length };
        }
      } else close();
      if (child.type === "text") out += child.text ?? "";
      else if (child.type === "hardBreak") out += "\n";
      else if (child.type === "inlineMath") out += `$${String(child.attrs?.latex ?? "")}$`;
      else if (child.type === "image" && typeof child.attrs?.src === "string") figures.push(child.attrs.src);
      else if (typeof child.attrs?.label === "string") out += child.attrs.label;
      else if (child.content) out += inlineText(child);
    }
    close();
    return out;
  };
  const visit = (node: RichNode, ctx: Ctx) => {
    switch (node.type) {
      case "paragraph": {
        const text = inlineText(node);
        if (!text.trim()) return;
        const t = text.replace(/\s+/g, " ").trim();
        if (typeof node.attrs?.blockId === "string") blockText.set(node.attrs.blockId, t);
        if (node.attrs?.docStyle === "title") units.push({ k: "h", l: 0, t, br: breaksOf(text), title: true });
        else if (ctx.cell) units.push({ k: "cell", l: 0, t, br: breaksOf(text), row: ctx.cell.row, col: ctx.cell.col });
        else if (ctx.lists.length) units.push({ k: "li", l: ctx.lists.length, t, br: breaksOf(text), lt: ctx.lists.at(-1) });
        else units.push({ k: ctx.quote ? "q" : "p", l: 0, t, br: breaksOf(text) });
        return;
      }
      case "heading": {
        const text = inlineText(node);
        if (typeof node.attrs?.blockId === "string") blockText.set(node.attrs.blockId, text);
        if (text.trim()) units.push({ k: "h", l: Number(node.attrs?.level ?? 1), t: text.replace(/\s+/g, " ").trim(), br: breaksOf(text) });
        return;
      }
      case "codeBlock":
        units.push({ k: "code", l: 0, t: (node.content ?? []).map((c) => c.text ?? (c.type === "hardBreak" ? "\n" : "")).join(""), br: null });
        return;
      case "blockMath":
        units.push({ k: "math", l: 0, t: String(node.attrs?.latex ?? ""), br: null });
        return;
      case "horizontalRule":
        units.push({ k: "hr", l: 0, t: "", br: null });
        return;
      case "figure": {
        const html = figureHtml.get(String(node.attrs?.mediaId)) ?? "";
        for (const m of (html ?? "").matchAll(/<(?:img|source|video)\b[^>]*?\bsrc="([^"]+)"/g)) figures.push(m[1].replace(/&amp;/g, "&"));
        return;
      }
      case "image":
        if (typeof node.attrs?.src === "string") figures.push(node.attrs.src);
        return;
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const lt = node.type === "bulletList" ? "ul" : node.type === "orderedList" ? "ol" : "task";
        for (const child of node.content ?? []) visit(child, { ...ctx, lists: [...ctx.lists, lt] });
        return;
      }
      case "blockquote":
        for (const child of node.content ?? []) visit(child, { ...ctx, quote: true });
        return;
      case "table": {
        (node.content ?? []).forEach((row, r) =>
          (row.content ?? []).forEach((cell, c) => {
            for (const child of cell.content ?? []) visit(child, { ...ctx, cell: { row: r + 1, col: c + 1 } });
          }),
        );
        return;
      }
      default:
        for (const child of node.content ?? []) visit(child, ctx);
    }
  };
  visit(doc, { lists: [], quote: false, cell: null });
  links = links.flatMap(([t, h]): [string, string][] => {
    if (!h.startsWith("#heading=")) return [[t, h]];
    const target = blockText.get(h.slice("#heading=".length));
    return target === undefined ? [] : [[t, targetKey(target)]];
  });
  return { units, links, figures };
}

// ── The score ───────────────────────────────────────────────────────────────

/** How each heading stands against the heading before it: deeper, same,
    or higher (the first: first). An import's Title is level 0. */
function headingSteps(units: Unit[]): Map<number, string> {
  const out = new Map<number, string>();
  let prev: number | null = null;
  units.forEach((u, i) => {
    if (u.k !== "h") return;
    out.set(i, prev === null ? "first" : u.l > prev ? "deeper" : u.l === prev ? "same" : "higher");
    prev = u.l;
  });
  return out;
}

// A key that many units share on both sides (a separator, a repeated log
// line) pairs in order of its copies instead of entering the common run:
// every pair of its copies would be a candidate.
const RUN_PAIRS_MAX = 200_000;

/** The longest common run of the reference's keys and the candidates'
    (Hunt–Szymanski: the longest increasing run over the matching pairs,
    each reference unit's candidates taken high to low). */
function commonRun(refKeys: string[], index: Map<string, number[]>): { r: number; c: number }[] {
  const refCount = new Map<string, number>();
  for (const k of refKeys) if (k) refCount.set(k, (refCount.get(k) ?? 0) + 1);
  const tails: number[] = []; // candidate index at the run's end, per length
  const tailPair: number[] = []; // the pair at tails[i]
  const pairsR: number[] = [];
  const pairsC: number[] = [];
  const prev: number[] = [];
  const seenOf = new Map<string, number>();
  refKeys.forEach((k, r) => {
    if (!k) return;
    const list = index.get(k);
    if (!list) return;
    let cands: number[];
    if (list.length * (refCount.get(k) ?? 1) > RUN_PAIRS_MAX) {
      // The n-th copy in the reference takes the n-th copy among ours.
      const n = seenOf.get(k) ?? 0;
      seenOf.set(k, n + 1);
      cands = n < list.length ? [list[n]] : [];
    } else cands = [...list].reverse();
    for (const c of cands) {
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid] < c) lo = mid + 1;
        else hi = mid;
      }
      const id = pairsR.length;
      pairsR.push(r);
      pairsC.push(c);
      prev.push(lo > 0 ? tailPair[lo - 1] : -1);
      tails[lo] = c;
      tailPair[lo] = id;
    }
  });
  const out: { r: number; c: number }[] = [];
  for (let id = tails.length ? tailPair[tails.length - 1] : -1; id >= 0; id = prev[id]) out.push({ r: pairsR[id], c: pairsC[id] });
  return out.reverse();
}

type Score = {
  score: number;
  words: number;
  lost: number;
  extra: number;
  structure: number | null;
  order: number | null;
  breaks: number | null;
  links: number | null;
  figures: number | null;
  units: [number, number, number];
  lostWords: string[];
  extraWords: string[];
  missed: Unit[];
  wrongKind: [Unit, Unit][];
  strays: Unit[];
  badBreaks: [Unit, Unit][];
};

function codeKey(text: string) {
  return text.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
}

function score(ref: Ref, ours: Ours, mode: "md" | "txt", refWords: string[], optional: Map<string, number> = new Map()): Score {
  // A twin's preformatted block (a poem set in <pre>) is its stanzas: a
  // text file's blank lines part them as the twin's do.
  const refUnits = ref.units.flatMap((u): Unit[] => {
    if (u.k !== "code") return [u];
    if (mode === "md") return [{ ...u, br: breaksOf(codeKey(u.t)) }];
    return codeKey(u.t)
      .split(/\n[ \t]*\n/)
      .filter((part) => part.trim())
      .map((part) => ({ k: "p", l: 0, t: part, br: breaksOf(part) }));
  });
  // Our units, and for a reference of lines, our units cut at their breaks.
  const ourUnits = ours.units.map((u) => (u.k === "code" ? { ...u, br: breaksOf(codeKey(u.t)) } : u));
  const lineMode = mode === "txt" && refUnits.some((u) => u.k === "line");
  // A unit's lines: its text cut at its breaks (a paragraph's text has its
  // whitespace collapsed; the breaks are word offsets), or at its newlines.
  const linesOf = (u: Unit): string[] => {
    if (!u.br?.length) return u.t.split("\n");
    const ws = words(u.t);
    const out: string[] = [];
    let from = 0;
    for (const b of [...u.br, ws.length]) {
      out.push(ws.slice(from, b).join(" "));
      from = b;
    }
    return out;
  };
  const candidates: { unit: Unit; at: number }[] = [];
  ourUnits.forEach((u, i) => {
    if (lineMode) for (const line of linesOf(u)) candidates.push({ unit: { ...u, t: line, br: [] }, at: i });
    else candidates.push({ unit: u, at: i });
  });
  const keyOf = (u: Unit) => (u.k === "hr" ? "<hr>" : mode === "md" && u.k === "code" ? `code:${codeKey(u.t)}` : key(u.t));
  const index = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    const k = keyOf(c.unit);
    if (!k) return;
    if (!index.has(k)) index.set(k, []);
    index.get(k)!.push(i);
  });
  // The units in order first: the longest common run of the two sequences
  // (a heading the contents list names too pairs with the heading, not with
  // the contents entry); then any unit left pairs with a free copy of
  // itself, out of order.
  const refKeys = refUnits.map(keyOf);
  const inOrder = commonRun(refKeys, index);
  const used = new Set<number>(inOrder.map((p) => p.c));
  const pairs: { r: number; c: number }[] = [...inOrder];
  const paired = new Set(inOrder.map((p) => p.r));
  refKeys.forEach((k, r) => {
    if (!k || paired.has(r)) return;
    const pick = index.get(k)?.find((i) => !used.has(i));
    if (pick === undefined) return;
    used.add(pick);
    pairs.push({ r, c: pick });
  });
  const refSteps = headingSteps(refUnits);
  // Steps over our headings: for a reference of lines, over the units.
  const ourSteps = headingSteps(ourUnits);
  const missed: Unit[] = [];
  const wrongKind: [Unit, Unit][] = [];
  const badBreaks: [Unit, Unit][] = [];
  const matched = new Set(pairs.map((p) => p.r));
  refUnits.forEach((u, r) => {
    if (keyOf(u) && !matched.has(r)) missed.push(u);
  });
  let correct = 0;
  let breaksChecked = 0;
  let breaksOk = 0;
  for (const { r, c } of pairs) {
    const a = refUnits[r];
    const cand = candidates[c];
    const b = cand.unit;
    let ok: boolean;
    if (mode === "txt") {
      ok = (a.k === "h") === (b.k === "h");
    } else if (a.k === "h") {
      ok = b.k === "h" && refSteps.get(r) === ourSteps.get(cand.at);
    } else if (a.k === "li") {
      ok = b.k === "li" && a.l === b.l && (a.lt ?? "ul") === (b.lt ?? "ul");
    } else if (a.k === "cell") {
      ok = b.k === "cell" && a.col === b.col;
    } else {
      ok = a.k === b.k;
    }
    if (ok) correct++;
    else wrongKind.push([a, b]);
    if (a.br !== null && a.k !== "h" && (mode === "txt" || a.k === "code" || a.br.length > 0 || b.br?.length)) {
      breaksChecked++;
      const same = JSON.stringify(a.br) === JSON.stringify(b.br ?? []);
      if (same) breaksOk++;
      else badBreaks.push([a, b]);
    }
  }
  const refCount = refUnits.filter((u) => keyOf(u)).length;
  const ourCount = ourUnits.filter((u) => keyOf(u)).length;
  const usedAt = new Set([...used].map((i) => candidates[i].at));
  const strays = mode === "md" ? ourUnits.filter((u, i) => keyOf(u) && !usedAt.has(i)) : [];
  let structure: number | null;
  if (mode === "md") {
    const p = ourCount ? correct / ourCount : refCount ? 0 : 1;
    const rr = refCount ? correct / refCount : ourCount ? 0 : 1;
    structure = p + rr > 0 ? (2 * p * rr) / (p + rr) : 0;
  } else {
    structure = refCount ? correct / refCount : null;
  }
  const order = pairs.length ? inOrder.length / pairs.length : null;
  const ourWords = ours.units.flatMap((u) => words(u.t));
  const w = wordScore(refWords, ourWords, optional);
  // Links: [words, href] pairs with an absolute href, or a fragment that
  // names a heading of the file (by GitHub's heading ids), scored as "#" and
  // the heading's words.
  let links: number | null = null;
  if (mode === "md") {
    const norm = (pairsIn: [string, string][]) =>
      pairsIn.filter(([, h]) => /^(https?:|mailto:|#)/i.test(h)).map(([t, h]) => `${key(t)}\u0000${h.trim()}`);
    const slugText = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const u of ref.units) {
      if (u.k !== "h" || u.title) continue;
      const base = u.t.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      slugText.set(n === 0 ? base : `${base}-${n}`, u.t);
    }
    const refLinks = ref.links.flatMap(([t, h]): [string, string][] => {
      if (!h.startsWith("#")) return [[t, h]];
      let fragment = h.slice(1);
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // the fragment as written
      }
      const target = slugText.get(fragment.toLowerCase());
      return target === undefined ? [] : [[t, targetKey(target)]];
    });
    const a = bag(norm(refLinks));
    // A bare address in the text is a link on GitHub (GFM's autolink
    // literal) and not in CommonMark: ours, when the reference has none, is
    // not counted.
    const bare = ([t, h]: [string, string]) => key(t) === key(h.replace(/^mailto:/i, "")) || key(`https://${t}`) === key(h) || key(`http://${t}`) === key(h);
    const b = bag(norm(ours.links.filter((l) => !bare(l) || a.has(norm([l])[0]))));
    const na = [...a.values()].reduce((s, n) => s + n, 0);
    const nb = [...b.values()].reduce((s, n) => s + n, 0);
    if (na + nb > 0) {
      let both = 0;
      for (const [k, n] of a) both += Math.min(n, b.get(k) ?? 0);
      const p = nb ? both / nb : 0;
      const r = na ? both / na : 0;
      links = p + r > 0 ? (2 * p * r) / (p + r) : 0;
    }
  }
  let figures: number | null = null;
  if (mode === "md" && ref.figures.length > 0) {
    const have = bag(ours.figures);
    let found = 0;
    for (const src of ref.figures) {
      const n = have.get(src) ?? 0;
      if (n > 0) {
        found++;
        have.set(src, n - 1);
      }
    }
    figures = found / ref.figures.length;
  }
  const breaks = breaksChecked ? breaksOk / breaksChecked : null;
  const parts = [w.f1, structure, order, breaks, links, figures].filter((x): x is number => x !== null);
  return {
    score: parts.reduce((s, x) => s + x, 0) / parts.length,
    words: w.f1,
    lost: w.lost,
    extra: w.extra,
    structure,
    order,
    breaks,
    links,
    figures,
    units: [correct, refCount, ourCount],
    lostWords: w.lostWords,
    extraWords: w.extraWords,
    missed,
    wrongKind,
    strays,
    badBreaks,
  };
}

// ── One file through the add ────────────────────────────────────────────────

type Run = { parse: Ours; import: Ours; parseMs: number; importMs: number; blockDocument: boolean; title: string; blocks: ParsedBlock[] };

async function runFile(bytes: Uint8Array, name: string): Promise<Run> {
  const t0 = performance.now();
  const text = markdownFileText(bytes);
  const parsed = await parseMarkdownDocument(text, name);
  const parseMs = performance.now() - t0;
  const title = parsed.title ?? name;
  const titleFromOriginal = !parsed.titleFromFile;
  const t1 = performance.now();
  const out = richTextFromImport({ kind: "markdown", title, titleFromOriginal, blocks: resolveContentsLinks(parsed.blocks) });
  let blockDocument = out.size.rows > IMPORT_MAX_ROWS || out.size.json > IMPORT_MAX_JSON_BYTES;
  const clean = blockDocument ? null : sanitizeRichText(out.richText);
  if (!clean) blockDocument = true;
  if (clean) deriveBlocks(clean);
  const importMs = performance.now() - t1;
  const refUrls = new Map((parsed.references ?? []).flatMap((r) => (r.url ? [[r.id, r.url] as [string, string]] : [])));
  const parse = unitsFromBlocks(parsed.blocks, titleFromOriginal ? title : null, refUrls);
  const figureHtml = new Map(out.figures.map((f) => [f.mediaId, f.html]));
  return { parse, import: clean ? unitsFromRich(clean, figureHtml, refUrls) : parse, parseMs, importMs, blockDocument, title, blocks: parsed.blocks };
}

// ── The run ─────────────────────────────────────────────────────────────────

type Result = { id: string; set: "spec" | "md" | "txt"; parse: Score; import: Score; parseMs: number; importMs: number; blockDocument: boolean; error?: string; section?: string };
const results: Result[] = [];
const runs = new Map<string, Run>();
const refs = new Map<string, Ref>();
const want = (id: string, s: string) => (detail ? id === detail : (!set || set === s) && (!only || only.includes(id)));

/** A parse that failed. A failed parse of a file that shows nothing (one
    HTML comment) loses nothing: it scores 1. */
function emptyScore(ref: Ref, mode: "md" | "txt" = "md"): Score {
  const empty = ref.units.length === 0 && ref.figures.length === 0 && !ref.title && (mode === "md" || words(ref.text ?? "").length === 0);
  return { score: empty ? 1 : 0, words: empty ? 1 : 0, lost: 0, extra: 0, structure: 0, order: null, breaks: null, links: null, figures: null, units: [0, 0, 0], lostWords: [], extraWords: [], missed: [], wrongKind: [], strays: [], badBreaks: [] };
}

for (const spec of corpus.spec) {
  const cases = (JSON.parse(readFileSync(refPath(`spec-${spec.id}`), "utf8")) as { cases: SpecCase[] }).cases;
  for (const c of cases) {
    const id = `${spec.id}-${c.n}`;
    if (!want(id, "spec")) continue;
    const refWords = c.units.flatMap((u) => words(u.t));
    try {
      const run = await runFile(new TextEncoder().encode(c.md), "example.md");
      runs.set(id, run);
      refs.set(id, c);
      results.push({ id, set: "spec", section: c.section, parse: score(c, run.parse, "md", refWords), import: score(c, run.import, "md", refWords), parseMs: run.parseMs, importMs: run.importMs, blockDocument: run.blockDocument });
    } catch (e) {
      results.push({ id, set: "spec", section: c.section, parse: emptyScore(c), import: emptyScore(c), parseMs: 0, importMs: 0, blockDocument: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

for (const entry of corpus.files) {
  if (!want(entry.id, entry.kind)) continue;
  const ref = JSON.parse(readFileSync(refPath(entry.id), "utf8")) as Ref;
  const bytes = new Uint8Array(readFileSync(join(BENCH, "files", `${entry.id}.bin`)));
  let refWords: string[];
  let optional = new Map<string, number>();
  if (entry.kind === "md") {
    refWords = [...(ref.title ? words(ref.title) : []), ...ref.units.flatMap((u) => words(u.t))];
    if (ref.title) ref.units.unshift({ k: "h", l: 0, t: ref.title, br: [], title: true });
  } else {
    // A text file's words are every word of the file, but the page
    // furniture of an RFC (its running heads and footers), which a parse
    // may keep or drop: those words are optional.
    const furniture = new Set(ref.optional ?? []);
    const lines = (ref.text ?? "").split("\n");
    refWords = lines.filter((line) => !furniture.has(line.replace(/\f/g, "").trimEnd())).flatMap((line) => words(line));
    optional = bag(lines.filter((line) => furniture.has(line.replace(/\f/g, "").trimEnd())).flatMap((line) => words(line)));
  }
  try {
    const run = await runFile(bytes, entry.name);
    runs.set(entry.id, run);
    refs.set(entry.id, ref);
    results.push({ id: entry.id, set: entry.kind, parse: score(ref, run.parse, entry.kind, refWords, optional), import: score(ref, run.import, entry.kind, refWords, optional), parseMs: run.parseMs, importMs: run.importMs, blockDocument: run.blockDocument });
  } catch (e) {
    results.push({ id: entry.id, set: entry.kind, parse: emptyScore(ref, entry.kind), import: emptyScore(ref, entry.kind), parseMs: 0, importMs: 0, blockDocument: false, error: e instanceof Error ? e.stack ?? e.message : String(e) });
  }
}

// ── The report ──────────────────────────────────────────────────────────────

const fmt = (x: number | null) => (x === null ? "  -  " : x.toFixed(3));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const meanOf = (rs: Result[], pick: (r: Result) => number | null) => {
  const xs = rs.map(pick).filter((x): x is number => x !== null);
  return xs.length ? mean(xs) : null;
};

if (detail) {
  const r = results[0];
  if (!r) {
    console.log(`No file or example ${detail}`);
    process.exit(1);
  }
  const run = runs.get(r.id);
  const ref = refs.get(r.id);
  console.log(`── ${r.id}${r.error ? `  error: ${r.error}` : ""}`);
  if (ref && "md" in ref) console.log(`Markdown:\n${(ref as SpecCase).md}`);
  for (const view of ["parse", "import"] as const) {
    const s = r[view];
    console.log(`\n${view}: score ${fmt(s.score)}  words ${fmt(s.words)} (lost ${s.lost}, extra ${s.extra})  structure ${fmt(s.structure)}  order ${fmt(s.order)}  breaks ${fmt(s.breaks)}  links ${fmt(s.links)}  figures ${fmt(s.figures)}  units ${s.units.join("/")}`);
    if (s.lostWords.length) console.log(`  lost words: ${s.lostWords.slice(0, 40).join(" ")}`);
    if (s.extraWords.length) console.log(`  extra words: ${s.extraWords.slice(0, 40).join(" ")}`);
    const show = (u: Unit) => `${u.k}${u.l ? u.l : ""}${u.lt ? `/${u.lt}` : ""}${u.col ? `@${u.col}` : ""} ${JSON.stringify(u.t.slice(0, 110))}`;
    for (const u of s.missed.slice(0, 25)) console.log(`  missed  ${show(u)}`);
    for (const [a, b] of s.wrongKind.slice(0, 25)) console.log(`  kind    ${show(a)}  →  ${show(b)}`);
    for (const u of s.strays.slice(0, 25)) console.log(`  stray   ${show(u)}`);
    for (const [a, b] of s.badBreaks.slice(0, 10)) console.log(`  breaks  ${show(a)} ${JSON.stringify(a.br)}  →  ${JSON.stringify(b.br)}`);
  }
  if (run) {
    console.log(`\nTitle: ${run.title}${run.blockDocument ? "  (stays a block document: past the size guard)" : ""}`);
    console.log(`Blocks (${run.blocks.length}):`);
    for (const b of run.blocks.slice(0, 60)) console.log(`  ${b.type.padEnd(9)} ${JSON.stringify(b.text.slice(0, 140))}`);
  }
  process.exit(0);
}

const sets = (["spec", "md", "txt"] as const).filter((s) => results.some((r) => r.set === s));
for (const s of sets) {
  const rs = results.filter((r) => r.set === s);
  console.log(`\n${s}: worst ${Math.min(worst, rs.length)} by import score`);
  for (const r of [...rs].sort((a, b) => a.import.score - b.import.score).slice(0, worst)) {
    const i = r.import;
    console.log(
      `  ${r.id.padEnd(28)} ${fmt(i.score)}  words ${fmt(i.words)} lost ${String(i.lost).padStart(5)} extra ${String(i.extra).padStart(5)}  struct ${fmt(i.structure)}  order ${fmt(i.order)}  breaks ${fmt(i.breaks)}  links ${fmt(i.links)}  parse ${fmt(r.parse.score)}  ${Math.round(r.parseMs)} ms${r.error ? `  error: ${r.error.split("\n")[0]}` : ""}`,
    );
  }
}
if (sets.includes("spec")) {
  const rs = results.filter((r) => r.set === "spec");
  const sections = new Map<string, Result[]>();
  for (const r of rs) {
    const name = r.section ?? "";
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name)!.push(r);
  }
  console.log("\nspec by section (import score, parse score, examples):");
  for (const [name, list] of [...sections].sort((a, b) => mean(a[1].map((r) => r.import.score)) - mean(b[1].map((r) => r.import.score)))) {
    console.log(`  ${name.padEnd(36)} ${fmt(mean(list.map((r) => r.import.score)))}  ${fmt(mean(list.map((r) => r.parse.score)))}  ${list.length}`);
  }
}

type Totals = { score: number; words: number; structure: number | null; order: number | null; breaks: number | null; links: number | null; lost: number; extra: number; parseScore: number; ms: number };
function totals(rs: Result[]): Totals {
  return {
    score: mean(rs.map((r) => r.import.score)),
    words: mean(rs.map((r) => r.import.words)),
    structure: meanOf(rs, (r) => r.import.structure),
    order: meanOf(rs, (r) => r.import.order),
    breaks: meanOf(rs, (r) => r.import.breaks),
    links: meanOf(rs, (r) => r.import.links),
    lost: rs.reduce((s, r) => s + r.import.lost, 0),
    extra: rs.reduce((s, r) => s + r.import.extra, 0),
    parseScore: mean(rs.map((r) => r.parse.score)),
    ms: rs.reduce((s, r) => s + r.parseMs + r.importMs, 0),
  };
}
console.log("");
const allTotals: Record<string, Totals> = {};
for (const s of sets) {
  const rs = results.filter((r) => r.set === s);
  const t = totals(rs);
  allTotals[s] = t;
  console.log(
    `${s.padEnd(4)} score ${fmt(t.score)} (parse ${fmt(t.parseScore)})  words ${fmt(t.words)}  structure ${fmt(t.structure)}  order ${fmt(t.order)}  breaks ${fmt(t.breaks)}  links ${fmt(t.links)}  lost ${t.lost}  extra ${t.extra}  ` +
      `files ${rs.length}  errors ${rs.filter((r) => r.error).length}  time ${(t.ms / 1000).toFixed(1)} s`,
  );
}

const json = value("--json");
if (json) writeFileSync(json, JSON.stringify(results.map((r) => ({ ...r, parse: { ...r.parse, missed: undefined, wrongKind: undefined, strays: undefined, badBreaks: undefined }, import: { ...r.import, missed: undefined, wrongKind: undefined, strays: undefined, badBreaks: undefined } })), null, 1));

type Baseline = { total: Record<string, { score: number; parse: number; words: number; lost: number }>; files: Record<string, [number, number]> };
const round = (x: number) => Math.round(x * 1000) / 1000;
if (flag("--save-baseline")) {
  const prior: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { total: {}, files: {} };
  for (const r of results) prior.files[r.id] = [round(r.import.score), round(r.parse.score)];
  if (!only) for (const s of sets) prior.total[s] = { score: round(allTotals[s].score), parse: round(allTotals[s].parseScore), words: round(allTotals[s].words), lost: allTotals[s].lost };
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${results.length} scores to ${BASELINE}`);
}
if (flag("--baseline") && existsSync(BASELINE)) {
  const base: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const drops = results.filter((r) => base.files[r.id] && (r.import.score < base.files[r.id][0] - 0.01 || r.parse.score < base.files[r.id][1] - 0.01));
  const rises = results.filter((r) => base.files[r.id] && (r.import.score > base.files[r.id][0] + 0.01 || r.parse.score > base.files[r.id][1] + 0.01));
  console.log(`\nAgainst the baseline (${sets.map((s) => `${s} ${fmt(base.total[s]?.score ?? null)}`).join(", ")}): ${rises.length} rose, ${drops.length} dropped`);
  for (const r of rises.slice(0, 40)) console.log(`  rose    ${r.id.padEnd(28)} ${fmt(base.files[r.id][0])} → ${fmt(r.import.score)}  (parse ${fmt(base.files[r.id][1])} → ${fmt(r.parse.score)})`);
  for (const r of drops) console.log(`  dropped ${r.id.padEnd(28)} ${fmt(base.files[r.id][0])} → ${fmt(r.import.score)}  (parse ${fmt(base.files[r.id][1])} → ${fmt(r.parse.score)})`);
  if (drops.length > 0) process.exitCode = 1;
}
