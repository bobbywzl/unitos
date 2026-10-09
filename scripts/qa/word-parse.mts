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

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
