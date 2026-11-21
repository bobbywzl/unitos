// A large sheet's edit (lib/replica.ts largeSheetWithText, SPEC.md §27): a
// sheet past LARGE_SHEET_CHARS takes new words in its cells by reading only
// the rows that changed, and refuses every other change in words.
// Run: npx tsx scripts/qa/large-sheet-check.ts
import { parseSheetsFile } from "@/lib/parse/sheets";
import { LARGE_SHEET_CHARS, replicaEdit } from "@/lib/replica";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

async function main() {
  const lines = ["id,name,amount,date,flag,note"];
  for (let r = 0; r < 3000; r++) lines.push(`${r},item ${r},${(r * 7.31).toFixed(2)},2026-01-${String((r % 28) + 1).padStart(2, "0")},${r % 2 ? "yes" : "no"},note for row ${r}`);
  const parsed = await parseSheetsFile(new TextEncoder().encode(lines.join("\n")), "big.csv", { storeImage: async () => null });
  const sheet = parsed.blocks.find((b) => b.type === "SHEET");
  if (!sheet?.html) throw new Error("no sheet block");
  const { html, text } = sheet;
  check("the sheet is a large one", html.length > LARGE_SHEET_CHARS, true);

  const edit = (next: string, from = text, source = html) => {
    const started = Date.now();
    const out = replicaEdit("SHEET", source, from, next, null);
    return { out, ms: Date.now() - started };
  };
  const reads = (out: ReturnType<typeof replicaEdit>, words: string) => ("html" in out ? out.html.includes(words) : `refused: ${out.refused}`);

  const one = text.replace("item 1500\t", "item 1500 QA\t");
  const first = edit(one);
  check("a cell's words change", reads(first.out, ">item 1500 QA<"), true);
  check("in under two seconds", first.ms < 2000, true);
  if ("html" in first.out) {
    const back = edit(text, one, first.out.html);
    check("the edit taken back gives the same bytes", "html" in back.out && back.out.html === html, true);
  }
  check("words in the first row", reads(edit(text.replace("name\t", "full name\t")).out, ">full name<"), true);
  check("words in the last row", reads(edit(text.replace("item 2999\t", "item 2999 changed\t")).out, ">item 2999 changed<"), true);
  const three = edit(text.replace("item 10\t", "ITEM 10\t").replace("item 1500\t", "ITEM 1500\t").replace("item 2500\t", "ITEM 2500\t")).out;
  check("three rows in one edit", ["ITEM 10", "ITEM 1500", "ITEM 2500"].map((w) => reads(three, `>${w}<`)), [true, true, true]);
  const words = edit(text.replace("\t7.31\t", "\tabout seven\t")).out;
  check("a number that becomes words", reads(words, ">about seven<"), true);
  check("a row removed is refused in words", reads(edit(text.split("\n").filter((_, i) => i !== 5).join("\n")).out, ""), "refused: large");
  check("a column added is refused in words", reads(edit(text.split("\n").map((l) => `${l}\tx`).join("\n")).out, ""), "refused: large");
  check("a tab typed into a cell is refused in words", reads(edit(text.replace("item 3\t", "item\t3\t")).out, ""), "refused: large");

  console.log(failed ? `\n${failed} failed` : "\nall ok");
  process.exit(failed ? 1 : 0);
}

void main();
