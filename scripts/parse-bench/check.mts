// The benchmark's own checks: each metric on tiny hand-built pairs, the
// adapters on tiny parses and imports, and the math canonical form on pairs
// that must and must not score 1. Run: npx tsx scripts/parse-bench/check.mts
import { readFileSync } from "node:fs";
import { listLevelsOf, type RichNode } from "@/lib/docs/schema";
import type { ParsedBlock } from "@/lib/parse/types";
import type { Glyph } from "@/lib/parse/pdf/drawing";
import { fromImport, fromParse, printedNotes, type Doc, type DocBlock } from "./adapt";
import { displayGaps, displaySpace, markerStart, rowHeight, rowHeights } from "./drawn";
import { borderScore, formulaScaleOf, freeScores, furnitureOf, mathPart, ocrSame, type PdfText } from "./free";
import { glyphScores, placeCrops, placeEquations, type PageGlyphs } from "./glyphs";
import { columnScores, cropScores, faceShape, figureScores, indentScores, labelScores, linesOfUnits, tableScores } from "./layout";
import { mathTokens, sequenceSimilarity } from "./math";
import { flatten, score, type Scores } from "./metrics";
import type { RefBlock, Span } from "./model";
import { CORPUS_PATH } from "./load";
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
  check("a split paragraph's second piece is no right block", near(s.blocks.precision, 9 / 10), `block precision ${s.blocks.precision}`);
}
{
  // A contents entry ends with its section's page number: no furniture leak.
  const entry: DocBlock = { kind: "paragraph", role: "contents", spans: [{ text: "1. Channels and banks 12", href: "#heading=h1" }] };
  const s = run(edit((b) => b.splice(1, 0, entry)));
  check("furniture: a contents entry's page number is no leak", s.furniture.leaked === 0, `leaked ${s.furniture.leaked}`);
  const paragraph = (text: string): RichNode => ({ type: "paragraph", content: [{ type: "text", text }] });
  const heading = (text: string): RichNode => ({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] });
  const unlinked = fromImport({
    type: "doc",
    content: [paragraph("1. Channels and banks 12"), paragraph("2. Floods 14"), paragraph("3. Dams 17"), heading("1. Channels and banks"), paragraph("2. Floods"), heading("2. Floods"), heading("3. Dams")],
  });
  const entries = unlinked.blocks[0];
  check(
    "import: three paragraphs in a row that read like headings are a contents list, their numbers the markers; one alone is no entry",
    entries?.kind === "list" && entries.role === "contents" && entries.items.map((it) => it.marker).join(",") === "1.,2.,3." && unlinked.blocks[2]?.kind === "paragraph" && unlinked.blocks[2].role === undefined,
    JSON.stringify(unlinked.blocks.map((b) => b.role ?? b.kind)),
  );
  const linkedEntry = (text: string, indentLeft?: number): RichNode => ({
    type: "paragraph",
    ...(indentLeft ? { attrs: { indentLeft } } : {}),
    content: [{ type: "text", text, marks: [{ type: "link", attrs: { href: "#heading=h1" } }] }],
  });
  const toc = fromImport({ type: "doc", content: [linkedEntry("2 Data"), linkedEntry("2.1 Delay variables", 36), linkedEntry("B Data cleaning")] }).blocks[0];
  check(
    "import: linked contents entries are one list: the section number the marker, the indent the depth",
    toc?.kind === "list" && toc.items.map((it) => `${it.depth}${it.marker}:${it.spans.map((s) => s.text).join("")}`).join("|") === "02:Data|12.1:Delay variables|0B:Data cleaning",
    JSON.stringify(toc),
  );
  const parsedToc = fromParse({ title: null, blocks: [{ type: "LIST", text: "C Estimation\n  C.1 Base regression", html: '<ol class="contents"></ol>', page: 1 }] }).blocks[0];
  check(
    "parse: a contents list's appendix letters are its markers",
    parsedToc?.kind === "list" && parsedToc.items.map((it) => `${it.depth}${it.marker}`).join(",") === "0C,1C.1",
    JSON.stringify(parsedToc),
  );
  const listed = fromParse({ title: null, blocks: [{ type: "LIST", text: "[Bil95] Billingsley, Probability and Measure.\n[Wil91] Williams, Probability with Martingales.", page: 1 }] }).blocks[0];
  check("parse: an author-year label is a list marker", listed?.kind === "list" && listed.items[0].marker === "[Bil95]" && listed.items[1].marker === "[Wil91]", JSON.stringify(listed));
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
  // A table of formulas: no words in its cells, found by its place, each formula placed as a word is.
  const f = (latex: string, text: string): Span => ({ text, latex });
  const grid = (cells: Span[][]): RefBlock => ({ kind: "table", rows: cells.map((row) => ({ cells: row.map((span) => ({ spans: [span] })) })) });
  const around = (table: RefBlock): RefBlock[] => [para("The two dice fall and the sum is counted."), table, para("Each sum has its own chance of showing.")];
  const dice = around(grid([[f("k", "k"), f("2", "2"), f("3", "3")], [f("P(S=k)", "P(S=k)"), f("\\frac{1}{36}", "1/36"), f("\\frac{2}{36}", "2/36")]]));
  const same = score({ blocks: dice }, [], { blocks: around(grid([[f("k", "k"), f("2", "2"), f("3", "3")], [f("P(S=k)", "P(S=k)"), f("\\frac{1}{36}", "1/36"), f("\\frac{2}{36}", "2/36")]])) }).scores;
  check("tables: a table of formulas is found and its formulas in place score 1", near(same.tables.f1, 1) && same.blocks.byKind.table?.found === 1, `f1 ${same.tables.f1}, found ${same.blocks.byKind.table?.found}`);
  const swapped = score({ blocks: dice }, [], { blocks: around(grid([[f("k", "k"), f("2", "2"), f("3", "3")], [f("P(S=k)", "P(S=k)"), f("\\frac{2}{36}", "2/36"), f("\\frac{1}{36}", "1/36")]])) }).scores;
  check("tables: two formulas in each other's cells are out of place", (swapped.tables.f1 ?? 1) < 1 && (swapped.tables.f1 ?? 0) > 0.5, `f1 ${swapped.tables.f1}`);
  const asWords = score({ blocks: dice }, [], { blocks: around(grid([[{ text: "k" }, { text: "2" }, { text: "3" }], [{ text: "P(S=k)" }, { text: "1/36" }, { text: "2/36" }]])) }).scores;
  check("tables: a formula read as the same characters in its cell is in place", near(asWords.tables.recall, 1), `recall ${asWords.tables.recall}`);
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
  const drawn = run(edit((b) => ((b[5] as Extract<RefBlock, { kind: "list" }>).items[0].marker = "a.")));
  check(
    "a list item drawn with another marker counts, by depth, and lowers the lists part",
    near(drawn.lists.markers, 0.5) && drawn.lists.byDepth[0]?.marked === 0 && drawn.lists.byDepth[1]?.marked === 1 && near(drawn.parts.lists, 5 / 6),
    `markers ${drawn.lists.markers}, lists ${drawn.parts.lists}, ${JSON.stringify(drawn.lists.byDepth)}`,
  );
}
{
  // A label no list level draws stays as the words an unmarked item opens with: it is the reference's marker
  // when the words open with exactly it.
  const labelled: RefBlock[] = [
    {
      kind: "list",
      items: [
        { depth: 0, marker: "[Bil95]", spans: [{ text: "Billingsley, Probability and Measure, Wiley." }] },
        { depth: 0, marker: "[Wil91]", spans: [{ text: "Williams, Probability with Martingales, Cambridge." }] },
      ],
    },
  ];
  const worded: DocBlock = {
    kind: "list",
    items: [
      { depth: 0, marker: "", spans: [{ text: "[Bil95] Billingsley, Probability and Measure, Wiley." }] },
      { depth: 0, marker: "", spans: [{ text: "[Wil9] Williams, Probability with Martingales, Cambridge." }] },
    ],
  };
  const s = score({ blocks: labelled }, [], { blocks: [worded] }).scores;
  check("lists: an unmarked item that opens with the reference's label has that marker", s.lists.found === 2 && s.lists.marked === 1, `found ${s.lists.found}, marked ${s.lists.marked}`);
}
{
  // A formula alone in a table cell has no words beside it: it is read from the cell the table maps it to.
  const intro = "The table lists each command and the symbol it draws.";
  const table = (result: Span): RefBlock => ({
    kind: "table",
    rows: [
      { cells: [{ spans: [{ text: "Command" }] }, { spans: [{ text: "Result" }] }] },
      { cells: [{ spans: [{ text: "sqrt" }] }, { spans: [result] }] },
    ],
  });
  const ref: RefBlock[] = [para(intro), table({ text: "√x", latex: "\\sqrt{x}" })];
  const asFormula = score({ blocks: ref }, [], { blocks: [para(intro), table({ text: "", latex: "\\sqrt{x}" })] }).scores;
  const asWords = score({ blocks: ref }, [], { blocks: [para(intro), table({ text: "√x" })] }).scores;
  check(
    "math: a formula alone in a table cell is read from the cell the table maps it to",
    near(asFormula.math.inline, 1) && asWords.math.plainInline === 1 && (asWords.math.inline ?? 0) > 0,
    `formula ${asFormula.math.inline}, words ${asWords.math.inline} (${asWords.math.plainInline})`,
  );
}
{
  // The free math part: a check passed 1, failed 0, a crop half; no part without a checked display.
  check(
    "free: a crop scores half of a checked display, and brings in no math part alone",
    near(mathPart({ checked: 2, passed: 2, mathImages: 1 }), 2.5 / 3) && mathPart({ checked: 0, passed: 0, mathImages: 1 }) === null && near(mathPart({ checked: 1, passed: 0, mathImages: 0 }), 0),
  );
}
{
  // An import's list in its own level formats (`listLevels` on the outermost list).
  const levels = JSON.stringify([
    { counter: "decimal", format: "%0." },
    { counter: "lower-alpha", format: "%1)." },
    ...Array.from({ length: 7 }, (_, k) => ({ counter: "decimal", format: `%${k + 2}.` })),
  ]);
  const item = (text: string, ...nested: RichNode[]): RichNode => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...nested] });
  const doc: RichNode = {
    type: "doc",
    content: [{ type: "orderedList", attrs: { listLevels: levels, start: 3 }, content: [item("Third step", { type: "orderedList", content: [item("First case"), item("Second case")] })] }],
  };
  const list = fromImport(doc).blocks[0];
  check(
    "import: a list's own level formats draw its markers",
    list?.kind === "list" && list.items.map((it) => it.marker).join(",") === "3.,a).,b).",
    list?.kind === "list" ? list.items.map((it) => it.marker).join(",") : JSON.stringify(list),
  );
  // A bullet list whose first level draws no marker (an empty bullet: a bibliography's entries) and whose second
  // draws one: the unmarked lines read as the parse reads an unmarked list, where the page editor can draw one.
  const unmarkedLevels = JSON.stringify([{ bullet: "" }, ...Array.from({ length: 8 }, () => ({ bullet: "◦" }))]);
  const bullets = fromImport({
    type: "doc",
    content: [{ type: "bulletList", attrs: { listLevels: unmarkedLevels }, content: [item("Adams, River flows", { type: "bulletList", content: [item("Gauges")] })] }],
  }).blocks[0];
  const drawn = listLevelsOf(unmarkedLevels) ? ",•" : "•,•";
  check(
    "import: a line whose level draws no marker has none",
    bullets?.kind === "list" && bullets.items.map((it) => it.marker).join(",") === drawn,
    bullets?.kind === "list" ? bullets.items.map((it) => it.marker).join(",") : JSON.stringify(bullets),
  );
}
{
  // An item's later paragraph (a centered label under the item's fill-in line) reads as its own paragraph,
  // with its alignment, between two lists; the items after it keep their depth.
  const line = (text: string, textAlign?: string): RichNode => ({ type: "paragraph", ...(textAlign ? { attrs: { textAlign } } : {}), content: [{ type: "text", text }] });
  const item = (...content: RichNode[]): RichNode => ({ type: "listItem", content });
  const doc: RichNode = {
    type: "doc",
    content: [{ type: "bulletList", content: [item(line("Birds"), { type: "bulletList", content: [item(line("Owls"), line("(kind)", "center")), item(line("Wrens"))] })] }],
  };
  const shape = fromImport(doc)
    .blocks.map((b) =>
      b.kind === "list"
        ? `list ${b.items.map((it) => `${it.depth}:${it.spans.map((s) => s.text).join("")}`).join(" ")}`
        : b.kind === "paragraph"
          ? `paragraph/${b.align ?? "left"} ${b.spans.map((s) => s.text).join("")}`
          : b.kind,
    )
    .join("; ");
  check("import: an item's later paragraph reads as its own, and the items after it keep their depth", shape === "list 0:Birds 1:Owls; paragraph/center (kind); list 1:Wrens", shape);
}
{
  // A display equation in a list item (a list the converter resumed after it), the paragraph after it, and a
  // table, a code block, a rule, and a picture in an item read as at the top level, between two lists.
  const line = (text: string): RichNode => ({ type: "paragraph", content: [{ type: "text", text }] });
  const item = (...content: RichNode[]): RichNode => ({ type: "listItem", content });
  const cell = (text: string): RichNode => ({ type: "tableCell", content: [line(text)] });
  const doc: RichNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        content: [
          item(line("Toss a coin three times."), { type: "blockMath", attrs: { latex: "\\Omega=\\{HHH,HHT\\}" } }, line("(see Example 1.6)."), {
            type: "orderedList",
            content: [item(line("Two heads."))],
          }),
          item(
            line("Count the cases."),
            { type: "table", content: [{ type: "tableRow", content: [cell("Heads"), cell("Tails")] }] },
            { type: "codeBlock", content: [{ type: "text", text: "count(cases)" }] },
            { type: "horizontalRule" },
            { type: "image", attrs: { src: "coin.png" } },
          ),
        ],
      },
    ],
  };
  const shape = fromImport(doc)
    .blocks.map((b) => (b.kind === "list" ? `list ${b.items.map((it) => `${it.depth}:${it.spans.map((s) => s.text).join("")}`).join(" ")}` : b.kind))
    .join("; ");
  check(
    "import: a display, a table, a code block, a rule, and a picture in a list item read as at the top level",
    shape === "list 0:Toss a coin three times.; equation; paragraph; list 1:Two heads. 0:Count the cases.; table; code; separator; figure",
    shape,
  );
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

