// The eval cases of the tool quality loop (SPEC.md §25): one case is one
// tool run on one fixture with one reader context. The set covers the
// contexts the tools meet — a paper, a memo, news, docs, an essay, a Chinese
// article, a transcript — and the readers: none set, a novice, an expert, a
// professional with a purpose. Add a case when a rating shows a poor answer
// (scripts/eval/import-ratings.ts writes cases/from-ratings.json).
import type { Lang } from "@/lib/i18n/config";
import type { ReaderProfileCtx } from "@/lib/prompts/types";
import type { SummaryDepth } from "@/lib/types";

export type EvalTool =
  | "define"
  | "simplify"
  | "salience"
  | "distill"
  | "collapse"
  | "summarize"
  | "assistant"
  | "act"
  | "ask"
  | "find";

export type EvalCase = {
  id: string;
  tool: EvalTool;
  fixture: string;
  // The reader's UI language; for collapse, the document's language, since
  // the cores are written in it for every reader.
  lang: Lang;
  profile: ReaderProfileCtx;
  // A selection: the block by its order (1-based) and the text inside it;
  // the whole block when text is absent. Define, Simplify, and act need one.
  selection?: { block: number; text?: string };
  // The question (distill, assistant), the command (act), the search (find).
  question?: string;
  depth?: SummaryDepth;
  // ask: the time range in seconds.
  range?: { start: number; end: number };
  // What a good answer must contain, for the judge to check against (optional).
  expect?: string;
};

export const NOVICE: ReaderProfileCtx = {
  background: "First-year student. No training in this field.",
  purpose: "Understand the document well enough to explain it to a friend.",
  application: "",
};
export const ML_ENGINEER: ReaderProfileCtx = {
  background: "Machine learning engineer, five years on transformer models.",
  purpose: "Decide whether to adopt the method in a production system.",
  application: "Long-document question answering.",
};
export const ANALYST: ReaderProfileCtx = {
  background: "Equity analyst covering transport.",
  purpose: "Decide whether to change the rating on the stock.",
  application: "",
};
export const LAWYER: ReaderProfileCtx = {
  background: "Commercial lawyer.",
  purpose: "Advise a client on API terms.",
  application: "",
};
export const HOME_BUYER: ReaderProfileCtx = {
  background: "Nurse. No training in economics.",
  purpose: "Decide when to fix the rate on a home loan.",
  application: "",
};
export const DEVELOPER: ReaderProfileCtx = {
  background: "Backend developer.",
  purpose: "Run three services against the API on one account without being cut off.",
  application: "",
};
export const SHOP_OWNER_ZH: ReaderProfileCtx = {
  background: "小餐馆老板，在外卖平台上开店。",
  purpose: "决定是否支持平台降低抽成。",
  application: "",
};

