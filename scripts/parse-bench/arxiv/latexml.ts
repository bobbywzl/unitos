/**
 * LaTeXML HTML (arXiv's HTML papers) → reference blocks, in LaTeXML's order (the source's order).
 * Each block carries a role that says how build.mts places it against the PDF: the front matter is
 * checked against page 1, the flow is cut at the last scored page, and floats and footnotes are
 * located by their own words (the PDF may print them pages away from where the source has them).
 * The author area is not converted: the PDF's own words replace it (see pages.ts).
 */
import { JSDOM } from "jsdom";
import type { RefBlock, Span } from "../model";

export type Role = "front" | "flow" | "float" | "note";
export type Built = {
  block: RefBlock;
  role: Role;
  /** Blocks of one float (an algorithm's caption and lines) share a group, so they stay together. */
  group?: number;
  /** What the block is in the source, where build.mts treats it apart: "abstract" (its name and text), "contents", "classification". */
  tag?: "abstract" | "contents" | "classification";
  /** LaTeXML's number of a heading ("2.1") or tag of a caption ("Figure 1:"); the PDF's printed form replaces it. */
  label?: string;
};

type Style = Omit<Span, "text" | "latex" | "mathml">;
type Item = { depth: number; marker: string; spans: Span[] };

const SKIP_TAGS = new Set(["img", "svg", "object", "canvas", "video", "audio", "iframe", "script", "style", "button", "input"]);
const INVISIBLE_MATH_CHARS = /[\u200b\u2061-\u2064]/g; // zero-width space, function application, invisible times and separators

export type ConvertOptions = {
  /** The class prints \cite in parentheses, "(Genovesi, 2020)" (ACL's natbib); LaTeXML writes "Genovesi (2020)". */
  parenCite?: boolean;
  /** The class prints citations and bibliography labels as numbers, "[91]" (ACM's numeric style); LaTeXML writes author and year. */
  numericCite?: boolean;
  /** The class prints no comma between author and year, "(Acciari et al. 2011)" (MNRAS); LaTeXML writes one. */
  citeNoComma?: boolean;
  /** The class sorts numeric citations and prints three or more in a row as a range, "[5–8]" (revtex); LaTeXML lists each. */
  citeCompress?: boolean;
};

/** Converts one arXiv LaTeXML page to blocks. */
export function convertLatexml(html: string, options: ConvertOptions = {}): Built[] {
  const doc = new JSDOM(html).window.document;
  const article = doc.querySelector("article.ltx_document");
  if (!article) throw new Error("no LaTeXML article");
  return new Converter(options).article(article);
}

class Converter {
  private out: Built[] = [];
  private notes: RefBlock[] = [];
  private groups = 0;

  /** The printed number of each bibliography entry, by the entry's id (numeric citation styles). */
  private bibNumbers = new Map<string, number>();
  /** Each bibliography entry's label by its text: revtex prints footnotes as entries of the bibliography. */
  private bibTexts = new Map<string, string>();

  constructor(private options: ConvertOptions) {}

  article(article: Element): Built[] {
    article.querySelectorAll("li.ltx_bibitem").forEach((li, i) => {
      this.bibNumbers.set(li.id, i + 1);
      const tag = (li.querySelector(":scope > .ltx_tag_bibitem")?.textContent ?? "").trim();
      const text = [...li.querySelectorAll(":scope > .ltx_bibblock")].map((b) => b.textContent ?? "").join(" ");
      this.bibTexts.set(squash(text), tag);
    });
    const title = article.querySelector(":scope > h1.ltx_title_document");
    const children = [...article.children];
    // what LaTeXML puts before the title is front matter out of place (LIPIcs' addresses): the PDF's page 1 has it
    for (const child of title ? children.slice(children.indexOf(title)) : children) {
      if (child.matches("h1.ltx_title_document")) {
        this.push({ kind: "title", spans: this.inline(child, {}, { dropNoteMarks: true }) }, "front");
      } else if (child.matches(".ltx_subtitle")) {
        this.push({ kind: "paragraph", spans: this.inline(child, {}) }, "front");
      } else if (child.matches(".ltx_authors, .ltx_dates, .ltx_pagination")) {
        continue; // the author area comes from the PDF; dates print there too
      } else {
        this.blocks(child, "flow");
      }
    }
    return this.out;
  }

  private push(block: RefBlock, role: Role, extra: Partial<Built> = {}) {
    const empty = "spans" in block && block.spans.every((s) => !s.text.trim() && !s.latex);
    if (!empty) this.out.push({ block, role, ...extra });
    for (const note of this.notes.splice(0)) this.out.push({ block: note, role: "note" });
  }

