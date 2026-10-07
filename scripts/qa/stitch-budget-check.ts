// Checks for Stitch's pure functions (SPEC.md §22): the token estimate, the
// command's kind, the answer pass's budget by kind, the history's block
// tags as aliases, the reply's citations, and the skeleton's parts without
// a contents call. No model, no database rows.
// Run: npx tsx scripts/qa/stitch-budget-check.ts
import { STITCH_SELECTED_BLOCKS, STITCH_SELECTED_BUDGET } from "../../src/lib/derive/config";
import { partsFor } from "../../src/lib/graph/skeleton";
import { readFileSync } from "node:fs";
import {
  answerMessages,
  citedAliases,
  citedBlocks,
  commandKind,
  cutSelection,
  expandPick,
  firstsFirst,
  historyWithAliases,
  interleave,
  readingOf,
  replyWithIds,
  skeletonGroups,
  type SkeletonView,
} from "../../src/lib/graph/stitch";
import { stitchExpandPrompt, stitchPrompt, stitchRules, stitchSelectPrompt } from "../../src/lib/prompts/stitch";
import { skeletonPrompt } from "../../src/lib/prompts/skeleton";
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
  ["Summarise what all the documents say about installation delays", "question"],
  ["Make that a page", "page"],
  ["Where do these documents contradict each other?", "links"],
  ["Connect the sections that answer this question", "links"],
  ["Where do the reports disagree on cost?", "links"],
  ["叔本华如何看待痛苦？", "question"],
  ["尼采和叔本华在同情问题上有何不同？", "question"],
  ["把所有关于同情的段落汇集成一页。", "page"],
  ["这些文档在哪些地方相互矛盾？", "links"],
  // Round 2 (COST2-06): commands in the style of a real project.
  ["What did Nietzsche write about pity?", "question"],
  ["How does Nietzsche link suffering and growth?", "question"],
  ["Is there a connection between the will to live and boredom?", "question"],
  ["What do all of these documents say about education?", "question"],
  ["Give me an overview of how the two thinkers relate", "question"],
  ["Summarise the chronology of Nietzsche's break with Wagner", "question"],
  ["List every claim about Schopenhauer's influence", "page"],
  ["Make a timeline of Nietzsche's life from these notes", "page"],
  ["Draw links between the notes and the essay", "links"],
  ["Which passages contradict the Comprehensive Chronological Report?", "links"],
  ["Where do they disagree about pity?", "links"],
  ["Explain the difference between master and slave morality", "question"],
  ["Compare the two essays on education", "question"],
  ["What conflicts did Nietzsche have with his publisher?", "question"],
  ["How many pages does the BOOK TWO section run?", "question"],
  ["Create a study guide from all documents", "page"],
  ["哪些地方尼采与叔本华的观点有冲突？", "links"],
  ["尼采写了哪些关于同情的话？", "question"],
  ["把叔本华对教育的看法整理成一页", "page"],
  ["请给我一个时间线", "page"],
  ["Summarise the chronology into one page", "page"],
  ["总结这些文档对教育的看法", "question"],
];
for (const [command, want] of kinds) check(`commandKind "${command}"`, commandKind(command) === want, commandKind(command));
// The answers audit's 27 commands (round 2), when its data is on this machine.
const ANS = "/home/user/unitos/.qa-tmp/stitch/r2/ans/commands.json";
const ANS_KIND: Record<string, ReturnType<typeof commandKind>> = { "P1-11": "links", "P1-12": "page", "P2-10": "links" };
try {
  const ans = JSON.parse(readFileSync(ANS, "utf8")) as { id: string; command: string }[];
  const wrong = ans.filter((c) => commandKind(c.command) !== (ANS_KIND[c.id] ?? "question"));
  check(`commandKind: the answers audit's ${ans.length} commands`, wrong.length === 0, wrong.map((c) => c.id).join(" "));
} catch {
  console.log("skip the answers audit's commands (not on this machine)");
}

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
check("interleave keeps every list's first first", interleave([["A1", "A2"], ["B1"], ["C1", "C2"]]).join(" ") === "A1 B1 C1 A2 C2");
// COST2-04: one call's order is kept, every document's first pick in front.
const docOf = (a: string) => blockByRef.get(a)?.documentId;
check(
  "firstsFirst: each document's first pick, then the call's order",
  firstsFirst(["A5", "A6", "A7", "B2", "A8", "C9", "B3", "Z1"], docOf).join(" ") === "A5 B2 C9 A6 A7 A8 B3",
  firstsFirst(["A5", "A6", "A7", "B2", "A8", "C9", "B3", "Z1"], docOf).join(" "),
);
{
  // A question about one document's topic: its late blocks survive the cut
  // because the call ranked them first, not after every other document's.
  const call = ["A150", "A151", "A152", "A153", "A154", "A155", ...Array.from({ length: 60 }, (_, i) => `${"BCD"[i % 3]}${i + 1}`)];
  const cut = cutSelection(firstsFirst(call, docOf), blockByRef, "question");
  check("cutSelection after firstsFirst keeps the call's best blocks", ["A150", "A155"].every((a) => cut.has(a)), [...cut].slice(0, 8).join(" "));
}
check("expandPick range", expandPick("B10-B12").join(" ") === "B10 B11 B12");