{
  // A parse's display equation carries its printed label as \tag (decision 4).
  const eq = (latex: string) => fromParse({ title: null, blocks: [{ type: "EQUATION", text: latex, page: 1 }] }).blocks[0];
  const tagged = eq("\\int_0^1 f(x)\\,dx = 1 \\tag{1.1}");
  check("math: \\tag leaves the LaTeX and becomes the label", tagged.kind === "equation" && tagged.latex === "\\int_0^1 f(x)\\,dx = 1" && tagged.label === "(1.1)", JSON.stringify(tagged));
  const starred = eq("x = 1 \\tag*{A.2}");
  check("math: \\tag* is its label as written", starred.kind === "equation" && starred.label === "A.2" && starred.latex === "x = 1", JSON.stringify(starred));
  const right = run(edit((b) => (b[4] = tagged)));
  check("math: an equation with its label scores 1, label right", near(right.math.display, 1) && right.math.labels.ref === 1 && near(right.math.labels.score, 1), `display ${right.math.display}, labels ${JSON.stringify(right.math.labels)}`);
  const wrong = run(edit((b) => (b[4] = eq("\\int_0^1 f(x)\\,dx = 1 \\tag{1.2}"))));
  check("math: a wrong label counts apart from the formula", near(wrong.math.display, 1) && near(wrong.math.labels.score, 0), `display ${wrong.math.display}, labels ${wrong.math.labels.score}`);
}
{
  // A parse's inline formula: a math span over the block's text.
  const text = "Let X be the discharge measured at the gauge each morning.";
  const parsed = fromParse({ title: null, blocks: [{ type: "PARAGRAPH", text, page: 1, math: [{ start: 4, end: 5, latex: "X" }] }] }).blocks[0];
  check(
    "parse: a math span is one span with its LaTeX",
    parsed.kind === "paragraph" && parsed.spans.length === 3 && parsed.spans[1].latex === "X" && parsed.spans[1].text === "X",
    JSON.stringify(parsed),
  );
  const s = run(edit((b) => (b[3] = parsed)));
  check("math: an inline formula from a math span scores 1, its words out of the word stream", near(s.math.inline, 1) && s.math.plainInline === 0 && near(s.words.precision, 1), `inline ${s.math.inline}, precision ${s.words.precision}`);
  const eaten = fromParse({ title: null, blocks: [{ type: "PARAGRAPH", text, page: 1, math: [{ start: 4, end: 8, latex: "X be" }] }] }).blocks[0];
  const e = run(edit((b) => (b[3] = eaten)));
  check("math: a formula that eats a word loses that word's recall", (e.words.recall ?? 1) < 1 && (e.math.inline ?? 1) < 1, `recall ${e.words.recall}, inline ${e.math.inline}`);
}

{
  // A heading's own number and a contents line that repeats it are no page number; a page number before the
  // heading is.
  const REF_HEAD: RefBlock[] = [{ kind: "heading", level: 1, spans: [{ text: "3 Flow in the lower channel" }] }, para("The channel narrows below the dam and the water runs faster there.")];
  const own = score({ blocks: REF_HEAD }, ["3"], { blocks: [para("3 Flow in the lower channel 12"), ...REF_HEAD] }).scores;
  const leaked = score({ blocks: REF_HEAD }, ["3"], { blocks: [{ kind: "heading", level: 1, spans: [{ text: "3 3 Flow in the lower channel" }] }, REF_HEAD[1]] }).scores;
  check("furniture: a heading's own number, and a contents line that repeats it, are no page number", own.furniture.leaked === 0 && leaked.furniture.leaked === 1, `${own.furniture.leaked} ${leaked.furniture.leaked}`);
  // A clause list's numbered titles read either as its items or as headings over lists of their clauses.
  const clauses: RefBlock[] = [
    {
      kind: "list",
      items: [
        { depth: 0, marker: "1.", spans: [{ text: "Definitions", bold: true }] },
        { depth: 1, marker: "1.1", spans: [{ text: "A gauge is a post that shows the water's level." }] },
        { depth: 0, marker: "2.", spans: [{ text: "Readings", bold: true }] },
        { depth: 1, marker: "2.1", spans: [{ text: "Each gauge is read at noon every day." }] },
      ],
    },
  ];
  const asHeadings: DocBlock[] = [
    { kind: "heading", level: 2, spans: [{ text: "1. Definitions", bold: true }] },
    { kind: "list", items: [{ depth: 0, marker: "1.1", spans: [{ text: "A gauge is a post that shows the water's level." }] }] },
    { kind: "heading", level: 2, spans: [{ text: "2. Readings", bold: true }] },
    { kind: "list", items: [{ depth: 0, marker: "2.1", spans: [{ text: "Each gauge is read at noon every day." }] }] },
  ];
  const either = score({ blocks: clauses }, [], { blocks: asHeadings }).scores;
  check("lists: a clause list's titles read as headings over their clauses score as the list", near(either.composite, 100), JSON.stringify(either.parts));
}

// ── Footnotes, styles, and roles ────────────────────────────────────────────

