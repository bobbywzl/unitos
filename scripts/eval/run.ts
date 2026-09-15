// The tool quality loop's runner (SPEC.md §25). One run: every case in
// scripts/eval/cases.ts (and cases/from-ratings.json when present) goes
// through its tool's real prompt template on the real model, the output is
// checked mechanically (caps, tags, spans, markers, language), a judge scores
// it against the tool's rubric, and a report lands under .eval/runs/<stamp>/
// with results.json (every prompt, output, check, and score) and report.md
// (the table). --baseline compares against an earlier run and names the
// regressions. Usage:
//   npx tsx scripts/eval/run.ts [--tools simplify,act] [--cases id,id]
//     [--judge claude|kimi|none] [--baseline latest|<path>] [--gate]
// Keys: MOONSHOT_API_KEY runs the tools; ANTHROPIC_API_KEY makes Claude the
// judge (else Kimi judges, else no judge). MOONSHOT_API_KEY=mock with
// MOONSHOT_BASE_URL=http://localhost:3399/v1 (scripts/qa/mock-kimi.mjs) is a
// dry run of the wiring.
import "./env";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { DERIVATION_EFFORT, MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import {
  distillOutputSchema,
  extractJson,
  findOutputSchema,
  keypointsOutputSchema,
  resolveSpan,
  salienceOutputSchema,
} from "@/lib/derive/json";
import { actPrompt, textSelectionBlock } from "@/lib/prompts/act";
import { askPrompt } from "@/lib/prompts/ask";
import { distillPrompt } from "@/lib/prompts/distill";
import { findPrompt } from "@/lib/prompts/find";
import { keypointsPrompt } from "@/lib/prompts/keypoints";
import { saliencePrompt } from "@/lib/prompts/salience";
import { simplifyPrompt } from "@/lib/prompts/simplify";
import { summarizePrompt } from "@/lib/prompts/summarize";
import { synthesisAskPrompt } from "@/lib/prompts/synthesis";
import { splitSentences } from "@/lib/sentences";
import { formatTimeRange } from "@/lib/video/types";
import { CASES, type EvalCase, type EvalTool } from "./cases";
import {
  blockTags,
  callJudge,
  callTool,
  cjkShare,
  defaultJudge,
  fixturePrefix,
  loadFixtures,
  promptCtx,
  selectionOf,
  wordCount,
  type Fixture,
  type JudgeModel,
} from "./lib";
import { RUBRICS, SHARED_CRITERIA } from "./rubrics";

type Check = { name: string; ok: boolean; detail?: string };

type CaseResult = {
  id: string;
  tool: EvalTool;
  fixture: string;
  lang: string;
  input: string;
  prompt: string;
  raw: string;
  output: string; // the output as the reader would see it, for the judge and the report
  checks: Check[];
  judge: { scores: Record<string, number>; overall: number; worst: string; evidence: string; fix: string } | null;
  error: string | null;
  ms: number;
  tokens: { input: number; output: number };
};

type Run = {
  stamp: string;
  judge: JudgeModel;
  model: string;
  results: CaseResult[];
};

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? "");
};
const has = (name: string) => args.includes(`--${name}`);
const toolsWanted = flag("tools")?.split(",").filter(Boolean) ?? null;
const casesWanted = flag("cases")?.split(",").filter(Boolean) ?? null;
const judgeWanted = (flag("judge") as JudgeModel | null) ?? defaultJudge();
const baselineWanted = flag("baseline");
const gate = has("gate");
const outRoot = flag("out") ?? join(process.cwd(), ".eval", "runs");

// ── Cases ──────────────────────────────────────────────────────────────────
function loadCases(): EvalCase[] {
  const fromRatings = join(process.cwd(), "scripts", "eval", "cases", "from-ratings.json");
  const extra: EvalCase[] = existsSync(fromRatings) ? (JSON.parse(readFileSync(fromRatings, "utf8")) as EvalCase[]) : [];
  return [...CASES, ...extra].filter(
    (c) => (!toolsWanted || toolsWanted.includes(c.tool)) && (!casesWanted || casesWanted.includes(c.id)),
  );
}