  /** The block-level children of a section, a paragraph container, a theorem, or a list item. */
  private blocks(el: Element, role: Role) {
    if (el.matches(".ltx_pagination, .ltx_nodisplay, .ltx_rdf, nav:not(.ltx_TOC)")) return;
    if (el.matches("section.ltx_bibliography")) return this.bibliography(el);
    if (el.matches("section")) return this.section(el, role);
    if (el.matches(".ltx_abstract")) return this.abstract(el);
    if (el.matches("nav.ltx_TOC")) return this.contents(el);
    if (el.matches(".ltx_classification, .ltx_keywords")) return this.classification(el);
    if (el.matches(".ltx_pubnotes")) return this.pubnotes(el);
    if (el.matches(".ltx_theorem, .ltx_proof, .ltx_acknowledgements")) return this.runIn(el, role);
    if (el.matches("p.ltx_p")) return this.push({ kind: "paragraph", spans: this.inline(el, {}) }, role);
    if (el.matches("table.ltx_equation, table.ltx_equationgroup")) return this.equations(el, role);
    if (el.matches("ul, ol")) return this.list(el, role);
    if (el.matches("dl.ltx_description")) return this.description(el, role);
    if (el.matches("blockquote")) {
      for (const p of el.querySelectorAll(":scope > p, :scope > .ltx_para > p")) this.push({ kind: "quote", spans: this.inline(p, {}) }, role);
      return;
    }
    if (el.matches("figure.ltx_table")) return this.tableFloat(el);
    if (el.matches("figure.ltx_float")) return this.algorithm(el);
    if (el.matches("figure")) return this.figure(el);
    if (el.matches(".ltx_listing")) return this.listing(el, role, undefined);
    if (el.matches("table.ltx_tabular")) return this.push(this.table(el, undefined), "float");
    if (el.matches("h1, h2, h3, h4, h5, h6")) return; // titles are read by their section
    for (const child of [...el.children]) this.blocks(child, role);
  }

  /** A section, subsection, … : its heading, then its content. \paragraph titles run in before the first paragraph. */
  private section(el: Element, role: Role) {
    const title = el.querySelector(":scope > .ltx_title");
    const runIn = el.matches(".ltx_paragraph, .ltx_subparagraph");
    // levels as the corpus counts them: the title apart, a section 2, a subsection 3, a subsubsection 4
    const level = el.matches(".ltx_subsubsection") ? 4 : el.matches(".ltx_subsection") ? 3 : 2;
    const start = this.out.length;
    const label = title?.querySelector(":scope > .ltx_tag")?.textContent?.trim();
    if (title && !runIn) this.push({ kind: "heading", level, spans: this.inline(title, {}) }, role, label ? { label } : {});
    for (const child of [...el.children]) if (child !== title) this.blocks(child, role);
    if (title && runIn) this.prependLabel(start, this.inline(title, { bold: true }), role);
  }

  /** Theorem-like environments, proofs, acknowledgements: the label runs in, then the body. */
  private runIn(el: Element, role: Role) {
    const title = el.querySelector(":scope > .ltx_title");
    const start = this.out.length;
    for (const child of [...el.children]) if (child !== title) this.blocks(child, role);
    if (el.matches(".ltx_proof")) this.dropQed(start);
    if (title) this.prependLabel(start, this.inline(title, {}), role);
  }

  /** Puts a run-in label before the first block written since `start`; a label before anything else stands alone. */
  private prependLabel(start: number, label: Span[], role: Role) {
    if (!label.length) return;
    const first = this.out.slice(start).find((b) => b.role !== "note");
    if (first && first.block.kind === "paragraph") {
      first.block.spans = normalizeSpans([...label, { text: " " }, ...first.block.spans]);
    } else {
      const index = first ? this.out.indexOf(first) : this.out.length;
      this.out.splice(index, 0, { block: { kind: "paragraph", spans: label }, role });
    }
  }

  /** The QED box LaTeXML writes as "∎": amsthm draws it with rules, so the PDF's text has no glyph. */
  private dropQed(start: number) {
    for (let i = this.out.length - 1; i >= start; i--) {
      const block = this.out[i].block;
      if (block.kind !== "paragraph" && block.kind !== "list") continue;
      const spans = block.kind === "paragraph" ? block.spans : block.items.at(-1)?.spans;
      const last = spans?.at(-1);
      if (last && !last.latex && /∎\s*$/.test(last.text)) last.text = last.text.replace(/\s*∎\s*$/, "");
      return;
    }
  }

