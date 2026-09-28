// The benchmark's own checks: each metric on tiny hand-built pairs, the
// adapters on tiny parses and imports, and the math canonical form on pairs
// that must and must not score 1. Run: npx tsx scripts/parse-bench/check.mts
import type { RichNode } from "@/lib/docs/schema";
import type { ParsedBlock } from "@/lib/parse/types";
import { fromImport, fromParse, type Doc, type DocBlock } from "./adapt";
import { mathTokens, sequenceSimilarity } from "./math";
import { score, type Scores } from "./metrics";
import type { RefBlock, Span } from "./model";
import { garblesOf, wordsOf } from "./text";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const para = (text: string, look: Omit<Span, "text"> = {}): RefBlock => ({ kind: "paragraph", spans: [{ text, ...look }] });
const REF: RefBlock[] = [
  { kind: "title", spans: [{ text: "Notes on river flow" }] },
  { kind: "heading", level: 1, spans: [{ text: "1. Channels and banks" }] },
  para("A channel carries water from its source to its mouth, and its banks and bed shape the flow on the way."),
  { kind: "paragraph", spans: [{ text: "Let " }, { text: "X", latex: "X" }, { text: " be the discharge measured at the gauge each morning." }] },
  { kind: "equation", latex: "\\int_0^1 f(x)\\,dx = 1", label: "(1.1)" },
  {
    kind: "list",
    items: [
      { depth: 0, marker: "(a)", spans: [{ text: "Gravel bars form where the current slows." }] },
      { depth: 1, marker: "(i)", spans: [{ text: "Sand settles behind every bar." }] },
    ],
  },
  { kind: "heading", level: 2, spans: [{ text: "1.1 Notation" }] },
  {
    kind: "table",
    rows: [
      { cells: [{ spans: [{ text: "Symbol" }], header: true }, { spans: [{ text: "Meaning" }], header: true }] },
      { cells: [{ spans: [{ text: "Q" }] }, { spans: [{ text: "gauge reading" }] }] },
    ],
  },
  { kind: "paragraph", spans: [{ text: "The last paragraph closes the section with " }, { text: "one bold claim", bold: true }, { text: " about floods." }] },
];
const FURNITURE = ["12", "CHAPTER 1. RIVERS"];
const run = (blocks: DocBlock[], furniture = FURNITURE): Scores => score({ blocks: REF }, furniture, { blocks }).scores;
const edit = (f: (blocks: DocBlock[]) => void): DocBlock[] => {
  const blocks = structuredClone(REF) as DocBlock[];
  f(blocks);
  return blocks;
};
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;

// ── Metrics ─────────────────────────────────────────────────────────────────