// ── Adapters: one per tool, the route's own messages and post-processing ──
type Adapter = (c: EvalCase, f: Fixture) => Promise<{ input: string; prompt: string; raw: string; output: string; checks: Check[]; ms: number; tokens: { input: number; output: number } }>;

function system(f: Fixture): ModelMessage {
  return { role: "system", content: fixturePrefix(f) };
}

function tagCheck(output: string, f: Fixture): Check {
  const ids = new Set(f.blocks.map((b) => b.id));
  const tags = blockTags(output);
  const bad = tags.filter((t) => !ids.has(t));
  return { name: "block tags resolve", ok: bad.length === 0, detail: bad.length > 0 ? `unknown: ${bad.join(", ")}` : `${tags.length} tags` };
}

function capCheck(output: string, cap: number): Check {
  const n = wordCount(output);
  return { name: `under ${cap} words`, ok: n <= cap * 1.15, detail: `${n} words` };
}

function languageCheck(output: string, lang: string): Check {
  const share = cjkShare(output);
  const ok = lang === "zh" ? share >= 0.3 : share < 0.3;
  return { name: `answers in ${lang}`, ok, detail: `CJK share ${(share * 100).toFixed(0)}%` };
}

const BANNED_OPENERS = /^\s*(in other words|this passage|the passage|this section|the document discusses|本段|这段|换句话说)/i;
function openerCheck(output: string): Check {
  return { name: "no banned opener", ok: !BANNED_OPENERS.test(output), detail: output.slice(0, 40) };
}

function quoteLines(items: { blockId: string; quotedText: string; label?: string }[]): string {
  return items.map((s) => `- ${s.label ? `${s.label} — ` : ""}“${s.quotedText.replace(/\s+/g, " ")}” [block ${s.blockId}]`).join("\n");
}

