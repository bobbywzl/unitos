// Checks for Stitch's pure functions (SPEC.md §22): the token estimate, the
// command's kind, the answer pass's budget by kind, the history's block
// tags as aliases, the reply's citations, and the skeleton's parts without
// a contents call. No model, no database rows.
// Run: npx tsx scripts/qa/stitch-budget-check.ts
import { STITCH_SELECTED_BLOCKS, STITCH_SELECTED_BUDGET } from "../../src/lib/derive/config";
import { partsFor } from "../../src/lib/graph/skeleton";
import {
  citedAliases,
  citedBlocks,
  commandKind,
  cutSelection,
  expandPick,
  historyWithAliases,
  interleave,
  replyWithIds,
} from "../../src/lib/graph/stitch";
import { stitchPrompt, stitchRules, stitchSelectPrompt } from "../../src/lib/prompts/stitch";
import { estTokens } from "../../src/lib/tokens";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed++;
}

// ── estTokens ──
check("estTokens: Latin at chars / 4", estTokens("a".repeat(400)) === 100);
check("estTokens: a CJK character is 1", estTokens("意志与痛苦") === 5);
check("estTokens: mixed", estTokens("Schopenhauer 认为痛苦") === Math.ceil(4 + 13 / 4), String(estTokens("Schopenhauer 认为痛苦")));
check("estTokens: Chinese costs ~4x English per char", estTokens("痛".repeat(1000)) === 4 * estTokens("a".repeat(1000)));

// ── commandKind ──
const kinds: [string, ReturnType<typeof commandKind>][] = [
  ["What does Schopenhauer say about the vanity of existence?", "question"],
  ["How do Nietzsche and Schopenhauer differ on pity and suffering?", "question"],
  ["How many homes were in the pilot?", "question"],
  ["Which of the two numbers is right?", "question"],
  ["And the second one, why did grades not change there?", "question"],
  ["Gather every passage about pity into one page.", "page"],
  ["Write one page that combines what they say about cost.", "page"],
  ["Summarise what all the documents say about installation delays", "page"],
  ["Make that a page", "page"],
  ["Where do these documents contradict each other?", "links"],
  ["Connect the sections that answer this question", "links"],
  ["Where do the reports disagree on cost?", "links"],
  ["叔本华如何看待痛苦？", "question"],
  ["尼采和叔本华在同情问题上有何不同？", "question"],
  ["把所有关于同情的段落汇集成一页。", "page"],
  ["这些文档在哪些地方相互矛盾？", "links"],
];
for (const [command, want] of kinds) check(`commandKind "${command}"`, commandKind(command) === want, commandKind(command));

// ── cutSelection by kind ──
type B = { id: string; alias: string; type: string; text: string; documentId: string };
const blockByRef = new Map<string, B>();
const aliases: string[] = [];
for (let d = 0; d < 4; d++) {
  for (let i = 1; i <= 200; i++) {
    const letter = "ABCD"[d];
    const b: B = { id: `id${letter}${i}`, alias: `${letter}${i}`, type: "PARAGRAPH", text: "word ".repeat(80), documentId: `doc${letter}` };
    blockByRef.set(b.alias, b);
    blockByRef.set(b.id, b);
    aliases.push(b.alias);
  }
}
const tokensOf = (set: Set<string>) => [...set].reduce((n, a) => n + estTokens(blockByRef.get(a)!.text) + 10, 0);
for (const kind of ["question", "links", "page"] as const) {
  const cut = cutSelection(aliases, blockByRef, kind);
  check(
    `cutSelection ${kind}: within ${STITCH_SELECTED_BUDGET[kind]} tokens and ${STITCH_SELECTED_BLOCKS[kind]} blocks`,
    tokensOf(cut) <= STITCH_SELECTED_BUDGET[kind] && cut.size <= STITCH_SELECTED_BLOCKS[kind] && cut.size > 0,
    `${cut.size} blocks, ${tokensOf(cut)} tokens`,
  );
}
check("cutSelection default is page", cutSelection(aliases, blockByRef).size === cutSelection(aliases, blockByRef, "page").size);
const zhBlocks = new Map<string, B>([["A1", { id: "z1", alias: "A1", type: "PARAGRAPH", text: "痛".repeat(16_000), documentId: "z" }]]);
check("cutSelection counts CJK as tokens (16k chars > 15k question budget)", cutSelection(["A1"], zhBlocks, "question").size === 0);
check("cutSelection: a 16k-char English block fits a question", cutSelection(["A1"], new Map([["A1", { ...zhBlocks.get("A1")!, text: "a".repeat(16_000) }]]), "question").size === 1);
check("interleave keeps every document's first pick first", interleave([["A1", "A2"], ["B1"], ["C1", "C2"]]).join(" ") === "A1 B1 C1 A2 C2");
check("expandPick range", expandPick("B10-B12").join(" ") === "B10 B11 B12");