{
  const s = run(REF);
  const off = Object.entries(s.parts).filter(([, v]) => v !== null && !near(v, 1));
  check("a perfect parse scores 100", near(s.composite, 100), off.map(([k, v]) => `${k} ${v}`).join(", "));
}
{
  const s = run(
    edit((b) => {
      b.splice(3, 0, para("CHAPTER 1. RIVERS"));
      b[2] = para(`12 ${(REF[2] as { spans: Span[] }).spans[0].text}`);
    }),
  );
  check("a leaked running head and page number drop furniture", s.furniture.leaked === 2 && near(s.parts.furniture, 0), `leaked ${s.furniture.leaked}, leaks ${s.furniture.leaks}`);
  check("a leaked running head drops word precision", (s.words.precision ?? 1) < 1 && near(s.words.recall, 1), `precision ${s.words.precision}`);
  check("a leaked running head is a paragraph no reference block owns", (s.blocks.precision ?? 1) < 1, `block precision ${s.blocks.precision}`);
}
{
  // A page number where a later page begins inside a paragraph (a break).
  const s = run(edit((b) => (b[2] = { ...para("A channel carries water from its source to its mouth, 12 and its banks and bed shape the flow on the way."), breaks: [{ unit: 0, at: 56 }] })));
  check("a page number at a page start inside a paragraph leaks", s.furniture.leaked === 1, `leaked ${s.furniture.leaked}`);
}
{
  const s = run(edit((b) => (b[2] = para("12 CHAPTER 1. RIVERS A channel carries water from its source to its mouth, and its banks and bed shape the flow on the way."))));
  check("furniture next to furniture at an edge leaks too", s.furniture.leaked === 2, `leaked ${s.furniture.leaked}`);
  const glued = run(edit((b) => (b[2] = para("A channel carries water from its source to its mouth (see gauge A-12):"))));
  check("a number glued to a word is not a page number", glued.furniture.leaked === 0, `leaked ${glued.furniture.leaked}`);
}
{
  const s = run(edit((b) => b.splice(2, 2, { kind: "paragraph", spans: [...(REF[2] as { spans: Span[] }).spans, { text: " " }, ...(REF[3] as { spans: Span[] }).spans] })));
  check("a merged paragraph counts as a merge", s.blocks.merges.length === 1 && s.blocks.merges[0].parts.length === 2 && (s.parts.paragraphs ?? 1) < 1, `merges ${s.blocks.merges.length}`);
}
{
  const s = run(edit((b) => b.splice(2, 1, para("A channel carries water from its source to its mouth,"), para("and its banks and bed shape the flow on the way."))));
  check("a paragraph cut in two counts as a split", s.blocks.splits.length === 1 && s.blocks.splits[0].pieces.length === 2, `splits ${s.blocks.splits.length}`);
}
{
  const s = run(
    edit((b) => {
      const table = b[7] as Extract<RefBlock, { kind: "table" }>;
      table.rows[1].cells[1] = { spans: [] };
      b.push(para("gauge reading"));
    }),
  );
  check("a table cell's words in a paragraph count as a leak", s.tables.outside === 2 && (s.tables.f1 ?? 1) < 1, `outside ${s.tables.outside}, f1 ${s.tables.f1?.toFixed(2)}`);
}
{
  const s = run(
    edit((b) => {
      const table = b[7] as Extract<RefBlock, { kind: "table" }>;
      table.rows.push({ cells: [{ spans: [{ text: "The last paragraph closes the section with one bold claim about floods." }] }, { spans: [] }] });
      b.splice(8, 1);
    }),
  );
  check("prose inside a table counts as a leak", s.tables.inside > 0 && (s.tables.precision ?? 1) < 1, `inside ${s.tables.inside}`);
}
{
  const s = run(edit((b) => b.splice(2, 2, b[3], b[2])));
  check("two paragraphs out of order lower reading order", (s.order ?? 1) < 1 && (s.order ?? 0) > 0.5, `order ${s.order?.toFixed(3)}`);
}
{
  const shifted = run(edit((b) => b.forEach((x) => x.kind === "heading" && (x.level = (x.level + 1) as 2 | 3))));
  const wrong = run(edit((b) => ((b[6] as Extract<RefBlock, { kind: "heading" }>).level = 1)));
  check("headings one level deeper keep the hierarchy", near(shifted.parts.headings, 1) && shifted.headings.shift === 1);
  check("a heading at the wrong level counts", near(wrong.parts.headings, 0.5), `headings ${wrong.parts.headings}`);
}
{
  const s = run(edit((b) => ((b[5] as Extract<RefBlock, { kind: "list" }>).items[1].depth = 0)));
  check("a list item at the wrong depth counts", s.lists.found === 2 && near(s.lists.depth, 0.5), `depth ${s.lists.depth}`);
  const flat = run(edit((b) => b.splice(5, 1, para("Gravel bars form where the current slows."), para("Sand settles behind every bar."))));
  check("list items read as paragraphs are not found", flat.lists.found === 0 && near(flat.lists.recall, 0));
}
{
  const s = run(edit((b) => (b[4] = { kind: "figure", mathImage: "∫ 1 0 f(x) dx = 1 (1.1)" })));
  check("an equation shown as an image counts and scores 0", s.math.images === 1 && near(s.math.display, 0), `display ${s.math.display}`);
  const words = run(edit((b) => (b[3] = para("Let X be the discharge measured at the gauge each morning."))));
  check("an inline formula read as words counts, and scores by its glyphs", words.math.plainInline === 1 && near(words.math.inline, 1), `inline ${words.math.inline}`);
  const lost = run(edit((b) => (b[3] = para("Let be the discharge measured at the gauge each morning."))));
  check("a lost inline formula scores 0", near(lost.math.inline, 0), `inline ${lost.math.inline}`);
}
{
  const s = run(edit((b) => (b[8] = para("The last paragraph closes the section with one bold claim about floods."))));
  check("a lost bold run lowers bold F1", (s.styles.bold ?? 1) < 1 && s.styles.italic === null, `bold ${s.styles.bold}`);
}
{
  const s = run(edit((b) => (b[2] = para("A channel carries water 6= from its source to its mouth, and its banks and bed shape the flow on the way."))));
  check("a garbled glyph counts", s.garbles.excess === 1 && (s.parts.garbles ?? 1) < 1);
}