  private abstract(el: Element) {
    const title = el.querySelector(":scope > .ltx_title");
    const name = (title?.textContent ?? "Abstract").trim().replace(/[.:]$/, "");
    const start = this.out.length;
    this.push({ kind: "heading", level: 2, spans: [{ text: name }] }, "flow");
    for (const child of [...el.children]) if (child !== title) this.blocks(child, "flow");
    for (const b of this.out.slice(start)) if (b.role === "flow") b.tag = "abstract";
  }

  /** A printed table of contents: its name, then its entries (depth by nesting; the printed page numbers are left out). */
  private contents(nav: Element) {
    const name = nav.querySelector(":scope > .ltx_title")?.textContent?.trim() || "Contents";
    const items: Item[] = [];
    const walk = (ol: Element, depth: number) => {
      for (const li of ol.querySelectorAll(":scope > li")) {
        if (li.matches(".ltx_tocentry_abstract, .ltx_tocentry_bibliography")) continue; // LaTeXML's own entries
        const ref = li.querySelector(":scope > a .ltx_ref_title, :scope > a");
        if (ref) {
          const tag = ref.querySelector(".ltx_tag");
          const marker = (tag?.textContent ?? "").trim();
          const clone = ref.cloneNode(true) as Element;
          clone.querySelector(".ltx_tag")?.remove();
          // the classes set a section's entry in bold
          items.push({ depth, marker, spans: this.inline(clone, depth === 0 ? { bold: true } : {}) });
        }
        for (const sub of li.querySelectorAll(":scope > ol")) walk(sub, depth + 1);
      }
    };
    for (const ol of nav.querySelectorAll(":scope > ol")) walk(ol, 0);
    this.push({ kind: "heading", level: 2, spans: [{ text: name }] }, "flow", { tag: "contents" });
    this.push({ kind: "list", items }, "flow", { tag: "contents" });
  }

  /** Subject classification and keywords: the label runs in. build.mts puts the PDF's own lines in their place when it has them. */
  private classification(el: Element) {
    const title = el.querySelector(":scope > .ltx_title");
    const label = (title?.textContent ?? "").replace(/\s+/g, " ").trim();
    const body = el.cloneNode(true) as Element;
    body.querySelector(":scope > .ltx_title")?.remove();
    const spans = [{ text: label, italic: true } as Span, { text: " " }, ...this.inline(body, {})];
    this.push({ kind: "paragraph", spans: normalizeSpans(spans) }, "flow", { tag: "classification" });
  }

  /** ACM's CCS concepts, as acmart prints them: "CCS Concepts: • Computing methodologies → Robotic planning; Computer vision." */
  private pubnotes(el: Element) {
    const concepts = new Map<string, string[]>();
    for (const note of el.querySelectorAll(".ltx_role_ccs")) {
      const clone = note.cloneNode(true) as Element;
      clone.querySelector(".ltx_note_name")?.remove();
      const [top, ...rest] = (clone.textContent ?? "").split("\u00a0").map((s) => s.trim());
      if (!concepts.has(top)) concepts.set(top, []);
      if (rest.length) concepts.get(top)!.push(rest.join(" "));
    }
    if (!concepts.size) return;
    const text = [...concepts].map(([top, subs]) => `• ${top} → ${subs.join("; ")}`).join("; ");
    this.push({ kind: "paragraph", spans: [{ text: "CCS Concepts:", bold: true }, { text: ` ${text}.` }] }, "flow", { tag: "classification" });
  }

  // ── Equations ──────────────────────────────────────────────────────────────

  /**
   * One LaTeXML equation or equation group → equation blocks. Rows join the tagged row after them (an equation's
   * continuation lines); each tagged unit is one block with its label; rows of a unit become an aligned environment.
   */
  private equations(table: Element, role: Role) {
    const kind = table.matches(".ltx_eqn_eqnarray") ? "eqnarray" : table.matches(".ltx_eqn_gather, .ltx_eqn_multline") ? "gather" : "align";
    type Row = { cells: Element[]; label?: string };
    const units: Row[][] = [[]];
    for (const tr of table.querySelectorAll(":scope > tbody > tr, :scope > tr")) {
      const eqno = tr.querySelector(":scope > td.ltx_eqn_eqno");
      const label = eqno?.textContent?.replace(/\s+/g, " ").trim() || undefined;
      const cells = [...tr.querySelectorAll(":scope > td")].filter(
        (td) => td !== eqno && !td.matches(".ltx_eqn_center_padleft, .ltx_eqn_center_padright, .ltx_eqn_left_padleft, .ltx_eqn_right_padright"),
      );
      const text = cells.map((td) => (td.querySelector("math") ? "" : (td.textContent ?? "").trim())).join(" ").trim();
      // \intertext between rows ("By splitting (−1)^k across z^{k−i}, we obtain:"): a row that is no equation, one
      // cell across the table; a paragraph of its own, its formulas inline
      const intertext = !tr.matches(".ltx_equation") && cells.length === 1 && Number(cells[0].getAttribute("colspan") ?? 1) > 1;
      if (intertext || (!cells.some((td) => td.querySelector("math")) && text)) {
        this.flushEquations(units, kind, role);
        this.push({ kind: "paragraph", spans: normalizeSpans(cells.flatMap((td) => this.inline(td, {}))) }, role);
        continue;
      }
      units.at(-1)!.push({ cells, label });
      if (label) units.push([]);
    }
    this.flushEquations(units, kind, role);
  }

