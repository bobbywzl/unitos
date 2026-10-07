// Round 5 GATHER5 (WALK5-10, VIEW5-04): a gathered quote at sentence bounds.
// Pure cases, then the two blocks of WALK5-10's gathered note (read only).
// Run: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<db> npx tsx scripts/qa/quote-span-check.ts
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { firstMatch, passageQuote, snippet } from "@/lib/graph/find";
import { QUOTE_MAX, QUOTE_WHOLE_MAX, quoteSpan, sentencePrefix } from "@/lib/graph/quote-span";

let pass = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  pass++;
  console.log(`ok  ${label}`);
};
const ENDS = /[.!?…。！？]["'”’)\]）」』]*$/;
const startsSentence = (text: string, at: number) => at === 0 || /[.!?…。！？]["'”’)\]）」』]*\s*$/.test(text.slice(0, at));

// Pure cases.
const short = "The will is blind. It strives without end.";
ok(passageQuote(short, "strives") === short, "a short block is quoted whole");
const filler = "Filler words run on here to make the block long enough to need sentences at all. ";
const long = filler.repeat(4) + "Pity, Dr. Rée says, is the ground of every moral act, e.g. of kindness to animals and to men. " + filler.repeat(4);
const q1 = passageQuote(long, "pity");
ok(q1.startsWith("Pity, Dr. Rée says") && q1.endsWith("to men."), `the sentence holding the match, past "Dr." and "e.g." in one sentence (${q1.length} chars)`);
ok(ENDS.test(q1), "it ends a sentence");
const decimal = filler.repeat(5) + "The ratio is 3.5 to one in pity's favour. " + filler.repeat(5);
ok(passageQuote(decimal, "ratio").startsWith("The ratio is 3.5 to one"), "3.5 is not a sentence end");
const tiny = filler.repeat(5) + "Pity wins. " + "Then the next sentence follows it with more words. " + filler.repeat(3);
const q2 = passageQuote(tiny, "pity");
ok(q2.startsWith("Pity wins.") && q2.includes("Then the next sentence"), "a quote under 80 chars takes in the next sentence");
const zh = "前文铺垫。".repeat(90) + "同情是一切道德的基础。它不需要理由！" + "后文继续。".repeat(90);
const q3 = passageQuote(zh, "同情");
ok(q3.startsWith("同情是一切道德的基础。"), `Chinese sentences (${q3})`);
const runOn = "word ".repeat(300) + "pity " + "word ".repeat(300);
const q4 = passageQuote(runOn, "pity");
ok(q4.length < QUOTE_MAX && q4 === snippet(runOn, "pity").text.replace(/^…|…$/g, "").trim(), "a sentence past QUOTE_MAX falls back to the row's window");
ok(quoteSpan("   x   ", 3, 4).start === 3, "a whole short block is trimmed");
// sentencePrefix: a cited passage cut to 600 chars.
const cited = (filler.repeat(10)).slice(0, 600);
const p1 = sentencePrefix(cited, 600);
ok(p1.length <= 600 && ENDS.test(p1), `a cut passage ends at its last whole sentence (${p1.length})`);
ok(sentencePrefix("Not cut. Whole", 600) === "Not cut. Whole", "a passage under the cut stays whole");
ok(sentencePrefix(("word ".repeat(200)).slice(0, 600), 600).endsWith("word"), "no sentence end: cut at the last word edge");

// WALK5-10's two blocks (dissect): offsets 294–457 of a 543-char block, 1083–1249 of a 3,385-char block.
async function main() {
  for (const [id, q] of [["cmuyh404c003o7dv21nokw9or", "suffering"], ["cmuyh403h000w7dv266yjqeej", "suffering"]] as const) {
    const block = await db.block.findUnique({ where: { id }, select: { text: true } });
    if (!block) {
      console.log(`skip ${id}: not in this database`);
      continue;
    }
    const text = block.text;
    const before = snippet(text, q).text.replace(/^…|…$/g, "").trim();
    const after = passageQuote(text, q);
    const at = text.indexOf(after);
    console.log(`  ${id} (${text.length} chars)\n    before: ${JSON.stringify(before)}\n    after:  ${JSON.stringify(after)}`);
    ok(at !== -1, `${id}: the quote is the block's own words`);
    ok(text.length <= QUOTE_WHOLE_MAX || (startsSentence(text, at) && (at + after.length === text.length || ENDS.test(after))), `${id}: starts and ends at sentence bounds (${at}–${at + after.length})`);
    const hit = firstMatch(text, q);
    ok(Boolean(hit) && at <= hit!.start && at + after.length >= hit!.end, `${id}: holds the match`);
  }
  console.log(`${pass} pass`);
  await db.$disconnect();
}
void main();
