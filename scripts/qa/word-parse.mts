// The Word parse's checks (lib/parse/docx.ts): small .docx files built here,
// each holding one thing a Word benchmark round found the parse got wrong
// (scripts/parse-bench/word.mts), parsed the way the Word add parses them
// and held to what the file says. Nothing is stored.
// Run: npx tsx --tsconfig tsconfig.json scripts/qa/word-parse.mts
import { strToU8, zipSync } from "fflate";
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

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