// ── history as aliases, citations ──
const titles = new Map([["idOther", "Board memo"]]);
const turn = "Final report says 1,240 [block idA2]; another doc [block idOther]; gone [block idGone]; alias [block b3].";
check(
  "historyWithAliases: stored id → alias, other doc → title, unknown → dropped",
  historyWithAliases(turn, blockByRef, titles) === 'Final report says 1,240 [block A2]; another doc (a passage of "Board memo"); gone ; alias [block B3].',
  historyWithAliases(turn, blockByRef, titles),
);
const listed = replyWithIds("Both [block B19, block B21] and [block A2, A3] and [blocks C4; C5].", blockByRef);
check(
  "replyWithIds splits a tag that names several blocks",
  listed === "Both [block idB19] [block idB21] and [block idA2] [block idA3] and [block idC4] [block idC5].",
  listed,
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
check("answer prompt: partial-read sentence when a pick reads it whole", next.includes("pick it and one short document in the graph"));
check("answer prompt: partial-read sentence for a long document", next.includes("ask about one part of it"));
check("answer prompt: never the sentence for a document with nothing shown", next.includes("Never write the sentence for a document with no blocks shown"));
check("answer rules: one block per tag", rules.includes("one block per tag"));
// Round 2 judge fixes.
check("answer rules: a summary is a reply unless it asks for a page", rules.includes("and a summary (summarise, overview, outline) get reply only"));
check("answer rules: causes and effects before \"says nothing\"", rules.includes("check its blocks for the topic's causes and effects"));
check("answer rules: different causes differ only when one denies the other", rules.includes("differ only when one denies the other's cause"));
check("answer rules: closest figures when the documents do not answer", rules.includes("give the closest figures they do give"));
check("answer rules: an unread document that could hold the answer", rules.includes("say in one sentence that it has no text to read"));
check("answer rules: a why question leads with the reason", rules.includes("A why question starts with the reason the documents give"));
check("answer rules: a count equals the quote parts", rules.includes("equals the number of its quote parts"));
check("answer prompt: the not-read sentence for every document that could hold the answer", next.includes("for every document that shows some of its blocks and whose blocks not shown could hold the answer, cited or not"));
check("answer prompt: unread named only when it bears", first.includes("only when the command asks about them"));
const select = stitchSelectPrompt({ documents: docs, command: "And the second one?", continued: true, earlier: ["List the two studies."], cited: ["B3"], maxBlocks: 150, partial: false });
check("select prompt: earlier commands", select.includes("- List the two studies."));
check("select prompt: cited blocks", select.includes("[block B3]"));
check("select prompt: kind's block cap", select.includes("up to 150"));
check("select prompt: best block first, even late", select.includes("even when it comes late in its document"));
const expand = stitchExpandPrompt({ command: "Where does the overman first appear?", earlier: ["Who is Zarathustra?"], titles: ["Thus Spake Zarathustra"], maxWords: 15 });
check("expand prompt: the command, the earlier commands, the titles, the cap", expand.includes("overman") && expand.includes("- Who is Zarathustra?") && expand.includes('"Thus Spake Zarathustra"') && expand.includes("up to 15"));
check("expand prompt: JSON words", expand.includes('{"words"'));
check("skeleton prompt: the line cap scales past 400 words", skeletonPrompt({ parts: [], window: 1, windows: 1, blockCount: 3 }).includes("one word in ten for a block over 400 words"));

// ── the answer pass's sections ──
{
  const mk = (id: string, title: string, n: number, words: number) => ({
    id,
    title,
    generatedCommand: null,
    skeleton: null,
    handwritten: false,
    importRev: null,
    pageLabels: null,
    conversionStatus: "NONE",
    conversionError: null,
    video: null,
    blocks: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, type: "PARAGRAPH", text: `${title} paragraph ${i} ${"word ".repeat(words)}`, startTime: null, endTime: null, cell: null, page: null })),
  });
  // A: long (about 40k tokens), B: short, C: medium (about 20k), D: nothing picked.
  const docs = [mk("a", "Long book", 400, 400), mk("b", "Short notes", 10, 20), mk("c", "Medium essay", 100, 200), mk("d", "Other essay", 100, 200)];
  const reading = readingOf(docs as unknown as Parameters<typeof readingOf>[0]);
  const sel = new Set(["A1", "A3", "B1", "C2", "C4"]);
  const sys = String(answerMessages({ reading, selected: sel, lang: "en", profile: null as unknown as Parameters<typeof answerMessages>[0]["profile"], history: [], command: "x" })[0].content);
  check("answer sections: a long document is not 'read whole when picked'", /\[document A\] "Long book" \([^)]*shown\)/.test(sys) && !/Long book" \([^)]*read whole/.test(sys));
  check("answer sections: a medium document is 'read whole when picked'", /Medium essay" \([^)]*; read whole when picked with one short document\)/.test(sys));
  check("answer sections: a gap of one is '1 block not shown'", sys.includes("(1 block not shown)") && !sys.includes("(1 blocks not shown)"));
  check("answer sections: a document with nothing shown is one line", !sys.includes('[document D]') && sys.includes('No block shown for this command: "Other essay" (100 blocks).'));
}