{
  const NOTE_REF: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: "Floods come in spring when the snow melts." }, { text: "1", sup: true }, { text: " The banks hold in most years." }] },
    { kind: "footnote", label: "1", spans: [{ text: "Records from the upper gauge since the year the dam was built." }] },
    { kind: "paragraph", spans: [{ text: "A second paragraph closes the page with more words about the river." }] },
  ];
  const cited = "Floods come in spring when the snow melts.1 The banks hold in most years.";
  const at = cited.indexOf(".1") + 1;
  const parse = (refAt: number): ParsedBlock[] => [
    { type: "PARAGRAPH", text: cited, page: 1, styles: [{ start: at, end: at + 1, style: "sup", quotedText: "1" }], footnoteRefs: [{ start: refAt, end: refAt + 1, targetOrder: 1 }] },
    { type: "PARAGRAPH", text: "1 Records from the upper gauge since the year the dam was built.", html: '<p class="footnote">1 Records</p>', page: 1, footnote: { label: "1" } },
    { type: "PARAGRAPH", text: "A second paragraph closes the page with more words about the river.", page: 1 },
  ];
  const noteRun = (doc: Doc) => score({ blocks: NOTE_REF }, [], doc).scores;
  const right = noteRun(fromParse({ title: null, blocks: parse(at) }));
  check(
    "notes: a parse's footnote is found, linked at its mark, its words right",
    right.notes?.found === 1 && right.notes.linked === 1 && near(right.notes.words, 1) && near(right.notes.score, 1),
    JSON.stringify(right.notes),
  );
  check("styles: a raised footnote mark scores sup F1 1", near(right.styles.f1.sup, 1), `sup ${right.styles.f1.sup}`);
  const elsewhere = noteRun(fromParse({ title: null, blocks: parse(cited.indexOf("spring")) }));
  check("notes: a mark that stands elsewhere is not linked", elsewhere.notes?.found === 1 && elsewhere.notes.linked === 0, JSON.stringify(elsewhere.notes));
  const plain = noteRun(fromParse({ title: null, blocks: parse(at).map((b) => ({ ...b, footnote: undefined, footnoteRefs: undefined, styles: undefined })) }));
  check("notes: a footnote read as a paragraph is not found", plain.notes?.found === 0 && near(plain.notes.score, 0), JSON.stringify(plain.notes));
  check("styles: a mark read flat loses sup F1", near(plain.styles.f1.sup, 0), `sup ${plain.styles.f1.sup}`);
  // The import: the page editor's footnote number and its footnote at the document's end.
  const doc: RichNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Floods come in spring when the snow melts." },
          { type: "footnoteReference", attrs: { footnoteId: "n1" } },
          { type: "text", text: " The banks hold in most years." },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "A second paragraph closes the page with more words about the river." }] },
      {
        type: "footnotes",
        content: [{ type: "footnote", attrs: { footnoteId: "n1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Records from the upper gauge since the year the dam was built." }] }] }],
      },
    ],
  };
  const imported = noteRun(fromImport(doc));
  // The page editor draws 1 where the page prints ¶¶: no word error, and a label is no page number.
  const signed = NOTE_REF.map((b) =>
    b.kind === "footnote" ? { ...b, label: "¶¶" } : b.kind === "paragraph" && b.spans[1]?.sup ? { ...b, spans: [b.spans[0], { text: "¶¶", sup: true as const }, b.spans[2]] } : b,
  );
  const drawn = score({ blocks: signed }, ["1"], fromImport(doc)).scores;
  check("notes: a drawn number where the page prints ¶¶ costs no precision", near(drawn.words.precision, 1) && drawn.notes?.linked === 1, `precision ${drawn.words.precision}`);
  check("furniture: a footnote's label is no page number", drawn.furniture.leaked === 0, `leaked ${drawn.furniture.leaked}`);
  check(
    "notes: an import's footnote at the end is found and linked; reading order leaves it apart",
    imported.notes?.found === 1 && imported.notes.linked === 1 && near(imported.notes.words, 1) && near(imported.order, 1),
    `${JSON.stringify(imported.notes)}; order ${imported.order}`,
  );
  // A "∗" note cited first takes the editor's 1, so the page's "RI1" draws as "RI2":
  // with the reference's notes, the import's marks read as the page prints them.
  const SHIFTED: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: "Ada Mercer" }, { text: "∗", sup: true }, { text: " studies the river index RI" }, { text: "1", sup: true }, { text: " over ten years." }] },
    { kind: "footnote", label: "∗", spans: [{ text: "Equal contribution to the survey of the lower basin." }] },
    { kind: "footnote", label: "1", spans: [{ text: "Records from the upper gauge since the year the dam was built." }] },
  ];
  const note = (id: string, text: string): RichNode => ({ type: "footnote", attrs: { footnoteId: id }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const shifted: RichNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ada Mercer" },
          { type: "footnoteReference", attrs: { footnoteId: "a" } },
          { type: "text", text: " studies the river index RI" },
          { type: "footnoteReference", attrs: { footnoteId: "b" } },
          { type: "text", text: " over ten years." },
        ],
      },
      { type: "footnotes", content: [note("a", "Equal contribution to the survey of the lower basin."), note("b", "Records from the upper gauge since the year the dam was built.")] },
    ],
  };
  const drawnOnly = score({ blocks: SHIFTED }, [], fromImport(shifted)).scores;
  const relabeled = score({ blocks: SHIFTED }, [], fromImport(shifted, undefined, printedNotes(SHIFTED))).scores;
  check(
    "notes: an import's drawn numbers take the page's marks from the reference's notes",
    (drawnOnly.words.recall ?? 1) < 1 && near(relabeled.words.f1, 1) && relabeled.notes?.linked === 2,
    `drawn recall ${drawnOnly.words.recall}; relabeled f1 ${relabeled.words.f1}, ${JSON.stringify(relabeled.notes)}`,
  );
  // A note the page prints with no mark (a first page's acknowledgment): the
  // page editor's number at the title's end is no word of the page.
  const UNMARKED: RefBlock[] = [
    { kind: "title", spans: [{ text: "Floods of 2025" }] },
    { kind: "footnote", label: "", spans: [{ text: "The author thanks the gauge keepers of the upper basin." }] },
  ];
  const unmarked: RichNode = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { docStyle: "title" }, content: [{ type: "text", text: "Floods of 2025" }, { type: "footnoteReference", attrs: { footnoteId: "u" } }] },
      { type: "footnotes", content: [note("u", "The author thanks the gauge keepers of the upper basin.")] },
    ],
  };
  const noMark = score({ blocks: UNMARKED }, [], fromImport(unmarked, undefined, printedNotes(UNMARKED))).scores;
  check("notes: a note the page prints with no mark draws no number into the import's words", near(noMark.words.f1, 1) && noMark.notes?.found === 1, `f1 ${noMark.words.f1}, ${JSON.stringify(noMark.notes)}`);
  // A note cited twice ("Shen∗", "Sherif∗"): a mark at either citation links it.
  const TWICE: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: "Lin Shen" }, { text: "∗", sup: true }, { text: " and Omar Sherif" }, { text: "∗", sup: true }, { text: " wrote the survey of the basin." }] },
    { kind: "footnote", label: "∗", spans: [{ text: "Equal contribution to the survey of the lower basin." }] },
  ];
  const twiceText = "Lin Shen∗ and Omar Sherif∗ wrote the survey of the basin.";
  const first = twiceText.indexOf("∗");
  const twice = score({ blocks: TWICE }, [], fromParse({
    title: null,
    blocks: [
      { type: "PARAGRAPH", text: twiceText, page: 1, styles: [{ start: first, end: first + 1, style: "sup", quotedText: "∗" }], footnoteRefs: [{ start: first, end: first + 1, targetOrder: 1 }] },
      { type: "PARAGRAPH", text: "∗ Equal contribution to the survey of the lower basin.", page: 1, footnote: { label: "∗" } },
    ],
  })).scores;
  check("notes: a note cited twice is linked from its first mark", twice.notes?.linked === 1, JSON.stringify(twice.notes));
  // A mark after a formula at a paragraph's end, the word before the formula lost in it: placed by its block.
  const AFTER_MATH: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: "Every Borel set lies in " }, { text: "B(R)", latex: "\\mathcal{B}(\\mathbb{R})" }, { text: "." }, { text: "1", sup: true }] },
    { kind: "footnote", label: "1", spans: [{ text: "Records from the upper gauge since the year the dam was built." }] },
  ];
  const mathText = "Every Borel set lies in B(R).1";
  const afterMath = score({ blocks: AFTER_MATH }, [], fromParse({
    title: null,
    blocks: [
      { type: "PARAGRAPH", text: mathText, page: 1, math: [{ start: mathText.indexOf("in B"), end: mathText.indexOf(")") + 1, latex: "in \\mathcal{B}(\\mathbb{R})" }], footnoteRefs: [{ start: mathText.length - 1, end: mathText.length, targetOrder: 1 }] },
      { type: "PARAGRAPH", text: "1 Records from the upper gauge since the year the dam was built.", page: 1, footnote: { label: "1" } },
    ],
  })).scores;
  check("notes: a mark whose neighbours do not align is placed by its block", afterMath.notes?.linked === 1, JSON.stringify(afterMath.notes));
  check("free: OCR's readings of one running foot are one repeat", ocrSame("CHALLENGE TO APOLLO", "CHRLLENGE TO _POLLO") && !ocrSame("Table 1: River flows", "Table 2: River floods"));
  // The PDF's text: a sentence with a formula the text layer splits by its
  // glyphs' spacing, and a diagram's two labels.
  const line = (text: string, top: number) => ({ page: 1, top, bottom: top + 10, left: 100, right: 100 + 6 * text.length, text });
  const pdf: PdfText = {
    first: 1,
    pages: 1,
    raw: [["Let 2k1 t be small.", "gauge", "dam wall"]],
    lines: [line("Let 2k1 t be small.", 100), line("gauge", 400), line("dam wall", 420)],
    furniture: [],
    sizes: new Map([[1, { width: 600, height: 800 }]]),
    symbols: [],
  };
  const diagram: DocBlock = { kind: "figure", at: { page: 1, region: { kind: "path", points: [[0, 45], [100, 45], [100, 60], [0, 60]] } } };
  const sentence: DocBlock = { kind: "paragraph", spans: [{ text: "Let " }, { text: "", latex: "2k_1t" }, { text: " be small." }] };
  const free = freeScores(pdf, flatten({ blocks: [sentence, diagram] })).coverage;
  check("free: a formula's glyphs cover the words the text layer splits it into", near(free.recall, 1) && near(free.precision, 1), `recall ${free.recall}, precision ${free.precision}`);
  const bare = freeScores(pdf, flatten({ blocks: [sentence] })).coverage;
  check("free: a diagram's labels are words to cover only without the figure", (bare.recall ?? 1) < 1, `recall ${bare.recall}`);
  // A display's crop and a figure show the lines in them, long ones too; a line the candidate's words hold (a
  // caption inside its figure's region) stays a word to cover, and a short label it holds is extra.
  const displayPdf: PdfText = { ...pdf, raw: [["Let 2k1 t be small.", "S n equals the sum of the first n terms"]], lines: [line("Let 2k1 t be small.", 100), line("S n equals the sum of the first n terms", 400)] };
  const crop = freeScores(displayPdf, flatten({ blocks: [sentence, { ...diagram, mathImage: "" }] })).coverage;
  const picture = freeScores(displayPdf, flatten({ blocks: [sentence, diagram] })).coverage;
  const captioned = freeScores(displayPdf, flatten({ blocks: [sentence, { ...diagram, caption: [{ text: "S n equals the sum of the first n terms" }] }] })).coverage;
  check(
    "free: a crop's and a figure's lines are their picture's words, unless the candidate's words hold them",
    near(crop.recall, 1) && near(picture.recall, 1) && near(picture.precision, 1) && near(captioned.recall, 1) && near(captioned.precision, 1),
    `crop ${crop.recall}, figure ${picture.recall}/${picture.precision}, caption ${captioned.recall}/${captioned.precision}`,
  );
  // Word's hollow bullet read as "o" before an item the candidate draws with a dash; a title broken in capitals.
  const wordPdf: PdfText = { ...pdf, raw: [["o Sand settles behind every bar.", "THE RIVER COM-", "PARED WITH LAKES"]], lines: [] };
  const item: DocBlock = { kind: "list", items: [{ depth: 1, marker: "-", spans: [{ text: "Sand settles behind every bar." }] }] };
  const word = freeScores(wordPdf, flatten({ blocks: [item, para("THE RIVER COMPARED WITH LAKES")] })).coverage;
  check("free: a hollow bullet's o and a hyphen in capitals are no missing words", near(word.recall, 1) && near(word.precision, 1), `recall ${word.recall}, precision ${word.precision}`);
  // A Word file's contents list, built from its headings where LibreOffice's PDF leaves the field empty.
  const contents: DocBlock = { kind: "list", role: "contents", items: [{ depth: 0, marker: "1", spans: [{ text: "Dam wall readings" }] }] };
  const withContents = flatten({ blocks: [item, para("THE RIVER COMPARED WITH LAKES"), contents] });
  const asWord = freeScores(wordPdf, withContents, undefined, true).coverage;
  const asPdf = freeScores(wordPdf, withContents).coverage;
  check("free: a Word file's contents list is no extra word; a PDF's is", near(asWord.precision, 1) && (asPdf.precision ?? 1) < 1, `word ${asWord.precision}, pdf ${asPdf.precision}`);
  const blindPdf: PdfText = { ...pdf, raw: [["small"]], lines: [] };
  const blind = freeScores(blindPdf, flatten({ blocks: [para("Words the text layer reads none of on this page.")] })).coverage;
  check("free: a text layer that reads fewer than half the candidate's words scores no coverage", blind.blind && blind.f1 === null && blind.recall === null, JSON.stringify(blind));
  // A table cell's word with its raised note mark, which the text layer reads apart.
  const markPdf: PdfText = { ...pdf, raw: [["Storage 2", "The yard grew."]], lines: [] };
  const cell: DocBlock = { kind: "table", rows: [{ cells: [{ spans: [{ text: "Storage" }, { text: "2", sup: true }] }] }] };
  const marked = freeScores(markPdf, flatten({ blocks: [cell, para("The yard grew.")] })).coverage;
  check("free: a word and its raised mark count whether the text layer joins them or not", near(marked.recall, 1) && near(marked.precision, 1), `recall ${marked.recall}, precision ${marked.precision}`);
  // Word's math letters, which its text layer reads twice.
  const doubled = freeScores({ ...pdf, raw: [["Let 𝑝𝑝 and εε be small."]], lines: [] }, flatten({ blocks: [para("Let 𝑝 and ε be small.")] })).coverage;
  check("free: a math letter the text layer reads twice is one letter", near(doubled.recall, 1) && near(doubled.precision, 1), `recall ${doubled.recall}, precision ${doubled.precision}`);
  // A page number printed with a period ("54."): the candidate's line of it is a page-number line.
  const numbered = freeScores({ ...pdf, raw: [["The yard grew."]], lines: [] }, flatten({ blocks: [para("The yard grew."), para("54.")] }));
  // Symbol fonts the text layer reads as letters: a Wingdings ◆ read "u", Symbol's α read as a private-use character.
  const symbolLine = line("u The yard grew \uf061 wide.", 100);
  const symbolPdf: PdfText = {
    ...pdf,
    raw: [[symbolLine.text]],
    lines: [symbolLine],
    symbols: [
      { page: 1, word: "u", reads: "", line: symbolLine },
      { page: 1, word: "\uf061", reads: "α", line: symbolLine },
    ],
  };
  const symbolic = freeScores(symbolPdf, flatten({ blocks: [para("◆ The yard grew α wide.")] })).coverage;
  check("free: a symbol font's character counts as the page draws it, not as the text layer's letter", near(symbolic.recall, 1) && near(symbolic.precision, 1), `recall ${symbolic.recall}, precision ${symbolic.precision}`);
  check("free: a line that is a page number and a period counts as a page-number line", numbered.numberLines.count === 1, `count ${numbered.numberLines.count}`);
}
{
  const ROLE_REF: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: "CHAPTER 1" }], align: "center" },
    { kind: "paragraph", spans: [{ text: "Definition", smallCaps: true }, { text: " A river is a channel with water in it most of the year." }], indent: "first" },
    { kind: "list", items: [{ depth: 0, marker: "☑", checked: true, spans: [{ text: "Measure the gauge at dawn" }] }, { depth: 0, marker: "☐", checked: false, spans: [{ text: "Measure the gauge at dusk" }] }] },
    { kind: "figure", caption: [{ text: "Figure 1: The river at the upper gauge." }] },
    { kind: "separator" },
    { kind: "paragraph", spans: [{ text: "The last words of the page stand after a rule drawn across the column." }] },
  ];
  const good: ParsedBlock[] = [
    { type: "PARAGRAPH", text: "CHAPTER 1", html: '<p class="center">CHAPTER 1</p>', page: 1 },
    { type: "PARAGRAPH", text: "Definition A river is a channel with water in it most of the year.", page: 1, styles: [{ start: 0, end: 10, style: "smallCaps", quotedText: "Definition" }] },
    { type: "LIST", text: "- ☑ Measure the gauge at dawn\n- [ ] Measure the gauge at dusk", page: 1 },
    { type: "FIGURE", text: "Figure 1: The river at the upper gauge.", page: 1, region: { x: 10, y: 10, w: 50, h: 30 } as never },
    { type: "SEPARATOR", text: "", page: 1 },
    { type: "PARAGRAPH", text: "The last words of the page stand after a rule drawn across the column.", page: 1 },
  ];
  const s = score({ blocks: ROLE_REF }, [], fromParse({ title: null, blocks: good })).scores;
  check("roles: alignment, captions, checkbox states, and separators score 1", near(s.roles.align, 1) && near(s.roles.captions, 1) && near(s.roles.checks, 1) && near(s.roles.separators, 1), JSON.stringify(s.roles));
  check("styles: small caps scores 1", near(s.styles.f1.smallCaps, 1), `smallCaps ${s.styles.f1.smallCaps}`);
  check("roles: an indent no parse marks scores 0", near(s.roles.indent, 0), `indent ${s.roles.indent}`);
  const bad: ParsedBlock[] = [
    { type: "PARAGRAPH", text: "CHAPTER 1", page: 1 },
    { type: "PARAGRAPH", text: "Definition A river is a channel with water in it most of the year.", page: 1 },
    { type: "LIST", text: "- ☐ Measure the gauge at dawn\n- Measure the gauge at dusk", page: 1 },
    { type: "PARAGRAPH", text: "Figure 1: The river at the upper gauge.", page: 1 },
    { type: "PARAGRAPH", text: "The last words of the page stand after a rule drawn across the column.", page: 1 },
  ];
  const b = score({ blocks: ROLE_REF }, [], fromParse({ title: null, blocks: bad })).scores;
  check("roles: a lost center, caption, box state, and rule score 0", near(b.roles.align, 0) && near(b.roles.captions, 0) && near(b.roles.checks, 0) && near(b.roles.separators, 0), JSON.stringify(b.roles));
  check("styles: lost small caps score 0", near(b.styles.f1.smallCaps, 0), `smallCaps ${b.styles.f1.smallCaps}`);
  const indented: RichNode = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "CHAPTER 1" }] },
      { type: "paragraph", attrs: { indentFirstLine: 18 }, content: [{ type: "text", text: "Definition", marks: [{ type: "smallCaps" }] }, { type: "text", text: " A river is a channel with water in it most of the year." }] },
    ],
  };
  const i = score({ blocks: ROLE_REF.slice(0, 2) }, [], fromImport(indented)).scores;
  check("roles: an import's first-line indent and small caps score 1", near(i.roles.indent, 1) && near(i.styles.f1.smallCaps, 1) && near(i.roles.align, 1), `${JSON.stringify(i.roles)} smallCaps ${i.styles.f1.smallCaps}`);
}

// ── The page's look: styles, alignment, fonts ──────────────────────────────