// ── Words and garbles ───────────────────────────────────────────────────────

check("words: ligatures, soft hyphens, and case normalize", wordsOf("The ﬁnal com­pu­ta­tion").map((w) => w.w).join(" ") === "the final computation");
check("words: a CJK character is a word", wordsOf("河流学 is fun").map((w) => w.w).join(" ") === "河 流 学 is fun");
check("words: Kangxi radicals read as ideographs", wordsOf("⼀").map((w) => w.w).join("") === "一");
const garbleKinds = (t: string) => garblesOf(t).map((g) => g.kind);
check("garbles: CMSY leftovers are found", garbleKinds("n6= m, ω7→ X(ω), A =⇒ B").length === 3);
check("garbles: real math and dates are not", garbleKinds("x+6=0, a 7-day week, 2016=2016").length === 0, garbleKinds("x+6=0, a 7-day week, 2016=2016").join(", "));
check("garbles: control and private-use characters are found", garbleKinds("a\u0001b  �").length === 3);

// ── Math canonical form ─────────────────────────────────────────────────────

const sim = (a: string, b: string) => sequenceSimilarity(mathTokens({ latex: a }, false), mathTokens({ latex: b }, false));
for (const [a, b] of [
  ["\\mathcal{F}", "\\cal F"],
  ["x_{n}", "x_n"],
  ["\\left( a \\right)", "(a)"],
  ["\\sum_{i=1}^n x_i", "\\sum\\limits_{i=1}^{n} x_{i}"],
  ["\\hat{x}", "\\widehat{x}"],
  ["a \\neq b", "a \\ne b"],
]) {
  check(`math: ${a} equals ${b}`, near(sim(a, b), 1), String(sim(a, b)));
}
check("math: x^2 is not x_2", sim("x^2", "x_2") < 1, String(sim("x^2", "x_2")));
check("math: \\frac{a}{b} against a/b scores partial", sim("\\frac{a}{b}", "a/b") > 0 && sim("\\frac{a}{b}", "a/b") < 1, String(sim("\\frac{a}{b}", "a/b")));
check("math: 𝓕 read as F is half an edit", near(sim("\\mathcal{F}", "F"), 0.5));
const latexml = `<math><semantics><msub><mi class="ltx_font_mathcaligraphic">ℱ</mi><mi>n</mi></msub><annotation encoding="application/x-tex">\\mathcal{F}_{n}</annotation></semantics></math>`;
check("math: LaTeXML MathML equals KaTeX's", near(sequenceSimilarity(mathTokens({ mathml: latexml }, false), mathTokens({ latex: "\\mathcal F_n" }, false)), 1));

// ── Adapters ────────────────────────────────────────────────────────────────

