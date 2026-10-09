// The Word benchmark: real .docx files parsed in-process the way the Word add
// parses them (parseDocx, lib/parse/docx.ts), turned into an import
// (richTextFromImport) and its paragraph index (deriveBlocks), and held to
// the file's own structure as word/document.xml states it.
//
//   npx tsx scripts/parse-bench/word.mts [--only name,name] [--detail name]
//     [--baseline] [--save-baseline] [--json out.json]
//
// The set is the test files of open-source Word readers and writers (pandoc,
// mammoth, docx2python, python-docx, Apache POI, LibreOffice), saved under
// .bench/word/files by scripts/parse-bench/word-fetch.ts. word-corpus.json
// names each file's source (the repository at a pinned commit, or the npm
// package at a pinned version), its path there, its license, its sha256, and
// what it holds. They are other people's files: never committed. With no set
// the run skips.
//
// The reference is read from the file, not from the parse: every word of
// the body, the notes, and the text boxes; each paragraph's heading level
// (its style, or an outline level), Title, and caption; each list paragraph
// (numbering through its own properties or its style) and its level; each
// table's rows, grid columns, and repeated header rows; each footnote and
// endnote cited; each equation (OMML); each external link; each picture;
// the words set bold, italic, underlined, struck, raised, or lowered.
// Word hides what a printed copy leaves out, and so does the reference:
// tracked deletions (w:del, w:moveFrom) are gone and insertions kept (the
// changes read as accepted), hidden runs (w:vanish), comments, headers and
// footers, field codes, the page numbers of PAGE, NUMPAGES, and PAGEREF
// fields, and the fallback copy of a drawing (mc:Fallback).
//
// Each class of loss is counted per file, for the parse and for the import:
//   lost:<kind>      a paragraph whose words are not in the output (kind:
//                    body, heading, list, cell, note, box, label, caption)
//   words            words of the reference missing from the output
//   heading.missing  a heading's words kept but not as a heading
//   heading.level    a heading at another level
//   title.missing    a Title paragraph neither the title nor a heading
//   list.missing     a list paragraph's words kept but not as a list line
//   list.depth       a list line nested wrong against the line before it
//   list.kind        a bullet drawn as a number, or a number as a bullet
//   table.missing    a table of two or more columns not drawn as a table
//   table.rows / table.cols / table.header   a table drawn with other rows,
//                    columns, or fewer header rows
//   note.missing     a cited note with no note block
//   math.missing     an equation not kept as math
//   link.missing     a link's words not linked
//   image.missing    a picture not drawn
//   caption.unjoined a caption beside a picture or table left a paragraph
//   mark.<style>     bold, italic, underline, strike, sup, sub words that
//                    lost their mark
// The import's classes carry "import." before them.
//
// Baseline: scripts/parse-bench/word-baseline.json holds each file's counts
// (numbers only). --baseline lists every file where a class rose and exits 1
// when one did; --save-baseline writes the run.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { join } from "node:path";
import type { RichNode } from "@/lib/docs/schema";
import type { ParsedBlock, TextFont } from "@/lib/parse/types";

const ROOT = join(import.meta.dirname, "..", "..");
const SET = join(ROOT, ".bench", "word", "files");
const BASELINE = join(import.meta.dirname, "word-baseline.json");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

if (!existsSync(SET)) {
  console.log("No Word set at .bench/word/files: the Word benchmark skips.");
  process.exit(0);
}

const { parseDocx } = await import("@/lib/parse/docx");
const { richTextFromImport } = await import("@/lib/docs/import");
const { deriveBlocks, mathWords } = await import("@/lib/docs/blocks");
const { resolveContentsLinks } = await import("@/lib/parse/url");
const { attr, child, children, descendants, intAttr, officeDocumentPath, parseXmlPart, partRels, relsOfType, unzipOffice } = await import("@/lib/parse/office");
type OfficeZip = ReturnType<typeof unzipOffice>;

const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const detail = value("--detail");

// ── Words ───────────────────────────────────────────────────────────────────

/** Letters and digits alone, lowercased: what two readings of a paragraph
    share however they space, break, and mark it. */
const compact = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** Words: a Han or kana character is a word of its own (web.mts). */
const tokenize = (text: string) =>
  text.normalize("NFKC").toLowerCase().match(/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{N}])+/gu) ?? [];
function bag(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tokenize(text)) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}
/** Words of `want` that `have` lacks: how many, and which. */
function missingWords(want: string, have: string): { n: number; words: string[] } {
  const a = bag(want);
  const b = bag(have);
  let n = 0;
  const words: string[] = [];
  for (const [t, k] of a) {
    const lost = Math.max(0, k - (b.get(t) ?? 0));
    n += lost;
    if (lost > 0) words.push(lost > 1 ? `${t}×${lost}` : t);
  }
  return { n, words };
}

// ── The reference: the file's own structure ─────────────────────────────────

type UnitKind = "body" | "heading" | "title" | "list" | "cell" | "note" | "box" | "label" | "caption";
type Unit = {
  kind: UnitKind;
  text: string;
  level?: number;
  ilvl?: number;
  bullet?: boolean;
  /** The list run a list paragraph belongs to (its position among the body's list runs). */
  run?: number;
  /** The list (w:numId) a list paragraph is an item of. */
  numId?: string;
  /** A caption beside a picture or a table. */
  nearFloat?: boolean;
  /** …beside a table and no picture: the page editor has no table caption,
      so an import keeps it a paragraph over the table. */
  nearTable?: boolean;
  /** The paragraph holds a picture (a caption's neighbor). */
  picture?: boolean;
};
type TableRef = { rows: number; cols: number; header: number; first: string; nested: boolean };
type Reference = {
  units: Unit[];
  tables: TableRef[];
  notes: number;
  math: number;
  links: string[];
  images: number;
  marks: Record<MarkKind, string[]>;
};
type MarkKind = "bold" | "italic" | "underline" | "strike" | "sup" | "sub";
const MARK_KINDS: MarkKind[] = ["bold", "italic", "underline", "strike", "sup", "sub"];

type StyleRef = { name: string; basedOn: string | null; pPr: Element | null; rPr: Element | null };
const RASTER = /\.(png|jpe?g|gif|bmp|webp|svg)$/i;