// ── history as aliases, citations ──
const titles = new Map([["idOther", "Board memo"]]);
const turn = "Final report says 1,240 [block idA2]; another doc [block idOther]; gone [block idGone]; alias [block b3].";
check(
  "historyWithAliases: stored id → alias, other doc → title, unknown → dropped",
  historyWithAliases(turn, blockByRef, titles) === 'Final report says 1,240 [block A2]; another doc (a passage of "Board memo"); gone ; alias [block B3].',
  historyWithAliases(turn, blockByRef, titles),
);
const reply = replyWithIds("1,240 homes [block A2], 1,180 [block B3], again [block A2], bad [block Z9].", blockByRef);
check("replyWithIds rewrites known aliases only", reply === "1,240 homes [block idA2], 1,180 [block idB3], again [block idA2], bad [block Z9].", reply);
const cited = citedBlocks(reply, blockByRef, new Map([["docA", "Final report"], ["docB", "Board memo"]]));
check("citedBlocks: one entry per stored id cited", Object.keys(cited).join(" ") === "idA2 idB3", Object.keys(cited).join(" "));
check("citedBlocks: document and title", cited.idA2?.documentId === "docA" && cited.idB3?.title === "Board memo");
const long = new Map<string, B>([["idL", { id: "idL", alias: "A1", type: "PARAGRAPH", text: "x".repeat(900), documentId: "d" }]]);
check("citedBlocks: text cut to 600 chars", citedBlocks("[block idL]", long, new Map()).idL?.text.length === 600);
check("citedBlocks: {} when nothing is cited", Object.keys(citedBlocks("No tags.", blockByRef, new Map())).length === 0);
check(
  "citedAliases: latest answer first, once each",
  citedAliases(
    [
      { role: "user", content: "q1" },
      { role: "assistant", content: "x [block idA2] y [block idB3]" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "z [block idC5] [block idA2]" },
    ],
    blockByRef,
  ).join(" ") === "C5 A2 B3",
);

// ── prompts ──
const rules = stitchRules("en");
for (const rule of ["never pick one", "is a copy", "cite the original", "Never say which to use", "no topic the command did not ask about", "one text part per finding", "do not answer", "worked out", "never by its letter", "reply only", "At most 3,000 characters", "Specificity:", "check that they measure the same thing", "up to 8"]) {
  check(`answer rules carry "${rule}"`, rules.includes(rule));
}
check("answer rules hold no command-specific text", !rules.includes("The reader's command"));
const docs = [
  { tag: "A", title: "Report", read: true },
  { tag: "B", title: "Scan", read: false },
];
const first = stitchPrompt({ documents: docs, command: "How many?", continued: false, selected: false });
const next = stitchPrompt({ documents: docs, command: "Which is right?", continued: true, selected: true });
check("answer prompt: no continue line on the first command", !first.includes("continues the conversation"));
check("answer prompt: continue line on a follow-up", next.includes("continues the conversation"));
check("answer prompt: the select-path line", next.includes("not that the documents do not"));
check("answer prompt: partial-read sentence, actionable", next.includes("pick fewer documents in the graph"));
check("answer prompt: unread named only when it bears", first.includes("only when the command asks about them"));
const select = stitchSelectPrompt({ documents: docs, command: "And the second one?", continued: true, earlier: ["List the two studies."], cited: ["B3"], maxBlocks: 150, partial: false });
check("select prompt: earlier commands", select.includes("- List the two studies."));
check("select prompt: cited blocks", select.includes("[block B3]"));
check("select prompt: kind's block cap", select.includes("up to 150"));

// ── skeleton parts without a contents call ──
const plain = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, type: "PARAGRAPH", text: `Paragraph ${i} says something long enough.`, order: i, html: null }));
const parts = partsFor(null, plain);
check("partsFor: no headings → a part every 25 blocks", parts.length === 3 && parts[1].blockId === "p25", parts.map((p) => p.blockId).join(" "));
const headed = [{ id: "h0", type: "HEADING", text: "Title", order: 0, html: "<h1>" }, ...plain.slice(0, 5), { id: "h1", type: "HEADING", text: "Method", order: 6, html: "<h2>" }];
check("partsFor: headings when there are some", partsFor(null, headed).some((p) => p.blockId === "h1"));
check("partsFor: stored contents first", partsFor([{ title: "X", blockId: "p3", level: 1 }], plain).map((p) => p.blockId).join(" ") === "p3");
check("partsFor: a short document is one part", partsFor(null, plain.slice(0, 10)).length === 0);

console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