export const CASES: EvalCase[] = [
  // ── Define: one word, in its sentence; never Chinese text, so the zh cases read English ──
  { id: "define-paper-retention", tool: "define", fixture: "paper-sparse-routing", lang: "en", profile: NOVICE, selection: { block: 5, text: "retention" }, expect: "Retention as in the retention loss, which the document names here: the loss that rewards the router for keeping the keys the dense model attended to most." },
  { id: "define-paper-router-zh", tool: "define", fixture: "paper-sparse-routing", lang: "zh", profile: null, selection: { block: 5, text: "router" }, expect: "In Chinese: the small network in each attention layer that picks the 4,096 key tokens attention runs over; not a network device." },
  { id: "define-memo-ebitda", tool: "define", fixture: "report-earnings-memo", lang: "en", profile: NOVICE, selection: { block: 3, text: "EBITDA" }, expect: "Spells out earnings before interest, taxes, depreciation, and amortization: a measure of operating profit; net debt at 2.1 times it measures debt." },
  { id: "define-memo-ebitda-zh", tool: "define", fixture: "report-earnings-memo", lang: "zh", profile: null, selection: { block: 3, text: "EBITDA" }, expect: "In Chinese: spells out EBITDA (息税折旧摊销前利润) and says it measures operating profit; net debt at 2.1 times it measures debt." },
  { id: "define-memo-spot", tool: "define", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, selection: { block: 10, text: "spot" }, expect: "Spot as in spot rates: the current market price to lease trucks when needed, put at 30 percent above the owned fleet's cost per mile." },
  { id: "define-docs-bucket", tool: "define", fixture: "docs-rate-limiting", lang: "en", profile: LAWYER, selection: { block: 1, text: "bucket" }, expect: "The token bucket: the key's request budget, at most 600 requests, refilling at 10 per second, one token per request; an empty bucket refuses with 429." },
  { id: "define-transcript-provenance", tool: "define", fixture: "transcript-podcast", lang: "en", profile: null, selection: { block: 2, text: "Provenance" }, expect: "Where an answer came from: the span of the document each claim rests on. The everyday meaning (the origin of an object, such as a painting) differs, so a second sentence may give it." },
  // ── Simplify ──
  { id: "simplify-paper-method", tool: "simplify", fixture: "paper-sparse-routing", lang: "en", profile: NOVICE, selection: { block: 5 } },
  { id: "simplify-memo-fuel", tool: "simplify", fixture: "report-earnings-memo", lang: "en", profile: null, selection: { block: 6 } },
  { id: "simplify-docs-bucket", tool: "simplify", fixture: "docs-rate-limiting", lang: "en", profile: LAWYER, selection: { block: 1 } },
  { id: "simplify-zh-fees", tool: "simplify", fixture: "zh-platform-fees", lang: "zh", profile: null, selection: { block: 4 } },
  // ── Salience ──
  { id: "salience-paper", tool: "salience", fixture: "paper-sparse-routing", lang: "en", profile: ML_ENGINEER },
  { id: "salience-news", tool: "salience", fixture: "news-rate-decision", lang: "en", profile: null },
  { id: "salience-essay", tool: "salience", fixture: "essay-slow-reading", lang: "en", profile: NOVICE },
  // ── Extract (DISTILL) ──
  { id: "distill-memo-fuel", tool: "distill", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, question: "How much of the margin gain is fuel, and will it repeat?", expect: "About 1.7 points is fuel and it is already reversing; about 1.1 points is structural." },
  { id: "distill-paper-limits", tool: "distill", fixture: "paper-sparse-routing", lang: "en", profile: ML_ENGINEER, question: "When does sparse routing lose to dense attention?", expect: "Evidence spread over more than 4,096 tokens (4.7 points behind on 8% of LongQA); mixed query blocks; untested above 256k." },
  { id: "distill-news-dissent", tool: "distill", fixture: "news-rate-decision", lang: "en", profile: null, question: "Why did the two dissenters want to cut now?", expect: "Unemployment up to 4.4% from 3.9%, job openings down 22%, waiting means easing too late." },
  { id: "distill-zh-who-gains", tool: "distill", fixture: "zh-platform-fees", lang: "zh", profile: null, question: "降低抽成率后谁受益、谁受损？", expect: "头部商家受益（订单量只降 3%），长尾商家受损（订单量降 18%）。" },
  { id: "distill-essay-unanswered", tool: "distill", fixture: "essay-slow-reading", lang: "en", profile: null, question: "What reading speed in words per minute does the author recommend?", expect: "The document gives no words-per-minute figure; the answer must say so." },
  // Questions whose intention reaches past their words: the worry or the decision behind them.
  { id: "distill-news-mortgage", tool: "distill", fixture: "news-rate-decision", lang: "en", profile: HOME_BUYER, question: "Should I lock my mortgage rate now or wait until December?", expect: "The reader wants to know whether mortgage rates will fall, and on what. The 30-year fixed rate was 6.9% this week; lenders expect it to fall toward 6.5% by December if the bank cuts. The cut is conditional: the governor puts a December cut on the table if the next two readings confirm, and one analyst ties it to the September reading, due October 12, coming in at 3.0% or lower; futures price a 78% chance. The document gives no advice on locking, and the answer must say so. The insight: the fall toward 6.5% hangs on inflation readings still to come." },
  { id: "distill-memo-customers", tool: "distill", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, question: "Should I be worried about Northwind's customers?", expect: "The reader wants the volume risk. Shipments fell 3% while revenue rose 6%: the rise is price. Northwind raised rates 9% on average, more than any listed peer; two of its five largest customers said they are moving volume to cheaper carriers, and losing either would cost about 4% of revenue; if volume returns, trucks leased at spot rates cost 30% more per mile than the owned fleet. The insight: the price rise that lifted revenue is what pushes customers away, and the fleet cut makes volume coming back expensive." },
  { id: "distill-docs-who-pays", tool: "distill", fixture: "docs-rate-limiting", lang: "en", profile: DEVELOPER, question: "If one of our services retries too fast, who pays for it?", expect: "Every workload on the same key pays: retries without waiting drain the key's bucket further, the refused requests count against a second limit, and 1,000 refusals in an hour suspend the key for 15 minutes. Limits are per key, keys do not share buckets, and an account can hold up to 20 keys, so a key per service keeps one service's retries from suspending the others. The insight: the suspension falls on the key, not on the service that retried." },
  { id: "distill-paper-million", tool: "distill", fixture: "paper-sparse-routing", lang: "en", profile: ML_ENGINEER, question: "Will this hold up on our 1-million-token contracts?", expect: "The paper did not test inputs above 256,000 tokens, and the answer must say so plainly. What bears on it: the router keeps a fixed budget of 4,096 keys, and evidence spread over more than 4,096 tokens loses part of it (4.7 points behind dense on the 8% of LongQA questions with more than ten supporting passages); a query block that mixes two questions gets a compromise set of keys; the scoring cost is linear in the input length; on ContractNLI sparse routing scores 83.3 F1 against 83.5 for dense." },
  { id: "distill-essay-worry", tool: "distill", fixture: "essay-slow-reading", lang: "en", profile: NOVICE, question: "Should I be worried that I read too fast?", expect: "Only for documents the reader will act on (a paper to build on, a contract to sign, a report to decide from): the ordinary speed gives the shape of the argument and the feeling of understanding, not the argument, and the author got a method wrong that the paper warned against, in a sentence read twice. For everything else the ordinary speed is right, with no guilt. The test: a passage you cannot restate in your own words is not understood." },
  { id: "distill-transcript-trust", tool: "distill", fixture: "transcript-podcast", lang: "en", profile: null, question: "Can I trust the answers not to be made up?", expect: "Every claim points to a source span, stored by block and offsets and by the quoted text with context, so a quote finds its place again after a re-parse; a quote no longer in the document shows with a broken-link mark, never dropped or guessed ('A wrong citation is worse than a missing one'); AI output never enters the notes without the reader's keystroke; every answer is rated and the poor ones become test cases. The interview gives no measure of how often answers are wrong, and the answer must not invent one." },
  { id: "distill-zh-small-shop", tool: "distill", fixture: "zh-platform-fees", lang: "zh", profile: SHOP_OWNER_ZH, question: "平台降低抽成，对我这样的小店意味着什么？", expect: "对依赖平台曝光的长尾小店是坏事：抽成从 20% 降到 15% 时订单量平均下降 11%，长尾商家下降 18%，每单多赚的 5 个百分点补不回来，长尾商家少赚约 13%；原因是平台约 60% 的抽成收入用于补贴和配送；降低抽成率是从长尾商家向头部商家的转移。对小店更有用的是限制排他性补贴、公开曝光分配规则。" },
  // ── Collapse: the whole document to its cores. Collapse takes no reader
  // context and writes in the document's language (SPEC.md §28): profile is
  // null and lang is the document's. ──
  { id: "collapse-paper", tool: "collapse", fixture: "paper-sparse-routing", lang: "en", profile: null, expect: "The first core keeps sparse routing, 256,000 tokens, the 4,096 tokens the router keeps, within 0.4 points of dense attention, and 61 percent less attention compute. The method core keeps the retention loss and that without it accuracy falls 3.1 points. The table's core says sparse routing is within half a point of dense on all three benchmarks and far above the 4k window. The limitations core keeps the fixed 4,096-key budget, the 4.7-point gap on the 8 percent of LongQA questions with more than ten supporting passages, and quotes \"We did not test inputs above 256,000 tokens.\" No core says sparse routing beats dense attention." },
  { id: "collapse-news", tool: "collapse", fixture: "news-rate-decision", lang: "en", profile: null, expect: "Every condition stays: one cut by year end is likely if inflation keeps slowing; a December cut is on the table if the next two readings confirm; mortgage rates fall toward 6.5 percent if the bank cuts; a December cut depends on the September reading coming in at 3.0 percent or lower. The governor's \"We are not there yet\" and the dissent's \"Waiting for core inflation to reach 2 percent before easing means easing too late\" are quoted, not paraphrased. The dissent is two of nine members." },
  { id: "collapse-memo", tool: "collapse", fixture: "report-earnings-memo", lang: "en", profile: null, expect: "The numbers stay as printed (1.84 billion dollars, 9.1 from 6.3 percent, 142 million, 2.1 from 2.9 times). Management's attribution stays management's. The fuel core keeps about 1.7 points from fuel, about 1.1 from something else, and 88 million dollars (1.2 percent of revenue) from the cuts. The fuel part will not repeat: diesel is up 9 percent, and about 1 point goes if it holds. \"Volume is the risk the numbers hide.\" is quoted. The recommendation keeps 7.6 percent, hold and do not add, and buy below 38 dollars." },
  { id: "collapse-zh", tool: "collapse", fixture: "zh-platform-fees", lang: "zh", profile: null, expect: "核心用中文。数字照原文：每降 1 个百分点每单利润升约 1 个百分点；约 60% 用于补贴和配送、约 15% 成为经营利润；从 20% 降到 15% 时订单量平均下降 11%、总利润下降约 6%；头部商家订单量只降 3%，长尾商家降 18%；长尾商家少赚约 13%。原文“降低抽成率是一次从长尾商家向头部商家的转移，而不是从平台向商家的转移”直接引用。“抽成率上限是一个错误的工具”的条件（若监管目标是保护中小商家）不能丢。" },
  { id: "collapse-transcript", tool: "collapse", fixture: "transcript-podcast", lang: "en", profile: null, expect: "Each line's core says what was said, and who says it where it matters (the host asks, the guest answers). The guest's key lines are quoted, not paraphrased: \"Provenance is the product.\", \"A wrong citation is worse than a missing one.\", \"let the background change what gets explained, not what is true\", \"A prompt you cannot measure is a prompt you cannot improve.\" The two ways a span is stored (block and offsets; the quoted text with context) and the rule to connect to the reader's purpose only when the connection is real stay." },
  { id: "collapse-docs", tool: "collapse", fixture: "docs-rate-limiting", lang: "en", profile: null, expect: "The numbers stay exact: 600 requests, 10 per second, one token per request, 429 with Retry-After; writes 120 at 2 per second; a search costs 5 tokens; 1,000 refusals in an hour suspend the key for 15 minutes; a batch of up to 50 items costs 1 token and writes cannot be batched; below 50 remaining, spread the burst; 20 keys per account; up to 6,000 on request with the refill still 10 per second (\"burst longer, not faster\"). The code's core says what the code does: it waits the Retry-After seconds (1 when absent) and retries." },
  { id: "collapse-essay", tool: "collapse", fixture: "essay-slow-reading", lang: "en", profile: null, expect: "The thesis stays: the reading that changes what you can do is one thing read slowly, and almost nobody does it. The cost keeps its condition: worth it only for documents you will act on. The eleven hours and the method the author got wrong stay. \"Reading at speed, the warning registered as a caveat. Reading slowly, it turned out to be the point.\" is quoted. The two habits stay: notes that restate, not highlights; one question at a time, twenty pages to six passages read in an hour." },
  // ── Summarize ──
  { id: "summarize-paper-layman", tool: "summarize", fixture: "paper-sparse-routing", lang: "en", profile: NOVICE, depth: "layman" },
  { id: "summarize-memo-professional", tool: "summarize", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, depth: "professional" },
  // ── Assistant (panel, document scope) ──
  { id: "assistant-memo-structural", tool: "assistant", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, question: "Is the margin recovery real?", expect: "Splits the 2.8-point gain into ~1.1 structural and ~1.7 fuel; fuel is reversing; models 7.6% next quarter." },
  { id: "assistant-docs-count", tool: "assistant", fixture: "docs-rate-limiting", lang: "en", profile: LAWYER, question: "How many separate limits are there, and what triggers a suspension?", expect: "Read bucket 600/10s, write bucket 120/2s, search costs 5 tokens, 1,000 refusals in an hour suspends for 15 minutes." },
  { id: "assistant-paper-absent", tool: "assistant", fixture: "paper-sparse-routing", lang: "en", profile: ML_ENGINEER, question: "What GPU did they run the throughput numbers on?", expect: "The document does not name the hardware; the answer must say so." },
  { id: "assistant-zh-regulation", tool: "assistant", fixture: "zh-platform-fees", lang: "zh", profile: null, question: "作者认为监管应该用什么工具？", expect: "限制排他性补贴、要求公开曝光分配规则；抽成率上限是错误工具。" },
  // ── Selection chat (act): the old Explain and Match-it in one ──
  { id: "act-paper-retention-loss", tool: "act", fixture: "paper-sparse-routing", lang: "en", profile: NOVICE, selection: { block: 5, text: "we call this the retention loss" }, question: "Explain this.", expect: "The retention loss rewards keeping the keys dense attention attended to most; without it accuracy falls 3.1 points; matches cite the method and limitations passages." },
  { id: "act-memo-volume", tool: "act", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, selection: { block: 9, text: "Volume is the risk the numbers hide." }, question: "Where else does the memo deal with this?", expect: "Shipments down 3%, rates up 9%, two large customers moving volume (~4% of revenue each), fleet cut removes capacity (30% spot premium)." },
  { id: "act-news-wages", tool: "act", fixture: "news-rate-decision", lang: "en", profile: null, selection: { block: 6, text: "Wage growth of 4.8 percent a year" }, question: "Why does this matter for the decision?", expect: "Services prices driven by wages rose 5.1%; core at 3.6%; the governor's reason for holding against the dissent." },
  { id: "act-zh-transfer", tool: "act", fixture: "zh-platform-fees", lang: "zh", profile: null, selection: { block: 7 }, question: "解释这一段。", expect: "头部商家订单量只降 3%，长尾商家降 18%，总利润下降约 13%；匹配片段引用受益者一节和结论。" },
  // ── Ask and Find (transcript) ──
  { id: "ask-transcript-provenance", tool: "ask", fixture: "transcript-podcast", lang: "en", profile: null, range: { start: 0, end: 120 }, question: "How do they store where an answer came from?", expect: "Two ways: block and offsets, and the quoted text with context; the quote re-finds its place after a re-parse (1:05)." },
  { id: "ask-transcript-outside", tool: "ask", fixture: "transcript-podcast", lang: "en", profile: null, range: { start: 0, end: 60 }, question: "What do they do when a quote is no longer in the document?", expect: "Not in the range; the answer names 1:58 and says it is outside the range: show the quote with a broken-link mark, never guess." },
  { id: "find-transcript-background", tool: "find", fixture: "transcript-podcast", lang: "en", profile: null, question: "the reader's background in prompts", expect: "The 2:20 to 3:58 stretch." },
];
