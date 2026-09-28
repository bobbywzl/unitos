// The benchmark's own checks: each metric on tiny hand-built pairs, the
// adapters on tiny parses and imports, and the math canonical form on pairs
// that must and must not score 1. Run: npx tsx scripts/parse-bench/check.mts
import { readFileSync } from "node:fs";
import type { RichNode } from "@/lib/docs/schema";
import type { ParsedBlock } from "@/lib/parse/types";
import type { Glyph } from "@/lib/parse/pdf/drawing";
import { fromImport, fromParse, printedNotes, type Doc, type DocBlock } from "./adapt";
import { freeScores, ocrSame, type PdfText } from "./free";
import { glyphScores, placeEquations, type PageGlyphs } from "./glyphs";
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
  };
  const diagram: DocBlock = { kind: "figure", at: { page: 1, region: { kind: "path", points: [[0, 45], [100, 45], [100, 60], [0, 60]] } } };
  const sentence: DocBlock = { kind: "paragraph", spans: [{ text: "Let " }, { text: "", latex: "2k_1t" }, { text: " be small." }] };
  const free = freeScores(pdf, flatten({ blocks: [sentence, diagram] })).coverage;
  check("free: a formula's glyphs cover the words the text layer splits it into", near(free.recall, 1) && near(free.precision, 1), `recall ${free.recall}, precision ${free.precision}`);
  const bare = freeScores(pdf, flatten({ blocks: [sentence] })).coverage;
  check("free: a diagram's labels are words to cover only without the figure", (bare.recall ?? 1) < 1, `recall ${bare.recall}`);
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
  // A page number printed with a period ("54."): the candidate's line of it is a page-number line.
  const numbered = freeScores({ ...pdf, raw: [["The yard grew."]], lines: [] }, flatten({ blocks: [para("The yard grew."), para("54.")] }));
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

{
  // The repository is public: the committed corpus list names none of the owner's files (load.ts).
  const listed = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as { id: string; license?: string; pdf?: string; docx?: string }[];
  const owner = listed.filter((e) => e.license === "private" || [e.pdf, e.docx].some((f) => f?.startsWith(".bench/private/")));
  check("corpus.json names none of the owner's files", owner.length === 0, `${owner.length} entries`);
}

console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} checks fail.`);
process.exit(failed === 0 ? 0 : 1);
