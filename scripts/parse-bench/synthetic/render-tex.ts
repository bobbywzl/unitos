/**
 * The LaTeX renderer: a spec's leaves → a .tex file → pdflatex. Every number a reader sees is the spec's:
 * headings print from starred commands with the spec's text, theorem heads from one generic environment,
 * equation labels from \tag*, footnote marks from \footnote[n]. A chapter keeps \chapter for its "CHAPTER n" line.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import type { Font, FontRole } from "../model";
import { picturePdf, picturePng } from "./pictures";
import { SOURCE_DATE_EPOCH } from "./stamp";
import { leafFont, tableGrid, type Group, type HeadingLevel, type Leaf, type LeafLook, type RenderBlock, type Role, type Slot, type SpecCell, type SpecSpan, type TableLayout } from "./spec";

export type TexLayout = {
  documentClass: string;
  classOptions?: string;
  /** No ToUnicode maps, as in many pdfLaTeX files: a parser reads glyph names, and math glyphs garble. */
  noToUnicode?: true;
  /** Packages and settings after \documentclass. */
  preamble: string;
  /** The starred command each heading level prints with, the style it sets, and the running head it marks. */
  headings: Partial<Record<HeadingLevel, { command: string; bold?: true; italic?: true; smallCaps?: true; mark?: "markright" | "markboth" }>>;
  /** Commands right after \begin{document} (IEEEtran's \markboth). */
  start?: string;
  /** A "•" marker is the class's own drawn bullet (beamer), not a text glyph. */
  drawnBullets?: true;
  /** The front matter: the class's \maketitle (amsart), IEEEtran's, a title page of centered lines, a title
      block at the top of the first page, or a beamer title frame. */
  front: "maketitle" | "ieee" | "plain" | "block" | "beamer";
  smallCaps: "keep" | "upper";
  /** Where a figure or a table may float. */
  float?: string;
  captionJoin?: string;
  /** The page's head and foot bands in points from the top and bottom edges: what prints there is furniture. */
  bands: { top: number; bottom: number };
  /** The fonts the class sets, as pdflatex prints them (read from the PDF with PyMuPDF): the body's, the
      title's, each heading level's, captions', footnotes', and a front-matter paragraph's by its role (a role
      not named takes the body's). */
  fonts: { body: Font } & Partial<Record<Exclude<FontRole, "body"> | Role, Font>>;
  /** The heading levels the class centers (IEEEtran's and amsart's sections, amsbook's chapters and sections). */
  centered: HeadingLevel[];
  /** The class justifies its paragraphs (every class here but beamer, which sets them ragged right). */
  justified: boolean;
};

/** Each leaf's font and alignment as the class sets them: the title centered, a heading as `centered` says, a
    paragraph as the spec aligns it or else justified when the class justifies. */
export function texLooks(layout: TexLayout, leaves: Leaf[]): LeafLook[] {
  const f = layout.fonts;
  return leaves.map(({ block }): LeafLook => {
    const role =
      block.kind === "title" ? f.title
      : block.kind === "heading" ? f[`h${block.level}`]
      : block.kind === "paragraph" ? ((block.role ? f[block.role] : undefined) ?? f.body)
      : block.kind === "list" ? f.body
      : block.kind === "footnote" ? f.footnote
      : block.kind === "table" || block.kind === "figure" ? f.caption
      : undefined;
    const align =
      block.kind === "title" ? "center"
      : block.kind === "heading" ? (!block.runIn && layout.centered.includes(block.level) ? "center" : undefined)
      : block.kind === "paragraph" ? (block.align ?? (layout.justified ? "justify" : undefined))
      : undefined;
    const font = leafFont(role, block);
    return { ...(font ? { font } : {}), ...(align ? { align } : {}) };
  });
}

// ---------------------------------------------------------------- text

