// Checks for Stitch's pure functions (SPEC.md §22): the token estimate, the
// command's kind, the answer pass's budget by kind, the history's block
// tags as aliases, the reply's citations, and the skeleton's parts without
// a contents call. No model, no database rows.
// Run: npx tsx scripts/qa/stitch-budget-check.ts
import { STITCH_HISTORY_FIRST_MIN, STITCH_READ_HISTORY, STITCH_SELECTED_BLOCKS, STITCH_SELECTED_BUDGET } from "../../src/lib/derive/config";
import { translatorFor } from "../../src/lib/i18n/dictionaries";
import { parseMarkdown } from "../../src/lib/parse/markdown";
import { partsFor } from "../../src/lib/graph/skeleton";
import { readFileSync } from "node:fs";
import {
  answerMessages,
  assignSources,
  checkReplyQuotes,
  duplicateLink,
  existingPairs,
  pageCommand,
  recordText,
  resolveQuote,
  sentenceWindow,
  citedAliases,
  citedBlocks,
  commandKind,
  commandNames,
  cutLines,
  cutSelection,
  expandPick,
  firstsFirst,
  historyWithAliases,
  interleave,
  nameHits,
  readingOf,
  replyLanguage,
  replyWithIds,
  skeletonGroups,
  type SkeletonView,
} from "../../src/lib/graph/stitch";
import { asksWhere, stitchExpandPrompt, stitchPrompt, stitchRules, stitchSelectPrompt } from "../../src/lib/prompts/stitch";
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
  // Round 3 (ANS3-02): Chinese page words open the command; a bare noun
  // (第一页, 时间线, 页面) or a verb inside a question is not a page.
  ["讲义第一页说了叔本华的哪些生平？", "question"],
  ["这些文档是怎么整理尼采的思想的？", "question"],
  ["讲义里的时间线对吗？", "question"],
  ["讲义和原文有没有不一致的地方？", "links"],
  ["尼采写一本书要多久？", "question"],
  ["页面上的引文是谁说的？", "question"],
  ["What does the timeline in my notes get wrong?", "question"],
  ["Which page does Mencken mention Parsifal on?", "question"],
  ["汇集所有关于怜悯的段落", "page"],
  ["把每份文档关于怜悯的说法整理成一页", "page"],
  ["写一页关于永恒轮回的总结", "page"],
  ["请列出查拉图斯特拉各部分的写作时间", "page"],
  ["Make a timeline of Nietzsche's life from these documents", "page"],
  ["Gather every passage on pity", "page"],
  ["Write a page on pity in each document.", "page"],
  ["Do my notes contradict any of the other documents?", "links"],
  ["叔本华认为自杀是罪行吗？", "question"],
  // Round 3 (REV3-06): everyday phrasings — a polite opening before the
  // verb, idiom verbs that make nothing, list without every/all/each.
  ["Could you gather what each author says about pity?", "page"],
  ["Can you collect the passages on suffering into one place?", "page"],
  ["I want a page of every quote about pity", "page"],
  ["Please write one page that combines what they say about the will", "page"],
  ["Summarize the project", "question"],
  ["Make sense of Nietzsche's view of pity for me", "question"],
  ["Put simply, what is the will to power?", "question"],
  ["List the three reasons Schopenhauer gives for pity", "question"],
  ["Turn to the Genealogy: what does he mean by ressentiment?", "question"],
  ["Build an argument: is pity a virtue?", "question"],
  ["What links pity and the will?", "question"],
  ["Where do they disagree about suffering?", "links"],
  ["Link the passages on pity", "links"],
  ["Find the contradictions", "links"],
  ["Is there any inconsistency in his use of 'pity'?", "links"],
  ["把关于同情的段落整理成一页", "page"],
  ["总结这些文档", "question"],
  ["列出所有关于同情的段落", "page"],
  ["他们在哪些地方意见不同？", "links"],
  ["尼采怎么看待同情与意志的联系？", "question"],
  // More everyday phrasings of the same rules.
  ["I'd like you to put these passages together in one place", "page"],
  ["Could you turn these quotes into a page?", "page"],
  ["Would you please make me a reading list from these documents", "page"],
  ["Can you connect the notes to the essay?", "links"],
  ["Make the case that pity is a weakness, from the documents", "question"],
  ["Could you tell me what Schopenhauer means by the will?", "question"],
  ["你能把这些段落汇总成一页吗？", "page"],
  ["列出叔本华给出的三个理由", "question"],
  ["尼采和叔本华的看法相反吗？", "links"],
];
for (const [command, want] of kinds) check(`commandKind "${command}"`, commandKind(command) === want, commandKind(command));
// The round 3 answers audit's 37 commands: every one a question.
try {
  const ans3 = JSON.parse(readFileSync("/home/user/unitos/.qa-tmp/stitch/r3/ans/commands.json", "utf8")) as { id: string; command: string }[];
  const wrong = ans3.filter((c) => commandKind(c.command) !== "question");
  check(`commandKind: the round 3 answers audit's ${ans3.length} commands are questions`, wrong.length === 0, wrong.map((c) => c.id).join(" "));
} catch {
  console.log("skip the round 3 answers audit's commands (not on this machine)");
}
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
check("answer prompt: never the sentence for a document with nothing shown", next.includes("never for a document with no blocks shown"));
check("answer rules: one block per tag", rules.includes("one block per tag"));
// Round 2 judge fixes.
check("answer rules: a summary is a reply unless it asks for a page", rules.includes("and a summary (summarise, overview, outline) get reply only"));
check("answer rules: causes and effects before \"says nothing\"", rules.includes("check its blocks for the topic's causes and effects"));
check("answer rules: different causes differ only when one denies the other", rules.includes("differ only when one denies the other's cause"));
// Round 3 (ANS3-06): "the documents don't say" in one sentence, a figure
// only when it is the same quantity, and one partial-read sentence at most.
check("answer rules: no padding when the documents do not answer", rules.includes("say so in one sentence. Then give a figure only when a block shown gives the same quantity for another scope or date; else stop.") && !rules.includes("closest figures"));
check("answer prompt: one partial-read sentence, for the likeliest document", next.includes("add one sentence, for the one document most likely to hold the rest") && next.includes("Never add it when no document is likely to hold the answer"));
// Round 3 (ANS3-07): the reader's later dated value replaces the earlier.
check("answer rules: a later-dated change comes first", rules.includes("never pick one. Except: when a later-dated document of the reader's says the value changed"));
// Round 3 (ANS3-05): quotes in the reply are copied exactly.
check("answer rules: a quote in reply is copied exactly", rules.includes("A quote in reply is copied exactly from the block it cites; cut words with … instead of rewording."));
// Round 3 (ANS3-01): which-documents lists on a partial read say so.
check("answer prompt: a which-documents list on a partial read says it covers the blocks read", next.includes("say in one sentence that the list covers the blocks read for this command"));
check("answer rules: an unread document that could hold the answer", rules.includes("say in one sentence that it has no text to read"));
check("answer rules: a why question leads with the reason", rules.includes("A why question starts with the reason the documents give"));
check("answer rules: a count equals the quote parts", rules.includes("equals the number of its quote parts"));
check("answer prompt: unread named only when it bears", first.includes("only when the command asks about them"));
const select = stitchSelectPrompt({ documents: docs, command: "And the second one?", continued: true, earlier: ["List the two studies."], cited: ["B3"], maxBlocks: 150, partial: false });
check("select prompt: earlier commands", select.includes("- List the two studies."));
check("select prompt: cited blocks", select.includes("[block B3]"));
check("select prompt: kind's block cap", select.includes("up to 150"));
check("select prompt: best block first, even late", select.includes("even when it comes late in its document"));
const expand = stitchExpandPrompt({ command: "Where does the overman first appear?", earlier: ["Who is Zarathustra?"], titles: ["Thus Spake Zarathustra"], maxWords: 15 });
check("expand prompt: the command, the earlier commands, the titles, the cap", expand.includes("overman") && expand.includes("- Who is Zarathustra?") && expand.includes('"Thus Spake Zarathustra"') && expand.includes("up to 15"));
check("expand prompt: JSON words", expand.includes('{"words"'));
// Round 3 (ANS3-03): the words in the documents' language, whatever the command's.
check("expand prompt: the documents' language, even for a command in another", expand.includes("a Chinese command over English documents gets English words"));
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