{
  // Strikethrough, a text color, a highlight; a link's underline and color are the link's.
  const LOOK_REF: RefBlock[] = [
    {
      kind: "paragraph",
      spans: [
        { text: "The gauge read " },
        { text: "four meters", strike: true },
        { text: " five meters at dawn, " },
        { text: "above the flood line", color: "#cc0000" },
        { text: ", and the " },
        { text: "levee held", highlight: "#ffff00" },
        { text: " through the night. See the " },
        { text: "river report", href: "https://example.com/river" },
        { text: " for the hourly readings." },
      ],
    },
  ];
  const look = (spans: Span[]) => score({ blocks: LOOK_REF }, [], { blocks: [{ kind: "paragraph", spans }] }).scores.styles;
  const same = look((LOOK_REF[0] as { spans: Span[] }).spans.map((s) => (s.href ? { ...s, underline: true, color: "#1155cc" } : s)));
  check(
    "styles: strike, color, and highlight score 1; a link's underline and blue are no style",
    near(same.f1.strike, 1) && near(same.f1.color, 1) && near(same.f1.highlight, 1) && same.f1.underline === null,
    JSON.stringify(same.f1),
  );
  const off = look(
    (LOOK_REF[0] as { spans: Span[] }).spans.map((s) => (s.strike ? { text: s.text } : s.color ? { ...s, color: "#0000cc" } : s.highlight ? { ...s, highlight: "#fde047" } : s)),
  );
  check(
    "styles: a lost strike scores 0, a red read as blue and a yellow read as a paler yellow are wrong",
    near(off.f1.strike, 0) && near(off.f1.color, 0) && near(off.f1.highlight, 0),
    JSON.stringify(off.f1),
  );
  // A paragraph set gray as a whole: its gray is the block's color, which the fonts metric scores, whether
  // the words carry it (the reference, an import's marks) or the block's font does (a parse).
  const GRAY_REF: RefBlock[] = [{ kind: "paragraph", spans: [{ text: "Prepared in March from the gauge log.", color: "#595959" }], font: { shape: "sans", size: 9, color: "#595959" } }];
  const grayCand: DocBlock[] = [{ kind: "paragraph", spans: [{ text: "Prepared in March from the gauge log." }], font: { shape: "sans", size: 9, color: "#595959" } }];
  const gray = score({ blocks: GRAY_REF, fonts: { body: { shape: "sans", size: 10.5 } } }, [], { blocks: grayCand }).scores.styles;
  check("styles: a block's own color on its words is no colored run", gray.f1.color === null, JSON.stringify(gray.f1));
  const parsed = fromParse({
    title: null,
    blocks: [
      {
        type: "PARAGRAPH",
        text: "old new red marked",
        page: 1,
        styles: [
          { start: 0, end: 3, style: "strike", quotedText: "old" },
          { start: 8, end: 11, style: "color:#cc0000", quotedText: "red" },
          { start: 12, end: 18, style: "highlight:#ffff00", quotedText: "marked" },
          { start: 4, end: 7, style: "color:#1a1a1a", quotedText: "new" },
        ],
      },
    ],
  }).blocks[0];
  const got = parsed.kind === "paragraph" ? parsed.spans.map((s) => `${s.text.trim()}${s.strike ? "~" : ""}${s.color ?? ""}${s.highlight ? `^${s.highlight}` : ""}`).join("|") : "";
  check("parse: strike, color, and highlight styles are read; near-black is no color", got === "old~|new|red#cc0000||marked^#ffff00", got);
  const imported = fromImport({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "old", marks: [{ type: "strike" }] },
          { type: "text", text: " red", marks: [{ type: "textStyle", attrs: { color: "#CC0000" } }] },
          { type: "text", text: " marked", marks: [{ type: "textStyle", attrs: { backgroundColor: "rgb(255, 255, 0)" } }] },
        ],
      },
    ],
  }).blocks[0];
  const read = imported.kind === "paragraph" ? imported.spans.map((s) => `${s.text.trim()}${s.strike ? "~" : ""}${s.color ?? ""}${s.highlight ? `^${s.highlight}` : ""}`).join("|") : "";
  check("import: the strike mark, a text color, and a background color are read", read === "old~|red#cc0000|marked^#ffff00", read);
}
{
  // Alignment: titles, headings, and paragraphs; justified only where a wrap shows it.
  const long = "The channel widens below the second bend, where the current slows and drops the gravel it carried from the hills.";
  const ALIGN_REF: RefBlock[] = [
    { kind: "title", spans: [{ text: "River notes" }], align: "center" },
    { kind: "paragraph", spans: [{ text: "Summer survey" }], align: "center" },
    { kind: "paragraph", spans: [{ text: long }], align: "justify" },
    { kind: "paragraph", spans: [{ text: "A short line of the same column." }], align: "justify" },
  ];
  const run = (blocks: DocBlock[], ref = ALIGN_REF) => score({ blocks: ref }, [], { blocks }).scores.roles.align;
  const right: DocBlock[] = [
    { kind: "title", spans: [{ text: "River notes" }], align: "center" },
    { kind: "heading", level: 2, spans: [{ text: "Summer survey" }], align: "center" },
    { kind: "paragraph", spans: [{ text: long }], align: "justify" },
    { kind: "paragraph", spans: [{ text: "A short line of the same column." }] },
  ];
  check("roles: a centered title and a centered line read as a heading keep their alignment; a short line may drop justify", near(run(right), 1), `align ${run(right)}`);
  const flat = right.map((b) => ("align" in b ? { ...b, align: undefined } : b)) as DocBlock[];
  check("roles: a lost center and a lost justify count", near(run(flat), 0), `align ${run(flat)}`);
  const misses = score({ blocks: ALIGN_REF }, [], { blocks: flat }).scores.roles.misses.align.map((m) => `${m.ref}→${m.cand}`);
  check("roles: the detail lists each block aligned wrong", misses.join(",") === "center→left,center→left,justify→left", misses.join(","));
  const unjustified = ALIGN_REF.map((b) => (b.kind === "paragraph" && b.align === "justify" ? { ...b, align: undefined } : b)) as RefBlock[];
  check("roles: justify is not scored where the reference justifies nothing", near(run(right, unjustified), 1), `align ${run(right, unjustified)}`);
  const heading = fromParse({ title: "River notes", titleAlign: "center", blocks: [{ type: "HEADING", text: "Summer survey", html: '<h2 class="center">Summer survey</h2>', page: 1 }] }).blocks;
  check("parse: the title's and a heading's alignment are read", heading[0].kind === "title" && heading[0].align === "center" && heading[1].kind === "heading" && heading[1].align === "center", JSON.stringify(heading));
}
{
  // Headings: an invented heading counts against them.
  const s = run(edit((b) => (b[8] = { kind: "heading", level: 2, spans: (b[8] as { spans: Span[] }).spans })));
  check("headings: a paragraph read as a heading lowers the heading score", s.headings.cand === 3 && s.headings.right === 2 && (s.parts.headings ?? 1) < 1, `${s.headings.right} of ${s.headings.cand}, score ${s.parts.headings}`);
}
{
  // Fonts: each role's shape, size (the body's in points, the others' as a ratio to the body), bold, and color.
  const serif = (size: number, bold = false, color?: string) => ({ shape: "serif" as const, size, ...(bold ? { bold: true as const } : {}), ...(color ? { color } : {}) });
  const sans = (size: number, bold = false) => ({ shape: "sans" as const, size, ...(bold ? { bold: true as const } : {}) });
  const FONT_REF: Doc = {
    fonts: { body: serif(10), title: serif(20, true), h2: serif(12, true, "#1f3864"), caption: serif(8), footnote: serif(8) },
    blocks: [
      { kind: "title", spans: [{ text: "Notes on river flow" }] },
      { kind: "heading", level: 2, spans: [{ text: "Channels and banks" }] },
      { kind: "paragraph", spans: [{ text: "A channel carries water from its source to its mouth, and its banks shape the flow." }] },
      { kind: "paragraph", spans: [{ text: "The author line of the survey" }], font: serif(11) },
      { kind: "figure", caption: [{ text: "Figure 1: The gauge at the upper bridge." }] },
      { kind: "footnote", label: "1", spans: [{ text: "Measured at dawn in the dry season." }] },
    ],
  };
  const fonts = (cand: Doc) => score(FONT_REF, [], cand).scores.fonts;
  const same: Doc = structuredClone(FONT_REF);
  same.blocks.forEach((b) => {
    const role = b.kind === "title" ? "title" : b.kind === "heading" ? "h2" : b.kind === "figure" ? "caption" : b.kind === "footnote" ? "footnote" : "body";
    if ("font" in b && b.font) return;
    Object.assign(b, { font: FONT_REF.fonts?.[role] });
  });
  const exact = fonts(same);
  check("fonts: every role's font right scores 1", near(exact?.score ?? 0, 1), JSON.stringify(exact?.roles));
  // The same page drawn a tenth larger throughout: the ratios hold, the body's size does not.
  const scaled: Doc = structuredClone(same);
  scaled.blocks.forEach((b) => "font" in b && b.font && (b.font = { ...b.font, size: b.font.size * 1.25 }));
  const big = fonts(scaled);
  check("fonts: a body a quarter larger is wrong, every other role's ratio right", near(big?.roles.body?.size ?? -1, 0) && near(big?.roles.h2?.size ?? -1, 1) && near(big?.roles.title?.size ?? -1, 1), JSON.stringify(big?.roles));
  const shapes: Doc = structuredClone(same);
  shapes.blocks.forEach((b) => "font" in b && b.font && (b.font = sans(b.font.size, Boolean(b.font.bold))));
  const wrongShape = fonts(shapes);
  check("fonts: sans where the page sets serif is wrong in every role, and the heading's color is lost", near(wrongShape?.shape ?? -1, 0) && near(wrongShape?.roles.h2?.color ?? -1, 0), JSON.stringify(wrongShape?.roles));
  const unknown: Doc = { blocks: FONT_REF.blocks.map((b) => ({ ...b, font: undefined })) as DocBlock[] };
  const none = fonts(unknown);
  check("fonts: a candidate that says no font scores 0", near(none?.score ?? -1, 0) && none?.roles.body?.known === 0, JSON.stringify(none?.roles));
  // A hand reference marks a bold paragraph on its words, not with a font: the paragraph's font is the body's, bold.
  const BOLD_REF: Doc = { fonts: { body: serif(10) }, blocks: [{ kind: "paragraph", spans: [{ text: "Vision: a gauge on every bridge by spring.", bold: true }] }] };
  const boldPara = score(BOLD_REF, [], { blocks: [{ kind: "paragraph", spans: [{ text: "Vision: a gauge on every bridge by spring.", bold: true }], font: serif(10, true) }] }).scores.fonts;
  check("fonts: a reference block bold in its words and with no font of its own wants its role's font, bold", near(boldPara?.roles.body?.bold ?? -1, 1), JSON.stringify(boldPara?.roles));
  const noFonts = score({ blocks: FONT_REF.blocks }, [], same).scores;
  check("fonts: a reference without fonts leaves the part unscored", noFonts.fonts === null && noFonts.parts.fonts === null);
  // The import: named styles and marks as drawn.
  const styles = { namedStyleNormal: JSON.stringify({ font: "Times New Roman", size: 10 }), namedStyleH2: JSON.stringify({ size: 12, bold: true, color: "#1f3864" }) };
  const doc: RichNode = {
    type: "doc",
    attrs: styles,
    content: [
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Channels and banks" }] },
      { type: "paragraph", attrs: { textAlign: "justify" }, content: [{ type: "text", text: "A channel carries water from its source to its mouth, and its banks shape the flow." }] },
      { type: "paragraph", content: [{ type: "text", text: "Small print", marks: [{ type: "textStyle", attrs: { fontSize: "8pt", fontFamily: "Courier New" } }] }] },
    ],
  };
  const drawn = fromImport(doc);
  const faces = drawn.blocks.map((b) => ("font" in b && b.font ? `${b.font.shape} ${b.font.size}${b.font.bold ? " bold" : ""}${b.font.color ? ` ${b.font.color}` : ""}` : "?")).join(" | ");
  check(
    "import: a block's font is its named style under its marks, its alignment its own",
    faces === "serif 12 bold #1f3864 | serif 10 | mono 8" && drawn.fonts?.body.size === 10 && drawn.blocks[0].kind === "heading" && drawn.blocks[0].align === "center" && drawn.blocks[1].kind === "paragraph" && drawn.blocks[1].align === "justify",
    `${faces}; body ${JSON.stringify(drawn.fonts?.body)}`,
  );
  const parsedFonts = fromParse({
    title: "Notes on river flow",
    titleFont: { family: "Times New Roman", size: 20, bold: true },
    bodyFont: { family: "Times New Roman", size: 10 },
    blocks: [{ type: "PARAGRAPH", text: "A channel carries water.", page: 1, font: { family: "Courier New", size: 9, color: "#CC0000" } }],
  });
  const parsedFaces = parsedFonts.blocks.map((b) => ("font" in b && b.font ? `${b.font.shape} ${b.font.size}${b.font.bold ? " bold" : ""}${b.font.color ? ` ${b.font.color}` : ""}` : "?")).join(" | ");
  check("parse: the title's, the body's, and a block's fonts are read by shape", parsedFaces === "serif 20 bold | mono 9 #cc0000" && parsedFonts.fonts?.body.shape === "serif", parsedFaces);
}

