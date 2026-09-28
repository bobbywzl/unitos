/**
 * Builds each arXiv paper's reference from its LaTeXML HTML (latexml.ts) and the PDF (pages.ts): the body from
 * LaTeXML, the front matter in the PDF's own words, headings and captions as the PDF prints them, the paper's
 * macros expanded; then cuts it to the scored pages and writes it: scripts/parse-bench/refs/<id>.json for CC BY
 * and CC0 papers, .bench/refs/<id>.json for the rest. Prints one line per paper: the pages scored, the license,
 * the word agreement with pdftotext on those pages (the reference's words found in the PDF, and the PDF's words
 * found in the reference, formulas left out on both sides), and the formulas KaTeX renders.
 *
 *   npx tsx scripts/parse-bench/arxiv/build.mts [--only 2411.09614v2,2502.02648v2] [--detail]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { texError } from "@/lib/katex";
import type { RefBlock, RefDoc, Span } from "../model";
import { convertLatexml, normalizeSpans, type Built } from "./latexml";
import {
  authorLines,
  findLine,
  frontNotes,
  furnitureStrings,
  lineEnding,
  linesBetween,
  locate,
  markFurniture,
  pageTokens,
  leadOf,
  printedCase,
  printedForm,
  readPdf,
  titleLines,
  tokens,
  typicalHeight,
} from "./pages";
import { PAPERS, benchFile, refId, type Paper } from "./papers";
import { expandTex } from "./tex";

/** A printed caption tag: "Figure 1:", "FIG. 1.", "TABLE II.", "Table 3.", "Fig. 4", "Algorithm 1". */
const CAPTION_TAG_RE = /^(fig(ure)?|table|tab|algorithm|listing|scheme|chart|plate)\.?\s*([A-Z]?\d+|[IVXL]+)[.:]?$/i;

/** A printed section number: "2", "2.1", "II.", "A", "A.1", "Appendix A". */
const SECTION_NUMBER_RE = /^(appendix\s+)?([A-Z]|[IVXL]+|\d+)(\.\d+)*[.:]?$/i;

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const detail = args.includes("--detail");

