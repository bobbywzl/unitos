// The Word parse's checks (lib/parse/docx.ts): small .docx files built here,
// each holding one thing a Word benchmark round found the parse got wrong
// (scripts/parse-bench/word.mts), parsed the way the Word add parses them
// and held to what the file says. Nothing is stored.
// Run: npx tsx --tsconfig tsconfig.json scripts/qa/word-parse.mts
import { strToU8, unzipSync, zipSync } from "fflate";
import { richTextFromImport } from "@/lib/docs/import";
import type { RichNode } from "@/lib/docs/schema";
import { parseDocx } from "@/lib/parse/docx";
import type { ParsedBlock } from "@/lib/parse/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A .docx of a body (the w:body's inner xml) and, when given, its numbering part. */
function docx(body: string, numbering?: string): Uint8Array {
  const parts: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${numbering ? `<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>` : ""}</Relationships>`,
    ),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
  };
  if (numbering) parts["word/numbering.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>${numbering}</w:numbering>`);
  return zipSync(parts);
}

const para = (text: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const item = (text: string, numId: number, ilvl: number) => para(text, `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
const level = (ilvl: number, fmt: string, text: string, left: number) =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
const list = (levels: string) => `<w:abstractNum w:abstractNumId="0">${levels}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;

async function parse(bytes: Uint8Array): Promise<ParsedBlock[]> {
  return (await parseDocx(bytes, "check.docx", { storeImage: async () => "/api/images/check" })).blocks;
}
const listText = (blocks: ParsedBlock[]) => blocks.find((b) => b.type === "LIST")?.text ?? "";
/** The import's lists: each list node's type and how deep it stands. */
function importLists(blocks: ParsedBlock[]): string[] {
  const { richText } = richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks });
  const out: string[] = [];
  const walk = (node: RichNode, depth: number) => {
    const list = node.type === "orderedList" || node.type === "bulletList";
    if (list) out.push(`${depth}:${node.type}`);
    for (const c of node.content ?? []) walk(c, list ? depth + 1 : depth);
  };
  walk(richText, 0);
  return out;
}

// ── Lists: one Word list's levels nest, whatever their indents ──────────────

{
  // A legal list: every level at one indent.
  const blocks = await parse(docx(item("Scope", 1, 0) + item("Purpose", 1, 1) + item("Terms", 1, 2) + item("Duties", 1, 0), list(level(0, "decimal", "%1.", 720) + level(1, "decimal", "%1.%2.", 720) + level(2, "decimal", "%1.%2.%3.", 720))));
  const text = listText(blocks);
  check("a legal list's levels at one indent nest by level", text === "1. Scope\n  1.1. Purpose\n    1.1.1. Terms\n2. Duties", JSON.stringify(text));
  check("each depth keeps its level's indent", (blocks.find((b) => b.type === "LIST")?.listIndents ?? []).map((d) => d.left).join(",") === "36,36,36");
  const lists = importLists(blocks).join(" ");
  check("the import draws the legal list as nested lists", lists === "0:orderedList 1:orderedList 2:orderedList", lists);
}
{
  // A number and a dash: Word's "%1-" (Persian and Arabic files).
  const blocks = await parse(docx(item("Patience", 1, 0) + item("Prayer", 1, 0), list(level(0, "decimal", "%1-", 720))));
  const { richText } = richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks });
  const found = (richText.content ?? []).find((n) => n.type === "orderedList");
  const format = found ? (JSON.parse(String(found.attrs?.listLevels ?? "[]")) as { format?: string }[])[0]?.format : undefined;
  check('a "1-" list imports as a numbered list that draws "1-"', format === "%0-", JSON.stringify(found?.attrs ?? null));
}
{
  // A list that starts deep in legal numbering: the numbers above print.
  const blocks: ParsedBlock[] = [{ type: "LIST", text: "3.2.2.5.1.3. Rooms\n3.2.2.5.1.4. Names", html: "<ol></ol>" }];
  const { richText } = richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks });
  const found = (richText.content ?? []).find((n) => n.type === "orderedList");
  const format = found ? (JSON.parse(String(found.attrs?.listLevels ?? "[]")) as { format?: string }[])[0]?.format : undefined;
  check('a list that starts at "3.2.2.5.1.3." is a numbered list that prints "3.2.2.5.1."', format === "3.2.2.5.1.%0." && found?.attrs?.start === 3, JSON.stringify(found?.attrs ?? null));
}
{
  // A level a tenth of an inch in from the level above it.
  const text = listText(await parse(docx(item("One", 1, 0) + item("Two", 1, 1) + item("Three", 1, 0), list(level(0, "bullet", "–", 142) + level(1, "bullet", "–", 284)))));
  check("a level under a tenth of an inch in stands a level deeper", text === "– One\n  – Two\n– Three", JSON.stringify(text));
}
{
  // Two lists side by side (List Bullet, List Bullet 2): level 0 each, nested by their indents.
  const numbering =
    `<w:abstractNum w:abstractNumId="0">${level(0, "bullet", "•", 720)}</w:abstractNum><w:abstractNum w:abstractNumId="1">${level(0, "bullet", "◦", 1440)}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`;
  const text = listText(await parse(docx(item("Fruit", 1, 0) + item("Apples", 2, 0) + item("Pears", 2, 0) + item("Bread", 1, 0), numbering)));
  check("two lists at level 0 nest by their indents", text === "• Fruit\n  ◦ Apples\n  ◦ Pears\n• Bread", JSON.stringify(text));
}