// Symbol's letters (Adobe's Symbol encoding): Greek typed as Latin letters,
// or named by w:sym. Its other characters are no letters, so no words.
const SYMBOL_UPPER = "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ";
const SYMBOL_LOWER = "αβχδεφγηιϕκλμνοπθρστυϖωξψζ";
function symbolLetters(text: string): string {
  return [...text]
    .map((ch) => {
      let code = ch.charCodeAt(0);
      if (code >= 0xf000 && code <= 0xf0ff) code -= 0xf000;
      if (code >= 0x41 && code <= 0x5a) return SYMBOL_UPPER[code - 0x41];
      if (code >= 0x61 && code <= 0x7a) return SYMBOL_LOWER[code - 0x61];
      return code === 0xb5 ? "µ" : " ";
    })
    .join("");
}
const symbolFont = (font: string | null) => /^symbol$/i.test(font ?? "");

function on(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, "val");
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}

function readReference(zip: OfficeZip): Reference {
  const docPath = officeDocumentPath(zip) ?? "word/document.xml";
  const doc = parseXmlPart(zip, docPath);
  const body = doc ? descendants(doc, "body")[0] : undefined;
  if (!doc || !body) throw new Error("no body");
  const rels = partRels(zip, docPath);
  const part = (type: string) => {
    const rel = relsOfType(rels, type)[0];
    return rel ? parseXmlPart(zip, rel.target) : null;
  };

  // Styles: names, bases, paragraph and run properties.
  const styles = new Map<string, StyleRef>();
  let defaultPara: string | null = null;
  for (const s of descendants(part("styles"), "style")) {
    const id = attr(s, "styleId");
    if (!id) continue;
    if ((attr(s, "type") ?? "paragraph") === "paragraph" && (attr(s, "default") === "1" || attr(s, "default") === "true")) defaultPara ??= id;
    styles.set(id, { name: (attr(child(s, "name"), "val") ?? id).toLowerCase(), basedOn: attr(child(s, "basedOn"), "val"), pPr: child(s, "pPr"), rPr: child(s, "rPr") });
  }
  const chain = (id: string | null): StyleRef[] => {
    const out: StyleRef[] = [];
    for (let at = id, k = 0; at && k < 20; k++) {
      const s = styles.get(at);
      if (!s) break;
      out.unshift(s);
      at = s.basedOn;
    }
    return out;
  };

  // Numbering: each list's levels' formats.
  const numbering = part("numbering");
  const abstracts = new Map<string, Element>();
  for (const a of descendants(numbering, "abstractNum")) abstracts.set(attr(a, "abstractNumId") ?? "", a);
  const levelFmt = (numId: string, ilvl: number): string | null => {
    const num = descendants(numbering, "num").find((n) => attr(n, "numId") === numId);
    if (!num) return null;
    const override = children(num, "lvlOverride").find((o) => intAttr(o, "ilvl") === ilvl);
    const lvl = child(override, "lvl") ?? children(abstracts.get(attr(child(num, "abstractNumId"), "val") ?? "") ?? null, "lvl").find((l) => intAttr(l, "ilvl") === ilvl);
    // A list a numbering style links stands for that style's list.
    const abs = abstracts.get(attr(child(num, "abstractNumId"), "val") ?? "");
    const link = attr(child(abs, "numStyleLink"), "val");
    if (!lvl && link) {
      const linked = attr(child(child(styles.get(link)?.pPr ?? null, "numPr"), "numId"), "val");
      if (linked && linked !== numId) return levelFmt(linked, ilvl);
    }
    return lvl ? (attr(child(lvl, "numFmt"), "val") ?? "decimal") : abs ? "decimal" : null;
  };

  const notesPart = { footnote: part("footnotes"), endnote: part("endnotes") };
  const noteById = (kind: "footnote" | "endnote", id: string) =>
    descendants(notesPart[kind], kind).find((n) => attr(n, "id") === id && (!attr(n, "type") || attr(n, "type") === "normal")) ?? null;

  const ref: Reference = { units: [], tables: [], notes: 0, math: 0, links: [], images: 0, marks: { bold: [], italic: [], underline: [], strike: [], sup: [], sub: [] } };
  const fields: { code: string; result: boolean }[] = [];
  const skipResult = () => fields.some((f) => f.result && /^\s*(PAGEREF|PAGE|NUMPAGES|SECTIONPAGES)\b/i.test(f.code)) || fields.some((f) => !f.result);
  let listRun = 0;
  let lastWasList = false;

  type Ctx = { unit: Unit | null; cell: boolean; box: boolean; diagram: boolean; note: boolean; hidden: boolean; pRPr: StyleRef[]; link: string | null; markable: boolean };
  type Look = Record<MarkKind | "hidden", boolean>;
  const lookOf = (layers: (Element | null)[]): Look => {
    const look: Look = { bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, hidden: false };
    // A single and a double strike are two properties: either strikes.
    let [single, double] = [false, false];
    for (const rPr of layers) {
      if (!rPr) continue;
      look.bold = on(child(rPr, "b")) ?? look.bold;
      look.italic = on(child(rPr, "i")) ?? look.italic;
      look.underline = on(child(rPr, "u")) ?? look.underline;
      single = on(child(rPr, "strike")) ?? single;
      double = on(child(rPr, "dstrike")) ?? double;
      look.strike = single || double;
      look.hidden = on(child(rPr, "vanish")) ?? look.hidden;
      const v = attr(child(rPr, "vertAlign"), "val");
      if (v) {
        look.sup = v === "superscript";
        look.sub = v === "subscript";
      }
    }
    return look;
  };
  // The marked words of the paragraph being read, by kind, run on while
  // the mark holds.
  let open: Record<MarkKind, string> | null = null;
  const closeMarks = () => {
    if (!open) return;
    for (const k of MARK_KINDS) if (compact(open[k]).length >= 2) ref.marks[k].push(open[k]);
    open = null;
  };

  const add = (ctx: Ctx, text: string, look?: Look) => {
    if (!ctx.unit || ctx.hidden || skipResult()) return;
    ctx.unit.text += text;
    if (look && ctx.markable && open) {
      // A link's underline is the link's look (the parse's rule too), not the words'.
      const linked = ctx.link !== null || fields.some((f) => f.result && /^\s*HYPERLINK\b/i.test(f.code));
      for (const k of MARK_KINDS) {
        if (look[k] && !(k === "underline" && linked)) open[k] += text;
        else if (open[k].trim()) {
          if (compact(open[k]).length >= 2) ref.marks[k].push(open[k]);
          open[k] = "";
        }
      }
    }
  };

  let carried: string | null = null;
  const paragraph = (p: Element, ctx: Ctx) => {
    const pPr = child(p, "pPr");
    const styleId = attr(child(pPr, "pStyle"), "val") ?? defaultPara;
    const styleChain = chain(styleId);
    const names = [...styleChain].reverse();
    let level: number | null = null;
    let title = false;
    let caption = false;
    for (const s of names) {
      const h = /^heading ([1-9])$/.exec(s.name);
      if (h && level === null && !title) level = Number(h[1]);
      if ((s.name === "title") && level === null) title = true;
      if (s.name === "caption") caption = true;
    }
    if (level === null && !title && styleId && /^heading([1-9])$/i.test(styleId) && !styles.has(styleId)) level = Number(/(\d)$/.exec(styleId)?.[1]);
    let outline: number | null = null;
    let numId: string | null = null;
    let ilvl = 0;
    for (const layer of [...styleChain.map((s) => s.pPr), pPr]) {
      const o = intAttr(child(layer, "outlineLvl"), "val");
      if (o !== null) outline = o;
      const numPr = child(layer, "numPr");
      const id = attr(child(numPr, "numId"), "val");
      if (id !== null) numId = id === "0" ? null : id;
      const l = intAttr(child(numPr, "ilvl"), "val");
      if (l !== null) ilvl = l;
    }
    if (level === null && !title && outline !== null && outline < 9) level = outline + 1;
    const fmt = numId ? levelFmt(numId, ilvl) : null;
    const listed = fmt !== null && level === null && !title;
    let kind: UnitKind = ctx.note ? "note" : ctx.diagram ? "label" : ctx.box ? "box" : ctx.cell ? "cell" : title ? "title" : level !== null ? "heading" : caption ? "caption" : listed ? "list" : "body";
    // A list inside a cell or a box reads as that container's words.
    if (kind === "list" && (ctx.cell || ctx.box)) kind = ctx.cell ? "cell" : "box";
    const unit: Unit = { kind, text: "" };
    if (level !== null) unit.level = Math.min(6, level);
    if (kind === "list") {
      if (!lastWasList) listRun++;
      unit.ilvl = ilvl;
      unit.bullet = fmt === "bullet";
      unit.run = listRun;
      unit.numId = numId ?? "";
    }
    if (!ctx.cell && !ctx.box && !ctx.note) lastWasList = kind === "list";
    ref.units.push(unit);
    const markable = kind === "body" || kind === "list" || kind === "cell" || kind === "caption";
    const prevOpen = open;
    open = markable ? { bold: "", italic: "", underline: "", strike: "", sup: "", sub: "" } : null;
    const inner: Ctx = { ...ctx, unit, pRPr: styleChain, markable };
    // A paragraph after one whose mark is a tracked deletion (accepted)
    // opens with that one's words: Word joins the two.
    if (carried !== null) {
      unit.text = carried;
      carried = null;
    }
    for (const node of p.children) walk(node, inner);
    closeMarks();
    open = prevOpen;
    if (child(child(pPr, "rPr"), "del") && ref.units.at(-1) === unit) {
      carried = unit.text;
      ref.units.pop();
      return;
    }
    unit.text = unit.text.replace(/\s+/g, " ").trim();
  };

  const table = (tbl: Element, ctx: Ctx) => {
    const rows: Element[] = [];
    const rowsOf = (el: Element) => {
      for (const c of el.children) {
        if (c.localName === "tr") {
          if (!child(child(c, "trPr"), "del")) rows.push(c);
        } else if (c.localName === "sdt") rowsOf(child(c, "sdtContent") ?? c);
        else if (c.localName === "customXml") rowsOf(c);
      }
    };
    rowsOf(tbl);
    const cellsOf = (tr: Element): Element[] => {
      const out: Element[] = [];
      for (const c of tr.children) {
        if (c.localName === "tc") out.push(c);
        else if (c.localName === "sdt") out.push(...cellsOf(child(c, "sdtContent") ?? c));
        else if (c.localName === "customXml") out.push(...cellsOf(c));
      }
      return out;
    };
    const grid = children(child(tbl, "tblGrid"), "gridCol").length;
    let cols = 0;
    for (const tr of rows) {
      let n = intAttr(child(child(tr, "trPr"), "gridBefore"), "val") ?? 0;
      for (const tc of cellsOf(tr)) n += Math.max(1, intAttr(child(child(tc, "tcPr"), "gridSpan"), "val") ?? 1);
      cols = Math.max(cols, n);
    }
    let header = 0;
    while (header < rows.length && on(child(child(rows[header], "trPr"), "tblHeader")) === true) header++;
    const at = ref.units.length;
    const entry: TableRef = { rows: rows.length, cols: Math.max(cols, Math.min(grid, cols || grid)), header, first: "", nested: ctx.cell };
    ref.tables.push(entry);
    for (const tr of rows) for (const tc of cellsOf(tr)) for (const node of tc.children) walk(node, { ...ctx, cell: true });
    entry.first = ref.units.slice(at).filter((u) => u.kind !== "note").map((u) => compact(u.text)).find((t) => t.length >= 2) ?? "";
  };

  const walk = (node: Element, ctx: Ctx): void => {
    switch (node.localName) {
      case "Fallback":
      case "rt":
      case "del":
      case "moveFrom":
      case "pPr":
      case "sectPr":
      case "tblPr":
      case "trPr":
      case "tcPr":
      case "tblGrid":
      case "rPr":
        return;
      case "p":
        paragraph(node, ctx);
        return;
      case "tbl":
        table(node, ctx);
        return;
      case "r": {
        const rPr = child(node, "rPr");
        const look = lookOf([...ctx.pRPr.map((s) => s.rPr), ...chain(attr(child(rPr, "rStyle"), "val")).map((s) => s.rPr), rPr]);
        const inner = { ...ctx, hidden: ctx.hidden || look.hidden };
        const fonts = child(rPr, "rFonts");
        const symbol = symbolFont(attr(fonts, "ascii") ?? attr(fonts, "hAnsi"));
        for (const c of node.children) {
          if (c.localName === "t") add(inner, symbol ? symbolLetters(c.textContent ?? "") : (c.textContent ?? ""), look);
          else if (["tab", "ptab", "br", "cr"].includes(c.localName)) add(inner, " ", look);
          else if (c.localName === "sym") add(inner, symbolFont(attr(c, "font")) ? symbolLetters(String.fromCharCode(parseInt(attr(c, "char") ?? "20", 16))) : " ", look);
          else walk(c, inner);
        }
        return;
      }
      case "t":
        add(ctx, node.textContent ?? "");
        return;
      case "tab":
      case "ptab":
      case "br":
      case "cr":
        add(ctx, " ");
        return;
      case "noBreakHyphen":
        add(ctx, "-");
        return;
      case "instrText": {
        const f = fields.at(-1);
        if (f && !f.result) f.code += node.textContent ?? "";
        return;
      }
      case "fldChar": {
        const type = attr(node, "fldCharType");
        if (type === "begin") fields.push({ code: "", result: false });
        else if (type === "separate") {
          const f = fields.at(-1);
          if (f) {
            f.result = true;
            const url = /^\s*HYPERLINK\s+"?(https?:[^"\s]+|mailto:[^"\s]+)/i.exec(f.code);
            if (url && ctx.unit) (ctx.unit as Unit & { linkStart?: number }).linkStart = ctx.unit.text.length;
          }
        } else if (type === "end") {
          const f = fields.pop();
          const url = f && /^\s*HYPERLINK\s+"?(https?:[^"\s]+|mailto:[^"\s]+)/i.exec(f.code);
          const u = ctx.unit as (Unit & { linkStart?: number }) | null;
          if (url && u && u.linkStart !== undefined) {
            const words = u.text.slice(u.linkStart);
            if (compact(words) && !ctx.hidden) ref.links.push(words);
            delete u.linkStart;
          }
        }
        return;
      }
      case "fldSimple": {
        const code = attr(node, "instr") ?? "";
        fields.push({ code, result: true });
        const before = ctx.unit?.text.length ?? 0;
        for (const c of node.children) walk(c, ctx);
        fields.pop();
        if (/^\s*HYPERLINK\s+"?(https?:|mailto:)/i.test(code) && ctx.unit) {
          const words = ctx.unit.text.slice(before);
          if (compact(words)) ref.links.push(words);
        }
        return;
      }
      case "hyperlink": {
        const rid = attr(node, "id");
        const rel = rid ? rels.get(rid) : undefined;
        const before = ctx.unit?.text.length ?? 0;
        for (const c of node.children) walk(c, { ...ctx, link: rel?.target ?? attr(node, "anchor") ?? "" });
        if (rel?.external && /^(https?:|mailto:)/i.test(rel.target) && ctx.unit && !ctx.note) {
          const words = ctx.unit.text.slice(before);
          if (compact(words)) ref.links.push(words);
        }
        return;
      }
      case "oMath":
        if (!ctx.hidden && !ctx.note) ref.math++;
        return;
      case "footnoteReference":
      case "endnoteReference": {
        const kind = node.localName === "endnoteReference" ? "endnote" : "footnote";
        const note = noteById(kind, attr(node, "id") ?? "");
        if (!note || ctx.hidden || ctx.note) return;
        ref.notes++;
        const saved = open;
        for (const c of note.children) walk(c, { ...ctx, unit: null, note: true, cell: false, box: false, pRPr: [] });
        open = saved;
        return;
      }
      case "txbxContent": {
        const diagram = ctx.diagram || inside(node, ["wgp", "wpc", "grpSp", "group"]);
        for (const c of node.children) walk(c, { ...ctx, unit: null, box: true, diagram, hidden: false, pRPr: [] });
        return;
      }
      case "blip": {
        const rel = rels.get(attr(node, "embed") ?? "");
        if (rel && !rel.external && RASTER.test(rel.target) && !ctx.hidden && !ctx.note) {
          ref.images++;
          if (ctx.unit) ctx.unit.picture = true;
        }
        return;
      }
      case "imagedata": {
        const rel = rels.get(attr(node, "id") ?? attr(node, "relid") ?? "");
        if (rel && !rel.external && RASTER.test(rel.target) && !ctx.hidden && !ctx.note) {
          ref.images++;
          if (ctx.unit) ctx.unit.picture = true;
        }
        return;
      }
      default:
        for (const c of node.children) walk(c, ctx);
    }
  };
  const inside = (el: Element, names: string[]) => {
    for (let at = el.parentElement; at; at = at.parentElement) if (names.includes(at.localName)) return true;
    return false;
  };

  // The body, element by element: a caption beside a table or a picture.
  const top = [...body.children];
  const unitsAt: number[] = [];
  for (const node of top) {
    unitsAt.push(ref.units.length);
    walk(node, { unit: null, cell: false, box: false, diagram: false, note: false, hidden: false, pRPr: [], link: null, markable: false });
  }
  unitsAt.push(ref.units.length);
  top.forEach((node, i) => {
    const own = ref.units.slice(unitsAt[i], unitsAt[i + 1]).filter((u) => u.kind === "caption");
    if (own.length === 0) return;
    const table = (k: number) => k >= 0 && k < top.length && top[k].localName === "tbl";
    const picture = (k: number) => k >= 0 && k < top.length && ref.units.slice(unitsAt[k], unitsAt[k + 1]).some((u) => u.picture && !u.text);
    for (const u of own) {
      u.nearFloat = table(i - 1) || table(i + 1) || picture(i - 1) || picture(i + 1) || Boolean(u.picture);
      u.nearTable = !(picture(i - 1) || picture(i + 1) || u.picture) && (table(i - 1) || table(i + 1));
    }
  });
  ref.units = ref.units.filter((u) => compact(u.text).length > 0);
  return ref;
}

