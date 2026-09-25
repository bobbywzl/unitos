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
  | "summarize"
  | "assistant"
  | "act"
  | "ask"
  | "find";

export type EvalCase = {
  id: string;
  tool: EvalTool;
  fixture: string;
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

export const CASES: EvalCase[] = [
  // ── Define: one word or one phrase, in its sentence ──
  { id: "define-paper-retention-loss", tool: "define", fixture: "paper-sparse-routing", lang: "en", profile: NOVICE, selection: { block: 5, text: "retention loss" }, expect: "The document's own definition: the loss that trains the router to keep the keys the dense model attended to most." },
  { id: "define-paper-router-zh", tool: "define", fixture: "paper-sparse-routing", lang: "zh", profile: null, selection: { block: 5, text: "router" }, expect: "In Chinese: the small network in each attention layer that picks the 4,096 key tokens attention runs over; not a network device." },
  { id: "define-memo-ebitda", tool: "define", fixture: "report-earnings-memo", lang: "en", profile: NOVICE, selection: { block: 3, text: "EBITDA" }, expect: "Spells out earnings before interest, taxes, depreciation, and amortization: a measure of operating profit; net debt at 2.1 times it measures debt." },
  { id: "define-memo-spot-rates", tool: "define", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, selection: { block: 10, text: "spot rates" }, expect: "The market price to lease trucks when needed, put at 30 percent above the owned fleet's cost per mile." },
  { id: "define-docs-token-bucket", tool: "define", fixture: "docs-rate-limiting", lang: "en", profile: LAWYER, selection: { block: 1, text: "token bucket" }, expect: "A budget of at most 600 requests that refills at 10 per second, one token per request; an empty bucket refuses with 429." },
  { id: "define-transcript-provenance", tool: "define", fixture: "transcript-podcast", lang: "en", profile: null, selection: { block: 2, text: "Provenance" }, expect: "Where an answer came from: the span of the document each claim rests on. The everyday meaning (the origin of an object, such as a painting) differs, so a second sentence may give it." },
  { id: "define-zh-long-tail", tool: "define", fixture: "zh-platform-fees", lang: "zh", profile: null, selection: { block: 6, text: "长尾商家" }, expect: "依赖平台曝光、订单量随补贴变化的中小商家；抽成降低后订单量下降 18%。" },
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