// ── Tables: a row inside a content control is a row ─────────────────────────

{
  const cell = (text: string) => `<w:tc>${para(text)}</w:tc>`;
  const row = (a: string, b: string) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;
  const control = (inner: string) => `<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
  const table = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>${row("Item", "Price")}${control(row("Bread", "2.10"))}${row("Milk", "1.20")}</w:tbl>`;
  const block = (await parse(docx(table))).find((b) => b.type === "TABLE");
  check("a row inside a content control stays the table's row", block?.text === "Item\tPrice\nBread\t2.10\nMilk\t1.20", JSON.stringify(block?.text));
}

// ── Marks: a single and a double strike are two properties ──────────────────

{
  const run = (text: string, rPr: string) => `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const body = `<w:p>${run("Kept ", "")}${run("once", '<w:strike/><w:dstrike w:val="0"/>')}${run(" and ", "")}${run("twice", '<w:strike w:val="0"/><w:dstrike/>')}</w:p>`;
  const block = (await parse(docx(body)))[0];
  const struck = (block?.styles ?? []).filter((s) => s.style === "strike").map((s) => s.quotedText);
  check("a run struck once or twice is struck, whichever the other says", struck.join("|") === "once|twice", JSON.stringify(struck));
}

// ── Code: a code style's words in a face that is not monospace are prose ────

{
  const run = (text: string, rPr: string) => `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const code = '<w:pPr><w:pStyle w:val="Code"/></w:pPr>';
  const times = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>';
  const courier = '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>';
  const body = `<w:p>${code}${run("Filed today", `${times}<w:b/>`)}</w:p><w:p/><w:p>${code}${run("let x = 1;", courier)}</w:p>${para("Between")}<w:p>${code}${run("let y = 2;", "")}</w:p>`;
  const blocks = await parse(docx(body));
  const kinds = blocks.map((b) => `${b.type}:${b.text}`).join("|");
  check("a code style's words in Times New Roman are a paragraph, a monospace or unnamed face's are code", kinds === "PARAGRAPH:Filed today|CODE:let x = 1;|PARAGRAPH:Between|CODE:let y = 2;", JSON.stringify(kinds));
  const bold = (blocks[0]?.styles ?? []).filter((s) => s.style === "bold").map((s) => s.quotedText);
  check("the prose keeps its bold", bold.join("|") === "Filed today", JSON.stringify(bold));
}

// ── An equation in Word's linear format, typed as LaTeX, is its LaTeX ───────

{
  const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
  const mr = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;
  const body = `<w:p><m:oMathPara ${M}><m:oMath>${mr("\\int_{0}^{1}x")}</m:oMath></m:oMathPara></w:p><w:p><w:r><w:t xml:space="preserve">Set </w:t></w:r><m:oMath ${M}>${mr("A\\B")}</m:oMath></w:p>`;
  const blocks = await parse(docx(body));
  const kinds = blocks.map((b) => `${b.type}:${b.type === "EQUATION" ? b.text : b.text.trim()}`).join("|");
  check("a linear-format equation with a LaTeX command is that LaTeX", kinds === "EQUATION:\\int_{0}^{1}x|PARAGRAPH:Set A\\B", JSON.stringify(kinds));
  const raw = (blocks[1]?.math ?? []).some((m) => m.latex === "A\\B");
  check("a backslash before one letter is no LaTeX command: the run is read as characters", !raw, JSON.stringify(blocks[1]?.math ?? []));
}