  private flushEquations(units: { cells: Element[]; label?: string }[][], kind: string, role: Role) {
    const flushed = units.splice(0, units.length, []); // rows after an intertext start a new unit
    for (const rows of flushed.filter((r) => r.length)) {
      const label = rows.find((r) => r.label)?.label;
      const texRows = rows.map((r) => r.cells.map((td) => cellTex(td, kind === "eqnarray")));
      const mathRows = rows.map((r) => r.cells.map((td) => td.querySelector("math")));
      let latex: string;
      let mathml: string | undefined;
      if (rows.length === 1 && rows[0].cells.filter((td) => td.querySelector("math")).length <= 1) {
        latex = cleanTex(texRows[0].join(" "));
        const math = mathRows[0].find((m) => m);
        mathml = math ? cleanMathml(math) : undefined;
      } else {
        const env = kind === "eqnarray" ? "array" : kind === "gather" ? "gathered" : "aligned";
        const cols = Math.max(...texRows.map((r) => r.length));
        const open = env === "array" ? `\\begin{array}{${"rcl".padEnd(cols, "l").slice(0, cols)}}` : `\\begin{${env}}`;
        const body = texRows.map((r) => (env === "gathered" ? r.join(" ") : r.join(" & "))).join(" \\\\ ");
        latex = `${open} ${body} \\end{${env}}`;
        mathml = tableMathml(mathRows);
      }
      if (!latex.trim()) continue;
      this.push({ kind: "equation", latex, ...(mathml ? { mathml } : {}), ...(label ? { label } : {}) }, role);
    }
  }

  // ── Lists ──────────────────────────────────────────────────────────────────

  /** A list with its nested lists, flattened by depth. A display equation inside an item splits the list around it. */
  private list(el: Element, role: Role) {
    let items: Item[] = [];
    const flush = () => {
      if (items.length) this.push({ kind: "list", items }, role);
      items = [];
    };
    const walk = (list: Element, depth: number) => {
      for (const li of list.querySelectorAll(":scope > li")) {
        const marker = (li.querySelector(":scope > .ltx_tag_item")?.textContent ?? "").trim();
        let first = true;
        const content = (node: Element) => {
          for (const child of [...node.children]) {
            if (child.matches(".ltx_tag_item")) continue;
            if (child.matches("p.ltx_p")) {
              const spans = this.inline(child, {});
              items.push({ depth, marker: first ? marker : "", spans });
              first = false;
              const notes = this.notes.splice(0);
              if (notes.length) {
                flush();
                for (const note of notes) this.out.push({ block: note, role: "note" });
              }
            } else if (child.matches("ul, ol")) {
              if (first) items.push({ depth, marker, spans: [] });
              first = false;
              walk(child, depth + 1);
            } else if (child.matches("table.ltx_equation, table.ltx_equationgroup")) {
              if (first) items.push({ depth, marker, spans: [] });
              first = false;
              flush();
              this.equations(child, role);
            } else if (child.matches("div.ltx_para, div.ltx_logical-block, div.ltx_inline-block")) {
              content(child);
            } else {
              flush();
              this.blocks(child, role);
            }
          }
        };
        content(li);
        if (first) items.push({ depth, marker, spans: [] });
      }
    };
    walk(el, 0);
    flush();
  }

  /** A description list: each term runs in bold before its text, as the page prints it. */
  private description(el: Element, role: Role) {
    for (const dt of el.querySelectorAll(":scope > dt")) {
      const term = this.inline(dt, { bold: true });
      const dd = dt.nextElementSibling?.matches("dd") ? dt.nextElementSibling : null;
      const start = this.out.length;
      if (dd) for (const child of [...dd.children]) this.blocks(child, role);
      this.prependLabel(start, term, role);
    }
  }

  // ── Floats ─────────────────────────────────────────────────────────────────