// ── The parse and the import, read the same way ─────────────────────────────

type Reading = {
  /** Every word, the title's first. */
  text: string;
  headings: { level: number; text: string }[];
  title: string;
  lists: { depth: number; numbered: boolean; text: string }[];
  tables: { rows: number; cols: number; header: number; text: string; caption: boolean }[];
  notes: number;
  math: number;
  links: string;
  images: number;
  /** Words that stand as a paragraph of their own, not a figure's or a table's caption. */
  paragraphs: Set<string>;
  marks: Record<MarkKind, string>;
};

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const stripTags = (html: string) => unescape(html.replace(/<[^>]+>/g, " "));

/** A table's html: its rows, columns (colspans summed), header rows. */
function htmlTable(html: string): { rows: number; cols: number; header: number } {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  let cols = 0;
  let header = 0;
  let heads = true;
  for (const row of rows) {
    const cells = [...row.matchAll(/<(t[dh])\b([^>]*)>/g)];
    cols = Math.max(cols, cells.reduce((n, c) => n + Number(/colspan="(\d+)"/.exec(c[2])?.[1] ?? 1), 0));
    if (heads && cells.length > 0 && cells.every((c) => c[1] === "th")) header++;
    else heads = false;
  }
  return { rows: rows.length, cols, header };
}