// ── Glyph checks ────────────────────────────────────────────────────────────

{
  // A page 600 × 800 pt: x² in math italic with a raised small 2, a relation
  // drawn as \not over "=", and a calligraphic F the text layer reads as "F".
  const g = (family: Glyph["family"], code: number, unicode: string, x: number, y: number, size = 10): Glyph => ({
    font: family ?? "f",
    base: family ?? "Helvetica",
    family,
    code,
    unicode,
    x,
    y,
    w: 5,
    size,
    mode: 0,
  });
  const page: PageGlyphs = {
    width: 600,
    height: 800,
    glyphs: [g("oml", 0x78, "x", 100, 400), g("ot1", 0x32, "2", 106, 403.6, 7), g("oms", 0x36, "6", 200, 400), g("ot1", 0x3d, "=", 200, 400), g("oms", 0x46, "F", 300, 400)],
  };
  const whole = { kind: "path" as const, points: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][] };
  const around = (x1: number, x2: number) => ({ kind: "path" as const, points: [[x1, 45], [x2, 45], [x2, 55], [x1, 55]] as [number, number][] });
  const doc = (text: string, blocks: DocBlock[] = []): Doc => ({ blocks: [{ kind: "paragraph", spans: [{ text }] }, ...blocks] });
  const right = glyphScores([page], doc("x2 ≠ ℱ"), undefined);
  const wrong = glyphScores([page], doc("x2 6= F"), undefined);
  check("glyphs: symbols the text layer misreads, printed right, are no garbles", right.hazards === 2 && right.garbles === 0, JSON.stringify(right.missing));
  check("glyphs: \\not read as 6 and ℱ read as F count as two garbles", wrong.garbles === 2, JSON.stringify(wrong.missing));
  const eq = (latex: string): DocBlock => ({ kind: "equation", latex, at: { page: 1, region: around(16, 18) } });
  const sup = glyphScores([page], doc("", [eq("x^{2}")]), undefined);
  check("glyphs: x^{2} draws the region's symbols at their levels", sup.checked === 1 && sup.passed === 1, JSON.stringify(sup.fails));
  const flat = glyphScores([page], doc("", [eq("x2")]), undefined);
  check("glyphs: x2 puts the 2 at the wrong level", flat.checked === 1 && flat.passed === 0, JSON.stringify(flat.fails));
  const neq = glyphScores([page], doc("", [{ kind: "equation", latex: "a \\neq b", at: { page: 1, region: around(32, 35) } }]), undefined);
  check("glyphs: \\not over = is \\neq, and a stray symbol fails", neq.checked === 1 && neq.passed === 0 && neq.fails[0].extra.length > 0, JSON.stringify(neq.fails));
  const justNeq = glyphScores([page], doc("", [{ kind: "equation", latex: "\\neq", at: { page: 1, region: around(32, 35) } }]), undefined);
  check("glyphs: \\not over = passes as \\neq", justNeq.passed === 1, JSON.stringify(justNeq.fails));
  const picture = glyphScores([page], doc("", [{ kind: "figure", at: { page: 1, region: whole } }]), undefined);
  check("glyphs: a figure over TeX math glyphs is an equation shown as a picture", picture.mathImages === 1);
  const blackboard: PageGlyphs = { width: 600, height: 800, glyphs: [g("msb", 0x52, "R", 100, 400)] };
  const reals = glyphScores([blackboard], doc("", [{ kind: "equation", latex: "x \\in \\mathbb{R}" }]), undefined);
  check("glyphs: \\mathbb{R} in an equation prints ℝ", reals.hazards === 1 && reals.garbles === 0, JSON.stringify(reals.missing));
  const parsed: Doc = { blocks: [eq("x^{2}"), { kind: "equation", latex: "a \\neq b", at: { page: 1, region: around(32, 35) } }] };
  const imported: Doc = { blocks: [{ kind: "equation", latex: "a \\neq b" }, { kind: "equation", latex: "y" }] };
  placeEquations(parsed, imported);
  check("glyphs: an import's equation takes the region of the parse's with its LaTeX", imported.blocks[0].at === parsed.blocks[1].at && imported.blocks[1].at === undefined);
  const figure = fromImport({
    type: "doc",
    content: [{ type: "figure", attrs: { caption: "x2", page: 1, region: JSON.stringify(whole), pageStart: 1 } }],
  });
  check("glyphs: an import's figure keeps its page and region", figure.blocks[0]?.at?.page === 1 && figure.blocks[0].at.region.kind === "path");
  // A display's crop with no caption (the import's) or a garbled one (the parse's) shows its symbols as the
  // page draws them: none is lost or misread.
  const cropped = (caption: string | undefined) => glyphScores([page], doc("x2", [{ kind: "figure", ...(caption === undefined ? {} : { mathImage: caption }), at: { page: 1, region: around(32, 52) } }]), undefined);
  check("glyphs: a crop's symbols count as printed, captioned or not", cropped(undefined).garbles === 0 && cropped("6= F").garbles === 0, `${JSON.stringify(cropped(undefined).missing)} ${JSON.stringify(cropped("6= F").missing)}`);
  // A cmex brace hangs below its origin, which stands at its top: a crop whose region starts just under the top
  // holds it whole.
  const braced: PageGlyphs = { width: 600, height: 800, glyphs: [g("omx", 40, "(", 390, 444), g("oml", 0x78, "x", 400, 400)] };
  const brace = glyphScores([braced], doc("", [{ kind: "figure", at: { page: 1, region: around(60, 70) } }]), undefined);
  check("glyphs: a crop holds the cmex brace that hangs into it", brace.hazards === 1 && brace.garbles === 0, JSON.stringify(brace.missing));
  // A cmex ∑ set at a script's size (an exponent's) is at the script's level; a norm's bars are one symbol
  // however KaTeX draws them (‖ or ∥).
  const exponent: PageGlyphs = { width: 600, height: 800, glyphs: [g("oml", 0x78, "x", 100, 400), g("omx", 0x50, "∑", 106, 404, 7), g("oml", 0x64, "d", 112, 404, 7)] };
  const scriptSum = glyphScores([exponent], doc("", [{ kind: "equation", latex: "x^{\\sum d}", at: { page: 1, region: around(15, 20) } }]), undefined);
  check("glyphs: a cmex glyph set at a script's size takes the script's level", scriptSum.checked === 1 && scriptSum.passed === 1, JSON.stringify(scriptSum.fails));
  const bars: PageGlyphs = { width: 600, height: 800, glyphs: [g("oms", 0x6b, "k", 100, 400), g("oml", 0x78, "x", 106, 400), g("oms", 0x6b, "k", 112, 400)] };
  // A candidate's LaTeX may hold ‖ itself, which KaTeX draws with a warning about its metrics: kept out of the output.
  const warn = console.warn;
  console.warn = () => {};
  const norm = glyphScores([bars], doc("", [{ kind: "equation", latex: "‖x‖", at: { page: 1, region: around(15, 20) } }]), undefined);
  console.warn = warn;
  check("glyphs: a norm's bars drawn as ‖ or ∥ are one symbol", norm.checked === 1 && norm.passed === 1, JSON.stringify(norm.fails));
  // ⟺ drawn as ⇐ and ⇒ overlapping by 3 mu (TeX's \Longleftrightarrow), which also opens ⟸ with "=".
  const iff: PageGlyphs = { width: 600, height: 800, glyphs: [g("oml", 0x61, "a", 90, 400), { ...g("oms", 0x28, "⇐", 100, 400), w: 10 }, { ...g("oms", 0x29, "⇒", 108.3, 400), w: 10 }, g("oml", 0x62, "b", 120, 400)] };
  const joined = glyphScores([iff], doc("", [{ kind: "equation", latex: "a \\Longleftrightarrow b", at: { page: 1, region: around(14, 22) } }]), undefined);
  check("glyphs: ⇐ and ⇒ joined by TeX's overlap are ⟺", joined.checked === 1 && joined.passed === 1, JSON.stringify(joined.fails));
  // A display's printed number "(3)" in its region, set an em and more apart in a text font: the formula is
  // read without it, whether the candidate kept the label or not.
  const numbered: PageGlyphs = { width: 600, height: 800, glyphs: [g("oml", 0x78, "x", 100, 400), g("ot1", 0x28, "(", 500, 400), g("ot1", 0x33, "3", 504, 400), g("ot1", 0x29, ")", 509, 400)] };
  const unlabelled = glyphScores([numbered], doc("", [{ kind: "equation", latex: "x", at: { page: 1, region: around(15, 90) } }]), undefined);
  const labelled = glyphScores([numbered], doc("", [{ kind: "equation", latex: "x", label: "(3)", at: { page: 1, region: around(15, 90) } }]), undefined);
  check("glyphs: a display's printed number is no symbol of its formula", unlabelled.passed === 1 && labelled.passed === 1, `${JSON.stringify(unlabelled.fails)} ${JSON.stringify(labelled.fails)}`);
  // A tall paren KaTeX draws as a picture stands for the cmex paren the page draws; a stacked brace counts once.
  const tall: PageGlyphs = { width: 600, height: 800, glyphs: [g("omx", 0x10, "(", 100, 420), g("omx", 0x5f, "⋁", 110, 420), g("oml", 0x78, "x", 125, 400), g("omx", 0x11, ")", 135, 420)] };
  const pictured = glyphScores([tall], doc("", [{ kind: "equation", latex: "\\left(\\bigvee_{q\\in Q} x\\right)", at: { page: 1, region: around(15, 25) } }]), undefined);
  check("glyphs: a delimiter KaTeX draws as a picture stands for the page's", pictured.fails.every((f) => !f.extra.some((x) => x.startsWith("(delimiter)"))) && pictured.fails.every((f) => !f.missing.some((x) => x.startsWith("(@") || x.startsWith(")@"))), JSON.stringify(pictured.fails));
  const stacked: PageGlyphs = { width: 600, height: 800, glyphs: [g("oml", 0x78, "x", 90, 400), g("ot1", 0x3d, "=", 96, 400), g("omx", 0x38, "", 106, 414), g("omx", 0x3c, "", 106, 404), g("omx", 0x3a, "", 106, 394), g("ot1", 0x30, "0", 116, 410), g("ot1", 0x31, "1", 116, 392)] };
  const cases = glyphScores([stacked], doc("", [{ kind: "equation", latex: "x = \\begin{cases} 0 \\\\ 1 \\end{cases}", at: { page: 1, region: around(14, 22) } }]), undefined);
  check("glyphs: a brace stacked from pieces is one brace on both sides", cases.fails.every((f) => !f.extra.some((x) => /^[⎧⎨⎩]/.test(x)) && !f.missing.some((x) => x.startsWith("{@"))), JSON.stringify(cases.fails));
  // An arrow KaTeX draws as a picture (\xrightarrow) stands for the arrow the page draws.
  const arrowed: PageGlyphs = { width: 600, height: 800, glyphs: [g("oml", 0x61, "a", 90, 400), { ...g("oms", 0x21, "→", 100, 400), w: 10 }, g("oml", 0x62, "b", 114, 400)] };
  const xarrow = glyphScores([arrowed], doc("", [{ kind: "equation", latex: "a \\xrightarrow{} b", at: { page: 1, region: around(14, 22) } }]), undefined);
  check("glyphs: an arrow KaTeX draws as a picture stands for the page's", xarrow.checked === 1 && xarrow.passed === 1, JSON.stringify(xarrow.fails));
  // TeX's \vdots and \ddots: three periods of the text font, in a column and stepping right.
  const dots: PageGlyphs = {
    width: 600,
    height: 800,
    glyphs: [g("ot1", 0x2e, ".", 100, 410), g("ot1", 0x2e, ".", 100, 406), g("ot1", 0x2e, ".", 100, 402), g("ot1", 0x2e, ".", 110, 407), g("ot1", 0x2e, ".", 114, 404), g("ot1", 0x2e, ".", 118, 401)],
  };
  const stackedDots = glyphScores([dots], doc("", [{ kind: "equation", latex: "\\vdots \\ddots", at: { page: 1, region: around(14, 22) } }]), undefined);
  check("glyphs: three periods in a column are ⋮, stepping down right ⋱", stackedDots.checked === 1 && stackedDots.passed === 1, JSON.stringify(stackedDots.fails));
  // A diagram read with its own labels as its caption (no "Figure N"): its ℱ counts once, from its region.
  const labelled2: PageGlyphs = { width: 600, height: 800, glyphs: [g("oms", 0x46, "F", 300, 400), g("oms", 0x46, "F", 300, 300)] };
  const once = glyphScores([labelled2], { blocks: [{ kind: "figure", caption: [{ text: "ℱ loss" }], at: { page: 1, region: around(45, 55) } }, { kind: "paragraph", spans: [{ text: "the ℱ of" }] }] }, undefined);
  check("glyphs: a figure whose caption is its picture's labels counts its symbols once", once.garbles === 0 && once.hazards === 2, JSON.stringify(once.missing));
  // The import's crop of a display has no caption: it is an equation picture where the parse's is one.
  const parseCrops: Doc = { blocks: [{ kind: "figure", mathImage: "6= F", at: { page: 1, region: around(32, 52) } }, { kind: "figure", caption: [{ text: "Figure 1: The dam." }], at: { page: 1, region: whole } }] };
  const importCrops: Doc = { blocks: [{ kind: "figure", at: { page: 1, region: around(32, 52) } }, { kind: "figure", at: { page: 1, region: whole } }] };
  placeCrops(parseCrops, importCrops);
  check(
    "glyphs: an import's uncaptioned figure is a display's crop where the parse's at its place is one",
    importCrops.blocks[0].kind === "figure" && importCrops.blocks[0].mathImage === "" && importCrops.blocks[1].kind === "figure" && importCrops.blocks[1].mathImage === undefined,
  );
}