const TEXT: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#", "%": "\\%", _: "\\_",
  "^": "\\textasciicircum{}", "~": "\\textasciitilde{}", "<": "\\textless{}", ">": "\\textgreater{}", "|": "\\textbar{}",
  "“": "``", "”": "''", "‘": "`", "’": "'", "–": "--", "—": "---", "\u00a0": "~", "…": "\\ldots{}", "•": "\\textbullet{}",
};

/** Text for LaTeX: TeX's own quotes and dashes, so the PDF prints the spec's characters. */
export function texEscape(text: string): string {
  if (/['"`]/.test(text)) throw new Error(`a straight quote in “${text}”: a spec writes ’ ‘ “ ”`);
  if (/--/.test(text)) throw new Error(`“--” in “${text}”: a spec writes – or —`);
  return text.replace(/[\\{}$&#%_^~<>|“”‘’–—\u00a0…•]/g, (ch) => TEXT[ch]);
}

const codeEscape = (text: string) =>
  text.replace(/[\\{}$&#%_^~]/g, (ch) => (ch === "\\" ? "\\textbackslash{}" : ch === "^" ? "\\textasciicircum{}" : ch === "~" ? "\\textasciitilde{}" : `\\${ch}`)).replace(/--/g, "-{}-");
const urlEscape = (url: string) => url.replace(/[%#]/g, (ch) => `\\${ch}`);

type Base = { italic?: boolean; bold?: boolean; smallCaps?: boolean };

/** Spans for LaTeX, each style set relative to the base style around them (a theorem body is italic). */
function texSpans(spans: SpecSpan[], base: Base = {}, marks: "footnote" | "thanks" = "footnote"): string {
  return spans
    .map((s) => {
      if (s.qed) return "";
      if (s.footnote) {
        if (marks === "thanks") return `\\thanks{${texSpans(s.footnote)}}`;
        if (!/^\d+$/.test(s.text)) throw new Error(`footnote mark “${s.text}”: LaTeX marks are numbers`);
        return `\\footnote[${s.text}]{${texSpans(s.footnote)}}`;
      }
      if (s.latex) return `$${s.latex}$`;
      if (s.strike || s.color || s.highlight) throw new Error(`“${s.text}”: LaTeX renderings print no strikethrough, color, or highlight`);
      if (s.dropCap) return `\\IEEEPARstart{${texEscape(s.text[0])}}{${texEscape(s.text.slice(1))}}`;
      let out = s.code ? `\\texttt{${codeEscape(s.text)}}` : texEscape(s.text);
      if (s.smallCaps && !base.smallCaps) out = `\\textsc{${out}}`;
      if (s.italic && !base.italic) out = `\\textit{${out}}`;
      if (!s.italic && base.italic && !s.code) out = `\\textup{${out}}`;
      if (s.bold && !base.bold) out = `\\textbf{${out}}`;
      if (!s.bold && base.bold) out = `\\textmd{${out}}`;
      if (s.underline) out = `\\underline{${out}}`;
      if (s.href) out = `\\href{${urlEscape(s.href)}}{${out}}`;
      return out;
    })
    .join("");
}

/** The spans upper-cased for a running head; math stays as it is. */
const upperSpans = (spans: SpecSpan[]): SpecSpan[] => spans.map((s) => (s.latex ? s : { ...s, text: s.text.toUpperCase(), bold: undefined, smallCaps: undefined }));

/** Drop the punctuation a class adds after a run-in heading ("." in amsbook, ":" in IEEEtran). */
function withoutRunInPunctuation(spans: SpecSpan[]): SpecSpan[] {
  const last = spans[spans.length - 1];
  if (!last || last.latex || !/[.:]$/.test(last.text)) throw new Error(`run-in heading “${spans.map((s) => s.text).join("")}” must end with the punctuation it prints`);
  return [...spans.slice(0, -1), { ...last, text: last.text.slice(0, -1) }];
}

// ---------------------------------------------------------------- tables

function texTable(block: Extract<RenderBlock, { kind: "table" }>, layout: TexLayout): string {
  const tl: TableLayout = block.layout ?? {};
  const rules = tl.rules ?? "booktabs";
  const { slots, columns } = tableGrid(block.rows);
  const alignOf = (col: number) => (tl.align?.[col] ?? "l") as "l" | "c" | "r";
  // A column of relative width w takes its share of the line less its own padding, so the table fills the line.
  const colType = (align: "l" | "c" | "r", width?: number) =>
    width === undefined
      ? align
      : `>{${align === "l" ? "\\raggedright" : align === "r" ? "\\raggedleft" : "\\centering"}\\arraybackslash}p{\\dimexpr ${width.toFixed(3)}\\linewidth-2\\tabcolsep\\relax}`;
  const total = tl.widths?.reduce((a, c) => a + c, 0) ?? 0;
  const widthOf = (col: number, span = 1) => (tl.widths ? (tl.widths.slice(col, col + span).reduce((a, c) => a + c, 0) / total) * 0.99 : undefined);
  const bar = rules === "grid" ? "|" : "";
  const spec = bar + Array.from({ length: columns }, (_, col) => colType(alignOf(col), widthOf(col))).join(bar) + bar;
  const headerCount = block.rows.findIndex((r) => !r.cells.some((c) => c.header));
  const headers = headerCount === -1 ? block.rows.length : headerCount;

  // A cell that spans rows prints in the last row it covers, lifted by a negative \multirow: a shaded row
  // below would otherwise paint over it (colortbl draws each row's background after the rows above).
  const cellText = (cell: SpecCell, col: number, lastOfSpan: boolean): string => {
    const text = texSpans(cell.spans);
    const align = cell.align ?? alignOf(col);
    const span = cell.colspan ?? 1;
    const rows = cell.rowspan ?? 1;
    const inner = rows > 1 ? (lastOfSpan ? `\\multirow{-${rows}}{*}{${text}}` : "") : text;
    if (span > 1 || cell.align) {
      const left = rules === "grid" && col === 0 ? "|" : "";
      return `\\multicolumn{${span}}{${left}${colType(align, widthOf(col, span))}${bar}}{${inner}}`;
    }
    return inner;
  };
  const rowText = (index: number): string => {
    const r = block.rows[index];
    const shade = r.shade ?? (index < headers ? tl.shadeHeader : undefined);
    // A slot a cell above still covers is empty, except in the last row it covers.
    const cells = slots[index].map((slot) => {
      if ("cell" in slot) return cellText(slot.cell, slot.col, false);
      return slot.last ? cellText(slot.covered, slot.col, true) : cellText({ spans: [], colspan: slot.covered.colspan }, slot.col, false);
    });
    let line = `${shade ? `\\rowcolor[HTML]{${shade.replace("#", "")}}` : ""}${cells.join(" & ")} \\\\`;
    if (rules === "grid") {
      const open = slots[index + 1]?.filter((s) => "covered" in s).map((s) => s.col) ?? [];
      if (open.length === 0) line += " \\hline";
      else {
        const ranges: string[] = [];
        for (let col = 0; col < columns; col++) if (!open.includes(col)) ranges.push(`\\cline{${col + 1}-${col + 1}}`);
        line += ` ${ranges.join("")}`;
      }
    } else if (rules === "booktabs") {
      if (index < headers - 1) {
        const mids = slots[index]
          .filter((s): s is Extract<Slot, { cell: SpecCell }> => "cell" in s && (s.cell.colspan ?? 1) > 1)
          .map((s) => `\\cmidrule(lr){${s.col + 1}-${s.col + (s.cell.colspan ?? 1)}}`);
        if (mids.length) line += ` ${mids.join("")}`;
      } else if (index === headers - 1) line += " \\midrule";
      else if (r.rule && index < block.rows.length - 1) line += " \\midrule";
    }
    return line;
  };
  const top = rules === "grid" ? "\\hline" : rules === "booktabs" ? "\\toprule" : "";
  const bottom = rules === "booktabs" ? "\\bottomrule" : "";
  const headerRows = block.rows.slice(0, headers).map((_, index) => rowText(index));
  const bodyRows = block.rows.slice(headers).map((_, index) => rowText(index + headers));
  const caption = block.captionText ? `\\caption{${texSpans(block.captionText)}}` : "";
  const size = tl.small ? "\\small" : "";

  if (tl.long) {
    const continued = tl.continued ? `\\multicolumn{${columns}}{r}{\\textit{${texEscape(tl.continued)}}} \\\\` : "";
    return [
      size ? `{${size}` : "",
      `\\begin{longtable}{${spec}}`,
      caption ? `${caption} \\\\` : "",
      top, ...headerRows, "\\endfirsthead",
      top, ...headerRows, "\\endhead",
      rules === "booktabs" ? "\\midrule" : "", continued, "\\endfoot",
      bottom, "\\endlastfoot",
      ...bodyRows,
      "\\end{longtable}",
      size ? "}" : "",
    ].filter(Boolean).join("\n");
  }
  const env = tl.wide ? "table*" : "table";
  return [
    `\\begin{${env}}[${layout.float ?? "htbp"}]`,
    "\\centering",
    size,
    caption,
    `\\begin{tabular}{${spec}}`,
    top, ...headerRows, ...bodyRows, bottom,
    "\\end{tabular}",
    `\\end{${env}}`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- document

const PREAMBLE_COMMON = String.raw`
\usepackage{amsmath,amssymb,mathrsfs}
\usepackage{graphicx,multirow,booktabs,longtable,array}
\usepackage[table]{xcolor}
\usepackage{listings,upquote,indentfirst}
\lstset{basicstyle=\ttfamily\footnotesize,columns=fullflexible,keepspaces=true,frame=single,upquote=true}
\newcommand{\synthhead}{}
\makeatletter\@ifundefined{theoremstyle}{\usepackage{amsthm}}{}\makeatother
\theoremstyle{plain}\newtheorem*{synthplain}{\synthhead}
\theoremstyle{definition}\newtheorem*{synthdefinition}{\synthhead}
\theoremstyle{remark}\newtheorem*{synthremark}{\synthhead}
`;

/** The .tex source of a rendering; `figures` names each figure's picture file, in order. */
export function texSource(layout: TexLayout, leaves: Leaf[], figures: string[]): string {
  const out: string[] = [];
  const open: Group[] = [];
  let frameOpen = false;
  let runInPending = false;
  let figureIndex = 0;
  let previous: RenderBlock | undefined;

  const closeGroup = (group: Group) => {
    if (group.kind === "box") throw new Error("LaTeX renders no boxes");
    out.push(group.style === "proof" ? "\\end{proof}" : `\\end{synth${group.style}}`);
  };
  const openGroup = (group: Group) => {
    if (group.kind === "box") throw new Error("LaTeX renders no boxes");
    out.push(group.style === "proof" ? "\\begin{proof}" : `\\renewcommand{\\synthhead}{${texEscape(group.head)}}\\begin{synth${group.style}}`);
  };

  // Front matter: the title and the role paragraphs before the first other block.
  const frontCount = leaves.findIndex(({ block }) => !(block.kind === "title" || (block.kind === "paragraph" && block.role)));
  const front = leaves.slice(0, frontCount === -1 ? leaves.length : frontCount).map((leaf) => leaf.block);
  const body = leaves.slice(front.length);
  out.push(...frontMatter(layout, front));
  if (layout.front === "beamer") frameOpen = true;

  for (const { block, groups } of body) {
    // Close the groups this block is not in, then open the new ones.
    let keep = 0;
    while (keep < open.length && keep < groups.length && open[keep].id === groups[keep].id) keep++;
    while (open.length > keep) closeGroup(open.pop() as Group);
    for (const group of groups.slice(keep)) {
      openGroup(group);
      open.push(group);
    }
    const base: Base = { italic: groups.some((g) => g.kind === "theorem" && g.style === "plain") };

    switch (block.kind) {
      case "heading": {
        const style = layout.headings[block.level];
        if (block.frame) {
          if (frameOpen) out.push("\\end{frame}");
          out.push(`\\begin{frame}[fragile]{${texSpans(block.spans)}}`);
          frameOpen = true;
          break;
        }
        if (block.chapter !== undefined) {
          out.push(`\\setcounter{chapter}{${block.chapter - 1}}`, `\\chapter{${texSpans(block.spans, { bold: true })}}`);
          break;
        }
        if (!style) throw new Error(`no LaTeX command for heading level ${block.level}`);
        const spans = block.runIn ? withoutRunInPunctuation(block.spans) : block.spans;
        const text = texSpans(spans, { bold: style.bold, italic: style.italic, smallCaps: style.smallCaps });
        out.push(`\\${style.command}*{${text}}${style.mark ? `\\${style.mark}{${texSpans(upperSpans(block.spans))}}${style.mark === "markboth" ? "{}" : ""}` : ""}`);
        runInPending = Boolean(block.runIn);
        break;
      }
      case "paragraph": {
        if (block.chapterLabel) break;
        let spans = block.spans;
        if (block.head) {
          spans = spans.slice(1);
          if (spans[0] && !spans[0].latex) spans = [{ ...spans[0], text: spans[0].text.replace(/^ /, "") }, ...spans.slice(1)];
          out.push(block.head === "only" ? "\\leavevmode" : texSpans(spans, base));
          break;
        }
        let text = texSpans(spans, base);
        if (block.small) text = `{\\small ${text}\\par}`;
        if (block.align === "center") text = `{\\centering ${text}\\par}`;
        else if (block.align === "right") text = `{\\raggedleft ${text}\\par}`;
        else if (block.indent === "hanging") text = `{\\hangindent=2em\\hangafter=1 \\noindent ${text}\\par}`;
        else if (block.indent === "block") text = `{\\leftskip=2em \\noindent ${text}\\par}`;
        if (runInPending) {
          // The paragraph a run-in heading starts: its text follows the heading on the same line.
          out[out.length - 1] += ` ${text}`;
          runInPending = false;
          break;
        }
        const continues = block.continues && (previous?.kind === "equation" || previous?.kind === "list");
        if (!block.align && !block.indent && !continues) text = `\\noindent ${text}`;
        out.push(continues ? text : `\n${text}`);
        break;
      }
      case "list":
        out.push(block.flush ? flushListText(block.items, base) : listText(block.items, base, layout.drawnBullets));
        break;
      case "equation":
        out.push(`\\begin{equation*}\n${block.latex}${block.label ? `\\tag*{${block.label}}` : ""}\n\\end{equation*}`);
        break;
      case "table":
        out.push(texTable(block, layout));
        break;
      case "figure": {
        const file = figures[figureIndex++];
        const width = block.width ?? 0.9;
        out.push(
          [
            `\\begin{figure}[${layout.float ?? "htbp"}]`,
            "\\centering",
            `\\includegraphics[width=${width}\\linewidth]{${file}}`,
            block.captionText ? `\\caption{${texSpans(block.captionText)}}` : "",
            "\\end{figure}",
          ].filter(Boolean).join("\n"),
        );
        break;
      }
      case "code":
        out.push(`\\begin{lstlisting}\n${block.text}\n\\end{lstlisting}`);
        break;
      case "quote":
        out.push(`\\begin{quote}\n${texSpans(block.spans, base)}\n\\end{quote}`);
        break;
      case "footnote":
        if (!block.atMark) throw new Error("a footnote block without a mark");
        break;
      case "separator":
        out.push("\n\\noindent\\rule{\\linewidth}{0.4pt}\n");
        break;
      case "contents":
        throw new Error("a contents field is a Word rendering's alone");
      case "pagebreak":
        out.push("\\clearpage");
        break;
      case "title":
        throw new Error("a title after the front matter");
    }
    if (block.kind !== "footnote") previous = block;
  }
  while (open.length) closeGroup(open.pop() as Group);
  if (frameOpen) out.push("\\end{frame}");

  const head = [
    layout.noToUnicode ? "\\pdfgentounicode=0" : "",
    `\\documentclass${layout.classOptions ? `[${layout.classOptions}]` : ""}{${layout.documentClass}}`,
    layout.preamble.trim(),
    PREAMBLE_COMMON.trim(),
    "\\begin{document}",
    layout.start ?? "",
  ].filter(Boolean);
  return `${[...head, ...out, "\\end{document}"].join("\n")}\n`;
}

function listText(items: Extract<RenderBlock, { kind: "list" }>["items"], base: Base, drawnBullets?: true): string {
  const env = drawnBullets && items.every((it) => it.marker === "•") ? "itemize" : "enumerate";
  const out: string[] = [];
  let depth = -1;
  for (const it of items) {
    if (it.depth > depth + 1) throw new Error(`list item “${it.marker}” skips a depth`);
    while (depth < it.depth) {
      out.push(`\\begin{${env}}`);
      depth++;
    }
    while (depth > it.depth) {
      out.push(`\\end{${env}}`);
      depth--;
    }
    // A drawn bullet is the class's own; any other marker prints as the spec's text.
    out.push(`\\item${env === "itemize" ? "" : `[\\textup{${texEscape(it.marker)}}]`} ${texSpans(it.spans, base)}`);
  }
  while (depth >= 0) {
    out.push(`\\end{${env}}`);
    depth--;
  }
  return out.join("\n");
}

/** Items typed as lines at the margin: the marker, a space, the text. */
function flushListText(items: Extract<RenderBlock, { kind: "list" }>["items"], base: Base): string {
  return items.map((it) => `\n\\noindent ${texEscape(it.marker)} ${texSpans(it.spans, base)}`).join("\n");
}

function frontMatter(layout: TexLayout, front: RenderBlock[]): string[] {
  const out: string[] = [];
  const text = (block: RenderBlock, base: Base = {}, marks: "footnote" | "thanks" = "footnote") => ("spans" in block ? texSpans(block.spans, base, marks) : "");
  // A role paragraph's first span is the head its class prints ("Abstract—", "Index Terms—", "Abstract.").
  const afterHead = (block: RenderBlock) => {
    if (!("spans" in block)) return "";
    const [, ...rest] = block.spans;
    return texSpans(rest.length && !rest[0].latex ? [{ ...rest[0], text: rest[0].text.replace(/^\s+/, "") }, ...rest.slice(1)] : rest);
  };
  const role = (block: RenderBlock) => (block.kind === "paragraph" ? block.role : undefined);
  switch (layout.front) {
    case "maketitle": {
      for (const block of front) {
        if (block.kind === "title") out.push(`\\title{${text(block)}}`);
        else if (role(block) === "author") out.push(`\\author{${text(block)}}`);
        else if (role(block) === "abstract") out.push(`\\begin{abstract}\n${afterHead(block)}\n\\end{abstract}`);
        else throw new Error(`amsart front matter: no place for ${role(block)}`);
      }
      out.push("\\date{}", "\\maketitle");
      break;
    }
    case "ieee": {
      const after: string[] = [];
      for (const block of front) {
        if (block.kind === "title") out.push(`\\title{${text(block)}}`);
        else if (role(block) === "author") out.push(`\\author{${text(block, {}, "thanks")}}`);
        else if (role(block) === "abstract") after.push(`\\begin{abstract}\n${afterHead(block)}\n\\end{abstract}`);
        else if (role(block) === "keywords") after.push(`\\begin{IEEEkeywords}\n${afterHead(block)}\n\\end{IEEEkeywords}`);
        else throw new Error(`IEEEtran front matter: no place for ${role(block)}`);
      }
      out.push("\\maketitle", ...after);
      break;
    }
    case "plain":
    case "block": {
      const sizes: Record<string, string> = { title: "\\LARGE", subtitle: "\\Large", author: "\\large", affiliation: "\\normalsize", date: "\\normalsize", abstract: "\\normalsize", keywords: "\\normalsize" };
      if (layout.front === "plain") out.push("\\thispagestyle{empty}", "\\vspace*{0.2\\textheight}");
      for (const block of front) {
        const size = block.kind === "title" ? sizes.title : sizes[role(block) ?? "author"];
        out.push(`{\\centering ${size} ${text(block)}\\par}`, layout.front === "plain" ? "\\vspace{1.2em}" : "\\vspace{0.6em}");
      }
      if (layout.front === "block") out.push("\\vspace{1em}");
      break;
    }
    case "beamer": {
      out.push("\\begin{frame}[plain]", "\\centering", "\\vspace*{\\fill}");
      for (const block of front) {
        const size = block.kind === "title" ? "\\Large" : role(block) === "author" ? "\\normalsize" : "\\small";
        out.push(`{${size} ${text(block)}\\par}`, "\\vspace{1em}");
      }
      out.push("\\vspace*{\\fill}");
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- compile

/** Runs pdflatex until the references settle; a missing glyph fails the build, since its words would vanish. */
export function compileTex(dir: string, name: string): void {
  const env = { ...process.env, SOURCE_DATE_EPOCH, FORCE_SOURCE_DATE: "1" };
  for (let run = 0; run < 5; run++) {
    try {
      execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", `${name}.tex`], { cwd: dir, env, stdio: "pipe" });
    } catch {
      const log = readFileSync(join(dir, `${name}.log`), "utf8");
      const error = log.split("\n").findIndex((line) => line.startsWith("!"));
      throw new Error(`pdflatex failed on ${name}.tex:\n${log.split("\n").slice(Math.max(0, error), error + 8).join("\n")}`);
    }
    const log = readFileSync(join(dir, `${name}.log`), "utf8");
    const missing = log.match(/Missing character: There is no .*/);
    if (missing) throw new Error(`${name}.tex: ${missing[0]}`);
    if (!/Rerun|Label\(s\) may have changed|Table widths have changed/.test(log)) break;
  }
  const log = readFileSync(join(dir, `${name}.log`), "utf8");
  const overfull = log.match(/Overfull \\hbox \((\d+\.\d+)pt too wide\)/g)?.filter((line) => Number(line.match(/\((\d+\.\d+)pt/)?.[1]) > 1) ?? [];
  if (overfull.length) console.warn(`${name}: ${overfull.length} line(s) run into the margin; see ${name}.log`);
  // Bitmap fonts (T1 without Latin Modern) drop ligatures from the text layer.
  const fonts = execFileSync("pdffonts", [join(dir, `${name}.pdf`)], { encoding: "utf8" });
  if (/Type 3/.test(fonts)) throw new Error(`${name}.pdf has bitmap Type 3 fonts: load lmodern with T1`);
}

/** Writes the figures' pictures and the .tex into `dir`, compiles, and returns the PDF's path. */
export async function renderTex(opts: { name: string; layout: TexLayout; leaves: Leaf[]; dir: string; browser: Browser }): Promise<string> {
  const figures: string[] = [];
  for (const { block } of opts.leaves) {
    if (block.kind !== "figure") continue;
    const file = `${opts.name}-figure-${figures.length + 1}.${block.picture.kind === "photo" ? "png" : "pdf"}`;
    if (block.picture.kind === "photo") await picturePng(opts.browser, block.picture, join(opts.dir, file));
    else await picturePdf(opts.browser, block.picture, join(opts.dir, file));
    figures.push(file);
  }
  writeFileSync(join(opts.dir, `${opts.name}.tex`), texSource(opts.layout, opts.leaves, figures));
  compileTex(opts.dir, opts.name);
  return join(opts.dir, `${opts.name}.pdf`);
}