const MARK_TAGS: Record<MarkKind, string> = { bold: "strong", italic: "em", underline: "u", strike: "s", sup: "sup", sub: "sub" };

function readParse(title: string | null, blocks: ParsedBlock[], titleFont?: TextFont): Reading {
  const r: Reading = { text: "", headings: [], title: title ?? "", lists: [], tables: [], notes: 0, math: 0, links: "", images: 0, paragraphs: new Set(), marks: { bold: "", italic: "", underline: "", strike: "", sup: "", sub: "" } };
  // The title's look (ParsedDocument.titleFont) is its words' marks: the
  // import's Title style takes it.
  if (title && titleFont?.bold) r.marks.bold += ` ${title}`;
  if (title && titleFont?.italic) r.marks.italic += ` ${title}`;
  const texts: string[] = [title ?? ""];
  const links: string[] = [];
  for (const b of blocks) {
    // A note's label the parse raises in the words is no word of the file.
    let words = b.text;
    // An inline formula's characters are no words of the file either: the
    // reference leaves them out (math), as the import reading does.
    const cuts = [...(b.footnoteRefs ?? []).map((f) => ({ ...f, by: "" })), ...(b.math ?? []).map((m) => ({ start: m.start, end: m.end, by: " " }))];
    for (const f of cuts.sort((x, y) => y.start - x.start)) words = `${words.slice(0, f.start)}${f.by}${words.slice(f.end)}`;
    texts.push(b.type === "EQUATION" ? "" : words);
    if (b.footnote) r.notes++;
    if (b.type === "EQUATION") r.math++;
    r.math += b.math?.length ?? 0;
    r.math += (b.html?.match(/data-type="inline-math"/g) ?? []).length;
    r.images += (b.html?.match(/<img\b/g) ?? []).length;
    for (const l of b.links ?? []) if (l.href) links.push(l.quotedText);
    for (const m of (b.type === "TABLE" || b.type === "FIGURE" ? b.html ?? "" : "").matchAll(/<a href="[^"]*">([\s\S]*?)<\/a>/g)) links.push(stripTags(m[1]));
    if (b.type === "HEADING") r.headings.push({ level: Number(/^<h([1-6])/.exec(b.html ?? "")?.[1] ?? 1), text: compact(b.text) });
    if (b.type === "PARAGRAPH" && !b.footnote) r.paragraphs.add(compact(b.text));
    if (b.type === "LIST" && !/class="[^"]*contents/.test(b.html ?? "")) {
      // Its lines without the note labels, as the words above.
      for (const line of words.split("\n")) {
        const m = /^( *)(\S+)\s?(.*)$/.exec(line);
        if (!m) continue;
        // A counter: up to 12 characters, or a legal number of any depth
        // ("3.2.2.5.1.4.1.").
        const counter = /[\p{L}\p{N}]/u.test(m[2]) && (m[2].length <= 12 || /^(?:\d{1,3}\.){2,}\d{0,3}$/.test(m[2]));
        r.lists.push({ depth: m[1].length / 2, numbered: counter, text: compact(line) });
      }
    }
    if (b.type === "TABLE") {
      const t = htmlTable(b.html ?? "");
      r.tables.push({ ...t, text: compact(b.text), caption: /<caption>/.test(b.html ?? "") });
    }
    // A mark's words without the note labels inside it, as the words above.
    const unlabeled = (start: number, end: number) => {
      let out = "";
      let at = start;
      for (const f of [...(b.footnoteRefs ?? [])].sort((x, y) => x.start - y.start)) {
        if (f.end <= at || f.start >= end) continue;
        out += b.text.slice(at, Math.max(at, f.start));
        at = Math.max(at, f.end);
      }
      return out + b.text.slice(at, Math.max(at, end));
    };
    for (const s of b.styles ?? []) {
      const k = (MARK_KINDS as string[]).includes(s.style) ? (s.style as MarkKind) : null;
      if (k) r.marks[k] += ` ${b.footnoteRefs?.length ? unlabeled(s.start, s.end) : s.quotedText}`;
    }
    if (b.font?.bold) r.marks.bold += ` ${b.text}`;
    if (b.font?.italic) r.marks.italic += ` ${b.text}`;
    for (const k of MARK_KINDS) for (const m of (b.html ?? "").matchAll(new RegExp(`<${MARK_TAGS[k]}>([\\s\\S]*?)</${MARK_TAGS[k]}>`, "g"))) r.marks[k] += ` ${stripTags(m[1])}`;
  }
  r.text = texts.join("\n");
  r.links = compact(links.join(" | "));
  for (const k of MARK_KINDS) r.marks[k] = compact(r.marks[k]);
  return r;
}