// ── Words and garbles ───────────────────────────────────────────────────────

check("words: ligatures, soft hyphens, and case normalize", wordsOf("The ﬁnal com­pu­ta­tion").map((w) => w.w).join(" ") === "the final computation");
check("words: a CJK character is a word", wordsOf("河流学 is fun").map((w) => w.w).join(" ") === "河 流 学 is fun");
check("words: Kangxi radicals read as ideographs", wordsOf("⼀").map((w) => w.w).join("") === "一");
const garbleKinds = (t: string) => garblesOf(t).map((g) => g.kind);
check("garbles: CMSY leftovers are found", garbleKinds("n6= m, ω7→ X(ω), A =⇒ B").length === 3);
check("garbles: a 6 after a relation is a number (a fraction read flat)", garbleKinds("z = x − μ σ = 6 = 1.5").length === 0, garbleKinds("z = x − μ σ = 6 = 1.5").join(","));
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
  // The memo's canonical form (P0-F §7): spacing, \\colon, and empty delimiters add nothing.
  ["\\int_0^1 f(x)\\,dx", "\\int_0^1 f(x) dx"],
  ["f\\colon A\\to B", "f: A\\to B"],
  ["\\left. f \\right|_{0}", "f|_{0}"],
  ["\\operatorname{Var}(X)", "\\mathrm{Var}(X)"],
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
  const later = fromParse({ title: "Notes", blocks }, [2, 2], (title) => title === "Notes");
  check("parse: a title whose words stand on the scored pages is scored there", later.blocks[0].kind === "title" && page2.blocks[0].kind !== "title");
  const withBreak = fromParse({ title: null, blocks: [blocks[1]] });
  check("parse: a page start inside a block is a break", withBreak.blocks[0].breaks?.[0]?.at === 19);
  const cells = fromParse({
    title: null,
    blocks: [
      {
        type: "TABLE",
        text: "Table 1: Flows\nCost\tE = mc2",
        html: '<table><caption>Table 1: Flows<span class="cell-gap">\n</span></caption><tbody><tr><td>1.0·10<sup>20</sup> H<sub>2</sub>O<span class="cell-gap">\t</span></td><td><span data-type="inline-math" data-latex="E = mc^2">E = mc2</span></td></tr></tbody></table>',
        page: 1,
      },
    ],
  }).blocks[0];
  const flags = cells.kind === "table" ? cells.rows[0].cells[0].spans.map((s) => `${s.text}${s.sup ? "^" : ""}${s.sub ? "_" : ""}`).join("|") : "";
  const formula = cells.kind === "table" ? cells.rows[0].cells[1].spans[0] : undefined;
  check(
    "parse: a cell keeps its sup and sub, an inline formula its TeX, and the table its caption",
    flags === "1.0·10|20^| H|2_|O" && formula?.latex === "E = mc^2" && formula.text === "E = mc2" && cells.kind === "table" && cells.caption?.[0]?.text.startsWith("Table 1: Flows") === true,
    `${flags} ${JSON.stringify(formula)}`,
  );
}
{
  // The converter's table caption: a centered 9 pt paragraph right before the table.
  const small = (text: string) => ({ type: "text", text, marks: [{ type: "textStyle", attrs: { fontSize: "9pt" } }] });
  const doc: RichNode = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { textAlign: "center" }, content: [small("Table 1: River flows")] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Q" }] }] }] }] },
      { type: "paragraph", content: [small("* All flows are in cubic meters a second.")] },
    ],
  };
  const read = fromImport(doc).blocks;
  check(
    "import: a centered 9 pt paragraph right before a table is its caption",
    read[0]?.kind === "table" && read[0].caption?.map((s) => s.text).join("") === "Table 1: River flows",
    JSON.stringify(read[0]),
  );
  check(
    "import: a small paragraph opening with a note symbol is a footnote",
    read[1]?.kind === "footnote" && read[1].label === "*" && read[1].spans.map((s) => s.text).join("") === "All flows are in cubic meters a second.",
    JSON.stringify(read[1]),
  );
}
{
  // A table cell's colored, highlighted, and struck words (a Word table's cell html).
  const html = '<table><tr><td><span style="color:#00b050"><strong>A</strong></span> grade</td><td><span style="background-color:#ffff00">late</span> <s>old</s></td></tr></table>';
  const table = fromParse({ title: null, blocks: [{ type: "TABLE", text: "A grade\tlate old", html, page: 1 }] }).blocks[0];
  const cells = table?.kind === "table" ? table.rows[0].cells.map((c) => c.spans.map((x) => `${x.text.trim()}${x.color ?? ""}${x.highlight ? `^${x.highlight}` : ""}${x.strike ? "~" : ""}`).filter((t) => t).join("|")).join(" / ") : "";
  check("parse: a table cell's color, highlight, and strikethrough are read", cells === "A#00b050|grade / late^#ffff00|old~", cells);
}
{
  // A table that runs onto the next page: its text opens with the caption's line, so row r is line r + 1; the
  // caption is on its own line's page.
  const text = "Table 3: Unary commands\nBackslash\tbslash\nColon\tcolon";
  const html = "<table><caption>Table 3: Unary commands</caption><tr><td>Backslash</td><td>bslash</td></tr><tr><td>Colon</td><td>colon</td></tr></table>";
  const second = fromParse({ title: null, blocks: [{ type: "TABLE", text, html, page: 1, pageStarts: [{ offset: text.indexOf("Backslash"), page: 2 }] }] }, [2, 2]).blocks[0];
  const got = second?.kind === "table" ? `${second.caption ? "caption " : ""}${second.rows.map((r) => r.cells[0].spans.map((x) => x.text).join("")).join(",")}` : JSON.stringify(second);
  check("parse: a table's rows on a page past its caption's are judged by their own lines, the caption by its own", got === "Backslash,Colon", got);
}
{
  // An affiliation under the authors opens with a raised number in a small size, as an unlinked footnote does:
  // it is a note only once the body has begun. A note symbol the converter set as a formula is the label.
  const small = (text: string, raised = false) => ({ type: "text", text, marks: [{ type: "textStyle", attrs: { fontSize: "8pt" } }, ...(raised ? [{ type: "superscript" }] : [])] });
  const body = "The river rose through the night and the gauge at the upper dam read above the flood line for six hours, so the crews opened the spillway and walked the levee from the dam to the bridge until the water fell again.";
  const doc: RichNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [small("1", true), small("Institute of River Studies, Lakeside.")] },
      { type: "paragraph", content: [{ type: "text", text: body }] },
      { type: "paragraph", content: [small("2", true), small(" Readings are hourly.")] },
      { type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "\\ddagger" } }, small(" Contact the gauge office.")] },
    ],
  };
  const shape = fromImport(doc).blocks.map((b) => (b.kind === "footnote" ? `footnote ${b.label}` : b.kind)).join(", ");
  check("import: an affiliation before the body is no footnote; notes after it are, a formula's symbol their label", shape === "paragraph, paragraph, footnote 2, footnote ‡", shape);
}
{
  // A caption at the body's own size (a page set in 9 pt) still captions its table; a centered small line
  // under a title, far from any table, is a paragraph.
  const sized = (text: string) => ({ type: "text", text, marks: [{ type: "textStyle", attrs: { fontSize: "9pt" } }] });
  const table: RichNode = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Q" }] }] }] }] };
  const doc: RichNode = {
    type: "doc",
    attrs: { namedStyleNormal: JSON.stringify({ font: "Times New Roman", size: 9 }) },
    content: [
      { type: "paragraph", attrs: { textAlign: "center" }, content: [sized("for the year of the survey")] },
      { type: "paragraph", content: [{ type: "text", text: "The gauge log runs from March." }] },
      { type: "paragraph", attrs: { textAlign: "center" }, content: [sized("Fig. 3. The upper gauge.")] },
      { type: "paragraph", content: [{ type: "text", text: "The lake rose in April." }] },
      { type: "paragraph", attrs: { textAlign: "center" }, content: [sized("Table 2: Lake levels")] },
      table,
      { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "(In thousands of liters)", marks: [{ type: "textStyle", attrs: { fontSize: "10pt" } }] }] },
      table,
    ],
  };
  const read = fromImport(doc).blocks;
  const shape = read
    .map((b) => `${b.kind}${b.kind === "paragraph" && b.role ? `/${b.role}` : ""}${b.kind === "paragraph" && b.align ? `/${b.align}` : ""}${b.kind === "table" && b.caption ? `+caption` : ""}`)
    .join(" ");
  check(
    "import: a line right before a table is its caption with a caption's label or a size under the body's; elsewhere only with its label",
    shape === "paragraph/center paragraph paragraph/caption/center paragraph table+caption paragraph/center table",
    shape,
  );
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

// ── The look beyond the words: indents, spacing, labels, the page editor's drawing ──

