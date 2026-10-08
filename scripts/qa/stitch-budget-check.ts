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
  duplicateOf,
  existingNamed,
  existingPairs,
  pageCountNote,
  skeletonView,
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
  groupMaxBlocks,
  historyWithAliases,
  interleave,
  nameHits,
  readingOf,
  replyLanguage,
  replyWithIds,
  skeletonGroups,
  skeletonSystem,
  namePicks,
  trimmedHistory,
  titleMatches,
  type SkeletonView,
} from "../../src/lib/graph/stitch";
import { asksEvery, asksWhere, stitchExpandPrompt, stitchPrompt, stitchRules, stitchSelectPrompt } from "../../src/lib/prompts/stitch";
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
  // Round 4 (REV4-08): 整理一下 with what it gathers; write an answer.
  ["请整理一下关于同情的段落", "page"],
  ["帮我整理好尼采关于怜悯的引文", "page"],
  ["Can you write a short answer: what is pity?", "question"],
  ["Write me a brief reply on what he means by the will", "question"],
  ["Write an answer to this: is pity a virtue?", "question"],
  ["Draft a page on pity from every document", "page"],
  ["Could you write up the passages on pity?", "page"],
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
  // REV4-07: one long first pick no longer turns off the rule for the
  // documents after it: it waits in the call's order, and B and C lead.
  const tok: Record<string, number> = { A1: 6000, A2: 100, A3: 100, A4: 100, B1: 100, C1: 100 };
  const capDoc = (a: string) => a[0];
  const capped = firstsFirst(["A1", "A2", "A3", "A4", "B1", "C1"], capDoc, { tokens: 5000, costOf: (a) => tok[a] });
  check("firstsFirst: a long first pick does not stop the next documents' first picks", capped.join(" ") === "B1 C1 A1 A2 A3 A4", capped.join(" "));
  check("firstsFirst: no cap, every first pick leads", firstsFirst(["A1", "A2", "A3", "A4", "B1", "C1"], capDoc).join(" ") === "A1 B1 C1 A2 A3 A4");
  const tight = firstsFirst(["A1", "B1", "C1", "D1"], capDoc, { tokens: 250, costOf: () => 100 });
  check("firstsFirst: the cap still holds: first picks past it keep the call's order", tight.join(" ") === "A1 B1 C1 D1", tight.join(" "));
}
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
// ANS5-04: the server states the page's counts; the model never counts them.
check("answer rules: the page's parts are never counted in reply", rules.includes("Never count the parts of the page: the count is added under the reply."));
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

  // COST5-04: past 20 documents the "No block shown" line is a count and the titles that hold a command word,
  // and a document with 1 to 3 blocks shown has no gist unless its title holds a command word.
  const many = [
    ...Array.from({ length: 20 }, (_, i) => mk(`m${i}`, `Essay ${i} on the will`, 5, 20)),
    mk("n", "On Noise", 10, 20),
    mk("p", "Of Women", 10, 20),
  ];
  const r2 = readingOf(many as unknown as Parameters<typeof readingOf>[0]);
  for (const d of many) r2.gists.set(d.id, `Gist of ${d.title}.`);
  const letterOf = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`);
  // Shown: two blocks of essay 0, four of essay 1, two of "On Noise"; "Of Women" and essays 2-19 nothing.
  const sel2 = new Set(["A1", "A2", "B1", "B2", "B3", "B4", `${letterOf(20)}1`, `${letterOf(20)}2`]);
  const msg = (command: string) =>
    String(answerMessages({ reading: r2, selected: sel2, lang: "en", profile: null as unknown as Parameters<typeof answerMessages>[0]["profile"], history: [], command })[0].content);
  const s2 = msg("What does Schopenhauer say about noise?");
  check("short lists: past 20 documents the nothing-shown line is a count", s2.includes("No block shown for this command: 19 more documents, none titled with a word of the command."), /No block shown[^\n]*/.exec(s2)?.[0]);
  check("short lists: a document with 2 blocks shown, off the command, has no gist", !s2.includes("Gist of Essay 0 on the will."));
  check("short lists: a document with 4 blocks shown keeps its gist", s2.includes("Gist of Essay 1 on the will."));
  check("short lists: a document whose title holds a command word keeps its gist", s2.includes("Gist of On Noise."));
  const s3 = msg("Which documents discuss women?");
  check("short lists: the nothing-shown titles that hold a command word are named", s3.includes('No block shown for this command: 19 more documents; the ones whose title holds a word of the command: "Of Women" (10 blocks).'), /No block shown[^\n]*/.exec(s3)?.[0]);
  check("titleMatches: 'documents', 'which', 'the' never match", titleMatches([{ doc: { title: "The documents which matter" } }], "Which documents discuss the will?").length === 0);
  check("titleMatches: two CJK characters in a row match", titleMatches([{ doc: { title: "人生的智慧（第3篇）" } }], "《人生的智慧》对幸福补充了什么？").length === 1);
  check("titleMatches: one CJK character alone does not", titleMatches([{ doc: { title: "道德的谱系" } }], "人如何看待痛苦？").length === 0);
  // Under 21 documents the line lists every title, as before.
  check("short lists: 20 documents or fewer list every title", sys.includes('"Other essay" (100 blocks)'));
}

// ── COST5-01: the select pass's ids per group ──
check("groupMaxBlocks: one group names the kind's cap", groupMaxBlocks("page", 1) === STITCH_SELECTED_BLOCKS.page && groupMaxBlocks("question", 1) === STITCH_SELECTED_BLOCKS.question);
check("groupMaxBlocks: two groups each name up to the cap", groupMaxBlocks("page", 2) === STITCH_SELECTED_BLOCKS.page);
check("groupMaxBlocks: 25 groups of a page name 32 each", groupMaxBlocks("page", 25) === 32, String(groupMaxBlocks("page", 25)));
check("groupMaxBlocks: never under 20", groupMaxBlocks("question", 40) === 20 && groupMaxBlocks("question", 6) === 50);

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

// ── Round 4 (REV4-05): correct quotes keep their marks ──
{
  const qb = new Map<string, B>([
    ["A1", { id: "b1", alias: "A1", type: "PARAGRAPH", documentId: "d1", text: "The will—blind, striving—is the thing in itself." }],
    ["A2", { id: "b2", alias: "A2", type: "PARAGRAPH", documentId: "d1", text: "Pity is the practice of nihilism, and it preserves what is ripe for destruction." }],
    ["C1", { id: "b6", alias: "C1", type: "PARAGRAPH", documentId: "d3", text: "Ressenti\u00adment itself, if it should appear in the noble man, consummates itself." }],
    ["B1", { id: "b3", alias: "B1", type: "PARAGRAPH", documentId: "d2", text: "Compassion is the basis of morality." }],
    ["B2", { id: "b4", alias: "B2", type: "PARAGRAPH", documentId: "d2", text: "and, he adds, it is the sole source of moral worth." }],
    ["B3", { id: "b5", alias: "B3", type: "PARAGRAPH", documentId: "d2", text: "Man is a rope, tied between beast and overman—a rope over an abyss." }],
  ]);
  const cases: [string, string, boolean][] = [
    ["exact", `He calls pity "the practice of nihilism" [block A2].`, true],
    ["spaced em dash", `He writes "The will — blind, striving — is the thing in itself" [block A1].`, true],
    ["hyphen for dash", `He writes "The will - blind, striving - is the thing" [block A1].`, true],
    ["soft hyphen in block", `He writes "Ressentiment itself, if it should appear" [block C1].`, true],
    ["bracketed insertion", `He says "[pity] preserves what is ripe for destruction" [block A2].`, true],
    ["across two blocks", `Schopenhauer: "Compassion is the basis of morality and, he adds, it is the sole source" [block B1] [block B2].`, true],
    ["ellipsis", `"Man is a rope ... over an abyss" [block B3].`, true],
    ["paraphrase", `He says "pity is a kind of weakness of the soul" [block A2].`, false],
    ["two blocks out of order", `"it is the sole source of moral worth. Compassion is the basis" [block B1] [block B2].`, false],
    ["a hyphenated word is not a dash", `He writes "The will-to blind, striving" [block A1].`, false],
  ];
  for (const [name, line, kept] of cases) {
    const r = checkReplyQuotes(line, qb, new Set());
    check(`checkReplyQuotes: ${name} ${kept ? "keeps" : "loses"} its marks`, (r.unquoted.length === 0) === kept, r.unquoted.join(" | "));
  }
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
  check("answer rules: the link count is the links proposed, the listed ones said to be there", rules.includes("A count of links equals the number of links you propose. A link listed as already in the project is never proposed again"));
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

// ── Round 5 (ENGINE5) ──
{
  const docs5 = [{ tag: "A", title: "Mencken", read: true }, { tag: "B", title: "Notes", read: true }];
  // ANS5-01: quotes in Chinese replies (the answers audit's proto/zhquote.ts, 6 of 6).
  const f24 = new Map<string, B>([["F24", { id: "b1", alias: "F24", type: "PARAGRAPH", documentId: "d", text: "Schopenhauer was right in this: that by means of pity life is denied, and made worthy of denial--pity is the technic of nihilism." }]]);
  const zhMis = [
    'He says "pity is the practice of nihilism" [block F24].',
    '他说 "pity is the practice of nihilism" [block F24]。',
    '他说"pity is the practice of nihilism" [block F24]。',
    '他说“pity is the practice of nihilism”[block F24]。',
    '他说「pity is the practice of nihilism」[block F24]。',
    '尼采写道：“pity is the practice of nihilism”[block F24]。',
  ];
  const caught = zhMis.filter((c) => checkReplyQuotes(c, f24, new Set()).unquoted.length === 1);
  check("checkReplyQuotes: a misquote after a CJK character, in 「」, and before [block (6 of 6)", caught.length === 6, `${caught.length} of 6`);
  const zhOut = checkReplyQuotes('他说「pity is the practice of nihilism」[block F24]。', f24, new Set()).reply;
  check("checkReplyQuotes: a corner-bracket misquote loses its brackets, keeps its words", zhOut === "他说pity is the practice of nihilism[block F24]。", zhOut);
  const zhBlock = new Map<string, B>([["C3", { id: "c3", alias: "C3", type: "PARAGRAPH", documentId: "d2", text: "叔本华认为同情是道德的唯一基础，而尼采说同情使痛苦加倍。" }]]);
  const zhKeep = [
    '他说"pity is the technic of nihilism"[block F24]。',
    '他说“by means of pity life is denied”，而且[block F24]',
    '笔记说「同情是道德的唯一基础」[block C3]。',
    '笔记说『尼采说同情使痛苦加倍』[block C3]。',
    '笔记说"同情是道德的唯一基础"而[block C3]',
  ];
  const kept5 = zhKeep.filter((c) => checkReplyQuotes(c, new Map([...f24, ...zhBlock]), new Set()).unquoted.length === 0);
  check("checkReplyQuotes: verbatim quotes in Chinese replies keep their marks (5 of 5)", kept5.length === 5, `${kept5.length} of 5`);
  const n13 = checkReplyQuotes('笔记说叔本华认为自杀"摧毁意志而不是否定意志"，而译者注说自杀是对生命意志的肯定 [block C3]。', zhBlock, new Set());
  check("checkReplyQuotes: N13's Chinese paraphrase of English notes loses its marks", n13.unquoted.length === 1 && !n13.reply.includes('"摧毁'), n13.reply);
  check("checkReplyQuotes: a title in 《》 and an English apostrophe stay", checkReplyQuotes("《敌基督》说 it's the technic [block F24]。", f24, new Set()).unquoted.length === 0);
  check("answer rules: a translation gets no quote marks", rules.includes("A quote is the document's words in the document's language: a translation or a paraphrase gets no quote marks."));

  // ANS5-02: every proposed link keeps its number in the record.
  const recX = recordText(
    {
      links: [
        { id: "n1", from: "Notes", to: "The Antichrist" },
        { id: "old", from: "BOOK TWO", to: "Arthur Schopenhauer", status: "existing" },
        { id: "n2", from: "Arthur Schopenhauer", to: "The Antichrist" },
        { id: "", from: "Notes", to: "", status: "unstored" },
        { id: "gone", from: "Notes", to: "BOOK TWO", status: "removed" },
      ],
      document: null,
    },
    new Map([
      ["n1", { id: "n1", fromBlockId: "idA2", toBlockId: "idB3", reason: "Both define happiness.", recommended: true }],
      ["old", { id: "old", fromBlockId: "idA5", toBlockId: "idC9", reason: "Well-being.", recommended: true }],
      ["n2", { id: "n2", fromBlockId: "idB3", toBlockId: "idC9", reason: "Boredom and power.", recommended: true }],
    ]),
    null,
  );
  check("recordText: link 3 is the reply's third link after a duplicate (F2x)", recX.includes("- link 3: [block idB3] – [block idC9]: Boredom and power."), recX);
  check("recordText: a link proposed again is numbered, in the graph, waiting", recX.includes("- link 2 (already in the graph, waiting under Recommended links; not stored again): [block idA5] – [block idC9]: Well-being."), recX);
  check("recordText: a link that did not resolve and one removed before keep their numbers", recX.includes("- link 4: not stored") && recX.includes('- link 5: removed by the reader before, not stored again ("Notes" – "BOOK TWO")') && recX.startsWith("(Proposed by this answer"), recX);
  check("recordText: a record with no status reads as before", recordText({ links: [{ id: "n1", from: "a", to: "b" }], document: null }, new Map([["n1", { id: "n1", fromBlockId: "x", toBlockId: "y", reason: null, recommended: true }]]), null) === "(Stored by this answer, in the order it proposed them:\n- link 1: [block x] – [block y])");
  const end5 = (block: string, start: number, stop: number) => ({ block, start, end: stop });
  check("duplicateOf: the index of the link repeated, -1 for a new one", duplicateOf([end5("G6", 0, 10), end5("B20", 0, 10)], [[end5("A1", 0, 5), end5("B1", 0, 5)], [end5("B20", 5, 20), end5("G6", 5, 20)]]) === 1 && duplicateOf([end5("G6", 0, 10), end5("B21", 0, 10)], []) === -1);

  // ANS5-05 / WALK5-03: the existing links' states, and which the answer is about.
  const ex = [
    { id: "e1", from: "G6", to: "B20", state: "accepted" as const },
    { id: "e2", from: "G7", to: "A8", state: "waiting" as const },
    { id: "e3", from: "G10", to: "E73", state: "removed" as const },
    { id: "e4", from: "G11", to: "E90", state: "waiting" as const },
  ];
  const pairs5 = existingPairs(ex, () => true);
  check("existingPairs: a waiting and a removed link say so", pairs5.join("; ") === "[block G6] – [block B20]; [block G7] – [block A8] (waiting under Recommended links); [block G10] – [block E73] (removed by the reader); [block G11] – [block E90] (waiting under Recommended links)", pairs5.join("; "));
  const sel5 = new Set(["G6", "B20", "G7", "A8", "G10", "E73", "G11"]);
  check("existingNamed: a links command lights every listed link but removed ones", existingNamed("Nine other links are already in the graph.", ex, sel5, true).join(",") === "e1,e2");
  check("existingNamed: a reply names a link by its two blocks side by side", existingNamed("Already linked: [block G7] – [block A8]; and [block G6] alone, [block E90].", ex, sel5, false).join(",") === "e2");
  check("existingNamed: a removed link is never lit", !existingNamed("[block G10] [block E73]", ex, null, false).includes("e3"));
  const en5 = translatorFor("en");
  const zh5 = translatorFor("zh");
  check("reply lines: waiting and removed, en and zh", en5("stitch.stitchLinksWaiting1", { n: 1 }) === "1 of the links proposed was proposed before and waits under Recommended links." && en5("stitch.stitchLinksRemovedN", { n: 2 }) === "2 of the links proposed were removed before, so they were not added again." && zh5("stitch.stitchLinksWaitingN", { n: 2 }).includes("推荐链接") && zh5("stitch.stitchLinksRemoved1", { n: 1 }).includes("已被移除"));
  const pr5 = stitchPrompt({ documents: docs5, command: "Connect the passages on the will", continued: false, selected: true, existing: pairs5.slice(0, 2) });
  check("answer prompt: the listed links say how many wait, never a removed one", pr5.includes("say in one sentence that these are already in the graph, and how many wait under Recommended links when some do; never mention one removed by the reader."));

  // ANS5-03: the lines before a document's first part are a part of their own.
  const rv = { letter: "X", blocks: [1, 2, 3, 4, 5].map((n) => ({ id: `x${n}`, alias: `X${n}` })) } as unknown as Parameters<typeof skeletonView>[0];
  const sv = skeletonView(rv, { v: 1, gist: "", chars: 0, built: 0, parts: [{ blockId: "x4", title: "Chapter 1", summary: "s" }], lines: [1, 2, 3, 4, 5].map((n) => ({ blockId: `x${n}`, hash: "", text: `line ${n}` })) } as unknown as Parameters<typeof skeletonView>[1]);
  check("skeletonView: an opening part at the first line holds the lines before the first part", sv.parts[0].alias === "X1" && sv.parts[0].opening === true && sv.lines.slice(0, 3).every((l) => l.partAlias === "X1") && sv.lines[3].partAlias === "X4");
  const sv0 = skeletonView(rv, { v: 1, gist: "", chars: 0, built: 0, parts: [{ blockId: "x1", title: "Chapter 1", summary: "s" }], lines: [1, 2].map((n) => ({ blockId: `x${n}`, hash: "", text: `line ${n}` })) } as unknown as Parameters<typeof skeletonView>[1]);
  const svNone = skeletonView(rv, { v: 1, gist: "", chars: 0, built: 0, parts: [], lines: [1, 2].map((n) => ({ blockId: `x${n}`, hash: "", text: `line ${n}` })) } as unknown as Parameters<typeof skeletonView>[1]);
  check("skeletonView: no opening part when the first part starts at the first line, or with no parts", sv0.parts.length === 1 && svNone.parts.length === 0 && svNone.lines.every((l) => l.partAlias === null));

  // ANS5-04: the page's counts, stated by the server.
  check("pageCountNote: en", pageCountNote({ quotes: 7, headings: 3, texts: 6 }, "en") === "The page holds 7 quotes, 3 headings, and 6 paragraphs of writing." && pageCountNote({ quotes: 1, headings: 0, texts: 1 }, "en") === "The page holds 1 quote and 1 paragraph of writing.", pageCountNote({ quotes: 7, headings: 3, texts: 6 }, "en"));
  check("pageCountNote: zh", pageCountNote({ quotes: 7, headings: 3, texts: 6 }, "zh") === "页面包含 7 段引文、3 个标题和 6 段撰写的文字。", pageCountNote({ quotes: 7, headings: 3, texts: 6 }, "zh"));

  // ANS5-07: the heading a shown block falls under, when the heading is not shown.
  const hDoc = (id: string, title: string, blocks: [string, string][]) => ({
    id, title, generatedCommand: null, skeleton: null, handwritten: false, importRev: null, pageLabels: null, conversionStatus: "NONE", conversionError: null, video: null,
    blocks: blocks.map(([type, text], i) => ({ id: `${id}-${i}`, type, text, startTime: null, endTime: null, cell: null, page: null })),
  });
  const hReading = readingOf([
    hDoc("h", "The Art of Controversy", [["PARAGRAPH", "Opening."], ["HEADING", "XXVII"], ["PARAGRAPH", "Should your opponent surprisingly become angry at an argument, you must urge it with all the more zeal."], ["PARAGRAPH", "Next."]]),
    hDoc("i", "Notes", [["PARAGRAPH", "Anger as a stratagem."]]),
  ] as unknown as Parameters<typeof readingOf>[0]);
  const hSys = String(answerMessages({ reading: hReading, selected: new Set(["A1", "A3", "B1"]), lang: "en", profile: null as unknown as Parameters<typeof answerMessages>[0]["profile"], history: [], command: "x" })[0].content);
  check("answer sections: a block under a heading not shown names it in the gap line", hSys.includes('(1 block not shown; under the heading "XXVII")\n\n[block A3]'), hSys.slice(hSys.indexOf("[document A]"), hSys.indexOf("[document A]") + 300));
  const hSys2 = String(answerMessages({ reading: hReading, selected: new Set(["A2", "A3", "B1"]), lang: "en", profile: null as unknown as Parameters<typeof answerMessages>[0]["profile"], history: [], command: "x" })[0].content);
  check("answer sections: a shown heading is not named twice", !hSys2.includes("under the heading"));

  // ANS5-09: the name-hint cap grows with the project.
  const darwin = Array.from({ length: 9 }, (_, i) => ({ alias: `D${i}`, text: "Darwin wrote" }));
  check("nameHits: 9 blocks name Darwin: dropped on 7 documents, kept on 36", nameHits("What does Darwin say?", darwin, Array(7).fill("t")).length === 0 && nameHits("What does Darwin say?", darwin, Array(36).fill("t"))[0]?.aliases.length === 9);

  // ANS5-10: the partial-list sentence only when the command asks for a list.
  const hedge = "say in one sentence that the list covers the blocks read for this command";
  check("answer prompt: no list sentence on a question with no names", !stitchPrompt({ documents: docs5, command: "Why did Nietzsche break with Wagner?", continued: false, selected: true, names: [] }).includes(hedge));
  check("answer prompt: the list sentence on which / every / 哪些 with no names", ["Which documents discuss pity?", "List every passage on pity", "哪些文档谈到同情？"].every((c) => stitchPrompt({ documents: docs5, command: c, continued: false, selected: true, names: [] }).includes(hedge)) && asksEvery("Gather all the passages"));
  check("answer prompt: the list sentence with a name partly shown, as before", stitchPrompt({ documents: docs5, command: "What does Darwin say?", continued: false, selected: true, names: [{ term: "Darwin", total: 9, shown: 3 }] }).includes(hedge));

  // ANS5-11: Stitch cannot remove, accept, or edit.
  check("answer rules: Stitch cannot remove, accept, or edit, and says where the reader does", rules.includes("You cannot remove, accept, or edit a link, a note, or a document: say so in one sentence") && rules.includes("a recommended link under Recommended links"));
}

// ── Round 6 (COST6) ──
{
  const prof6 = null as unknown as Parameters<typeof answerMessages>[0]["profile"];
  const mk6 = (id: string, title: string, n: number) => ({
    id, title, generatedCommand: null, skeleton: null, handwritten: false, importRev: null, pageLabels: null, conversionStatus: "NONE", conversionError: null, video: null,
    blocks: Array.from({ length: n }, (_, i) => ({ id: `${id}${i + 1}`, type: "PARAGRAPH", text: `paragraph ${i + 1} of ${title}`, startTime: null, endTime: null, cell: null, page: null })),
  });
  const r6 = readingOf([mk6("p", "Pity", 6), mk6("q", "Will", 4)] as unknown as Parameters<typeof readingOf>[0]);
  const skel = (id: string, n: number, gist: string) =>
    ({ v: 1, gist, chars: 0, built: 0, parts: [{ blockId: `${id}3`, title: "Part two", summary: "the second part" }], lines: Array.from({ length: n }, (_, i) => ({ blockId: `${id}${i + 1}`, hash: "", text: `line ${i + 1}` })) }) as unknown as Parameters<typeof skeletonView>[1];
  const views6 = [skeletonView(r6.read[0], skel("p", 6, "On pity.")), skeletonView(r6.read[1], skel("q", 4, "On the will."))];
  const rd = r6.rendered.filter((r) => r.letter === "A" || r.letter === "B");

  // COST6-02: a cut's headers and gists first, the same bytes every command; gaps marked (…).
  const cutA = skeletonSystem(views6, rd, new Set(["A1", "A5", "B2"]), prof6);
  const cutB = skeletonSystem(views6, rd, new Set(["A2", "B1", "B4"]), prof6);
  const linesAt = cutA.indexOf("The skeleton lines read for this command:");
  check("skeletonSystem: a cut's headers and gists come first, byte-identical across cuts", linesAt > 0 && cutA.slice(0, linesAt) === cutB.slice(0, cutB.indexOf("The skeleton lines read for this command:")) && cutA.slice(0, linesAt).includes("gist: On pity.") && cutA.slice(0, linesAt).includes("gist: On the will."));
  check("skeletonSystem: a cut's lines under [document X] \"title\": N of M skeleton lines shown, the gap marked (…)", cutA.includes("[document A] \"Pity\": 2 of 6 skeleton lines shown\n[block A1] line 1\n(…)\n[part at A3] \"Part two\": the second part\n[block A5] line 5") && !cutA.includes("not shown)"));
  const whole6 = skeletonSystem(views6, rd, null, prof6);
  check("skeletonSystem: every line shown keeps the header, gist and lines together, no gap mark", /\[document A\] "Pity" \([^)]*\)\ngist: On pity\.\n\[block A1\] line 1\n\[block A2\]/.test(whole6) && !whole6.includes("(…)") && !whole6.includes("lines read for this command"));
  check("select prompt: the partial note names the gap mark", stitchSelectPrompt({ documents: [], command: "x", continued: false, earlier: [], cited: [], maxBlocks: 10, partial: true }).includes("(…) marks lines not shown between two lines."));

  // COST6-04: nothing picked: the name-hit blocks, two per name, once each; none when no name hits.
  check("namePicks: two blocks per name, once each", namePicks([{ aliases: ["G45", "G50", "G60"] }, { aliases: ["X38", "G45", "X39"] }]).join(",") === "G45,G50,X38");
  check("namePicks: no name hits → none (every document's opening, as before)", namePicks([]).length === 0);

  // COST6-05: answers older than the last two keep their first paragraph (and the next when it is short), the
  // block tags of the cut text, and their record; commands stay whole; the whole read keeps the history whole.
  const long6 = "Nietzsche holds that pity weakens the one who feels it and multiplies suffering, works against the law of natural selection, and preserves what is ripe for destruction, in The Antichrist [block A1].";
  const turns6 = [
    { role: "user" as const, content: "What does Nietzsche say pity does?" },
    { role: "assistant" as const, content: `${long6}\n\n- It wastes strength [block A2].\n- Beyond Good and Evil hears self-contempt [block B1] [block A1].\n\n(Stored by this answer, in the order it proposed them:\n- link 1: [block A2] – [block B3])` },
    { role: "user" as const, content: "When was it printed?" },
    { role: "assistant" as const, content: "两份文档的说法不一致。\n\n门肯说 1895 年 [block A4]。\n\n笔记说 1889 年 [block B2]。" },
    { role: "user" as const, content: "Which is right?" },
    { role: "assistant" as const, content: "Neither says.\n\nMore [block B4]." },
    { role: "user" as const, content: "And Schopenhauer?" },
    { role: "assistant" as const, content: "He grounds morals in compassion [block B1].\n\nMore [block B2]." },
  ];
  const t6 = trimmedHistory(turns6);
  check("trimmedHistory: an old answer keeps its first paragraph, the cut text's tags, and its record", t6[1].content === `${long6}\n\n(This answer also cited [block A2] [block B1].)\n\n(Stored by this answer, in the order it proposed them:\n- link 1: [block A2] – [block B3])`, String(t6[1].content));
  check("trimmedHistory: a first paragraph under 40 tokens keeps the next", t6[3].content === "两份文档的说法不一致。\n\n门肯说 1895 年 [block A4]。\n\n(This answer also cited [block B2].)", String(t6[3].content));
  check("trimmedHistory: the last two answers and every command stay whole", t6[5] === turns6[5] && t6[7] === turns6[7] && [0, 2, 4, 6].every((i) => t6[i] === turns6[i]));
  check("trimmedHistory: two answers or fewer: unchanged", trimmedHistory(turns6.slice(4)).every((m, i) => m === turns6[4 + i]));
  const pick6 = answerMessages({ reading: r6, selected: new Set(["A1"]), lang: "en", profile: prof6, history: turns6, command: "x" });
  const whole6a = answerMessages({ reading: r6, selected: null, lang: "en", profile: prof6, history: turns6, command: "x" });
  check("answerMessages: a pick reads the trimmed history; the whole read (cached) reads it whole", pick6[2].content === t6[1].content && whole6a[2].content === turns6[1].content);
  check("citedAliases reads every answer whole (the reading passes)", citedAliases(turns6, r6.blockByRef).includes("B3"));
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