// ── Round 3 (ANS3-01): the command's rare names and the blocks naming them ──
check("commandNames: a capitalised word after the first", commandNames("Which of these documents mention Darwin, and what do they say about him?").join("|") === "Darwin");
check("commandNames: a run is one name, question words drop", commandNames("Who is the one figure in the New Testament that Nietzsche says deserves honour?").join("|") === "New Testament|Nietzsche");
check("commandNames: quoted phrases and 《》", commandNames('What does "eternal recurrence" mean?').includes("eternal recurrence") && commandNames("翻译《敌基督》之前已经有哪些英译本？").join("|") === "敌基督");
{
  const blocks = [
    { alias: "A11", text: "a clergyman criticising Darwin's hypothesis of natural selection" },
    { alias: "A12", text: "the Darwinists" },
    { alias: "A13", text: "nothing here" },
    { alias: "B13", text: "a million Darwins and Harnacks" },
    { alias: "C1", text: "undarwinian" },
  ];
  const hits = nameHits("Which documents mention Darwin?", blocks);
  check("nameHits: word-start matches, any case, not inside a word", hits.length === 1 && hits[0].aliases.join(" ") === "A11 A12 B13", JSON.stringify(hits));
  const common = Array.from({ length: 12 }, (_, i) => ({ alias: `A${i + 1}`, text: "Kant again" }));
  check("nameHits: a name in more than 8 blocks is common and drops", nameHits("What does Nietzsche hold against Kant?", common).length === 0);
  const sel = stitchSelectPrompt({ documents: docs, command: "Which documents mention Darwin?", continued: false, earlier: [], cited: [], maxBlocks: 150, partial: false, names: hits });
  check("select prompt: the blocks that name the rare name", sel.includes('Blocks whose full text names "Darwin", though their skeleton line may not: A11, A12, B13.'));
  const all = stitchPrompt({ documents: docs, command: "x", continued: false, selected: true, names: [{ term: "Darwin", total: 3, shown: 3 }] });
  const part = stitchPrompt({ documents: docs, command: "Which documents mention Darwin?", continued: false, selected: true, names: [{ term: "Darwin", total: 5, shown: 3 }] });
  check("answer prompt: every block naming it shown", all.includes('Every block of the documents read that names "Darwin" is shown above (3).'));
  check("answer prompt: some blocks naming it not shown, the list is partial", part.includes('5 blocks of the documents read name "Darwin"; 3 of them are shown above. A list of where "Darwin" is named is partial: say so.'));
  check("answer prompt: no partial-list hedge when every block naming the name is shown", !all.includes("the list covers the blocks read") && part.includes("the list covers the blocks read"));
}