const RICH_MARKS: Record<string, MarkKind> = { bold: "bold", italic: "italic", underline: "underline", strike: "strike", superscript: "sup", subscript: "sub" };

function readImport(doc: RichNode): Reading {
  const rows = deriveBlocks(doc);
  const r: Reading = { text: "", headings: [], title: "", lists: [], tables: [], notes: 0, math: 0, links: "", images: 0, paragraphs: new Set(), marks: { bold: "", italic: "", underline: "", strike: "", sup: "", sub: "" } };
  // An inline formula reads as its TeX between dollar signs (mathWords): no
  // words of the file, which keep a formula out of the words too.
  const formulas = new Set<string>();
  const findMath = (node: RichNode) => {
    if (node.type === "inlineMath") formulas.add(mathWords(node.attrs?.latex));
    for (const c of node.content ?? []) findMath(c);
  };
  findMath(doc);
  r.text = rows
    .filter((row) => row.type !== "EQUATION")
    .map((row) => [...formulas].reduce((text, f) => (f ? text.split(f).join(" ") : text), row.text))
    .join("\n");
  for (const row of rows) {
    if (row.type === "HEADING") r.headings.push({ level: Number(/^<h([1-6])/.exec(row.html ?? "")?.[1] ?? 1), text: compact(row.text) });
    if (row.type === "PARAGRAPH" && !row.cell) r.paragraphs.add(compact(row.text));
  }
  const links: string[] = [];
  // A named style the import sets bold or italic (namedStyleTitle
  // {"bold":true}: a Word title's own look) draws its paragraphs' words so,
  // with no mark on them (components/docs/toolbar/styles.ts).
  const styled = (style: string): Partial<Record<MarkKind, boolean>> => {
    try {
      const look = JSON.parse(String(doc.attrs?.[`namedStyle${style}`] ?? "{}")) as Record<string, unknown>;
      return { bold: look.bold === true, italic: look.italic === true, underline: look.underline === true };
    } catch {
      return {};
    }
  };
  const looks: Record<string, Partial<Record<MarkKind, boolean>>> = {};
  for (const style of ["Normal", "Title", "Subtitle", "H1", "H2", "H3", "H4", "H5", "H6"]) looks[style] = styled(style);
  const styleOf = (node: RichNode) =>
    node.type === "heading" ? `H${Number(node.attrs?.level) || 1}` : node.attrs?.docStyle === "title" ? "Title" : node.attrs?.docStyle === "subtitle" ? "Subtitle" : "Normal";
  const walk = (node: RichNode, depth: number, ordered: boolean, inCell: boolean, inNote: boolean) => {
    if (node.type === "paragraph" || node.type === "heading") {
      const look = looks[styleOf(node)];
      const words: string[] = [];
      const collect = (n: RichNode) => {
        if (n.type === "text") words.push(n.text ?? "");
        for (const c of n.content ?? []) collect(c);
      };
      if (MARK_KINDS.some((k) => look[k])) collect(node);
      for (const k of MARK_KINDS) if (look[k]) r.marks[k] += ` ${words.join("")}`;
    }
    if (node.type === "footnote") r.notes++;
    if (node.type === "blockMath" || node.type === "inlineMath") r.math++;
    if (node.type === "image" || node.type === "figure") r.images++;
    if (node.type === "figure" && typeof node.attrs?.caption === "string") r.text += `\n${node.attrs.caption}`;
    if (node.type === "text") {
      for (const m of node.marks ?? []) {
        if (m.type === "link" && typeof m.attrs?.href === "string") links.push(node.text ?? "");
        const k = RICH_MARKS[m.type];
        if (k) r.marks[k] += ` ${node.text ?? ""}`;
      }
    }
    if (node.type === "table") {
      const rowsOf = (node.content ?? []).filter((n) => n.type === "tableRow");
      let cols = 0;
      let header = 0;
      let heads = true;
      for (const row of rowsOf) {
        const cells = (row.content ?? []).filter((c) => c.type === "tableCell" || c.type === "tableHeader");
        cols = Math.max(cols, cells.reduce((n, c) => n + (Number(c.attrs?.colspan) || 1), 0));
        if (heads && cells.length > 0 && cells.every((c) => c.type === "tableHeader")) header++;
        else heads = false;
      }
      const words: string[] = [];
      const collect = (n: RichNode) => {
        if (n.type === "text") words.push(n.text ?? "");
        else if (n.type === "hardBreak") words.push(" ");
        for (const c of n.content ?? []) collect(c);
        if (n.type === "paragraph") words.push(" ");
      };
      collect(node);
      r.tables.push({ rows: rowsOf.length, cols, header, text: compact(words.join("")), caption: false });
    }
    const list = node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList";
    if ((node.type === "paragraph" || node.type === "heading") && depth > 0 && !inCell && !inNote) {
      const words: string[] = [];
      const collect = (n: RichNode) => {
        if (n.type === "text") words.push(n.text ?? "");
        for (const c of n.content ?? []) collect(c);
      };
      collect(node);
      r.lists.push({ depth: depth - 1, numbered: ordered, text: compact(words.join("")) });
    }
    for (const c of node.content ?? []) walk(c, list ? depth + 1 : depth, list ? node.type === "orderedList" : ordered, inCell || node.type === "tableCell" || node.type === "tableHeader", inNote || node.type === "footnote");
  };
  walk(doc, 0, false, false, false);
  r.links = compact(links.join(" | "));
  for (const k of MARK_KINDS) r.marks[k] = compact(r.marks[k]);
  return r;
}