  private caption(el: Element): Span[] | undefined {
    const captions = [...el.querySelectorAll(":scope > figcaption, :scope > .ltx_flex_figure figcaption, :scope figure.ltx_figure_panel > figcaption")];
    const main = el.querySelector(":scope > figcaption");
    const panels = captions.filter((c) => c !== main && !letterOnly(c));
    const ordered = [...panels, ...(main ? [main] : [])];
    const spans = ordered.flatMap((c, i) => [...(i ? [{ text: " " }] : []), ...this.inline(c, {})]);
    return spans.length ? normalizeSpans(spans) : undefined;
  }

  /**
   * A float's parts in order: its tabulars (each with the caption of the panel it sits in) and its main captions.
   * LaTeXML may put two floats in one (two \caption in one table environment): each main caption opens or closes
   * a group, as the float's first caption stands before or after its first tabular.
   */
  private floatGroups(el: Element): { above: boolean; groups: { main: Element | null; tabulars: { tabular: Element; panel: Element | null }[] }[] } {
    type Unit = { tabular: Element; panel: Element | null } | { main: Element };
    const units: Unit[] = [];
    const visit = (node: Element, panel: Element | null) => {
      for (const child of [...node.children]) {
        if (child.matches("table.ltx_tabular")) units.push({ tabular: child, panel });
        else if (child.matches("figcaption")) {
          if (!panel || child.parentElement !== panel) units.push({ main: child });
        } else visit(child, child.matches("figure.ltx_figure_panel") ? child : panel);
      }
    };
    visit(el, null);
    const firstMain = units.findIndex((u) => "main" in u);
    const firstTable = units.findIndex((u) => "tabular" in u);
    const above = firstMain >= 0 && (firstTable < 0 || firstMain < firstTable); // captions stand above their tables
    const groups: { main: Element | null; tabulars: { tabular: Element; panel: Element | null }[] }[] = [{ main: null, tabulars: [] }];
    for (const unit of units) {
      if ("main" in unit) {
        if (above) groups.push({ main: unit.main, tabulars: [] });
        else {
          groups.at(-1)!.main = unit.main;
          groups.push({ main: null, tabulars: [] });
        }
      } else groups.at(-1)!.tabulars.push(unit);
    }
    return { above, groups: groups.filter((g) => g.main || g.tabulars.length) };
  }

  /** An image, chart, or diagram with its caption (panel captions first, then the figure's own). Inner labels are not text. */
  private figure(el: Element) {
    const tabulars = topTabulars(el);
    if (tabulars.length && !el.querySelector("img, svg, object")) return this.tableFloat(el);
    const caption = this.caption(el);
    this.push({ kind: "figure", ...(caption ? { caption } : {}) }, "float", captionLabel(el));
  }

  /**
   * A table float: each tabular is a table with the caption of its panel; a main caption goes with the first table
   * of its group (captions above the tables) or the last (below), before the panel's caption. A table drawn as an
   * image is a figure.
   */
  private tableFloat(el: Element) {
    if (!topTabulars(el).length) {
      const caption = this.caption(el);
      return this.push({ kind: "figure", ...(caption ? { caption } : {}) }, "float", captionLabel(el));
    }
    const { above, groups } = this.floatGroups(el);
    for (const { main, tabulars } of groups) {
      const group = ++this.groups;
      const mainSpans = main ? this.inline(main, {}) : [];
      const label = main?.querySelector(":scope > .ltx_tag")?.textContent?.replace(/\s+/g, " ").trim();
      const withMain = above ? 0 : tabulars.length - 1;
      tabulars.forEach(({ tabular, panel }, i) => {
        // a panel may hold several tables, each with the caption under it
        const captions = panel ? [...panel.querySelectorAll(":scope > figcaption")] : [];
        const panelCaption = captions.find((c) => (tabular.compareDocumentPosition(c) & 4) !== 0) ?? captions.at(-1);
        const panelSpans = panelCaption && !letterOnly(panelCaption) ? this.inline(panelCaption, {}) : [];
        const caption = normalizeSpans(i === withMain ? [...mainSpans, { text: " " }, ...panelSpans] : panelSpans);
        const tagged = i === withMain && label ? { label } : {};
        this.push(this.table(tabular, caption.length ? caption : undefined), "float", { group, ...tagged });
      });
      if (!tabulars.length && mainSpans.length) this.push({ kind: "figure", caption: mainSpans }, "float", { group, ...(label ? { label } : {}) });
    }
  }