{
  // amsbook's 5 pt first-line indent, a list's items spaced 4 pt apart, an equation numbered at the left.
  const REF_LOOK: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: "A channel carries water from its source to its mouth, and its banks shape the flow." }], indent: "first", indentPt: { left: 0, first: 5 }, spaceAfter: 6 },
    {
      kind: "list",
      items: [
        { depth: 0, marker: "(a)", spans: [{ text: "Gravel bars form where the current slows down in the bend." }] },
        { depth: 0, marker: "(b)", spans: [{ text: "Sand settles behind every bar the river leaves." }] },
      ],
      itemSpace: 4,
      spaceAfter: 0,
    },
    { kind: "paragraph", spans: [{ text: "The last paragraph closes the section with one more claim." }] },
    { kind: "equation", latex: "x = 1", label: "(1.1)", labelSide: "left" },
  ];
  const parsed = (first: number, itemSpace: number | undefined, leqno: boolean): ParsedBlock[] => [
    { type: "PARAGRAPH", text: "A channel carries water from its source to its mouth, and its banks shape the flow.", html: '<p class="indent-first"></p>', page: 1, indent: { left: 0, first }, spaceAfter: 6 },
    { type: "LIST", text: "(a) Gravel bars form where the current slows down in the bend.\n(b) Sand settles behind every bar the river leaves.", page: 1, spaceAfter: 0, ...(itemSpace !== undefined ? { itemSpace } : {}) },
    { type: "PARAGRAPH", text: "The last paragraph closes the section with one more claim.", page: 1 },
    { type: "EQUATION", text: "x = 1 \\tag{1.1}", page: 1, ...(leqno ? { html: '<p class="leqno"></p>' } : {}) },
  ];
  const right = score({ blocks: REF_LOOK }, [], fromParse({ title: null, blocks: parsed(5, 4, true) })).scores;
  check("look: an indent at the page's size, items spaced as the page, a label at its side score 1", near(right.roles.indentSize, 1) && near(right.roles.spacing, 1) && near(right.math.labels.side.score, 1), `${JSON.stringify(right.roles)} side ${right.math.labels.side.score}`);
  const wrong = score({ blocks: REF_LOOK }, [], fromParse({ title: null, blocks: parsed(36, undefined, false) })).scores;
  check(
    "look: a half-inch indent for 5 pt, tight items, a label at the other side score 0",
    near(wrong.roles.indentSize, 0) && near(wrong.roles.spacing, 2 / 3) && near(wrong.math.labels.side.score, 0) && near(wrong.math.labels.score, 1),
    `${JSON.stringify(wrong.roles)} side ${wrong.math.labels.side.score}`,
  );
  // A justified list whose items wrap: the list's alignment counts where the reference justifies.
  const justified: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: "The river report opens here with a first paragraph long enough to wrap across the column twice at least." }], align: "justify" },
    { kind: "list", align: "justify", items: [{ depth: 0, marker: "(a)", spans: [{ text: "Gravel bars form where the current slows down in the bend, and sand settles behind every bar the river leaves." }] }] },
  ];
  const listed = (html: string | undefined): ParsedBlock[] => [
    { type: "PARAGRAPH", text: "The river report opens here with a first paragraph long enough to wrap across the column twice at least.", html: '<p class="justify"></p>', page: 1 },
    { type: "LIST", text: "(a) Gravel bars form where the current slows down in the bend, and sand settles behind every bar the river leaves.", page: 1, ...(html ? { html } : {}) },
  ];
  const ragged = score({ blocks: justified }, [], fromParse({ title: null, blocks: listed(undefined) })).scores;
  const flush = score({ blocks: justified }, [], fromParse({ title: null, blocks: listed('<ul class="justify"></ul>') })).scores;
  check("look: a list justified where the page justifies its items; ragged is wrong", near(flush.roles.align, 1) && (ragged.roles.align ?? 1) < 1, `justified ${flush.roles.align}, ragged ${ragged.roles.align}`);
  // A justified paragraph that wraps only with its inline formula: the formula counts by the glyphs it draws on
  // every side (an import's formula holds no text), so the paragraph reads as justified on both.
  const opening = "The river report opens here with a first paragraph long enough to wrap across the column twice at least.";
  const before = "Let the variables of the sample be independent, each with mean zero and variance one; then ";
  const formula = "\\mathbf{E}(X_1+\\cdots+X_n)^2=n";
  const withFormula: RefBlock[] = [
    { kind: "paragraph", spans: [{ text: opening }], align: "justify" },
    { kind: "paragraph", spans: [{ text: before }, { text: "E(X1+⋯+Xn)2=n", latex: formula }, { text: " holds." }], align: "justify" },
  ];
  const justifiedImport = fromImport({
    type: "doc",
    content: [
      { type: "paragraph", attrs: { textAlign: "justify" }, content: [{ type: "text", text: opening }] },
      {
        type: "paragraph",
        attrs: { textAlign: "justify" },
        content: [{ type: "text", text: before }, { type: "inlineMath", attrs: { latex: formula } }, { type: "text", text: " holds." }],
      },
    ],
  });
  const glyphs = score({ blocks: withFormula }, [], justifiedImport).scores;
  check("look: a justified paragraph's inline formulas count by the glyphs they draw", near(glyphs.roles.align, 1), `align ${glyphs.roles.align}`);
  // The import: indents and spaces in points, a list's items' own alignment and space, the number's side.
  const text = (t: string, size?: string): RichNode => ({ type: "text", text: t, ...(size ? { marks: [{ type: "textStyle", attrs: { fontSize: size } }] } : {}) });
  const item = (t: string, attrs: Record<string, unknown>): RichNode => ({ type: "listItem", content: [{ type: "paragraph", attrs, content: [text(t)] }] });
  const imported = fromImport({
    type: "doc",
    content: [
      { type: "paragraph", attrs: { indentFirstLine: 5, spaceAfter: 6 }, content: [text("A channel carries water from its source to its mouth, and its banks shape the flow.")] },
      {
        type: "orderedList",
        content: [
          item("Gravel bars form where the current slows down in the bend.", { spaceAfter: 4, textAlign: "justify" }),
          item("Sand settles behind every bar the river leaves.", { textAlign: "justify" }),
        ],
      },
      { type: "paragraph", attrs: { spaceBefore: 2, borderBottom: "0.75 solid #4472c4 1", borderTop: "0 solid #000000 0" }, content: [text("The last paragraph closes the section with one more claim.")] },
      { type: "blockMath", attrs: { latex: "x = 1 \\tag{1.1}", leqno: true } },
      { type: "figure", attrs: { caption: "Figure 1: The river at the upper gauge.", captionStyles: JSON.stringify([{ start: 0, end: 9, style: "bold" }]) } },
    ],
  }).blocks;
  const [p0, l1, p2, e3, f4] = imported;
  check(
    "import: a figure's caption keeps its bold label",
    f4?.kind === "figure" && f4.caption?.[0]?.text === "Figure 1:" && f4.caption[0].bold === true && f4.caption[1]?.bold === undefined,
    JSON.stringify(f4),
  );
  check(
    "import: indents and spaces in points, items' alignment and space, borders, and the label's side",
    p0.kind === "paragraph" && p0.indentPt?.first === 5 && p0.spaceAfter === 6 && l1.kind === "list" && l1.align === "justify" && l1.itemSpace === 4 && l1.spaceAfter === 2 && p2.kind === "paragraph" && p2.borders?.join() === "bottom" && e3.kind === "equation" && e3.labelSide === "left",
    JSON.stringify(imported.map((b) => ({ kind: b.kind, ...("indentPt" in b ? { indentPt: b.indentPt } : {}), ...("spaceAfter" in b ? { spaceAfter: b.spaceAfter } : {}), ...("itemSpace" in b ? { itemSpace: b.itemSpace } : {}), ...(b.borders ? { borders: b.borders } : {}) }))),
  );
  // A scan's notes, which raise no mark: a small paragraph opening with its number once the body has begun.
  const body = "At the end of the war the country lay in ruins, and yet within months its engineers were at work on the captured rockets, reading the drawings left behind in the tunnels and the test stands of the north.";
  const notes = fromImport({
    type: "doc",
    attrs: {},
    content: [
      { type: "paragraph", content: [text(body)] },
      { type: "paragraph", content: [text("2. Anna Berg, Rivers of the North, pp. 44-45.", "9pt")] },
      { type: "paragraph", content: [text("1945 was the year the war ended in Europe and in the Pacific.", "9pt")] },
    ],
  }).blocks;
  check(
    "import: a small paragraph opening with a note's number is a footnote, a year is not",
    notes[1]?.kind === "footnote" && notes[1].label === "2" && notes[2]?.kind === "paragraph",
    JSON.stringify(notes.map((b) => b.kind)),
  );
  // The parse's crop of a display the glyph check failed is an equation image, whatever its words.
  const crop = fromParse({ title: null, blocks: [{ type: "FIGURE", text: "Figure the river", page: 1, mathCrop: true, region: { x: 10, y: 10, w: 50, h: 5 } as never }] }).blocks[0];
  check("parse: a display's crop is an equation image", crop?.kind === "figure" && crop.mathImage !== undefined);
  // KaTeX's 1.21em, and the page editor's rule that sets a formula at its words' size.
  const katexCss = ".katex{font:normal 1.21em KaTeX_Main,Times New Roman,serif;line-height:1.2}.katex *{border-color:currentColor}";
  check(
    "look: a formula draws at KaTeX's 1.21em until the page editor's rule sets 1em",
    formulaScaleOf(katexCss, [".docs-prose .docs-math { display: inline-block; }"]) === 1.21 && formulaScaleOf(katexCss, ["/* a note { } */ .docs-prose .docs-math .katex { font-size: 1em; }"]) === 1,
  );
  // A Word file's borders: a Heading 1's rule under it, a quote's bar beside it.
  const word = [
    { words: "results", sides: ["bottom" as const] },
    { words: "the market moved", sides: ["left" as const] },
    { words: "revenue grew", sides: [] },
  ];
  const drawn = flatten({ blocks: [{ kind: "heading", level: 1, spans: [{ text: "Results" }], borders: ["bottom"] }, { kind: "paragraph", spans: [{ text: "The market moved." }], borders: ["left"] }, para("Revenue grew.")] });
  const bare = flatten({ blocks: [{ kind: "heading", level: 1, spans: [{ text: "Results" }] }, para("The market moved."), para("Revenue grew.")] });
  check("look: a Word file's borders drawn score 1, none drawn 0", near(borderScore(word, drawn), 1) && near(borderScore(word, bare), 0), `${borderScore(word, drawn)} ${borderScore(word, bare)}`);
  // An import's Title and quote blocks draw their borders: a Word Title's rule under it, a quote's bar beside it.
  const paragraph = (text: string, attrs: Record<string, unknown>): RichNode => ({ type: "paragraph", attrs, content: [{ type: "text", text }] });
  const report = (bar: boolean): RichNode => ({
    type: "doc",
    content: [
      paragraph("Annual report", { docStyle: "title", borderBottom: "0.75 solid #4472c4 4" }),
      { type: "heading", attrs: { level: 1, borderBottom: "0.5 solid #000000 1" }, content: [{ type: "text", text: "Results" }] },
      { type: "blockquote", content: [paragraph("The market moved.", bar ? { borderLeft: "1.5 solid #000000 0" } : {})] },
      paragraph("Revenue grew.", {}),
    ],
  });
  const titled = [{ words: "annual report", sides: ["bottom" as const] }, ...word];
  const withBar = borderScore(titled, flatten(fromImport(report(true))));
  const noBar = borderScore(titled, flatten(fromImport(report(false))));
  check("look: an import's Title and quote count their borders", near(withBar, 1) && (noBar ?? 1) < 1, `${withBar} ${noBar}`);
}

{
  // Furniture found by position: a head on every page, a page number that counts, the front matter's
  // roman numbers; and what stands at one height by chance.
  const lines: PdfText["lines"] = [];
  const at = (page: number, top: number, left: number, text: string) => lines.push({ page, top, bottom: top + 10, left, right: left + 6 * text.length, text });
  for (let p = 1; p <= 10; p++) {
    if (p >= 2) at(p, 30, 250, "RIVERS AND LAKES");
    for (const top of [100, 400, 600]) at(p, top, 72, `Body words of page ${p} at ${top}, long enough to be a line of the text.`);
    at(p, 740, 300, p <= 3 ? ["i", "ii", "iii"][p - 1] : String(p));
  }
  at(3, 60, 72, "Introduction");
  at(7, 60, 72, "Introduction");
  for (const [p, left] of [[4, 80], [5, 100], [6, 120]]) at(p, 60, left, "Tip");
  for (const [p, n] of [[5, 2], [6, 11], [8, 13]]) at(p, 45, 72, `Note ${n}.`);
  at(4, 58, 72, "I.");
  const found = new Set(furnitureOf(lines, new Map(Array.from({ length: 10 }, (_, k) => [k + 1, { width: 612, height: 792 }]))).map((l) => `${l.page} ${l.text}`));
  const has = (key: string) => found.has(key);
  check(
    "free: a head on every page and page numbers that count, arabic and roman, are furniture",
    has("5 RIVERS AND LAKES") && has("6 6") && has("2 ii") && has("3 iii"),
    [...found].slice(0, 12).join(" | "),
  );
  check(
    "free: a chapter's heading on pages far apart, a label at other places, notes that do not count, and a chapter's I. are no furniture",
    !has("3 Introduction") && !has("5 Tip") && !has("6 Note 11.") && !has("4 I."),
    [...found].filter((k) => /Introduction|Tip|Note|I\./.test(k)).join(" | "),
  );
  // A page number next to a heading's own words is no leak; one alone is.
  const pageNumber = { page: 2, top: 740, bottom: 750, left: 300, right: 306, text: "2" };
  const numberPdf: PdfText = {
    first: 1,
    pages: 2,
    raw: [["2 VHE OBSERVATIONS", "The telescope saw the source."], ["2"]],
    lines: [
      { page: 1, top: 100, bottom: 110, left: 72, right: 250, text: "2 VHE OBSERVATIONS" },
      { page: 1, top: 130, bottom: 140, left: 72, right: 250, text: "The telescope saw the source." },
      pageNumber,
    ],
    furniture: [pageNumber],
    sizes: new Map([[1, { width: 612, height: 792 }], [2, { width: 612, height: 792 }]]),
    symbols: [],
  };
  const heading: DocBlock = { kind: "heading", level: 1, spans: [{ text: "2 VHE OBSERVATIONS" }] };
  const own = freeScores(numberPdf, flatten({ blocks: [heading, para("The telescope saw the source.")] })).furniture;
  const leaked = freeScores(numberPdf, flatten({ blocks: [heading, para("The telescope saw the source."), para("2")] }));
  check("free: a heading's number is its own; a page number alone leaks and is a page-number line", own.leaked === 0 && leaked.furniture.leaked === 1 && leaked.numberLines.count === 1, `${own.leaked} ${leaked.furniture.leaked} ${leaked.numberLines.count}`);
  // A figure's region that reaches up to the running head: the crop draws it, a leak.
  const head = { page: 1, top: 30, bottom: 40, left: 200, right: 400, text: "RIVERS AND LAKES" };
  const headPdf: PdfText = { ...numberPdf, pages: 1, raw: [["RIVERS AND LAKES", "The telescope saw the source."]], lines: [head, numberPdf.lines[1]], furniture: [head] };
  const figureAt = (top: number): DocBlock => ({ kind: "figure", at: { page: 1, region: { kind: "path", points: [[10, top], [90, top], [90, 40], [10, 40]] } } });
  const tall = freeScores(headPdf, flatten({ blocks: [figureAt(3), para("The telescope saw the source.")] })).furniture;
  const short = freeScores(headPdf, flatten({ blocks: [figureAt(10), para("The telescope saw the source.")] })).furniture;
  check("free: a running head inside a figure's region leaks; below it, none", tall.leaked === 1 && tall.found[0]?.pictured === 1 && short.leaked === 0, `${tall.leaked} ${short.leaked}`);
  // A chart's label a run of pages repeats inside the body is no running head, whatever the furniture finder says.
  const tick = { page: 1, top: 300, bottom: 310, left: 200, right: 220, text: "0.8" };
  const below = { page: 1, top: 500, bottom: 510, left: 72, right: 250, text: "The dam held the flood." };
  const chartPdf: PdfText = { ...headPdf, raw: [["RIVERS AND LAKES", "The telescope saw the source.", "0.8", "The dam held the flood."]], lines: [head, numberPdf.lines[1], tick, below], furniture: [head, tick] };
  const chart: DocBlock = { kind: "figure", at: { page: 1, region: { kind: "path", points: [[10, 30], [90, 30], [90, 60], [10, 60]] } } };
  const ticked = freeScores(chartPdf, flatten({ blocks: [para("The telescope saw the source."), chart, para("The dam held the flood.")] })).furniture;
  check("free: a furniture line inside the body of a figure (a chart's tick) is no leak", ticked.leaked === 0, `leaked ${ticked.leaked}`);
  // A section's title that the running head repeats on every page: its heading holds the head's words, once.
  const sectionHead = { page: 2, top: 20, bottom: 30, left: 200, right: 400, text: "Section 1 River gauges" };
  const sectionPdf: PdfText = { ...numberPdf, pages: 2, raw: [["The telescope saw the source."], ["Section 1 River gauges"]], lines: [numberPdf.lines[1], sectionHead], furniture: [sectionHead] };
  const titled = freeScores(sectionPdf, flatten({ blocks: [{ kind: "heading", level: 1, spans: [{ text: "Section 1 River gauges" }] }, para("The telescope saw the source.")] })).furniture;
  const leakedHead = freeScores(sectionPdf, flatten({ blocks: [{ kind: "heading", level: 1, spans: [{ text: "Section 1 River gauges" }] }, para("The telescope saw the source."), para("Section 1 River gauges")] })).furniture;
  check("free: a section's heading the running head repeats is its own words, once", titled.leaked === 0 && leakedHead.leaked === 1, `${titled.leaked} ${leakedHead.leaked}`);
  // A tab set sideways at the page's edge names the section, and a line of the contents names it too: no leak.
  const tab = { page: 2, top: 60, bottom: 240, left: 560, right: 590, text: "river gauges" };
  const tabPdf: PdfText = { ...numberPdf, pages: 2, raw: [["River gauges", "The telescope saw the source."], ["river gauges"]], lines: [numberPdf.lines[1], tab], furniture: [tab] };
  const tabbed = freeScores(tabPdf, flatten({ blocks: [para("River gauges"), para("The telescope saw the source.")] })).furniture;
  const runningHead = { ...tab, top: 20, bottom: 30, left: 200, right: 400 };
  const across = freeScores({ ...tabPdf, lines: [numberPdf.lines[1], runningHead], furniture: [runningHead] }, flatten({ blocks: [para("River gauges"), para("The telescope saw the source.")] })).furniture;
  check("free: a tab set sideways leaks nothing; the same words as a running head leak", tabbed.leaked === 0 && across.leaked === 1, `leaked ${tabbed.leaked} ${across.leaked}`);
  // A display read as words holds a line "12": no page-number line.
  const display = freeScores({ ...numberPdf, furniture: [] }, flatten({ blocks: [para("MSE = 1\n12\nI=0")] }));
  check("free: a number on a line inside a block is no page-number line", display.numberLines.count === 0, `count ${display.numberLines.count}`);
}