// ── Comparing ───────────────────────────────────────────────────────────────

const TYPED = /^\s*(?:[([]?(?:\d{1,3}(?:\.\d{1,3})*|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,6})[.)\]]?\.?|[•▪◦●○■\-–*☐☑☒➢✓])\s+/;

type Counts = Record<string, number>;
type Findings = { counts: Counts; notes: string[] };

function compare(ref: Reference, got: Reading, side: "parse" | "import"): Findings {
  const counts: Counts = {};
  const notes: string[] = [];
  const bump = (key: string, why: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
    if (notes.length < 400) notes.push(`${key}: ${why.slice(0, 160)}`);
  };
  const all = compact(got.text);
  // A typed marker an import's list draws is no word lost (lost:<kind> too).
  const want = ref.units.map((u) => u.text.replace(TYPED, "")).join("\n");
  const lost = missingWords(want, got.text);
  if (lost.n > 0) {
    counts.words = lost.n;
    notes.push(`words: ${lost.words.join(" ").slice(0, 300)}`);
  }
  for (const u of ref.units) {
    const c = compact(u.text);
    // A marker typed before the words ("1.1", "(a)", "•") an import's list
    // draws as its own counter: the words after it are the line's.
    const words = compact(u.text.replace(TYPED, ""));
    if (c.length >= 3 && !all.includes(c) && !(words.length >= 3 && all.includes(words))) bump(`lost:${u.kind}`, u.text);
  }
  // Headings, the title.
  for (const u of ref.units) {
    const c = compact(u.text);
    if (!c || !all.includes(c)) continue;
    if (u.kind === "heading") {
      const hit = got.headings.filter((h) => h.text.includes(c) || (h.text.length >= 3 && c.includes(h.text) && h.text.length * 2 > c.length));
      if (hit.length === 0 && compact(got.title) !== c) bump("heading.missing", `h${u.level} ${u.text}`);
      else if (hit.length > 0 && !hit.some((h) => h.level === u.level) && compact(got.title) !== c) bump("heading.level", `h${u.level} → h${hit[0].level} ${u.text}`);
    }
    if (u.kind === "title" && compact(got.title) !== c && !got.headings.some((h) => h.text.includes(c))) bump("title.missing", u.text);
  }
  // Lists.
  const listUnits = ref.units.filter((u) => u.kind === "list");
  // In document order: two lists may hold the same words ("one", "two").
  let line = 0;
  const placed = listUnits.map((u) => {
    const c = compact(u.text);
    const words = compact(u.text.replace(TYPED, ""));
    const fits = (l: Reading["lists"][number]) => l.text.endsWith(c) || (c.length >= 3 && l.text.includes(c)) || (words.length >= 3 && l.text.endsWith(words));
    const at = got.lists.findIndex((l, k) => k >= line && fits(l));
    if (at >= 0) line = at + 1;
    return at >= 0 ? got.lists[at] : (got.lists.find(fits) ?? null);
  });
  listUnits.forEach((u, i) => {
    const c = compact(u.text);
    if (c.length < 2 || !all.includes(c)) return;
    const line = placed[i];
    if (!line) {
      bump("list.missing", u.text);
      return;
    }
    if (u.bullet !== undefined && line.numbered === u.bullet) bump("list.kind", `${u.bullet ? "bullet" : "number"} ${u.text}`);
    // Against the item before it in the same list: two lists side by side
    // (List Bullet, List Bullet 2) nest by their indents alone.
    const prev = i > 0 && listUnits[i - 1].run === u.run && listUnits[i - 1].numId === u.numId ? i - 1 : -1;
    if (prev >= 0 && placed[prev]) {
      const want = Math.sign((u.ilvl ?? 0) - (listUnits[prev].ilvl ?? 0));
      const have = Math.sign(line.depth - (placed[prev]?.depth ?? 0));
      if (want !== have) bump("list.depth", `ilvl ${listUnits[prev].ilvl}→${u.ilvl}, depth ${placed[prev]?.depth}→${line.depth} ${u.text}`);
    }
  });
  // Tables: each table of two columns or more, top level, by its first cell's words.
  // In document order: many tables open with the same words ("Parameter").
  let cursor = 0;
  for (const t of ref.tables) {
    if (t.nested || t.cols < 2 || t.rows < 1 || !t.first) continue;
    const at = got.tables.findIndex((g, k) => k >= cursor && g.text.includes(t.first));
    if (at >= 0) cursor = at + 1;
    const hit = at >= 0 ? got.tables[at] : got.tables.find((g) => g.text.includes(t.first));
    if (!hit) {
      if (all.includes(t.first)) bump("table.missing", `${t.rows}x${t.cols} ${t.first}`);
      continue;
    }
    if (hit.rows !== t.rows) bump("table.rows", `${t.rows} → ${hit.rows} ${t.first}`);
    if (hit.cols !== t.cols) bump("table.cols", `${t.cols} → ${hit.cols} ${t.first}`);
    if (hit.header < t.header) bump("table.header", `${t.header} → ${hit.header} ${t.first}`);
  }
  if (got.notes < ref.notes) counts["note.missing"] = ref.notes - got.notes;
  if (got.math < ref.math) counts["math.missing"] = ref.math - got.math;
  if (got.images < ref.images) counts["image.missing"] = ref.images - got.images;
  for (const l of ref.links) {
    const c = compact(l);
    if (c && all.includes(c) && !got.links.includes(c)) bump("link.missing", l);
  }
  for (const u of ref.units) {
    if (u.kind === "caption" && u.nearFloat && !(side === "import" && u.nearTable) && got.paragraphs.has(compact(u.text))) bump("caption.unjoined", u.text);
  }
  for (const k of MARK_KINDS) {
    for (const words of ref.marks[k]) {
      const c = compact(words.replace(TYPED, ""));
      if (c && all.includes(c) && !got.marks[k].includes(c)) bump(`mark.${k}`, words);
    }
  }
  return { counts, notes };
}