  private table(tabular: Element, caption: Span[] | undefined): RefBlock {
    const rows: { cells: { spans: Span[]; header?: true; colspan?: number; rowspan?: number }[] }[] = [];
    for (const tr of tabular.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr")) {
      const head = tr.parentElement?.matches("thead") ?? false;
      const cells = [...tr.querySelectorAll(":scope > td, :scope > th")].map((cell) => {
        const colspan = Number(cell.getAttribute("colspan") ?? 1);
        const rowspan = Number(cell.getAttribute("rowspan") ?? 1);
        return {
          spans: this.inline(cell, {}),
          ...(head ? { header: true as const } : {}),
          ...(colspan > 1 ? { colspan } : {}),
          ...(rowspan > 1 ? { rowspan } : {}),
        };
      });
      if (cells.some((c) => c.spans.some((s) => s.text.trim() || s.latex))) rows.push({ cells });
    }
    return { kind: "table", ...(caption ? { caption } : {}), rows };
  }

  /** An algorithm float: its caption as a paragraph, its lines as a list (depth by indentation, marker the printed line number). */
  private algorithm(el: Element) {
    const group = ++this.groups;
    const caption = this.caption(el);
    if (caption) this.push({ kind: "paragraph", spans: caption }, "float", { group });
    for (const listing of el.querySelectorAll(".ltx_listing")) this.listing(listing, "float", group);
  }

  /** Listing lines: pseudo-code (math or bold keywords in it) as a list, program code as a code block. */
  private listing(el: Element, role: Role, group: number | undefined) {
    const lines = [...el.querySelectorAll(".ltx_listingline")];
    const pseudo = el.querySelector("math, .ltx_font_bold") !== null;
    if (!pseudo) {
      const text = lines.map((l) => (l.textContent ?? "").replace(/\u00a0/g, " ").replace(/^\n+|\s+$/g, "")).join("\n");
      return this.push({ kind: "code", text: dedent(text) }, role, group ? { group } : {});
    }
    const indents = lines.map((l) => /^\s*/.exec(l.textContent ?? "")![0].replace(/\n/g, "").length);
    const levels = [...new Set(indents)].sort((a, b) => a - b);
    const items: Item[] = lines.map((line, i) => {
      const clone = line.cloneNode(true) as Element;
      const tag = clone.querySelector(".ltx_tag_listingline");
      const marker = (tag?.textContent ?? "").trim();
      tag?.remove();
      return { depth: levels.indexOf(indents[i]), marker, spans: this.inline(clone, {}) };
    });
    this.push({ kind: "list", items }, role, group ? { group } : {});
  }

  private bibliography(el: Element) {
    const title = el.querySelector(":scope > .ltx_title");
    if (title) this.push({ kind: "heading", level: 2, spans: this.inline(title, {}) }, "flow");
    const items: Item[] = [];
    for (const li of el.querySelectorAll("li.ltx_bibitem")) {
      const tag = (li.querySelector(":scope > .ltx_tag_bibitem")?.textContent ?? "").trim();
      // Numbered and alphabetic labels print ("[1]", "[Abh67]", "1."); author-year labels do not.
      const marker = this.options.numericCite ? `[${this.bibNumbers.get(li.id)}]` : /^\[.*\]$|^\d+\.?$/.test(tag) ? tag : "";
      const spans = [...li.querySelectorAll(":scope > .ltx_bibblock")].flatMap((b, i) => [...(i ? [{ text: " " }] : []), ...this.inline(b, {})]);
      items.push({ depth: 0, marker, spans: normalizeSpans(spans) });
    }
    if (items.length) this.push({ kind: "list", items }, "flow");
  }

  // ── Inline content ─────────────────────────────────────────────────────────