// ── Round 3 (ANS3-05): the reply's quotes against the blocks cited ──
{
  const quoteBlocks = new Map<string, B>([
    ["F56", { id: "idF56", alias: "F56", type: "PARAGRAPH", text: "Christianity wants to master beasts of prey; its method is to make them _ill_ — to make feeble is the Christian recipe.", documentId: "docF" }],
    ["B19", { id: "idB19", alias: "B19", type: "PARAGRAPH", text: "It was in the month of August 1881 in Sils Maria, 6,000 feet above the sea.", documentId: "docB" }],
  ]);
  const titles = new Set(["The Antichrist"]);
  const q = checkReplyQuotes(
    [
      'In "The Antichrist" he says its method is "to make them _ill_" [block F56], not "by making them _ill_" [block F56].',
      'The idea came "in the month of August 1881 in Sils Maria" [block B19], or "in August 1881 in Sils Maria" [block B19].',
      'Cut words stay a quote: "It was in the month … in Sils Maria" [block B19].',
      "A Chinese line quotes “to make feeble is the Christian recipe” [block F56].",
    ].join("\n"),
    quoteBlocks,
    titles,
  );
  const lines = q.reply.split("\n");
  check("checkReplyQuotes: a verbatim quote keeps its marks", lines[0].includes('"to make them _ill_" [block F56]') && lines[1].includes('"in the month of August 1881 in Sils Maria"'));
  check("checkReplyQuotes: a title in quote marks is left alone", lines[0].includes('In "The Antichrist"'));
  check("checkReplyQuotes: a misquote loses its marks, keeps its words", lines[0].includes("not by making them _ill_ [block F56]") && lines[1].includes("or in August 1881 in Sils Maria [block B19]"), lines.slice(0, 2).join(" / "));
  check("checkReplyQuotes: cut words (…) stay a quote", lines[2].includes('"It was in the month … in Sils Maria"'));
  check("checkReplyQuotes: curly quotes are checked too", lines[3].includes("“to make feeble is the Christian recipe”"));
  check("checkReplyQuotes: the misquotes are counted", q.unquoted.length === 2, q.unquoted.join(" | "));
}