// ── A group of a few boxes is layout; one that links its shapes is a diagram ─

{
  const NS =
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const box = (text: string) => `<wps:wsp><wps:txbx><w:txbxContent>${para(text)}</w:txbxContent></wps:txbx></wps:wsp>`;
  const connector = '<wps:wsp><wps:cNvCnPr/><wps:spPr><a:prstGeom prst="straightConnector1"/></wps:spPr></wps:wsp>';
  const group = (inner: string) =>
    `<w:p><w:r><w:drawing ${NS}><wp:anchor><wp:extent cx="3000000" cy="900000"/><a:graphic><a:graphicData><wpg:wgp>${inner}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Anchor</w:t></w:r></w:p>`;
  const layout = (await parse(docx(group(box("Jane Doe") + box("jane@example.com"))))).map((b) => b.text).join("|");
  check("a group of two boxes and no link reads its boxes after its paragraph", layout === "Anchor|Jane Doe|jane@example.com", JSON.stringify(layout));
  const chart = (await parse(docx(group(box("Board") + connector + box("Staff"))))).map((b) => b.text).join("|");
  check("a group that links its boxes is a diagram: its labels stay out", chart === "Anchor", JSON.stringify(chart));
}

// ── A heading that repeats a Word file's title stands ───────────────────────

{
  const parsed = await parseDocx(
    docx(para("Annual Report", '<w:pStyle w:val="Title"/>') + para("Written for the board.") + para("Annual Report", '<w:pStyle w:val="Heading1"/>') + para("The year in short.")),
    "check.docx",
    { storeImage: async () => "/api/images/check" },
  );
  const { richText } = richTextFromImport({ kind: "docx", title: parsed.title ?? "", titleFromOriginal: !parsed.titleFromFile, blocks: parsed.blocks });
  const lines = (richText.content ?? []).map((n) => `${n.type === "heading" ? "h" : String(n.attrs?.docStyle ?? "p")}:${(n.content ?? []).map((c) => c.text ?? "").join("")}`).join("|");
  check("a heading that repeats a Word file's title stands where it is", lines === "title:Annual Report|p:Written for the board.|h:Annual Report|p:The year in short.", JSON.stringify(lines));
}

// ── A line separator typed in a run is a line break ─────────────────────────

{
  const sep = String.fromCharCode(0x2028);
  const block = (await parse(docx(para(`four scales${sep}of land`))))[0];
  check("a U+2028 in a run's text is a line break, as w:br is", block?.text === "four scales\nof land", JSON.stringify(block?.text));
}

// ── A picture straight in the body is a figure ───────────────────────────────