  /** The spans of an element's inline content. Footnotes inside it are queued; push() writes them after the block. */
  private inline(el: Element, style: Style, options: { dropNoteMarks?: boolean } = {}): Span[] {
    const spans: Span[] = [];
    const walk = (node: Node, s: Style) => {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ");
        if (text) spans.push({ text, ...s });
        return;
      }
      if (node.nodeType !== 1) return;
      const child = node as Element;
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;
      if (child.matches(".ltx_ERROR, .ltx_rule, .ltx_nodisplay, .ltx_phantom, .ltx_note_outer, .ltx_tag_note, .ltx_rdf, .ltx_pubnotes")) return;
      if (tag === "math") return void spans.push(mathSpan(child));
      if (tag === "br") return void spans.push({ text: " ", ...s });
      if (child.matches(".ltx_note")) return this.note(child, spans, options.dropNoteMarks ?? false);
      if (child.matches("cite") && this.options.numericCite) {
        const numbers = [...child.querySelectorAll("a.ltx_ref")].map((a) => this.bibNumbers.get((a.getAttribute("href") ?? "").replace(/^#/, "")));
        return void spans.push({ ...s, text: `[${numbers.join(", ")}]` });
      }
      if (child.matches("cite") && this.options.citeCompress) {
        const refs = [...child.querySelectorAll("a.ltx_ref")].map((a) => (a.textContent ?? "").trim());
        const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
        if (refs.length > 2 && refs.every((r) => /^\d+$/.test(r)) && /^\[[\d,\s]+\]$/.test(text)) {
          return void spans.push({ ...s, text: `[${compressRange(refs.map(Number))}]` });
        }
      }
      if (child.matches("cite") && this.options.citeNoComma && !child.hasAttribute("data-comma")) {
        const clone = child.cloneNode(true) as Element;
        clone.setAttribute("data-comma", "");
        for (const a of clone.querySelectorAll("a.ltx_ref")) a.textContent = (a.textContent ?? "").replace(/,\s*(\d{4}[a-z]?|in prep\.|submitted)$/, " $1");
        return walk(clone, s);
      }
      if (child.matches("cite.ltx_citemacro_cite") && this.options.parenCite) {
        const refs = [...child.querySelectorAll("a.ltx_ref")].map((a) =>
          (a.textContent ?? "").replace(/\s+/g, " ").trim().replace(/\s*\(\)$/, "").replace(/\s*\(([^()]*)\)$/, ", $1"),
        );
        return void spans.push({ ...s, text: `(${refs.join("; ")})` });
      }
      if (child.matches("table.ltx_equation, table.ltx_equationgroup")) {
        // display math inside inline content (a caption, a cell): its formulas as inline math
        for (const math of child.querySelectorAll("math")) spans.push({ text: " " }, mathSpan(math), { text: " " });
        return;
      }
      const next = styleOf(child, s);
      const block = /^(p|div|li|dt|dd|figcaption|table|tr)$/.test(tag);
      if (block) spans.push({ text: " " });
      for (const grandchild of [...child.childNodes]) walk(grandchild, next);
      if (block || tag === "td" || tag === "th") spans.push({ text: " " });
    };
    for (const node of [...el.childNodes]) walk(node, styleOf(el, style));
    return normalizeSpans(spans);
  }

  /** A footnote: its mark stays in the text as the page prints it; its text becomes a footnote block after the current block. */
  private note(el: Element, spans: Span[], dropMark: boolean) {
    // running heads are furniture; \thanks notes come from the PDF's page 1 (build.mts), marks and all
    if (el.matches(".ltx_role_runningtitle, .ltx_role_runningauthor, .ltx_role_supplement, .ltx_role_thanks, .ltx_note_frontmatter")) return;
    const mark = (el.querySelector(":scope > .ltx_note_mark")?.textContent ?? "").trim();
    if (mark && !dropMark) spans.push({ text: mark, sup: true });
    if (el.matches(".ltx_role_footnotemark")) return;
    const content = el.querySelector(":scope > .ltx_note_outer > .ltx_note_content");
    if (!content) return;
    const clone = content.cloneNode(true) as Element;
    for (const drop of clone.querySelectorAll(":scope > .ltx_note_mark, :scope > .ltx_tag_note, :scope > .ltx_note_type")) drop.remove();
    // revtex prints a footnote as an entry of the bibliography: its mark is the entry's number, "[32]"
    const entry = this.bibTexts.get(squash(clone.textContent ?? ""));
    if (entry !== undefined) {
      if (mark && !dropMark && spans.at(-1)?.text === mark) spans[spans.length - 1] = { text: entry };
      return;
    }
    const saved = this.notes.splice(0);
    const body = this.inline(clone, {});
    this.notes.unshift(...saved);
    if (body.length) this.notes.push({ kind: "footnote", label: mark, spans: body });
  }
}

function styleOf(el: Element, base: Style): Style {
  const s: Style = { ...base };
  const cls = el.classList;
  const tag = el.tagName.toLowerCase();
  if (cls.contains("ltx_font_bold") || tag === "b" || tag === "strong") s.bold = true;
  if (cls.contains("ltx_font_medium")) delete s.bold;
  if (cls.contains("ltx_font_italic") || cls.contains("ltx_font_slanted") || tag === "i") s.italic = true;
  if (cls.contains("ltx_font_upright")) delete s.italic;
  if (cls.contains("ltx_font_typewriter") || tag === "code" || tag === "tt") s.code = true;
  if (cls.contains("ltx_font_smallcaps")) s.smallCaps = true;
  if (cls.contains("ltx_framed_underline") || tag === "u") s.underline = true;
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/.test(href)) s.href = href;
  }
  return s;
}

/** Inline math: its plain reading, LaTeXML's TeX (alttext), and its presentation MathML without the TeX annotation. */
function mathSpan(math: Element): Span {
  return { text: mathText(math), latex: cleanTex(math.getAttribute("alttext") ?? ""), mathml: cleanMathml(math) };
}