for (const paper of PAPERS) {
  if (only && !only.includes(paper.id)) continue;
  const result = build(paper);
  const dir = result.doc.license === "open" || result.doc.license === "public-domain" ? "scripts/parse-bench/refs" : ".bench/refs";
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${result.doc.id}.json`, JSON.stringify(result.doc, null, 1) + "\n");
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(
    [
      paper.id.padEnd(13),
      paper.field.padEnd(30),
      `pages ${paper.pages.join("–")}`.padEnd(12),
      result.licenseName.padEnd(10),
      `words ${pct(result.recall)} / ${pct(result.precision)}`,
      `KaTeX ${result.formulas - result.failed}/${result.formulas}`,
      `${result.doc.blocks.length} blocks`,
    ].join("  "),
  );
}

type Result = { doc: RefDoc; licenseName: string; recall: number; precision: number; formulas: number; failed: number };

function build(paper: Paper): Result {
  const built = convertLatexml(readFileSync(benchFile(paper, "html"), "utf8"), {
    parenCite: paper.parenCite,
    numericCite: paper.numericCite,
    citeNoComma: paper.citeNoComma,
    citeCompress: paper.citeCompress,
  });
  const pages = readPdf(benchFile(paper, "pdf"));
  const [license, licenseName] = readLicense(readFileSync(benchFile(paper, "abs.html"), "utf8"));
  const log = (...parts: unknown[]) => detail && console.log(`  [${paper.id}]`, ...parts);

  // Front matter: the title, then the author area in the PDF's own words, then the abstract as the PDF prints it.
  const page1 = pages[0];
  const front = built.filter((b) => b.role === "front");
  const title = titleLines(page1, textOf(front[0].block));
  if (!title.length) throw new Error(`${paper.id}: title not found on page 1`);
  const titleCase = printedCase(title.flatMap((l) => l.words));
  for (const span of spansOf(front[0].block)) {
    if (span.latex !== undefined) continue;
    if (titleCase === "upper") span.text = span.text.toUpperCase();
    if (titleCase === "smallCaps") span.smallCaps = true;
  }
  let below = Math.max(...title.map((l) => l.y1));
  for (const extra of front.slice(1)) {
    const lines = titleLines(page1, textOf(extra.block));
    if (lines.length) below = Math.max(below, ...lines.map((l) => l.y1));
  }
  markFurniture(pages, title, paper.furniture ?? []);

  const abstractAt = built.findIndex((b) => b.tag === "abstract" && b.block.kind === "heading");
  const firstText = built.find((b, i) => i > abstractAt && b.role === "flow" && b.block.kind === "paragraph");
  const abstractLine = firstText ? findLine(page1, tokens(textOf(firstText.block)), below) : undefined;
  const nameLine = page1.lines.find((l) => !l.furniture && l.y0 >= below - 1 && /^abstract\b/i.test(l.text.trim()) && (!abstractLine || l.y0 <= abstractLine.y0 + 1));
  if (abstractAt >= 0) {
    const name = nameLine?.text.trim() ?? "";
    if (nameLine && /^abstract[.:—–-]?$/i.test(name)) log("abstract: heading");
    else if (nameLine && firstText && firstText.block.kind === "paragraph") {
      const label = name.split(/\s+/)[0];
      firstText.block.spans = normalizeSpans([{ text: label }, { text: " " }, ...firstText.block.spans]);
      built.splice(abstractAt, 1);
      log(`abstract: run in "${label}"`);
    } else {
      built.splice(abstractAt, 1);
      log("abstract: no name printed");
    }
  }
  const above = Math.min(nameLine?.y0 ?? Infinity, abstractLine?.y0 ?? Infinity);
  if (!Number.isFinite(above)) throw new Error(`${paper.id}: abstract not found on page 1`);
  const authors: Built[] = authorLines(page1, below, above).map((spans) => ({ block: { kind: "paragraph", spans }, role: "front" }));
  log("author area:", authors.map((a) => textOf(a.block)));

  // What the class prints between the abstract and the first heading (keywords, classification, funding,
  // acknowledgements): the PDF's own lines where the reference lacks them, else LaTeXML's keywords and
  // classification, placed after the abstract (LaTeXML may put them elsewhere).
  const classification = built.filter((b) => b.tag === "classification");
  remove(built, (b) => b.tag === "classification");
  const abstractEnd = built.findLastIndex((b) => b.tag === "abstract");
  const afterAbstract = abstractEnd + 1;
  const nextBlock = built.slice(afterAbstract).find((b) => b.role === "flow");
  const abstractLines = built.slice(0, afterAbstract).filter((b) => b.tag === "abstract" && b.block.kind === "paragraph");
  const lastAbstract = abstractLines.at(-1);
  const endLine = lastAbstract && lineEnding(page1, tokens(blockText(lastAbstract.block, false)), above);
  const nextLine = nextBlock && findLine(page1, tokens(blockText(nextBlock.block, false)), endLine?.y1 ?? above);
  let region: string[] = [];
  if (endLine && firstText) {
    const grams = new Set(built.flatMap((b) => ngrams(tokens(blockText(b.block)), 3)));
    const known = (words: string[]) => words.length > 0 && ngrams(words, Math.min(3, words.length)).filter((g) => grams.has(g)).length >= Math.max(1, (words.length - 2) * 0.6);
    const columns = page1.lines.filter((l) => l.y0 >= (abstractLine?.y0 ?? above) - 1 && l.y1 <= endLine.y1 + 1);
    const x0 = Math.min(...columns.map((l) => l.x0));
    const x1 = Math.max(...columns.map((l) => l.x1));
    const inColumn = { ...page1, lines: page1.lines.filter((l) => l.x0 >= x0 - 8 && l.x1 <= x1 + 8) };
    region = linesBetween(inColumn, endLine.y1, nextLine?.y0 ?? page1.height, known);
  }
  const printedFront: Built[] = region.map((text) => ({ block: { kind: "paragraph", spans: [{ text }] }, role: "flow" }));
  log("after the abstract:", region);
  built.splice(afterAbstract, 0, ...(printedFront.length ? printedFront : classification));

  // Page 1's front notes (\thanks, addresses, amsart's classification) in the PDF's own words. A note LaTeXML
  // already has as a footnote stays LaTeXML's; a classification block the PDF prints as a note leaves.
  const joinable = new Set([...pages.flatMap((p) => tokens(p.lines.map((l) => l.text).join(" "))), ...built.flatMap((b) => tokens(blockText(b.block)))]);
  const covered = (words: string[], by: string[]) => words.filter((w) => by.includes(w)).length >= words.length * 0.6;
  const footnotes = built.filter((b) => b.block.kind === "footnote").map((b) => tokens(blockText(b.block)));
  const notes: Built[] = frontNotes(page1, endLine?.y1 ?? above, joinable, typicalHeight(pages[1] ?? page1))
    .filter((n) => !footnotes.some((f) => covered(tokens(n.text), f)))
    .map((n) => ({ block: { kind: "footnote", label: n.label, spans: [{ text: n.text }] }, role: "front" }));
  remove(built, (b) => b.tag === "classification" && notes.some((n) => covered(tokens(blockText(b.block)), tokens(blockText(n.block)))));
  log("front notes:", notes.map((n) => blockText(n.block)));

  built.splice(built.indexOf(front.at(-1)!) + 1, 0, ...authors, ...notes);

  // A printed table of contents stays when the PDF prints one.
  const printsContents = pages.slice(0, 3).some((p) => p.lines.some((l) => /^(table of )?contents$/i.test(l.text.trim())));
  if (!printsContents) remove(built, (b) => b.tag === "contents");

  // Headings and captions take their printed number or tag and their printed capitals from the PDF. A heading the
  // PDF runs in before its text (amsart's subsections) becomes the bold lead of its paragraph.
  let headingPage = 1; // each heading is searched from the page of the one before it, past the lines headings took
  const taken = new Set<string>();
  const captionLines = new Set<string>(); // a caption's line serves one caption (two may start alike)
  const captionPage = new Map<Built | number, number>(); // the page a float's caption prints on
  const unprinted = new Set<Built>();
  for (const [index, b] of built.entries()) {
    if (b.block.kind === "heading" && b.role === "flow") {
      const spans = b.block.spans;
      const lead = b.label && spans[0]?.latex === undefined && spans[0].text.startsWith(b.label) ? b.label : "";
      // the title's words, its formulas left out (pdftotext reads their glyphs its own way)
      const body = tokens(spans.map((s, i) => (s.latex !== undefined ? " " : i === 0 && lead ? s.text.slice(lead.length) : s.text)).join(""));
      const titleText = spans.map((sp, i) => (i === 0 && lead ? sp.text.slice(lead.length) : sp.text)).join("");
      const printed = printedForm(pages, headingPage, body, {
        maxBefore: lead ? 2 : 0,
        whole: true,
        taken,
        lead: leadOf(titleText),
        // a number set far apart may not be found on the row: LaTeXML's number stays then
        prefixOk: (prefix) => !prefix || (lead !== "" && SECTION_NUMBER_RE.test(prefix)),
      });
      if (!printed) {
        // an unnumbered heading the class does not print (revtex's "References") leaves the reference
        log(`heading not found in the PDF${lead ? "" : ", left out"}: "${textOf(b.block)}"`);
        if (!lead) unprinted.add(b);
        continue;
      }
      headingPage = printed.page;
      taken.add(`${printed.page}:${printed.line}`);
      if (lead && printed.prefix) spans[0].text = `${printed.prefix} ${spans[0].text.slice(lead.length).trimStart()}`;
      if (printed.upper) for (const s of spans) if (s.latex === undefined) s.text = s.text.toUpperCase();
      if (printed.smallCaps) for (const s of spans) if (s.latex === undefined) s.smallCaps = true;
      if (printed.after.length) {
        const next = built[index + 1];
        const paragraph = next?.role === "flow" && next.block.kind === "paragraph" ? next.block : null;
        const words = paragraph ? tokens(blockText(paragraph, false)) : [];
        // the words after the title on its line start its paragraph (a formula's glyph may stand among them)
        if (paragraph && printed.after.slice(0, 3).filter((w) => words.slice(0, 5).includes(w)).length >= Math.min(2, printed.after.length)) {
          paragraph.spans = normalizeSpans([...spans.map((s) => (s.latex === undefined ? { ...s, bold: true as const } : s)), { text: " " }, ...paragraph.spans]);
          unprinted.add(b);
          log(`heading runs in: "${textOf(b.block)}"`);
        } else log(`heading "${textOf(b.block)}" is followed on its line by "${printed.after.slice(0, 4).join(" ")}", not its text`);
      }
    }
    if (b.role === "float" && b.label && (b.block.kind === "figure" || b.block.kind === "table") && b.block.caption) {
      // the tag may follow panel captions ("(a) … (b) … Figure 1: …")
      const caption = b.block.caption;
      const at = caption.findIndex((sp) => sp.latex === undefined && sp.text.includes(b.label!));
      if (at < 0) continue;
      const head = caption[at].text.slice(0, caption[at].text.indexOf(b.label));
      const rest = caption[at].text.slice(head.length + b.label.length);
      const body = tokens([rest, ...caption.slice(at + 1).map((s) => (s.latex !== undefined ? " " : s.text))].join(""));
      const printed = printedForm(pages, 1, body, {
        maxBefore: 3,
        whole: false,
        lead: leadOf([rest, ...caption.slice(at + 1).map((s) => s.text)].join("")),
        prefixOk: (prefix) => CAPTION_TAG_RE.test(prefix),
        taken: captionLines,
      });
      if (printed) {
        caption[at].text = `${head}${printed.prefix} ${rest.trimStart()}`;
        captionLines.add(`${printed.page}:${printed.line}`);
        captionPage.set(b.group ?? b, printed.page);
      }
    }
  }
  remove(built, (b) => unprinted.has(b));

  // The paper's fixes: where LaTeXML prints other words than the PDF.
  for (const [find, replace] of paper.fixes ?? []) {
    let hits = 0;
    for (const b of built) {
      for (const span of spansOf(b.block)) {
        if (span.latex === undefined && span.text.includes(find)) {
          span.text = span.text.split(find).join(replace);
          hits++;
        }
      }
    }
    if (hits !== 1) throw new Error(`${paper.id}: fix "${find}" matches ${hits} spans, not one`);
  }

  // The paper's macros expand, so each formula is plain TeX.
  const expanded = new Set<string>();
  for (const b of built) {
    if (b.block.kind === "equation") b.block.latex = expandTex(b.block.latex, paper.macros, expanded);
    for (const span of spansOf(b.block)) if (span.latex !== undefined) span.latex = expandTex(span.latex, paper.macros, expanded);
  }

  // Cut to the scored pages: the flow at the last scored page's end, floats and footnotes by the page they print on.
  const [from, to] = paper.pages;
  const vocabulary = new Set(built.flatMap((b) => tokens(blockText(b.block))));
  const perPage = pages.map((p) => pageTokens(p, vocabulary));
  const pageTexts = pages.map((p) => p.lines.filter((l) => !l.furniture).map((l) => l.text).join("\n"));
  const { blocks: kept, end } = cut(built, perPage, pageTexts, to, log);
  const groups = new Map<number, number | null>();
  const final: RefBlock[] = [];
  kept.forEach((b, index) => {
    if (b.role === "front" || b.role === "flow") return void final.push(b.block);
    let page: number | null = captionPage.get(b.group ?? b) ?? null;
    if (page === null && b.group !== undefined && groups.has(b.group)) page = groups.get(b.group)!;
    else if (page === null) {
      page = locate(tokens(blockText(b.block)), perPage);
      if (b.group !== undefined) groups.set(b.group, page);
    }
    // a float the PDF's words do not place stays when the source has it before the cut
    const keep = page === null ? index < end : page >= from && page <= to;
    if (page === null) log(`not located (${keep ? "kept" : "left out"}): ${b.block.kind} ${blockText(b.block).slice(0, 60)}`);
    if (keep) final.push(b.block);
  });

  // Checks: word agreement with pdftotext on the scored pages, formulas left out on both sides (a PDF word the
  // reference's text never uses, under five letters or Greek, is taken for a formula's glyphs), and KaTeX.
  const refWords = final.flatMap((b) => tokens(blockText(b, false)));
  const known = new Set(refWords);
  const pdfWords = perPage.slice(from - 1, to).flat().filter((w) => known.has(w) || (w.length >= 5 && !/[\u0370-\u03ff]/.test(w)));
  const [recall, precision, missing, extra] = agreement(refWords, pdfWords);
  log("reference words not in the PDF:", missing.slice(0, 40).join(" "));
  log("PDF words not in the reference:", extra.slice(0, 60).join(" "));
  const formulas = final.flatMap((b) => (b.kind === "equation" ? [b.latex] : spansOf(b).flatMap((s) => (s.latex !== undefined ? [s.latex] : []))));
  const failures = formulas.filter((tex) => texError(tex) !== null);
  for (const tex of failures.slice(0, 5)) log("KaTeX fails:", tex, texError(tex));

  const furniture = furnitureStrings(pages, from, to);
  log("furniture:", furniture.join(" | "));
  const doc: RefDoc = {
    id: refId(paper),
    category: paper.category,
    source: { pdf: benchFile(paper, "pdf"), url: `https://arxiv.org/abs/${paper.id}` },
    pages: paper.pages,
    blocks: final,
    furniture,
    license,
    provenance: "latexml",
    notes: [
      `arXiv ${paper.id} (${paper.field}; ${paper.layout}), ${licenseName}. Built by scripts/parse-bench/arxiv/build.mts from the LaTeXML HTML; the author area is the PDF's own words.`,
      expanded.size ? `Macros expanded: ${[...expanded].sort().join(" ")}.` : "",
      paper.fixes?.length ? `Fixed where LaTeXML differs from the PDF: ${paper.fixes.map(([a, b]) => `"${a}" → "${b}"`).join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
  return { doc, licenseName, recall, precision, formulas: formulas.length, failed: failures.length };
}

/** The license the abstract page states: CC BY → open, CC0 → public domain, anything else → copyrighted. */
function readLicense(abs: string): [RefDoc["license"], string] {
  const href = /href="([^"]+)"[^>]*title="Rights to this article"|title="Rights to this article"[^>]*href="([^"]+)"/.exec(abs);
  const url = href?.[1] ?? href?.[2] ?? "";
  if (/creativecommons\.org\/licenses\/by\/(\d\.\d)/.test(url)) return ["open", `CC BY ${/\/by\/(\d\.\d)/.exec(url)![1]}`];
  if (/publicdomain\/zero/.test(url)) return ["public-domain", "CC0"];
  return ["copyrighted", url.replace(/^https?:\/\//, "") || "unknown"];
}

/**
 * The flow up to the end of page `to`. Five-word sequences found once in the reference and once in the PDF anchor
 * reference words to pages; between page `to`'s last anchor and the next page's first, a word alignment puts the
 * boundary. A paragraph that runs over the page end is cut there.
 */
function cut(built: Built[], perPage: string[][], pageTexts: string[], to: number, log: (...parts: unknown[]) => void): { blocks: Built[]; end: number } {
  const whole = { blocks: built, end: Infinity };
  if (to >= perPage.length) return whole;
  type Pos = { block: number; item: number; span: number; offset: number };
  const flow: { token: string; pos: Pos }[] = [];
  built.forEach((b, block) => {
    if (b.role !== "flow" && b.role !== "front") return;
    const walk = (spans: Span[], item: number) =>
      spans.forEach((span, s) => {
        if (span.latex !== undefined) return; // formulas read differently in the PDF's text
        for (const m of span.text.normalize("NFKD").matchAll(/\p{L}[\p{L}\p{M}]+/gu)) {
          const token = tokens(m[0])[0];
          if (token) flow.push({ token, pos: { block, item, span: s, offset: m.index! } });
        }
      });
    const blk = b.block;
    if (blk.kind === "list") blk.items.forEach((it, i) => walk(it.spans, i));
    else if ("spans" in blk) walk(blk.spans, -1);
  });
  const N = 5;
  const gram = (arr: string[], i: number) => arr.slice(i, i + N).join(" ");
  const refCount = new Map<string, number[]>();
  const refTokens = flow.map((f) => f.token);
  for (let i = 0; i + N <= refTokens.length; i++) refCount.set(gram(refTokens, i), [...(refCount.get(gram(refTokens, i)) ?? []), i]);
  const pdfAll = perPage.flatMap((words, p) => words.map((w) => ({ w, p: p + 1 })));
  const pdfCount = new Map<string, number>();
  const pdfTokens = pdfAll.map((x) => x.w);
  for (let i = 0; i + N <= pdfTokens.length; i++) pdfCount.set(gram(pdfTokens, i), (pdfCount.get(gram(pdfTokens, i)) ?? 0) + 1);
  // an anchor lies on one page; the scored pages' last anchor and the later pages' first set the window
  const anchors: { ref: number; pdf: number; page: number }[] = [];
  for (let i = 0; i + N <= pdfAll.length; i++) {
    if (pdfAll[i].p !== pdfAll[i + N - 1].p) continue;
    const g = gram(pdfTokens, i);
    const at = refCount.get(g);
    if (at?.length === 1 && pdfCount.get(g) === 1) anchors.push({ ref: at[0], pdf: i, page: pdfAll[i].p });
  }
  // The scored pages end at the last anchor of the longest chain rising in both orders (a figure's labels can match
  // text far away). The next pages start at the earliest anchor after it that another anchor near it on its page
  // supports (pdftotext may read a page's columns out of order).
  const last = rising(anchors).filter((a) => a.page <= to).at(-1);
  const later = anchors.filter((a) => a.page > to && a.ref > (last?.ref ?? -1)).sort((a, b) => a.ref - b.ref);
  const first = later.find((a) => later.some((b) => b !== a && b.page === a.page && Math.abs(b.ref - a.ref) <= 60));
  if (!first) return whole;
  // Align the reference words between the two anchors with the rest of the last anchor's page and the start of
  // the first one's page; pages between them hold no text of the flow (figures, tables).
  const refLo = last ? last.ref + N : 0;
  const window = refTokens.slice(refLo, first.ref);
  const between = pdfAll.slice(last ? last.pdf + N : 0, first.pdf);
  const before = between.filter((t) => t.p === last?.page).map((t) => t.w);
  const after = between.filter((t) => t.p === first.page).map((t) => t.w);
  const boundary = refLo + split(window, before, after);
  let at = flow[boundary]?.pos;
  // A formula or a number has no words to place it: when the page ends with the words the cut keeps last, what
  // follows them stays only as far as the page's own characters follow ("…Rev. Mod. Phys. 88, 035001 (2016)." stays;
  // "…from (14). The space" ‖ "Hk is called…" loses the formula).
  const lastKept = flow[boundary - 1];
  const pageEnd = before.length ? before : pdfAll.filter((t) => t.p === (last?.page ?? to)).map((t) => t.w);
  if (at && lastKept && lastKept.pos.block === at.block && lastKept.pos.item === at.item && pageEnd.at(-1) === lastKept.token) {
    const alnum = (text: string) => text.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    const text = pageTexts[(last?.page ?? to) - 1];
    const tail = alnum(text.slice(text.toLowerCase().lastIndexOf(lastKept.token) + lastKept.token.length));
    const b = built[at.block].block;
    const spans = b.kind === "list" ? b.items[at.item].spans : "spans" in b ? b.spans : [];
    let end = { ...lastKept.pos, offset: lastKept.pos.offset + lastKept.token.length };
    let seen = "";
    for (let s = lastKept.pos.span; s < spans.length && (s < at.span || (s === at.span && at.offset > 0)); s++) {
      const piece = s === lastKept.pos.span ? spans[s].text.normalize("NFKD").slice(end.offset) : spans[s].text;
      const upto = s === at.span ? piece.slice(0, at.offset) : piece;
      if (!tail.startsWith(seen + alnum(upto))) break;
      seen += alnum(upto);
      end = s === lastKept.pos.span ? { ...end, offset: end.offset + upto.length } : { ...end, span: s, offset: upto.length };
    }
    at = end;
  }
  const context = (i: number, j: number) => refTokens.slice(Math.max(0, i), Math.max(0, j)).join(" ");
  log(`cut after page ${to}: …${context(boundary - 8, boundary)} ‖ ${context(boundary, boundary + 8)}…`);
  if (!at) return whole;
  const out: Built[] = [];
  let end = Infinity;
  built.forEach((b, i) => {
    const isFlow = b.role === "flow" || b.role === "front";
    if (!isFlow || i < at.block) return void out.push(b);
    if (i > at.block) return;
    end = out.length;
    const blk = structuredClone(b.block);
    const trim = (spans: Span[], span: number, offset: number): Span[] => {
      const kept = spans.slice(0, span);
      const piece = spans[span];
      if (piece && piece.latex === undefined) kept.push({ ...piece, text: piece.text.normalize("NFKD").slice(0, offset).normalize("NFC") });
      return normalizeSpans(kept);
    };
    if (blk.kind === "list") {
      const items = blk.items.slice(0, at.item);
      const partial = trim(blk.items[at.item].spans, at.span, at.offset);
      if (partial.length) items.push({ ...blk.items[at.item], spans: partial });
      if (items.length) out.push({ ...b, block: { ...blk, items } });
    } else if ("spans" in blk) {
      const spans = trim(blk.spans, at.span, at.offset);
      if (spans.length) out.push({ ...b, block: { ...blk, spans } as RefBlock });
    }
    end = out.length;
  });
  // floats and footnotes stay in the source's order; build() places them by the page they print on
  return { blocks: out, end };
}

/** The longest chain of anchors rising in the PDF's order and in the reference's (anchors come in the PDF's order). */
function rising<T extends { ref: number }>(anchors: T[]): T[] {
  const tails: number[] = []; // tails[k]: index of the chain of length k+1 ending with the smallest ref
  const prev = new Array<number>(anchors.length).fill(-1);
  anchors.forEach((a, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (anchors[tails[mid]].ref < a.ref) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const out: T[] = [];
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]) out.unshift(anchors[i]);
  return out;
}

/**
 * Where a run of reference words splits between the end of one page and the start of the next: the k that
 * matches most words, the first k words against the page end and the rest against the next page's start.
 */
function split(words: string[], end: string[], start: string[]): number {
  const prefix = lcsLengths(words, end); // prefix[k]: common words of words[0..k) and `end`
  const suffix = lcsLengths([...words].reverse(), [...start].reverse()).reverse(); // suffix[k]: of words[k..) and `start`
  let best = 0;
  for (let k = 0; k <= words.length; k++) {
    const score = prefix[k] + suffix[k];
    const bestScore = prefix[best] + suffix[best];
    // on a tie, a word both pages could hold stays on the page it ends
    if (score > bestScore || (score === bestScore && prefix[k] > prefix[best])) best = k;
  }
  return best;
}

/** For each prefix a[0..k), the length of its longest common subsequence with b. */
function lcsLengths(a: string[], b: string[]): number[] {
  let row = new Array<number>(b.length + 1).fill(0);
  const out = [0];
  for (let i = 0; i < a.length; i++) {
    const next = new Array<number>(b.length + 1).fill(0);
    for (let j = 0; j < b.length; j++) next[j + 1] = a[i] === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
    row = next;
    out.push(row[b.length]);
  }
  return out;
}

/** Shares of the reference's words found in the PDF's and of the PDF's found in the reference, as bags; then the misses. */
function agreement(ref: string[], pdf: string[]): [number, number, string[], string[]] {
  const bag = (words: string[]) => words.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());
  const a = bag(ref);
  const b = bag(pdf);
  let common = 0;
  for (const [w, n] of a) common += Math.min(n, b.get(w) ?? 0);
  const missing = [...a].filter(([w, n]) => n > (b.get(w) ?? 0)).sort((x, y) => y[1] - (b.get(y[0]) ?? 0) - (x[1] - (b.get(x[0]) ?? 0))).map(([w, n]) => `${w}×${n - (b.get(w) ?? 0)}`);
  const extra = [...b].filter(([w, n]) => n > (a.get(w) ?? 0)).sort((x, y) => y[1] - (a.get(y[0]) ?? 0) - (x[1] - (a.get(x[0]) ?? 0))).map(([w, n]) => `${w}×${n - (a.get(w) ?? 0)}`);
  return [common / Math.max(1, ref.length), common / Math.max(1, pdf.length), missing, extra];
}

/** A word list's runs of n words. */
function ngrams(words: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out;
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function remove(built: Built[], test: (b: Built) => boolean) {
  for (let i = built.length - 1; i >= 0; i--) if (test(built[i])) built.splice(i, 1);
}

/** Every span of a block: text, captions, cells, items. */
function spansOf(block: RefBlock): Span[] {
  switch (block.kind) {
    case "title":
    case "heading":
    case "paragraph":
    case "quote":
    case "footnote":
      return block.spans;
    case "list":
      return block.items.flatMap((i) => i.spans);
    case "table":
      return [...(block.caption ?? []), ...block.rows.flatMap((r) => r.cells.flatMap((c) => c.spans))];
    case "figure":
      return block.caption ?? [];
    default:
      return [];
  }
}

function textOf(block: RefBlock): string {
  return spansOf(block)
    .map((s) => s.text)
    .join("");
}

/** The words a reader sees in a block: its spans, list markers, labels; formulas by their plain reading unless `math` is false. */
function blockText(block: RefBlock, math = true): string {
  const text = (spans: Span[]) => spans.map((s) => (s.latex !== undefined ? (math ? ` ${s.text} ` : " ") : s.text)).join("");
  if (block.kind === "equation") return `${math ? decodeEntities((block.mathml ?? "").replace(/<[^>]+>/g, " ")) : ""} ${block.label ?? ""}`;
  if (block.kind === "code") return block.text;
  if (block.kind === "list") return block.items.map((i) => `${i.marker} ${text(i.spans)}`).join(" ");
  if (block.kind === "footnote") return `${block.label} ${text(block.spans)}`;
  if (block.kind === "table") return [text(block.caption ?? []), ...block.rows.flatMap((r) => r.cells.map((c) => text(c.spans)))].join(" ");
  return text(spansOf(block));
}