// ── The run ─────────────────────────────────────────────────────────────────

type FileResult = { name: string; counts: Counts; expected: Counts; ms: number; notes: string[] };
let files = readdirSync(SET).filter((f) => /\.docx$/i.test(f)).sort();
if (detail) files = files.filter((f) => f === detail || f.replace(/\.docx$/i, "") === detail);
else if (only) files = files.filter((f) => only.includes(f) || only.includes(f.replace(/\.docx$/i, "")));

const results: FileResult[] = [];
const quiet = console.warn;
console.warn = () => undefined;
// A file whose body part is past LARGE_BYTES (a 600-page specification)
// takes minutes and gigabytes: it runs when named (--only, --detail) or
// with --large, else it is listed and skipped.
const LARGE_BYTES = 8_000_000;
const skipped: string[] = [];
for (const name of files) {
  const bytes = new Uint8Array(readFileSync(join(SET, name)));
  if (!only && !detail && !flag("--large")) {
    let size = 0;
    try {
      unzipSync(bytes, {
        filter: (f) => {
          if (/^word\/document\d*\.xml$/.test(f.name)) size = f.originalSize;
          return false;
        },
      });
    } catch {
      // A broken zip: the reference skips it below.
    }
    if (size > LARGE_BYTES) {
      skipped.push(name);
      continue;
    }
  }
  const counts: Counts = {};
  const expected: Counts = {};
  const notes: string[] = [];
  const t0 = performance.now();
  let ref: Reference;
  try {
    ref = readReference(unzipOffice(bytes));
  } catch {
    continue; // Not a Word file the reference reads (a broken zip, no body): no score.
  }
  expected.paragraphs = ref.units.length;
  expected.words = tokenize(ref.units.map((u) => u.text).join(" ")).length;
  expected.headings = ref.units.filter((u) => u.kind === "heading").length;
  expected.lists = ref.units.filter((u) => u.kind === "list").length;
  expected.tables = ref.tables.filter((t) => !t.nested && t.cols >= 2).length;
  expected.notes = ref.notes;
  expected.math = ref.math;
  expected.links = ref.links.length;
  expected.images = ref.images;
  try {
    const parsed = await parseDocx(bytes, name, { storeImage: async () => "/api/images/bench" });
    const title = parsed.titleFromFile ? null : (parsed.title ?? null);
    const p = compare(ref, readParse(title, parsed.blocks, parsed.titleFont), "parse");
    Object.assign(counts, p.counts);
    notes.push(...p.notes);
    try {
      const out = richTextFromImport({
        kind: "docx",
        title: parsed.title ?? name.replace(/\.docx$/i, ""),
        titleFromOriginal: !parsed.titleFromFile,
        blocks: resolveContentsLinks(parsed.blocks),
        bodyFont: parsed.bodyFont,
        titleFont: parsed.titleFont,
        titleAlign: parsed.titleAlign,
        titleStyles: parsed.titleStyles,
        titleLines: parsed.titleLines,
      });
      const reading = readImport(out.richText);
      if (!parsed.titleFromFile) reading.title = parsed.title ?? "";
      const i = compare(ref, reading, "import");
      for (const [k, v] of Object.entries(i.counts)) counts[`import.${k}`] = v;
      notes.push(...i.notes.map((n) => `import.${n}`));
    } catch (err) {
      counts["error.import"] = 1;
      notes.push(`error.import: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    counts["error.parse"] = 1;
    notes.push(`error.parse: ${err instanceof Error ? err.message : String(err)}`);
  }
  results.push({ name, counts, expected, ms: Math.round(performance.now() - t0), notes });
  if (flag("--verbose")) process.stdout.write(`${name} ${results.at(-1)?.ms} ms\n`);
}
console.warn = quiet;

// ── The report ──────────────────────────────────────────────────────────────

const sum = (key: string, list = results) => list.reduce((n, r) => n + (r.counts[key] ?? 0), 0);
const classes = [...new Set(results.flatMap((r) => Object.keys(r.counts)))].sort((a, b) => (a.startsWith("import.") ? 1 : 0) - (b.startsWith("import.") ? 1 : 0) || a.localeCompare(b));
const total: Counts = {};
for (const k of classes) total[k] = sum(k);

if (detail) {
  for (const r of results) {
    console.log(`── ${r.name}  (${r.ms} ms)`);
    console.log(`expected ${JSON.stringify(r.expected)}`);
    for (const n of r.notes) console.log(`  ${n}`);
  }
} else {
  const expectedTotal: Counts = {};
  for (const r of results) for (const [k, v] of Object.entries(r.expected)) expectedTotal[k] = (expectedTotal[k] ?? 0) + v;
  console.log(`Word set: ${results.length} files. Expected: ${Object.entries(expectedTotal).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (skipped.length > 0) console.log(`Skipped as large (run with --large or --only): ${skipped.join(", ")}`);
  console.log("\nClass                     parse (files)    import (files)");
  const base = [...new Set(classes.map((k) => k.replace(/^import\./, "")))].sort();
  for (const k of base) {
    const files = (key: string) => results.filter((r) => r.counts[key]).length;
    console.log(`  ${k.padEnd(22)} ${String(sum(k)).padStart(6)} (${String(files(k)).padStart(3)})    ${String(sum(`import.${k}`)).padStart(6)} (${String(files(`import.${k}`)).padStart(3)})`);
  }
  // The table counts this run's files alone. The baseline's total counts
  // every file, a skipped file with its last counts: say both, so a run
  // that skips the large files is not read as a count that fell.
  if (skipped.length > 0 && existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as { files: Record<string, Counts> };
    const rest: Counts = {};
    for (const name of skipped) for (const [k, v] of Object.entries(base.files[name] ?? {})) rest[k] = (rest[k] ?? 0) + v;
    const whole = (key: string) => sum(key) + (rest[key] ?? 0);
    const keys = [...new Set([...classes, ...Object.keys(rest)])].sort();
    console.log(`\nThe table counts the ${results.length} files run. The skipped files' last counts (word-baseline.json): ${Object.entries(rest).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`);
    console.log(`The whole set: ${keys.map((k) => `${k} ${whole(k)}`).join(", ")}.`);
  }
  const worst = [...results].sort((a, b) => Object.keys(b.counts).length - Object.keys(a.counts).length).slice(0, Number(value("--worst") ?? 10));
  console.log("\nFiles with the most classes of loss:");
  for (const r of worst) console.log(`  ${r.name.padEnd(48)} ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

const json = value("--json");
if (json) writeFileSync(json, JSON.stringify({ total, results }, null, 2));

type Baseline = { total: Counts; files: Record<string, Counts> };
if (flag("--save-baseline") && !detail) {
  const prior: Baseline = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline) : { total, files: {} };
  for (const r of results) prior.files[r.name] = r.counts;
  // The total is every file's, a large file's last run with it.
  prior.total = {};
  for (const counts of Object.values(prior.files)) for (const [k, v] of Object.entries(counts)) prior.total[k] = (prior.total[k] ?? 0) + v;
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${results.length} files to ${BASELINE}`);
}
if (flag("--baseline") && existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  const rose: string[] = [];
  const fell: string[] = [];
  for (const r of results) {
    const was = base.files[r.name];
    if (!was) continue;
    for (const k of new Set([...Object.keys(was), ...Object.keys(r.counts)])) {
      const [a, b] = [was[k] ?? 0, r.counts[k] ?? 0];
      if (b > a) rose.push(`${r.name} ${k} ${a} → ${b}`);
      if (b < a) fell.push(`${r.name} ${k} ${a} → ${b}`);
    }
  }
  console.log(`\nAgainst the baseline: ${fell.length} counts fell, ${rose.length} rose`);
  for (const line of rose) console.log(`  rose ${line}`);
  if (rose.length > 0) process.exitCode = 1;
}