// ── Round 3 (ANS3-04): the reply's language, one switch ──
check("replyLanguage ui (the default): the UI's, whatever the command", replyLanguage("翻译《敌基督》之前已经有哪些英译本？", "en") === "en" && replyLanguage("When did he die?", "zh") === "zh");
check("replyLanguage command: a Chinese question under an English UI is answered in Chinese", replyLanguage("翻译《敌基督》之前已经有哪些英译本？门肯怎么评价它们？", "en", "command") === "zh");
check("replyLanguage command: an English question under a Chinese UI is answered in English", replyLanguage("What does Mencken predict about the plutocracy?", "zh", "command") === "en");
check("replyLanguage command: a mixed or short command keeps the UI's", replyLanguage("Zarathustra 是谁", "en", "command") === "en" && replyLanguage("ok?", "zh", "command") === "zh");
{
  const mkDoc = (id: string) => ({ id, title: id, generatedCommand: null, skeleton: null, handwritten: false, importRev: null, pageLabels: null, conversionStatus: "NONE", conversionError: null, video: null, blocks: [{ id: `${id}-0`, type: "PARAGRAPH", text: "text", startTime: null, endTime: null, cell: null, page: null }] });
  const reading = readingOf([mkDoc("a"), mkDoc("b")] as unknown as Parameters<typeof readingOf>[0]);
  const profile = null as unknown as Parameters<typeof answerMessages>[0]["profile"];
  const sysOf = (lang: "en" | "zh") => String(answerMessages({ reading, selected: null, lang, profile, history: [], command: "x" })[0].content);
  check("answer pass: the reply language reaches the rules", sysOf(replyLanguage("尼采在哪里第一次想到永恒轮回？", "en", "command")).includes("in Chinese") && sysOf(replyLanguage("尼采在哪里第一次想到永恒轮回？", "en")).includes("reply: the answer to the command, in English"));
}

// ── Round 3 (COST3-01): first picks capped at a third of the budget ──
{
  // 100 documents, the select pass's best 12 blocks in two documents, then
  // every document's one weak match: today the weak matches fill the
  // question's budget; capped, the best blocks are read.
  const big = new Map<string, B>();
  const docOf100 = (a: string) => big.get(a)?.documentId;
  const order: string[] = [];
  const mk = (alias: string, doc: string, words: number) => {
    const b: B = { id: `id${alias}`, alias, type: "PARAGRAPH", text: "word ".repeat(words), documentId: doc };
    big.set(alias, b);
    return alias;
  };
  for (let i = 1; i <= 6; i++) order.push(mk(`A${i}`, "docA", 400));
  for (let i = 1; i <= 6; i++) order.push(mk(`B${i}`, "docB", 400));
  for (let d = 0; d < 100; d++) order.push(mk(`D${d}Z1`, `doc${d}`, 400));
  const costOf = (a: string) => estTokens(big.get(a)!.text) + 10;
  const best = order.slice(0, 12);
  const today = cutSelection(firstsFirst(order, docOf100), big, "question");
  const capped = cutSelection(firstsFirst(order, docOf100, { tokens: STITCH_SELECTED_BUDGET.question / 3, costOf }), big, "question");
  const kept = (set: Set<string>) => best.filter((a) => set.has(a)).length;
  check("firstsFirst cap: 100 documents, the best blocks survive the cut", kept(capped) === 12 && kept(today) < 12, `best kept: today ${kept(today)}/12, capped ${kept(capped)}/12`);
  const few = ["A5", "A6", "B2", "A7", "C9", "B3"];
  check("firstsFirst cap: under a third of the budget the order is unchanged", firstsFirst(few, docOf, { tokens: STITCH_SELECTED_BUDGET.question / 3, costOf: (a) => estTokens(blockByRef.get(a)!.text) + 10 }).join(" ") === firstsFirst(few, docOf).join(" "));
}