const adapters: Record<EvalTool, Adapter> = {
  async simplify(c, f) {
    const ctx = promptCtx(f, c);
    const prompt = simplifyPrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.SIMPLIFY, maxOutputTokens: MAX_OUTPUT_TOKENS.SIMPLIFY });
    const sentences = splitSentences(ctx.anchoredText).length;
    const markers = [...r.text.matchAll(/\[\[([\d,\s]+)\]\]/g)].map((m) => m[1].split(",").map((n) => Number(n.trim())));
    const cited = new Set(markers.flat());
    const outOfRange = [...cited].filter((n) => n < 1 || n > sentences);
    const rewritten = r.text.split(/\[\[[\d,\s]+\]\]/).filter((s) => s.trim()).length;
    const checks: Check[] = [
      { name: "every sentence has a marker", ok: markers.length >= rewritten, detail: `${markers.length} markers, ${rewritten} sentences` },
      { name: "markers in range", ok: outOfRange.length === 0, detail: outOfRange.length > 0 ? `out of 1..${sentences}: ${outOfRange.join(",")}` : `1..${sentences}` },
      { name: "every original sentence restated", ok: cited.size >= sentences, detail: `${cited.size} of ${sentences} cited` },
      openerCheck(r.text),
      { name: "keeps the passage's language", ok: (cjkShare(ctx.anchoredText) >= 0.3) === (cjkShare(r.text) >= 0.3) },
    ];
    return { input: ctx.anchoredText, prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async salience(c, f) {
    const ctx = promptCtx(f, c);
    const prompt = saliencePrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.SALIENCE, maxOutputTokens: MAX_OUTPUT_TOKENS.SALIENCE });
    const parsed = salienceOutputSchema.safeParse(extractJson(r.text));
    const blockById = new Map(f.blocks.map((b) => [b.id, { id: b.id, text: b.text }]));
    const spans = parsed.success ? parsed.data.spans.map((s) => resolveSpan(s, blockById)).filter((s) => s !== null) : [];
    const overlaps = spans.filter((a, i) => spans.some((b, j) => j < i && a.blockId === b.blockId && a.start < b.end && a.end > b.start)).length;
    const long = spans.filter((s) => s.quotedText.length > 300).length;
    const headings = new Set(f.blocks.filter((b) => b.type === "HEADING").map((b) => b.id));
    const onHeadings = spans.filter((s) => headings.has(s.blockId)).length;
    const paragraphs = f.blocks.filter((b) => b.type === "PARAGRAPH").length;
    const lastThird = f.blocks.slice(Math.floor((f.blocks.length * 2) / 3)).map((b) => b.id);
    const inLastThird = spans.filter((s) => lastThird.includes(s.blockId)).length;
    const checks: Check[] = [
      { name: "valid JSON", ok: parsed.success, detail: parsed.success ? "" : "did not parse" },
      { name: "spans resolve", ok: parsed.success && spans.length === parsed.data.spans.length, detail: `${spans.length} of ${parsed.success ? parsed.data.spans.length : 0}` },
      { name: "count fits the document", ok: spans.length >= Math.min(6, paragraphs) && spans.length <= 40, detail: `${spans.length} spans, ${paragraphs} paragraphs` },
      { name: "no overlaps", ok: overlaps === 0, detail: `${overlaps} overlapping` },
      { name: "spans are short", ok: long === 0, detail: `${long} over 300 chars` },
      { name: "no span on a heading", ok: onHeadings === 0, detail: `${onHeadings}` },
      { name: "covers the last third", ok: inLastThird > 0, detail: `${inLastThird} spans there` },
    ];
    return { input: "(whole document)", prompt, raw: r.text, output: quoteLines(spans), checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async distill(c, f) {
    const ctx = { ...promptCtx(f, c), question: c.question ?? "" };
    const prompt = distillPrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.DISTILL, maxOutputTokens: MAX_OUTPUT_TOKENS.DISTILL });
    const parsed = distillOutputSchema.safeParse(extractJson(r.text));
    const blockById = new Map(f.blocks.map((b) => [b.id, { id: b.id, text: b.text }]));
    const quotes = parsed.success
      ? parsed.data.quotes.map((q) => ({ span: resolveSpan(q, blockById), caption: q.caption })).filter((q) => q.span !== null)
      : [];
    const checks: Check[] = [
      { name: "valid JSON", ok: parsed.success },
      { name: "spans resolve", ok: parsed.success && quotes.length === parsed.data.quotes.length, detail: `${quotes.length} of ${parsed.success ? parsed.data.quotes.length : 0}` },
      { name: "2 to 10 quotes", ok: quotes.length >= 1 && quotes.length <= 10, detail: `${quotes.length}` },
      { name: "captions stand alone", ok: quotes.every((q) => !/\b(the question|this quote)\b|这段引文|该问题/i.test(q.caption)) },
      { name: "captions answer in " + c.lang, ok: quotes.every((q) => languageCheck(q.caption, c.lang).ok) },
    ];
    const output = quotes.map((q) => `- ${q.caption}\n  “${q.span!.quotedText.replace(/\s+/g, " ")}” [block ${q.span!.blockId}]`).join("\n");
    return { input: c.question ?? "", prompt, raw: r.text, output, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async keypoints(c, f) {
    const ctx = promptCtx(f, c);
    const prompt = keypointsPrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.KEYPOINTS, maxOutputTokens: MAX_OUTPUT_TOKENS.KEYPOINTS });
    const parsed = keypointsOutputSchema.safeParse(extractJson(r.text));
    const blockById = new Map(f.blocks.map((b) => [b.id, { id: b.id, text: b.text }]));
    const order = new Map(f.blocks.map((b, i) => [b.id, i]));
    const points = parsed.success
      ? parsed.data.points.map((p) => ({ span: resolveSpan(p, blockById), text: p.text })).filter((p) => p.span !== null)
      : [];
    let inOrder = true;
    for (let i = 1; i < points.length; i++) {
      const a = order.get(points[i - 1].span!.blockId) ?? 0;
      const b = order.get(points[i].span!.blockId) ?? 0;
      if (b < a) inOrder = false;
    }
    const numbersInDoc = new Set((f.blocks.map((b) => b.text).join(" ").match(/\d[\d,.]*%?/g) ?? []).map((n) => n.replace(/,/g, "")));
    const invented = points.flatMap((p) => (p.text.match(/\d[\d,.]*%?/g) ?? []).map((n) => n.replace(/,/g, ""))).filter((n) => !numbersInDoc.has(n) && !numbersInDoc.has(n.replace(/%$/, "")));
    const checks: Check[] = [
      { name: "valid JSON", ok: parsed.success },
      { name: "spans resolve", ok: parsed.success && points.length === parsed.data.points.length, detail: `${points.length} of ${parsed.success ? parsed.data.points.length : 0}` },
      { name: "5 to 20 points", ok: points.length >= 4 && points.length <= 20, detail: `${points.length}` },
      { name: "document order", ok: inOrder },
      { name: "no invented numbers", ok: invented.length === 0, detail: invented.join(", ") },
      { name: "points in " + c.lang, ok: points.every((p) => languageCheck(p.text, c.lang).ok) },
      { name: "points state claims", ok: points.every((p) => !/^(the (document|author|paper|memo|article) (discusses|describes|mentions|talks about))|^(本文|作者)(讨论|介绍|提到)/i.test(p.text)) },
    ];
    const output = points.map((p) => `- ${p.text}\n  “${p.span!.quotedText.replace(/\s+/g, " ").slice(0, 160)}” [block ${p.span!.blockId}]`).join("\n");
    return { input: "(whole document)", prompt, raw: r.text, output, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async summarize(c, f) {
    const depth = c.depth ?? "layman";
    const ctx = { ...promptCtx(f, c), depth };
    const prompt = summarizePrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.SUMMARIZE, maxOutputTokens: MAX_OUTPUT_TOKENS.SUMMARIZE });
    const cap = depth === "layman" ? 180 : depth === "insights" ? 300 : 400;
    const checks: Check[] = [capCheck(r.text, cap), tagCheck(r.text, f), languageCheck(r.text, c.lang), openerCheck(r.text)];
    return { input: `depth: ${depth}`, prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async assistant(c, f) {
    const prompt = synthesisAskPrompt({
      profile: c.profile,
      lang: c.lang,
      scopeLabel: "this page: the open document in full",
      question: c.question ?? "",
    });
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.SYNTHESIS, maxOutputTokens: MAX_OUTPUT_TOKENS.SYNTHESIS });
    const checks: Check[] = [
      tagCheck(r.text, f),
      { name: "cites at least one block", ok: blockTags(r.text).length > 0 },
      capCheck(r.text, 250),
      languageCheck(r.text, c.lang),
      openerCheck(r.text),
    ];
    return { input: c.question ?? "", prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async act(c, f) {
    if (!c.selection) throw new Error("act needs a selection");
    const anchor = selectionOf(f, c.selection);
    const prompt = actPrompt({
      profile: c.profile,
      lang: c.lang,
      selectionBlock: textSelectionBlock(anchor.blockId, anchor.quotedText),
      toolBlock: "",
      hasSelection: true,
      sections: [],
      otherDocuments: [],
      notes: [],
      history: [],
      command: c.question ?? "Explain this.",
    });
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.SYNTHESIS, maxOutputTokens: MAX_OUTPUT_TOKENS.SYNTHESIS });
    const planSchema = z.object({
      reply: z.string().nullable(),
      actions: z.array(z.unknown()).optional(),
      matches: z.array(z.object({ blockId: z.string(), quote: z.string(), why: z.string() })).optional(),
    });
    const parsed = planSchema.safeParse(extractJson(r.text));
    const matches = parsed.success ? (parsed.data.matches ?? []) : [];
    const blockById = new Map(f.blocks.map((b) => [b.id, b]));
    const resolved = matches
      .map((m) => {
        const block = blockById.get(m.blockId);
        const hit = block ? matchInText(block.text, { quotedText: m.quote.trim(), prefix: "", suffix: "" }) : null;
        return block && hit ? { blockId: block.id, quotedText: block.text.slice(hit.start, hit.end), why: m.why, self: block.id === anchor.blockId && hit.start < anchor.endOffset && hit.end > anchor.startOffset } : null;
      })
      .filter((m) => m !== null);
    const reply = parsed.success ? (parsed.data.reply ?? "") : "";
    const checks: Check[] = [
      { name: "valid JSON", ok: parsed.success },
      { name: "3 to 8 matches", ok: matches.length >= 3 && matches.length <= 8, detail: `${matches.length}` },
      { name: "quotes verbatim", ok: resolved.length === matches.length, detail: `${resolved.length} of ${matches.length} resolve` },
      { name: "never the selection itself", ok: resolved.every((m) => !m.self) },
      { name: "reply cites blocks", ok: blockTags(reply).length > 0 },
      tagCheck(reply, f),
      capCheck(reply, 150),
      languageCheck(reply, c.lang),
      openerCheck(reply),
    ];
    const output = [reply, "", "Passages", quoteLines(resolved.map((m) => ({ blockId: m.blockId, quotedText: m.quotedText, label: m.why })))].join("\n");
    return { input: `selection: ${anchor.quotedText}\ncommand: ${c.question ?? "Explain this."}`, prompt, raw: r.text, output, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async ask(c, f) {
    if (!c.range) throw new Error("ask needs a range");
    const timed = f.blocks.filter((b) => b.type === "TRANSCRIPT" && b.startTime !== undefined && b.endTime !== undefined);
    const excerpt = timed
      .filter((b) => b.startTime! < c.range!.end && b.endTime! > c.range!.start)
      .map((b) => `[${formatTimeRange(b.startTime!, b.endTime!)}] ${b.text}`)
      .join("\n");
    const ctx = {
      ...promptCtx(f, c),
      question: c.question ?? "",
      video: { timeRange: formatTimeRange(c.range.start, c.range.end), transcriptExcerpt: excerpt, hasFrame: false, hasRegion: false, audio: true },
    };
    const prompt = askPrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.ASK, maxOutputTokens: MAX_OUTPUT_TOKENS.ASK });
    const checks: Check[] = [
      capCheck(r.text, 150),
      { name: "gives times", ok: /\b\d+:\d\d\b/.test(r.text) },
      languageCheck(r.text, c.lang),
      openerCheck(r.text),
    ];
    return { input: `range ${ctx.video.timeRange}: ${c.question}`, prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },

  async find(c, f) {
    const ctx = { ...promptCtx(f, c), query: c.question ?? "" };
    const prompt = findPrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.FIND, maxOutputTokens: MAX_OUTPUT_TOKENS.FIND });
    const parsed = findOutputSchema.safeParse(extractJson(r.text));
    const timed = new Map(f.blocks.filter((b) => b.type === "TRANSCRIPT").map((b) => [b.id, b]));
    const matches = parsed.success
      ? parsed.data.matches.map((m) => ({ blocks: m.blockIds.map((id) => timed.get(id)).filter((b) => b !== undefined), explanation: m.explanation })).filter((m) => m.blocks.length > 0)
      : [];
    const checks: Check[] = [
      { name: "valid JSON", ok: parsed.success },
      { name: "block ids resolve", ok: parsed.success && matches.length === parsed.data.matches.length },
      { name: "at most 5 matches", ok: matches.length <= 5, detail: `${matches.length}` },
      { name: "explanations in " + c.lang, ok: matches.every((m) => languageCheck(m.explanation, c.lang).ok) },
    ];
    const output = matches
      .map((m) => `- ${formatTimeRange(m.blocks[0]!.startTime!, m.blocks[m.blocks.length - 1]!.endTime!)}: ${m.explanation}\n  “${m.blocks.map((b) => b!.text).join(" ").slice(0, 200)}”`)
      .join("\n");
    return { input: c.question ?? "", prompt, raw: r.text, output, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens } };
  },
};