function mathText(math: Element): string {
  const clone = math.cloneNode(true) as Element;
  for (const a of clone.querySelectorAll("annotation, annotation-xml")) a.remove();
  return (clone.textContent ?? "").replace(INVISIBLE_MATH_CHARS, "").replace(/\s+/g, " ").trim();
}

/** LaTeXML's alttext as TeX a display block holds: no \displaystyle lead, no \label. */
export function cleanTex(tex: string): string {
  return tex
    .replace(/^\s*\\displaystyle\s*/, "")
    .replace(/\\label\{[^}]*\}/g, "")
    .trim();
}

function cellTex(td: Element, keepDisplaystyle: boolean): string {
  const math = td.querySelector("math");
  if (!math) return "";
  const tex = math.getAttribute("alttext") ?? "";
  return keepDisplaystyle ? tex.replace(/\\label\{[^}]*\}/g, "").trim() : cleanTex(tex);
}

/** The element's MathML without the TeX annotation, ids, classes, and LaTeXML's own attributes. */
export function cleanMathml(math: Element): string {
  const clone = math.cloneNode(true) as Element;
  for (const a of clone.querySelectorAll("annotation, annotation-xml")) a.remove();
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    for (const name of ["id", "class", "alttext", "intent", "xref", "arg"]) node.removeAttribute(name);
  }
  const semantics = clone.querySelector(":scope > semantics");
  if (semantics) semantics.replaceWith(...[...semantics.childNodes]);
  return clone.outerHTML.replace(/>\s+</g, "><");
}

/** The rows of an aligned group as one MathML table. */
function tableMathml(rows: (Element | null)[][]): string {
  const inner = (math: Element | null) => {
    if (!math) return "";
    const clean = cleanMathml(math);
    return clean.replace(/^<math[^>]*>/, "").replace(/<\/math>$/, "");
  };
  const body = rows.map((r) => `<mtr>${r.map((m) => `<mtd>${inner(m)}</mtd>`).join("")}</mtr>`).join("");
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mtable>${body}</mtable></math>`;
}

/** A panel's caption that is only its letter, "(a)": the panel's label, which the main caption names. */
function letterOnly(caption: Element): boolean {
  return /^\s*\(?[a-z]\)?\s*$/i.test(caption.textContent ?? "");
}

/** The tag LaTeXML prints before a float's own caption ("Figure 1:"). */
function captionLabel(el: Element): { label?: string } {
  const label = el.querySelector(":scope > figcaption > .ltx_tag")?.textContent?.replace(/\s+/g, " ").trim();
  return label ? { label } : {};
}

/** A text with its spaces removed, for comparing texts LaTeXML writes in two places. */
function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Sorted numbers with three or more in a row as a range: 5, 6, 7, 8, 12 → "5–8, 12". */
function compressRange(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) out.push(`${sorted[i]}–${sorted[j]}`);
    else for (let k = i; k <= j; k++) out.push(String(sorted[k]));
    i = j + 1;
  }
  return out.join(", ");
}

/** The tabulars of a float, not those nested inside a cell. */
function topTabulars(el: Element): Element[] {
  return [...el.querySelectorAll("table.ltx_tabular")].filter((t) => !t.parentElement?.closest("table.ltx_tabular"));
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n");
}

/** Merges neighbouring spans of one style, collapses spaces across spans, and trims the ends. */
export function normalizeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    if (span.latex !== undefined) {
      out.push(span);
      continue;
    }
    let text = span.text.replace(/\s+/g, " ");
    const prev = out.at(-1);
    if (prev && prev.latex === undefined && /\s$/.test(prev.text) && text.startsWith(" ")) text = text.slice(1);
    if (!text) continue;
    if (prev && prev.latex === undefined && sameStyle(prev, span)) prev.text += text;
    else if (prev && prev.latex === undefined && !text.trim() && !/\s$/.test(prev.text)) prev.text += " "; // a lone space joins the span before
    else out.push({ ...span, text });
  }
  while (out.length && out[0].latex === undefined && !out[0].text.trim()) out.shift();
  while (out.length && out.at(-1)!.latex === undefined && !out.at(-1)!.text.trim()) out.pop();
  if (out[0] && out[0].latex === undefined) out[0].text = out[0].text.trimStart();
  const last = out.at(-1);
  if (last && last.latex === undefined) last.text = last.text.trimEnd();
  return out.filter((s) => s.latex !== undefined || s.text.length);
}

function sameStyle(a: Span, b: Span): boolean {
  return (
    a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.code === b.code && a.smallCaps === b.smallCaps && a.sup === b.sup && a.href === b.href
  );
}