{
  const blocks: ParsedBlock[] = [
    { type: "HEADING", text: "1. Channels and banks", html: "<h2>1. Channels and banks</h2>", page: 1 },
    // A paragraph joined across pages 1 and 2.
    { type: "PARAGRAPH", text: "Words on page one. Words on page two.", page: 1, pageStarts: [{ offset: 19, page: 2 }], styles: [{ start: 25, end: 29, style: "bold", quotedText: "page" }] },
    { type: "LIST", text: "(a) First item\n  (i) Nested item\n- A bullet", page: 2 },
    {
      type: "TABLE",
      text: "Symbol\tMeaning\nQ\tgauge reading",
      html: '<table><thead><tr><th>Symbol<span class="cell-gap">\t</span></th><th>Meaning</th></tr></thead><tbody><tr><td><strong>Q</strong><span class="cell-gap">\t</span></td><td>gauge reading</td></tr></tbody></table>',
      page: 2,
    },
    { type: "FIGURE", text: "∫ 1 0 f(x) dx = 1 (1.1)", page: 2, region: { x: 10, y: 10, w: 50, h: 5 } as never },
  ];
  const all = fromParse({ title: "Notes", blocks });
  check("parse: the title comes first, headings keep their level", all.blocks[0].kind === "title" && all.blocks[1].kind === "heading" && all.blocks[1].level === 2);
  const page2 = fromParse({ title: "Notes", blocks }, [2, 2]);
  const text = (d: Doc, i: number) => {
    const b = d.blocks[i];
    return "spans" in b ? b.spans.map((s) => s.text).join("") : "";
  };
  check("parse: pages out of range drop, a joined block keeps its words in range", page2.blocks[0].kind === "paragraph" && text(page2, 0) === "Words on page two.", text(page2, 0));
  const list = page2.blocks[1];
  check(
    "parse: list markers and depths come from the text",
    list.kind === "list" && list.items.map((i) => `${i.depth}${i.marker}`).join(",") === "0(a),1(i),0-",
    list.kind === "list" ? list.items.map((i) => `${i.depth}${i.marker}`).join(",") : list.kind,
  );
  const table = page2.blocks[2];
  check(
    "parse: table cells from the html, header cells and bold kept",
    table.kind === "table" && table.rows[0].cells[0].header === true && table.rows[1].cells[0].spans[0].bold === true && table.rows[1].cells[1].spans[0].text === "gauge reading",
  );
  check("parse: a figure of math is an equation image", page2.blocks[3].kind === "figure" && page2.blocks[3].mathImage !== undefined);
  const withBreak = fromParse({ title: null, blocks: [blocks[1]] });
  check("parse: a page start inside a block is a break", withBreak.blocks[0].breaks?.[0]?.at === 19);
}
{
  const doc: RichNode = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { docStyle: "title" }, content: [{ type: "pageStart", attrs: { page: 1 } }, { type: "text", text: "Notes" }] },
      { type: "paragraph", content: [{ type: "text", text: "Page one ends and " }, { type: "pageStart", attrs: { page: 2 } }, { type: "text", text: "page two begins", marks: [{ type: "italic" }] }] },
      {
        type: "orderedList",
        attrs: { listStyle: "NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS" },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "First item" }] },
              { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested item" }] }] }] },
            ],
          },
        ],
      },
      { type: "blockMath", attrs: { latex: "x^2" } },
      { type: "figure", attrs: { caption: "Figure 1: A chart" } },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Symbol" }] }] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Q" }] }] }] },
        ],
      },
    ],
  };
  const all = fromImport(doc);
  const list = all.blocks[2];
  check("import: the Title is the title", all.blocks[0].kind === "title");
  check(
    "import: list markers are the ones the editor draws",
    list.kind === "list" && list.items.map((i) => `${i.depth}${i.marker}`).join(",") === "0(a),1(i)",
    list.kind === "list" ? list.items.map((i) => `${i.depth}${i.marker}`).join(",") : list.kind,
  );
  check("import: equation, figure, and table", all.blocks[3].kind === "equation" && all.blocks[4].kind === "figure" && all.blocks[5].kind === "table");
  const page2 = fromImport(doc, [2, 2]);
  const first = page2.blocks[0];
  check(
    "import: page starts cut the text to the pages in range",
    first.kind === "paragraph" && first.spans.map((s) => s.text).join("") === "page two begins" && first.spans[0].italic === true,
    first.kind === "paragraph" ? first.spans.map((s) => s.text).join("") : first.kind,
  );
}

console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} checks fail.`);
process.exit(failed === 0 ? 0 : 1);