// ── Round 4 (ENGINE4) ──
{
  const end = (block: string, start: number, stop: number) => ({ block, start, end: stop });
  // ANS4-01: the round 2 link G6→B20 (quote 0–120), proposed again.
  const kept: Parameters<typeof duplicateLink>[1] = [[end("G6", 0, 120), end("B20", 40, 200)]];
  check("duplicateLink: the same pair, a quote one period longer", duplicateLink([end("G6", 0, 121), end("B20", 40, 200)], kept));
  check("duplicateLink: the same pair reversed (F24→E53 after E53→F24)", duplicateLink([end("B20", 60, 90), end("G6", 300, 400)], kept));
  check("duplicateLink: other passages of the same two blocks are a new link", !duplicateLink([end("G6", 200, 300), end("B20", 300, 400)], kept));
  check("duplicateLink: one block shared, the other end elsewhere, is a new link", !duplicateLink([end("G6", 0, 120), end("B21", 0, 50)], kept));
  check("duplicateLink: a whole-document link overlaps its document's end", duplicateLink([end("G6", 10, 20), end("docB", 0, 5)], [[end("G6", 0, 50), end("docB", 0, Number.MAX_SAFE_INTEGER)]]));
  const pairs = existingPairs([{ from: "G6", to: "B20" }, { from: "B20", to: "G6" }, { from: "G7", to: "A8" }, { from: "G10", to: "E73" }], (a) => a !== "E73");
  check("existingPairs: once per pair, only when both blocks are shown", pairs.join("; ") === "[block G6] – [block B20]; [block G7] – [block A8]", pairs.join("; "));
  const docs4 = [{ tag: "A", title: "Mencken", read: true }, { tag: "B", title: "Notes", read: true }];
  const withLinks = stitchPrompt({ documents: docs4, command: "Find the contradictions", continued: false, selected: true, existing: pairs });
  check("answer prompt: the links already in the project", withLinks.includes("Links already in the project between the blocks above: [block G6] – [block B20]; [block G7] – [block A8]. Never propose them again"));
  check("answer prompt: no links line when none", !stitchPrompt({ documents: docs4, command: "x", continued: false, selected: true }).includes("Links already in the project"));
  check("answer rules: the link count is the links proposed, the listed ones said to be there", rules.includes("a count of links equals the number of links you propose. A link listed as already in the project is never proposed again"));
  const en = translatorFor("en");
  const zh = translatorFor("zh");
  check("reply note: N already in the graph, en and zh", en("stitch.stitchLinksExistingN", { n: 3 }).startsWith("3 of the links proposed were already in the graph") && zh("stitch.stitchLinksExisting1", { n: 1 }).includes("1 条已在图谱中"), `${en("stitch.stitchLinksExistingN", { n: 3 })} / ${zh("stitch.stitchLinksExisting1", { n: 1 })}`);

  // ANS4-02: a turn's record.
  const rec = recordText(
    { links: [{ id: "l1", from: "Notes", to: "Mencken" }, { id: "l2", from: "Notes", to: "Essays" }, { id: "gone", from: "Notes", to: "Zarathustra" }], document: { id: "p", title: "Pity in both" } },
    new Map([
      ["l1", { id: "l1", fromBlockId: "idA2", toBlockId: "idB3", reason: "Both date the printing.", recommended: true }],
      ["l2", { id: "l2", fromBlockId: "idA5", toBlockId: "idC9", reason: "Pity\nmultiplies suffering.", recommended: false }],
    ]),
    [
      { quote: false, sources: [] },
      { quote: true, sources: [{ blockId: "idA2", title: "Notes" }] },
      { quote: true, sources: [{ blockId: "idA5", title: "Notes" }] },
      { quote: true, sources: [{ blockId: "idB3", title: "Mencken" }] },
      { quote: false, sources: [{ blockId: "idB3", title: "Mencken" }] },
    ],
  );
  check("recordText: each link numbered, its blocks and its stored reason", rec.includes("- link 1: [block idA2] – [block idB3]: Both date the printing.") && rec.includes("- link 2 (accepted): [block idA5] – [block idC9]: Pity multiplies suffering."), rec);
  check("recordText: a link gone from the project by its titles", rec.includes('- link 3: "Notes" – "Zarathustra" (no longer in the graph)'));
  check("recordText: the page's quote parts counted by document", rec.includes('- page "Pity in both": 3 quote parts ("Notes" 2, "Mencken" 1): [block idA2] [block idA5] [block idB3]; 1 text block with sources'), rec);
  check("recordText: nothing stored is no record", recordText({ links: [], document: null }, new Map(), null) === "");
  check("recordText: the history's tags become this reading's aliases", historyWithAliases(rec, blockByRef, new Map()).includes("[block A2] – [block B3]"));

  // ANS4-03: the sources of a text part of two paragraphs and a list.
  const md = "Nietzsche dates the idea to August 1881 at Sils Maria.\n\nMencken reads the recurrence as a mocking criticism of progress.\n\n- animals are happy\n- the present moment alone";
  const blocks4 = parseMarkdown(md);
  const src = (q: string) => ({ quotedText: q });
  const spread = assignSources(blocks4, [src("in the month of August 1881 in Sils Maria"), src("a mocking criticism of the idea of progress"), src("the animal is happy in the present moment")]);
  check("assignSources: each paragraph and the list get their own sources", spread.length === 3 && spread.every((s) => s.length === 1) && spread[1][0].quotedText.includes("mocking"), JSON.stringify(spread.map((s) => s.map((x) => x.quotedText.slice(0, 12)))));
  const lonely = assignSources(parseMarkdown("One finding.\n\nAnother, with no shared words."), [src("finding")]);
  check("assignSources: a block that gets none takes the first source", lonely.every((s) => s.length === 1));
  check("answer rules: a text part is one paragraph or one list", rules.includes("A finding in two paragraphs is two text parts, each with its own sources."));

  // ANS4-04: a text part's misquote loses its marks (checkReplyQuotes as it is).
  const recurrence = new Map<string, B>([["B19", { id: "idB19", alias: "B19", type: "PARAGRAPH", text: "The idea first occurred to me in August 1881 at Sils Maria.", documentId: "docB" }]]);
  const textPart = checkReplyQuotes('Nietzsche says it "first came to me in August 1881" at Sils Maria.', recurrence, new Set());
  check("page text part: a misquote loses its marks", textPart.unquoted.length === 1 && !textPart.reply.includes('"first came'));

  // ANS4-05: a quote two words off resolves to its sentence, not the whole block.
  const a16text = "The plutocracy is fat and the proletariat is lean. ".repeat(12) + "Here, perhaps, there is an example of the eternal recurrence that Nietzsche was fond of mulling over in his blacker moods. " + "Every revolution ends where it began. ".repeat(20);
  const a16 = new Map<string, B>([["A16", { id: "idA16", alias: "A16", type: "PARAGRAPH", text: a16text, documentId: "docA" }]]);
  const near = resolveQuote(a16, "A16", "Here, perhaps, there is an example of the eternal recurrence that Nietzsche was so fond of mulling over in his darker moods.");
  check("resolveQuote: a quote two words off is its sentence", near?.quotedText === "Here, perhaps, there is an example of the eternal recurrence that Nietzsche was fond of mulling over in his blacker moods.", near?.quotedText.slice(0, 80));
  const off = resolveQuote(a16, "A16", "A sentence that this block never says about anything at all, really.");
  check("resolveQuote: a quote in no sentence is still the whole block", off?.quotedText.length === a16text.length);
  check("sentenceWindow: never more than 2.5 times the quote", sentenceWindow("Short one. " + "x ".repeat(400) + "end.", "Short one two") !== null && sentenceWindow("a b c d e f g h i j k l m n o p.", "a b c") === null);
  check("sentenceWindow: Chinese sentences", (() => { const t = "叔本华说同情是道德的基础。尼采说同情使痛苦加倍。"; const w = sentenceWindow(t, "尼采认为同情让痛苦加倍"); return w !== null && t.slice(w.start, w.end) === "尼采说同情使痛苦加倍。"; })());

  // ANS4-06: title words are not rare names; the hedge only for "which/where".
  const named = [{ alias: "A23", text: "H. L. Mencken" }, { alias: "C5", text: "Beyond Good and Evil was written" }, { alias: "D2", text: "democracy, Beyond Good" }];
  const h1 = nameHits("What do the Mencken introduction, Beyond Good and Evil and The Antichrist each say about democracy?", named, ["Friedrich Nietzsche", "Beyond Good and Evil (Chapters I–III)", "BOOK TWO", "The Antichrist"]);
  check("nameHits: a term in a title of a document read drops; Mencken stays", !h1.some((n) => n.term.startsWith("Beyond Good")) && !h1.some((n) => n.term.includes("Antichrist")) && h1.some((n) => n.term === "Mencken"), JSON.stringify(h1));
  check("nameHits: without titles the term stays (old behaviour)", nameHits("What does Beyond Good say?", named).some((n) => n.term === "Beyond Good"));
  check("asksWhere: which documents, mention, where … discussed, 哪些, 提到", ["Which documents mention Darwin?", "Where is Parsifal discussed?", "Every passage that names Wagner", "哪些文档提到达尔文？"].every(asksWhere));
  check("asksWhere: not a question about a topic", !["What do they each say about democracy?", "How many years passed?", "Why did Nietzsche praise St. Paul?"].some(asksWhere));
  const h1p = stitchPrompt({ documents: docs4, command: "What do the Mencken introduction and The Antichrist each say about democracy?", continued: false, selected: true, names: [{ term: "Mencken", total: 2, shown: 0 }] });
  check("answer prompt: no name hedge on a question that asks no list", !h1p.includes("is named is partial"));

  // ANS4-07: the gist under each document's header.
  const mkG = (id: string, title: string, gist: string | null, n: number) => ({
    id, title, generatedCommand: null, skeleton: gist === null ? null : { v: 1, gist, parts: [], lines: [], chars: 0 },
    handwritten: false, importRev: null, pageLabels: null, conversionStatus: "NONE", conversionError: null, video: null,
    blocks: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, type: "PARAGRAPH", text: `paragraph ${i} of ${title}`, startTime: null, endTime: null, cell: null, page: null })),
  });
  const gReading = readingOf([mkG("d", "BOOK TWO", "Beyond Good and Evil, chapters V and VII: the natural history of morals.", 3), mkG("e", "Notes", null, 2)] as unknown as Parameters<typeof readingOf>[0]);
  const prof = null as unknown as Parameters<typeof answerMessages>[0]["profile"];
  const gSel = String(answerMessages({ reading: gReading, selected: new Set(["A1", "B1"]), lang: "en", profile: prof, history: [], command: "x" })[0].content);
  const gWhole = String(answerMessages({ reading: gReading, selected: null, lang: "en", profile: prof, history: [], command: "x" })[0].content);
  check("answer sections: a document's gist under its header (pick)", /\[document A\] "BOOK TWO" \([^)]*\)\ngist: Beyond Good and Evil, chapters V and VII/.test(gSel) && !/\[document B\] "Notes" \([^)]*\)\ngist/.test(gSel));
  check("answer sections: a document's gist under its header (whole read)", /\[document A\] "BOOK TWO" \([^)]*\)\ngist: Beyond Good and Evil[^\n]*\n\[block A1\]/.test(gWhole));

  // ANS4-08: Stitch says it reads no notes, replies, or links.
  check("answer rules: Stitch reads only the documents' text", rules.includes("You read only the documents' text: never the reader's notes, the replies on links, or the links in the graph") && rules.includes("notes in the Notes list, replies in the link's panel, links in the graph"));

  // ANS4-09: the reading passes keep the last six commands.
  check("STITCH_READ_HISTORY keeps six commands", STITCH_READ_HISTORY === 6);

  // ANS4-10: a page made by a follow-up records the command it continues.
  const pageBlocks = new Set(["idA2", "idA5", "idB3"]);
  const hist = [
    { role: "user" as const, content: "What does Nietzsche say pity does?" },
    { role: "assistant" as const, content: "It multiplies suffering [block A2] [block A5]." },
    { role: "user" as const, content: "Quote the sentence about natural selection." },
    { role: "assistant" as const, content: "Here it is [block B3]." },
  ];
  check("pageCommand: the earliest command whose answer cited the page's blocks", pageCommand("Make that a page", hist, pageBlocks, blockByRef) === "What does Nietzsche say pity does? → Make that a page");
  check("pageCommand: one shared block is not enough when the page rests on more", pageCommand("Make that a page", hist.slice(2), pageBlocks, blockByRef) === "Make that a page");
  check("pageCommand: a first command records itself", pageCommand("Gather every passage on pity", [], pageBlocks, blockByRef) === "Gather every passage on pity");

  // COST4-01: history before the blocks only past STITCH_HISTORY_FIRST_MIN tokens.
  const short = [{ role: "user" as const, content: "What is pity?" }, { role: "assistant" as const, content: "x ".repeat(400) }];
  const long = [{ role: "user" as const, content: "What is pity?" }, { role: "assistant" as const, content: "x ".repeat(4 * 3_000) }];
  // The layout at a 3k line (the config ships it off: Infinity).
  const lay = (history: typeof short, selected: Set<string> | null, historyFirstMin = 3_000) => answerMessages({ reading: gReading, selected, lang: "en", profile: prof, history, command: "And then?", historyFirstMin });
  const s1 = lay(short, new Set(["A1"]));
  const l1 = lay(long, new Set(["A1"]));
  check("answer layout: a short history comes after the blocks", String(s1[0].content).includes("[block A1]") && s1.length === 4 && !String(s1[3].content).includes("[block A1]"));
  check("answer layout: past the threshold the history comes first, the blocks last", !String(l1[0].content).includes("[block A1]") && String(l1[3].content).includes("[block A1]") && String(l1[3].content).includes("And then?"));
  check("answer layout: the whole read never moves", String(lay(long, null)[0].content).includes("[block A1]"));
  check("answer layout: the history-first system message is the same bytes every turn", String(l1[0].content) === String(lay([...long, ...long], new Set(["A1", "B1"]))[0].content));
  check("answer layout: off by default (STITCH_HISTORY_FIRST_MIN), a long history still after the blocks", STITCH_HISTORY_FIRST_MIN === Infinity && String(answerMessages({ reading: gReading, selected: new Set(["A1"]), lang: "en", profile: prof, history: long, command: "And then?" })[0].content).includes("[block A1]"));
}

// ── Round 3 (ANS3-03): a cut where no line shares a word with the query ──
void (async () => {
  const view = (letter: string, n: number) =>
    ({
      r: { letter },
      gist: "",
      parts: [],
      lines: Array.from({ length: n }, (_, i) => ({ alias: `${letter}${i + 1}`, text: `english words line ${i} `.repeat(6), partAlias: null })),
    }) as unknown as SkeletonView;
  const views = Array.from({ length: 30 }, (_, i) => view(String.fromCharCode(65 + (i % 26)) + (i >= 26 ? "A" : ""), 100));
  const shown = await cutLines(views, null, async () => "尼采说的末人是什么", 20_000);
  const total = views.reduce((n, v) => n + v.lines.length, 0);
  const last = views[views.length - 1];
  check("cutLines: no line matches → every line read, not the first documents", shown.size === total && last.lines.every((l) => shown.has(l.alias)), `${shown.size} of ${total}`);
  const match = await cutLines(views, null, async () => "line 5 words", 20_000);
  check("cutLines: a query that matches still cuts", match.size < total, `${match.size} of ${total}`);
  console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