{
  const bytes = docx(`${para("Before")}<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:60pt"><v:imagedata r:id="rId9"/></v:shape></w:pict>${para("After")}`);
  const parts = unzipSync(bytes);
  parts["word/_rels/document.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${REL}/image" Target="media/image1.png"/></Relationships>`,
  );
  parts["word/media/image1.png"] = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const blocks = await parse(zipSync(parts));
  const kinds = blocks.map((b) => b.type).join(",");
  check("a w:pict out of any paragraph is a figure between its neighbors", kinds === "PARAGRAPH,FIGURE,PARAGRAPH", kinds);
}

// ── A picture bullet draws its picture, not its character ───────────────────

{
  const symbol = '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>';
  const lvl = (picture: boolean) =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${String.fromCharCode(0xf06c)}"/>${picture ? '<w:lvlPicBulletId w:val="0"/>' : ""}<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr>${symbol}</w:lvl>`;
  const numbering = `<w:abstractNum w:abstractNumId="0">${lvl(true)}</w:abstractNum><w:abstractNum w:abstractNumId="1">${lvl(false)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`;
  const texts = (await parse(docx(item("Pictured", 1, 0) + para("Between") + item("Lettered", 2, 0), numbering))).filter((b) => b.type === "LIST").map((b) => b.text);
  check("a picture bullet is the default dot; Symbol's U+F06C without a picture is λ", texts.join("|") === "• Pictured|λ Lettered", JSON.stringify(texts));
}

// ── A CJK counter stays the page's words in a list that draws no marker ─────

{
  // The page editor counts in Latin digits, letters, and roman numerals
  // alone: "第%0条" would print "第9条" where Word prints "第九条".
  const numbering = `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="9"/><w:numFmt w:val="chineseCounting"/><w:lvlText w:val="第%1条"/><w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
  const blocks = await parse(docx(item("合同双方履行义务。", 1, 0) + item("不得擅自变更合同。", 1, 0), numbering));
  check("a chineseCounting list counts 九, 十", listText(blocks) === "第九条 合同双方履行义务。\n第十条 不得擅自变更合同。", JSON.stringify(listText(blocks)));
  const { richText } = richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks });
  const found = (richText.content ?? []).find((n) => n.type === "bulletList" || n.type === "orderedList");
  const levels = found ? (JSON.parse(String(found.attrs?.listLevels ?? "[]")) as { bullet?: string }[]) : [];
  const first = found?.content?.[0]?.content?.[0]?.content?.[0]?.text ?? "";
  check("the import keeps 第九条 as words in a list that draws no marker", levels.length === 9 && levels.every((l) => l.bullet === "") && first === "第九条 合同双方履行义务。", JSON.stringify({ levels: found?.attrs?.listLevels, first }));
}

// ── A cross-reference in a list item makes no contents list ─────────────────

{
  const text = "• Refer to Step 1 for the data.\n• Keep the device codes.\n• Send one time zone.";
  const at = text.indexOf("Step 1");
  const notes: ParsedBlock[] = [
    { type: "HEADING", text: "Step 1", html: "<h2>Step 1</h2>" },
    { type: "LIST", text, links: [{ start: at, end: at + 6, quotedText: "Step 1", targetOrder: 0 }] },
  ];
  const kinds = (richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks: notes }).richText.content ?? []).map((n) => n.type).join(",");
  check("a bulleted list whose one item cites a heading stays a list", kinds === "heading,bulletList", kinds);
  const toc = "1 Introduction\n2 Methods";
  const contents: ParsedBlock[] = [
    { type: "LIST", text: toc, links: [{ start: 2, end: 14, quotedText: "Introduction", targetOrder: 1 }, { start: 17, end: 24, quotedText: "Methods", targetOrder: 2 }] },
    { type: "HEADING", text: "Introduction", html: "<h1>Introduction</h1>" },
    { type: "HEADING", text: "Methods", html: "<h1>Methods</h1>" },
  ];
  const tocKinds = (richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks: contents }).richText.content ?? []).map((n) => n.type).join(",");
  check("lines that each link to a heading are a contents list: a paragraph each", tocKinds === "paragraph,paragraph,heading,heading", tocKinds);
  const note = "NOTE A template for XPath 2.0 needs a processor (Section 7.2).";
  const ref = note.indexOf("7.2");
  const one: ParsedBlock[] = [
    { type: "HEADING", text: "7.2 Booleans", html: "<h2>7.2 Booleans</h2>" },
    { type: "LIST", text: note, links: [{ start: ref, end: ref + 3, quotedText: "7.2", targetOrder: 0 }] },
  ];
  const oneKinds = (richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks: one }).richText.content ?? []).map((n) => n.type).join(",");
  check("a one-line note that cites a section stays a list", oneKinds === "heading,bulletList", oneKinds);
}

// ── A Word figure's caption keeps its bold label in the import ──────────────

{
  const figure: ParsedBlock = { type: "FIGURE", text: "Figure 2.4. Simulated data.", html: '<figure><img src="/a.png" alt=""><figcaption><strong>Figure 2.4. </strong>Simulated data.</figcaption></figure>' };
  const out = richTextFromImport({ kind: "docx", title: "Check", titleFromOriginal: false, blocks: [figure] });
  const html = out.figures[0]?.html ?? "";
  check("a Word figure draws its figcaption, its bold label in <strong>", /<figcaption[^>]*><strong>Figure 2\.4\. <\/strong>/.test(html), html);
}

// ── A Word title keeps its own styles ───────────────────────────────────────

{
  const title = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">Interpreting help text</w:t></w:r></w:p>`;
  const parsed = await parseDocx(docx(title + para("Brackets mark a field to fill.")), "check.docx", { storeImage: async () => "/api/images/check" });
  check("an underlined Word title keeps its underline as a title style", JSON.stringify(parsed.titleStyles) === JSON.stringify([{ start: 0, end: 22, style: "underline", quotedText: "Interpreting help text" }]), JSON.stringify(parsed.titleStyles));
  const { richText } = richTextFromImport({ kind: "docx", title: parsed.title ?? "", titleFromOriginal: !parsed.titleFromFile, blocks: parsed.blocks, titleStyles: parsed.titleStyles });
  const marks = (richText.content?.[0]?.content?.[0]?.marks ?? []).map((m) => m.type).join(",");
  check("the import's Title draws the title underlined", richText.content?.[0]?.attrs?.docStyle === "title" && marks === "underline", JSON.stringify(richText.content?.[0]));
}

// ── A page reference in a sentence keeps the page number Word printed ──────

{
  const run = (inner: string) => `<w:r>${inner}</w:r>`;
  const field = run('<w:fldChar w:fldCharType="begin"/>') + run('<w:instrText xml:space="preserve"> PAGEREF _Toc1 \\h </w:instrText>') + run('<w:fldChar w:fldCharType="separate"/>') + run("<w:t>1</w:t>") + run('<w:fldChar w:fldCharType="end"/>');
  const body = `<w:p>${run('<w:t xml:space="preserve">See page </w:t>')}${field}${run('<w:t xml:space="preserve">, Select by Polygon.</w:t>')}</w:p>`;
  const block = (await parse(docx(body)))[0];
  check("a PAGEREF outside a contents list keeps its number in the sentence", block?.text === "See page 1, Select by Polygon.", JSON.stringify(block?.text));
}

// ── An icon between words keeps the sentence one paragraph ──────────────────

/** A .docx of a body whose drawings show media/image1.png (r:embed rId9). */
function withPicture(body: string): Uint8Array {
  const parts = unzipSync(docx(body));
  parts["word/_rels/document.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${REL}/image" Target="media/image1.png"/></Relationships>`,
  );
  parts["word/media/image1.png"] = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return zipSync(parts);
}
const picture = (emu: number) =>
  `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${emu}" cy="${emu}"/><wp:docPr id="1" name="Picture 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const words = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

{
  const blocks = await parse(withPicture(`<w:p>${words("Select by Polygon: the sign ")}${picture(114286)}${words(" draws a closed shape.")}</w:p>`));
  const lines = blocks.map((b) => `${b.type}:${b.text}`).join("|");
  check("an icon between words leaves the sentence one paragraph", lines === "PARAGRAPH:Select by Polygon: the sign draws a closed shape.", JSON.stringify(lines));
  const alone = (await parse(withPicture(`<w:p>${picture(114286)}</w:p>`))).map((b) => b.type).join(",");
  check("an icon on a line of its own is a figure", alone === "FIGURE", alone);
}

// ── A picture inline in a sentence follows the sentence ────────────────────

{
  const big = 952500; // 1 inch: no icon
  const blocks = await parse(withPicture(`<w:p>${words("This picture ")}${picture(big)}${words(" is an identicon.")}</w:p>`));
  const lines = blocks.map((b) => `${b.type}:${b.text}`).join("|");
  check("a picture inline in a sentence follows the sentence, which stays one paragraph", lines === "PARAGRAPH:This picture is an identicon.|FIGURE:", JSON.stringify(lines));
  const own = await parse(withPicture(`<w:p>${words("Before")}<w:r><w:br/></w:r>${picture(big)}<w:r><w:br/></w:r>${words("After")}</w:p>`));
  const ownLines = own.map((b) => `${b.type}:${b.text}`).join("|");
  check("a picture on a line of its own between words stays where it stands", /^PARAGRAPH:Before\s*\|FIGURE:\|PARAGRAPH:\s*After$/.test(ownLines), JSON.stringify(ownLines));
}

// ── A spacer picture after words draws nothing ──────────────────────────────

{
  const blocks = await parse(withPicture(`<w:p>${words("Determining font script in DrawingML ")}${picture(8255)}</w:p>`));
  const lines = blocks.map((b) => `${b.type}:${b.text}`).join("|");
  check("a 1x1 spacer picture after words draws no figure", lines === "PARAGRAPH:Determining font script in DrawingML", JSON.stringify(lines));
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