// ── skeleton groups close at a document's end ──
{
  const view = (letter: string, n: number, words: number) =>
    ({
      r: { letter },
      gist: "",
      parts: [],
      lines: Array.from({ length: n }, (_, i) => ({ alias: `${letter}${i + 1}`, text: "word ".repeat(words), partAlias: null })),
    }) as unknown as SkeletonView;
  // Three documents of about 3.2k tokens each, groups of 8k: two fit a
  // group, the third starts the next one rather than splitting.
  const views = [view("A", 60, 40), view("B", 60, 40), view("C", 60, 40)];
  const groups = skeletonGroups(views, null, 5_000, 8_000);
  const split = views.filter((v) => groups.filter((g) => g.views.includes(v)).length > 1);
  check("skeletonGroups: a document that fits a group is never split", split.length === 0 && groups.length === 2, `${groups.length} groups, split ${split.map((v) => v.r.letter).join("")}`);
  const big = skeletonGroups([view("A", 300, 40)], null, 5_000, 8_000);
  check("skeletonGroups: a document over a group runs over several", big.length >= 2, String(big.length));
}

// ── skeleton parts without a contents call ──
const plain = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, type: "PARAGRAPH", text: `Paragraph ${i} says something long enough.`, order: i, html: null }));
const parts = partsFor(null, plain);
check("partsFor: no headings → a part every 25 blocks", parts.length === 3 && parts[1].blockId === "p25", parts.map((p) => p.blockId).join(" "));
check("partsFor: a fallback part is titled by its blocks", parts[1].title === "Blocks 26–50", parts[1].title);
const footed = plain.map((b, i) => (i === 25 ? { ...b, text: "[Footnote 3: see above.]" } : b));
check("partsFor: a fallback part never starts at a footnote", partsFor(null, footed)[1].blockId === "p26");
const headed = [{ id: "h0", type: "HEADING", text: "Title", order: 0, html: "<h1>" }, ...plain.slice(0, 5), { id: "h1", type: "HEADING", text: "Method", order: 6, html: "<h2>" }];
check("partsFor: headings when there are some", partsFor(null, headed).some((p) => p.blockId === "h1"));
check("partsFor: stored contents first", partsFor([{ title: "X", blockId: "p3", level: 1 }], plain).map((p) => p.blockId).join(" ") === "p3");
check("partsFor: a short document is one part", partsFor(null, plain.slice(0, 10)).length === 0);

console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
