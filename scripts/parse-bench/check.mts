// The benchmark's own checks: each metric on tiny hand-built pairs, the
// adapters on tiny parses and imports, and the math canonical form on pairs
// that must and must not score 1. Run: npx tsx scripts/parse-bench/check.mts
import type { RichNode } from "@/lib/docs/schema";
import type { ParsedBlock } from "@/lib/parse/types";
import type { Glyph } from "@/lib/parse/pdf/drawing";
import { fromImport, fromParse, printedNotes, type Doc, type DocBlock } from "./adapt";
import { freeScores, ocrSame, type PdfText } from "./free";
import { glyphScores, placeEquations, type PageGlyphs } from "./glyphs";
import { mathTokens, sequenceSimilarity } from "./math";
import { flatten, score, type Scores } from "./metrics";
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
  check(
    "import: three paragraphs in a row that read like headings are contents entries; one alone is no entry",
    unlinked.blocks.slice(0, 3).every((b) => b.role === "contents") && unlinked.blocks[4]?.role === undefined,
    JSON.stringify(unlinked.blocks.map((b) => b.role ?? b.kind)),
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