// ── Judge ──────────────────────────────────────────────────────────────────
const judgeSchema = z.object({
  scores: z.record(z.string(), z.number().min(1).max(5)),
  overall: z.number().min(1).max(5),
  worst: z.string(),
  evidence: z.string(),
  fix: z.string(),
});

function judgePrompt(c: EvalCase, f: Fixture, input: string, output: string): string {
  const rubric = RUBRICS[c.tool];
  const criteria = [...rubric.criteria, ...SHARED_CRITERIA];
  const profile = c.profile
    ? `Background: ${c.profile.background}\nPurpose: ${c.profile.purpose}\nApplication: ${c.profile.application || "(none)"}`
    : "(not set: a technically literate generalist)";
  return [
    `You judge the output of one AI reading tool, ${rubric.tool}, against what a valuable output is. Be strict and concrete: a reader's time is the cost.`,
    "",
    `What a valuable output is: ${rubric.what}`,
    "",
    "The document the tool read, every block tagged [block <id>]:",
    "",
    fixturePrefix(f),
    "",
    `The reader context the tool was given:\n${profile}`,
    "",
    `The reader's UI language: ${c.lang === "zh" ? "Chinese" : "English"}.`,
    "",
    `The input the tool ran on:\n${input}`,
    ...(c.expect ? ["", `What a good output must contain (from the case's author):\n${c.expect}`] : []),
    "",
    "The output:",
    "",
    output || "(empty)",
    "",
    "Score each criterion 1 to 5: 5 = fully holds, 3 = holds with one real fault, 1 = fails. Then overall, 1 to 5, as the reader would rate it. worst: the key of the lowest criterion. evidence: the exact words of the output that show the worst fault, or the absence they show. fix: one concrete change to the tool's prompt template that would raise the worst criterion, in one sentence — a rule to add, a rule to drop, or a wording to change, never 'improve' or 'be more careful'.",
    "",
    "Criteria:",
    ...criteria.map((cr) => `- ${cr.key}: ${cr.ask}`),
    "",
    `Return ONLY JSON: {"scores": {${criteria.map((cr) => `"${cr.key}": <1-5>`).join(", ")}}, "overall": <1-5>, "worst": "<key>", "evidence": "<words>", "fix": "<sentence>"}`,
  ].join("\n");
}

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  const fixtures = loadFixtures();
  const cases = loadCases();
  if (cases.length === 0) {
    console.error("no cases match");
    process.exit(2);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = join(outRoot, stamp);
  mkdirSync(outDir, { recursive: true });
  const run: Run = { stamp, judge: judgeWanted, model: process.env.MOONSHOT_BASE_URL?.includes("localhost") ? "mock" : "kimi-k3", results: [] };
  console.log(`eval ${stamp}: ${cases.length} cases, judge ${judgeWanted}, out ${outDir}`);

  for (const c of cases) {
    const f = fixtures.get(c.fixture);
    const started = Date.now();
    if (!f) {
      run.results.push({ id: c.id, tool: c.tool, fixture: c.fixture, lang: c.lang, input: "", prompt: "", raw: "", output: "", checks: [], judge: null, error: `fixture ${c.fixture} not found`, ms: 0, tokens: { input: 0, output: 0 } });
      continue;
    }
    try {
      const r = await adapters[c.tool](c, f);
      let judge: CaseResult["judge"] = null;
      if (judgeWanted !== "none") {
        const answer = judgeSchema.safeParse(await callJudge(judgeWanted, judgePrompt(c, f, r.input, r.output)));
        if (answer.success) judge = answer.data;
        else r.checks.push({ name: "judge answered", ok: false, detail: "the judge's JSON did not parse" });
      }
      const failed = r.checks.filter((k) => !k.ok).map((k) => k.name);
      console.log(
        `  ${c.id.padEnd(34)} ${judge ? judge.overall.toFixed(1) : "  - "}  ${failed.length === 0 ? "checks ok" : `FAIL: ${failed.join("; ")}`}  ${(r.ms / 1000).toFixed(1)}s`,
      );
      run.results.push({ id: c.id, tool: c.tool, fixture: c.fixture, lang: c.lang, input: r.input, prompt: r.prompt, raw: r.raw, output: r.output, checks: r.checks, judge, error: null, ms: r.ms, tokens: r.tokens });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${c.id.padEnd(34)} ERROR ${message}`);
      run.results.push({ id: c.id, tool: c.tool, fixture: c.fixture, lang: c.lang, input: "", prompt: "", raw: "", output: "", checks: [], judge: null, error: message, ms: Date.now() - started, tokens: { input: 0, output: 0 } });
    }
  }

  // ── Baseline ──
  const latestPath = join(outRoot, "..", "latest.json");
  let baseline: Run | null = null;
  if (baselineWanted) {
    const path = baselineWanted === "latest" ? latestPath : baselineWanted;
    if (existsSync(path)) baseline = JSON.parse(readFileSync(path, "utf8")) as Run;
    else console.warn(`baseline ${path} not found`);
  }

  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  const report = renderReport(run, baseline);
  writeFileSync(join(outDir, "report.md"), report);
  mkdirSync(join(outRoot, ".."), { recursive: true });
  copyFileSync(join(outDir, "results.json"), latestPath);
  console.log("");
  console.log(report);
  console.log(`\nwritten: ${outDir}/report.md`);

  if (gate && baseline) {
    const regressions = toolRows(run, baseline).filter((r) => r.regressed);
    if (regressions.length > 0) {
      console.error(`REGRESSION in ${regressions.map((r) => r.tool).join(", ")}`);
      process.exit(1);
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
type ToolRow = { tool: string; cases: number; errors: number; checksFailed: number; mean: number | null; min: number | null; baselineMean: number | null; delta: number | null; regressed: boolean };

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function toolRows(run: Run, baseline: Run | null): ToolRow[] {
  const tools = [...new Set(run.results.map((r) => r.tool))];
  return tools.map((tool) => {
    const rows = run.results.filter((r) => r.tool === tool);
    const scores = rows.map((r) => r.judge?.overall).filter((s): s is number => s !== undefined && s !== null);
    const m = mean(scores);
    const base = baseline ? mean(baseline.results.filter((r) => r.tool === tool).map((r) => r.judge?.overall).filter((s): s is number => typeof s === "number")) : null;
    const checksFailed = rows.reduce((n, r) => n + r.checks.filter((k) => !k.ok).length, 0);
    const baseChecksFailed = baseline ? baseline.results.filter((r) => r.tool === tool).reduce((n, r) => n + r.checks.filter((k) => !k.ok).length, 0) : 0;
    const delta = m !== null && base !== null ? m - base : null;
    return {
      tool,
      cases: rows.length,
      errors: rows.filter((r) => r.error).length,
      checksFailed,
      mean: m,
      min: scores.length > 0 ? Math.min(...scores) : null,
      baselineMean: base,
      delta,
      regressed: (delta !== null && delta <= -0.5) || (baseline !== null && checksFailed > baseChecksFailed),
    };
  });
}

function renderReport(run: Run, baseline: Run | null): string {
  const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(2));
  const lines: string[] = [
    `# Tool eval ${run.stamp}`,
    "",
    `Model: ${run.model}. Judge: ${run.judge}.${baseline ? ` Baseline: ${baseline.stamp}.` : ""}`,
    "",
    "| Tool | Cases | Errors | Checks failed | Mean | Min | Baseline | Delta |",
    "|---|---|---|---|---|---|---|---|",
    ...toolRows(run, baseline).map(
      (r) => `| ${r.tool} | ${r.cases} | ${r.errors} | ${r.checksFailed} | ${fmt(r.mean)} | ${fmt(r.min)} | ${fmt(r.baselineMean)} | ${r.delta === null ? "-" : (r.delta >= 0 ? "+" : "") + r.delta.toFixed(2)}${r.regressed ? " REGRESSED" : ""} |`,
    ),
    "",
    "## Weakest cases",
    "",
  ];
  const ranked = run.results
    .filter((r) => !r.error)
    .map((r) => ({ r, score: r.judge?.overall ?? (r.checks.some((k) => !k.ok) ? 0 : 5) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 8);
  for (const { r } of ranked) {
    const failed = r.checks.filter((k) => !k.ok);
    lines.push(`### ${r.id} (${r.tool}) — ${r.judge ? `overall ${r.judge.overall}` : "no judge"}`);
    if (failed.length > 0) lines.push(`- Checks failed: ${failed.map((k) => `${k.name}${k.detail ? ` (${k.detail})` : ""}`).join("; ")}`);
    if (r.judge) {
      lines.push(`- Scores: ${Object.entries(r.judge.scores).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      lines.push(`- Worst: ${r.judge.worst} — “${r.judge.evidence}”`);
      lines.push(`- Fix: ${r.judge.fix}`);
    }
    lines.push("");
  }
  const errors = run.results.filter((r) => r.error);
  if (errors.length > 0) {
    lines.push("## Errors", "", ...errors.map((r) => `- ${r.id}: ${r.error}`), "");
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