// ── The page's own lines: columns, indents, tables, figures, crops, faces, labels ──

{
  // A page of two columns, each line of prose: the left column's lines at x 72, the right's at x 320.
  const L = ["The river rises in the hills above the town and", "runs west through the valley to the lake below", "where the old mill stood until the flood of", "the year the bridge was built across the gorge"];
  const R = ["Gauges along the bank record the water level", "every hour and send their readings to the office", "where the engineers compare them with the rain", "that fell on the hills during the night before"];
  const lines: PdfText["lines"] = [...L.map((text, i) => ({ page: 1, top: 100 + 14 * i, bottom: 110 + 14 * i, left: 72, right: 290, text })), ...R.map((text, i) => ({ page: 1, top: 100 + 14 * i, bottom: 110 + 14 * i, left: 320, right: 540, text }))];
  const pdf: PdfText = { first: 1, pages: 1, raw: [[...L, ...R]], lines, furniture: [], sizes: new Map([[1, { width: 612, height: 792 }]]), symbols: [] };
  const across = flatten({ blocks: [para(L.flatMap((l, i) => [l, R[i]]).join(" "))] });
  const read = flatten({ blocks: [para(L.join(" ")), para(R.join(" "))] });
  const wrong = columnScores(pdf, across, linesOfUnits(pdf, across));
  const right = columnScores(pdf, read, linesOfUnits(pdf, read));
  check("layout: two columns read line by line across the gutter are read across; column by column, in order", wrong.across === 8 && near(right.score, 1), `across ${wrong.across}, in order ${right.score}`);
  // The same lines as a table's cells, a row a line, one sentence running on down each column: prose in a table.
  const cells = (texts: string[][]) => flatten({ blocks: [{ kind: "table", rows: texts.map((row) => ({ cells: row.map((text) => ({ spans: [{ text }] })) })) }] });
  const prose = cells(L.map((l, i) => [l, R[i]]));
  const phrases = cells([["Gauge", "Level"], ["upper dam", "high water"], ["lower dam", "low water"], ["mill race", "no reading"]]);
  check("layout: prose read into a table's cells is prose; a table of phrases is none", tableScores(prose, linesOfUnits(pdf, prose)).prose > 0 && tableScores(phrases, linesOfUnits(pdf, phrases)).prose === 0);
  // A paragraph set in 20 pt where the page sets its lines at the column's edge, and one the page sets in; the
  // column's other paragraph stands at its edge.
  const block = (left: number): DocBlock => ({ kind: "paragraph", spans: [{ text: L.join(" ") }], indent: "block", indentPt: { left, first: 0 } });
  const other = [0, 1, 2].map((i) => ({ page: 1, top: 300 + 14 * i, bottom: 310 + 14 * i, left: 72, right: 290, text: `Body line ${i} of the column's other paragraph` }));
  const own = L.map((text, i) => ({ page: 1, top: 100 + 14 * i, bottom: 110 + 14 * i, left: 72, right: 290, text }));
  const flushPdf: PdfText = { ...pdf, lines: [...own, ...other] };
  const setInPdf: PdfText = { ...flushPdf, lines: [...own.map((l) => ({ ...l, left: 92 })), ...other] };
  const indented = flatten({ blocks: [block(20)] });
  const falseSet = indentScores(flushPdf, indented, linesOfUnits(flushPdf, indented));
  const trueSet = indentScores(setInPdf, indented, linesOfUnits(setInPdf, indented));
  check("layout: a block indent the page does not set is false; one it sets is right", falseSet.wrong === 1 && trueSet.judged === 1 && trueSet.wrong === 0, `${JSON.stringify(falseSet.found)} ${JSON.stringify(trueSet.found)}`);
  // A drawing read as a display's crop over the captioned rest of its figure: one figure in two pieces.
  const region = (y1: number, y2: number) => ({ kind: "path" as const, points: [[20, y1], [80, y1], [80, y2], [20, y2]] as [number, number][] });
  const top: DocBlock = { kind: "figure", mathImage: "", at: { page: 1, region: region(10, 20) } };
  const rest: DocBlock = { kind: "figure", caption: [{ text: "Figure 1. The dam and its gauges." }], at: { page: 1, region: region(20, 35) } };
  const gapPdf: PdfText = { ...pdf, lines: [...pdf.lines, { page: 1, top: 160, bottom: 170, left: 150, right: 450, text: "The words between the two pictures" }] };
  const apart: DocBlock = { ...rest, at: { page: 1, region: region(22, 35) } };
  check(
    "layout: a figure's top read apart from its captioned rest is a figure in two pieces; with words between them, two figures",
    figureScores(pdf, flatten({ blocks: [top, rest] })).split === 2 && figureScores(gapPdf, flatten({ blocks: [top, apart] })).split === 0,
  );
  // A display's crop that holds a line of the paragraph (it starts at the column's edge, words of prose) holds prose.
  const cropPdf = (text: string, left: number): PdfText => ({ ...pdf, lines: [...lines, { page: 1, top: 400, bottom: 410, left, right: left + 200, text }] });
  const crop: DocBlock = { kind: "figure", mathImage: "", at: { page: 1, region: { kind: "path", points: [[5, 49], [95, 49], [95, 53], [5, 53]] } } };
  check(
    "layout: a crop holding a line of prose holds prose; a display's own words (for all, set apart) do not",
    cropScores(cropPdf("For any set S of gauges, define the level L and", 72), flatten({ blocks: [crop] })).prose === 1 && cropScores(cropPdf("f(x) = 0 for all x in S", 250), flatten({ blocks: [crop] })).prose === 0,
  );
}
{
  check(
    "layout: a face's shape by its name",
    faceShape("FRBWPF+LinLibertineT") === "serif" && faceShape("CQLEKO+CharisSIL") === "serif" && faceShape("SHZHDT+LinBiolinumTB") === "sans" && faceShape("ABCDEF+Arial-BoldMT") === "sans" && faceShape("CMTT10") === "mono" && faceShape("CMR10") === "serif" && faceShape("Wingdings") === null,
  );
  const scan = labelScores(["1", "2", "3", "2", "3", "4"], 6, [3, 3]);
  const book = labelScores(["i", "ii", "iii", "1", "2", "3"], 6, undefined);
  check("layout: page labels that run backwards are wrong; roman front matter before arabic is right", scan.wrong === 1 && scan.pairs === 2 && book.wrong === 0 && book.pairs === 4, `${JSON.stringify(scan)} ${JSON.stringify(book)}`);
}

// ── The import's drawing: a display's space, a row's height, a marker's place ──

{
  const em = 10;
  const space = displaySpace(em);
  const doc = (spaceAfter: number): RichNode => ({
    type: "doc",
    attrs: { namedStyleNormal: JSON.stringify({ size: em }) },
    content: [
      { type: "paragraph", attrs: { spaceAfter }, content: [{ type: "text", text: "The flow over the dam is" }] },
      { type: "blockMath", attrs: { latex: "Q = v A" } },
      { type: "paragraph", content: [{ type: "text", text: "where v is the speed of the water." }] },
    ],
  });
  // The page: a line, the display 100 pt wide, a line; gaps above and below as the page editor draws them.
  const at = (above: number, below: number): { pdf: PdfText; parse: Doc } => {
    const [y1, y2] = [200 + above, 230 + above];
    return {
      pdf: { first: 1, pages: 1, raw: [[]], lines: [{ page: 1, top: 190, bottom: 200, left: 72, right: 540, text: "The flow over the dam is" }, { page: 1, top: y2 + below, bottom: y2 + below + 10, left: 72, right: 540, text: "where v is the speed of the water." }], furniture: [], sizes: new Map([[1, { width: 612, height: 792 }]]), symbols: [] },
      parse: { blocks: [{ kind: "equation", latex: "Q = v A", at: { page: 1, region: { kind: "path", points: [[40, (y1 / 792) * 100], [60, (y1 / 792) * 100], [60, (y2 / 792) * 100], [40, (y2 / 792) * 100]] } } }] },
    };
  };
  const same = at(4 + space.top, space.bottom);
  const drawnAsPage = displayGaps(doc(4), same.parse, same.pdf);
  const off = space.top >= 12 ? space.top / 3 : space.top + 12;
  const wide = at(off, off);
  const drawnOff = displayGaps(doc(0), wide.parse, wide.pdf);
  check("look: a display drawn with the page's space above and below is right; off by more than 2 pt, wrong", drawnAsPage.right === 2 && drawnAsPage.edges === 2 && drawnOff.right < drawnOff.edges, `${JSON.stringify(drawnAsPage)} ${JSON.stringify(drawnOff)}`);
  // A table of one-line rows the page sets at the page editor's row height, and at twice it.
  const row = rowHeight(10, 1);
  const table: DocBlock = { kind: "table", rows: [0, 1, 2, 3].map((r) => ({ cells: [{ spans: [{ text: `Gauge number ${r} reads` }] }] })), cells: { size: 10, lineSpacing: 1 } };
  const rowsPdf = (pitch: number): PdfText => ({ first: 1, pages: 1, raw: [[]], lines: [0, 1, 2, 3].map((r) => ({ page: 1, top: 100 + pitch * r, bottom: 110 + pitch * r, left: 72, right: 300, text: `Gauge number ${r} reads` })), furniture: [], sizes: new Map([[1, { width: 612, height: 792 }]]), symbols: [] });
  const flat = flatten({ blocks: [table] });
  const asDrawn = rowHeights(flat, linesOfUnits(rowsPdf(row), flat), rowsPdf(row));
  const tight = rowHeights(flat, linesOfUnits(rowsPdf(row / 2), flat), rowsPdf(row / 2));
  check("look: a table's rows at the page's height are right; twice the page's, wrong", asDrawn.right === 1 && tight.tables === 1 && tight.right === 0, `${JSON.stringify(asDrawn)} ${JSON.stringify(tight)}`);
  // A marker drawn as a box at its line's start stands there; one drawn outside, its width and an em left of the words.
  check("look: a marker drawn at its line's start stands in the column; one hung past a narrow hang stands in the margin", markerStart(true, 15, -15, "(a)", 10) === 0 && markerStart(false, 15, 0, "(a)", 10) < -1);
}

{
  // The repository is public: the committed corpus list names none of the owner's files (load.ts).
  const listed = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as { id: string; license?: string; pdf?: string; docx?: string }[];
  const owner = listed.filter((e) => e.license === "private" || [e.pdf, e.docx].some((f) => f?.startsWith(".bench/private/")));
  check("corpus.json names none of the owner's files", owner.length === 0, `${owner.length} entries`);
}

console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} checks fail.`);
process.exit(failed === 0 ? 0 : 1);
