// The tool quality loop's runner (SPEC.md §25). One run: every case in
// scripts/eval/cases.ts (and cases/from-ratings.json when present) goes
// through its tool's real prompt template on the real model, the output is
// checked mechanically (caps, tags, spans, markers, language), a judge scores
// it against the tool's rubric, and a report lands under .eval/runs/<stamp>/
// with results.json (every prompt, output, check, and score) and report.md
// (the table). --baseline compares against an earlier run and names the
// regressions; latest.json keeps the last result of every case, so a run of
// one tool compares with that tool's last run. Usage:
//   npx tsx scripts/eval/run.ts [--tools simplify,act] [--cases id,id]
//     [--judge claude|kimi|external|none] [--baseline latest|<path>] [--gate]
//     [--external <dir>]
// --external: no model is called; each case's prompt is written under <dir>
// and an agent's answer is read back from there (lib.ts). Run once to write
// the prompts, let agents answer, run again with --judge external to write
// the judge prompts, let agents judge, run a third time for the report.
// Keys: MOONSHOT_API_KEY runs the tools; ANTHROPIC_API_KEY runs Collapse
// (Claude Opus 5.5, as the route does) and makes Claude the judge (else
// Kimi judges, else no judge). MOONSHOT_API_KEY=mock with
// MOONSHOT_BASE_URL=http://localhost:3399/v1 (scripts/qa/mock-kimi.mjs) is a
// dry run of the wiring; the Claude calls go to the same mock (env.ts).
import "./env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText, matchInTextLoose } from "@/lib/anchors/match";
import {
  collapseRequests,
  collapseWindowSchema,
  coreCeiling,
  currentCores,
  fittedCores,
  wordCount as collapseWords,
  type CollapseAnswer,
} from "@/lib/collapse";
import { COLLAPSE_EFFORT, COLLAPSE_MAX_OUTPUT_TOKENS, DERIVATION_EFFORT, MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import {
  distillOutputSchema,
  extractJson,
  findOutputSchema,
  resolveSpan,
  salienceOutputSchema,
} from "@/lib/derive/json";
import { actPrompt, textSelectionBlock } from "@/lib/prompts/act";
import { askPrompt } from "@/lib/prompts/ask";
import { definable } from "@/lib/define";
import { definePrompt } from "@/lib/prompts/define";
import { distillPrompt } from "@/lib/prompts/distill";
import { findPrompt } from "@/lib/prompts/find";
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
  isExternal,
  setCurrentCase,
  setExternal,
  loadFixtures,
  numbersIn,
  promptCtx,
  quotedSpans,
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
  // The model id the tool ran on (absent in runs before it was recorded).
  model?: string;
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
const externalWanted = flag("external");
if (externalWanted) setExternal(externalWanted);

// ── Cases ──────────────────────────────────────────────────────────────────
function loadCases(): EvalCase[] {
  const fromRatings = join(process.cwd(), "scripts", "eval", "cases", "from-ratings.json");
  const extra: EvalCase[] = existsSync(fromRatings) ? (JSON.parse(readFileSync(fromRatings, "utf8")) as EvalCase[]) : [];
  return [...CASES, ...extra].filter(
    (c) => (!toolsWanted || toolsWanted.includes(c.tool)) && (!casesWanted || casesWanted.includes(c.id)),
  );
}

// ── Adapters: one per tool, the route's own messages and post-processing ──
type Adapter = (c: EvalCase, f: Fixture) => Promise<{ input: string; prompt: string; raw: string; output: string; checks: Check[]; ms: number; tokens: { input: number; output: number }; model?: string }>;

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

// The numbers a text states that its source does not, each marked with
// whether the document holds it elsewhere.
function numbersNotIn(text: string, source: string, document: string): string[] {
  const inSource = numbersIn(source, true);
  const inDocument = numbersIn(document, true);
  return [...numbersIn(text)]
    .filter((n) => !inSource.has(n))
    .map((n) => (inDocument.has(n) ? `${n} (elsewhere in the document)` : `${n} (not in the document)`));
}

// The spans a text quotes that are not the source's words, each marked
// with whether the document holds them elsewhere. Typography and case are
// the quoter's (matchInTextLoose, the ladder for a quote a model copied).
function quotesNotIn(text: string, source: string, document: string): string[] {
  const found = (haystack: string, span: string) => matchInTextLoose(haystack, { quotedText: span, prefix: "", suffix: "" }) !== null;
  return quotedSpans(text)
    .filter((span) => !found(source, span))
    .map((span) => `“${span.length > 60 ? `${span.slice(0, 60)}…` : span}”${found(document, span) ? " (another block's words)" : ""}`);
}

// A core that opens by describing the block instead of saying what it says.
const CORE_META_OPENERS = /^\s*((this|the) (paragraph|passage|block|section|excerpt|list|table)\b|in other words|the document discusses|本段|这段|该段|此段|换句话说)/i;

function quoteLines(items: { blockId: string; quotedText: string; label?: string }[]): string {
  return items.map((s) => `- ${s.label ? `${s.label} — ` : ""}“${s.quotedText.replace(/\s+/g, " ")}” [block ${s.blockId}]`).join("\n");
}

const adapters: Record<EvalTool, Adapter> = {
  async define(c, f) {
    if (!c.selection) throw new Error("define needs a selection");
    const ctx = promptCtx(f, c);
    const prompt = definePrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.DEFINE, maxOutputTokens: MAX_OUTPUT_TOKENS.DEFINE });
    const text = r.text.trim();
    const sentences = splitSentences(text).length;
    const checks: Check[] = [
      { name: "the selection is one word", ok: definable(ctx.anchoredText), detail: ctx.anchoredText },
      capCheck(text, 40),
      { name: "two sentences at most", ok: sentences <= 2, detail: `${sentences} sentences` },
      { name: "does not open with the selection", ok: !text.toLowerCase().startsWith(ctx.anchoredText.trim().toLowerCase()) },
      { name: "plain text", ok: !/[*#`]|^\s*[-•]\s/m.test(text) },
      languageCheck(text, c.lang),
      openerCheck(text),
    ];
    return { input: ctx.anchoredText, prompt, raw: r.text, output: text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
  },

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
    return { input: ctx.anchoredText, prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
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
    return { input: "(whole document)", prompt, raw: r.text, output: quoteLines(spans), checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
  },

  async distill(c, f) {
    const ctx = { ...promptCtx(f, c), question: c.question ?? "" };
    const prompt = distillPrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.DISTILL, maxOutputTokens: MAX_OUTPUT_TOKENS.DISTILL });
    const parsed = distillOutputSchema.safeParse(extractJson(r.text));
    const blockById = new Map(f.blocks.map((b) => [b.id, { id: b.id, text: b.text }]));
    // Resolved and in document order, as the route stores them and the page shows them.
    const order = new Map(f.blocks.map((b, i) => [b.id, i]));
    const quotes = (parsed.success ? parsed.data.quotes : [])
      .map((q) => ({ span: resolveSpan(q, blockById), caption: q.caption, quote: q.quote?.trim() ?? "" }))
      .flatMap((q) => (q.span ? [{ ...q, span: q.span }] : []))
      .sort((a, b) => (order.get(a.span.blockId) ?? 0) - (order.get(b.span.blockId) ?? 0) || a.span.start - b.span.start);
    const document = f.blocks.map((b) => b.text).join("\n");
    // A quote the document does not hold resolves on its offsets alone: the
    // reader then sees words the model did not mean.
    const misquoted = quotes.filter((q) => q.quote && !f.blocks.some((b) => matchInTextLoose(b.text, { quotedText: q.quote, prefix: "", suffix: "" })));
    const overlaps = quotes.filter((a, i) => quotes.some((b, j) => j < i && a.span.blockId === b.span.blockId && a.span.start < b.span.end && a.span.end > b.span.start));
    const numbers = quotes.flatMap((q) => numbersNotIn(q.caption, `${document}\n${c.question ?? ""}`, document));
    const checks: Check[] = [
      { name: "valid JSON", ok: parsed.success },
      { name: "spans resolve", ok: parsed.success && quotes.length === parsed.data.quotes.length, detail: `${quotes.length} of ${parsed.success ? parsed.data.quotes.length : 0}` },
      { name: "1 to 10 quotes", ok: quotes.length >= 1 && quotes.length <= 10, detail: `${quotes.length}` },
      { name: "quotes are the document's words", ok: misquoted.length === 0, detail: misquoted.map((q) => `“${q.quote.slice(0, 60)}”`).join("; ") },
      { name: "quotes do not overlap", ok: overlaps.length === 0, detail: `${overlaps.length} overlapping` },
      { name: "caption numbers are in the document", ok: numbers.length === 0, detail: numbers.join("; ") },
      { name: "captions stand alone", ok: quotes.every((q) => !/\b(the question|this quote)\b|这段引文|该问题/i.test(q.caption)) },
      { name: "captions answer in " + c.lang, ok: quotes.every((q) => languageCheck(q.caption, c.lang).ok) },
    ];
    const output = quotes.map((q) => `- ${q.caption}\n  “${q.span.quotedText.replace(/\s+/g, " ")}” [block ${q.span.blockId}]`).join("\n");
    return { input: c.question ?? "", prompt, raw: r.text, output, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
  },

  async collapse(c, f) {
    // The route's own path (lib/collapse.ts, buildCollapse): in a fixture
    // every collapsible block lacks a core; the windows, their prompts, the
    // collapse feature's model and effort, and the fitting of the cores are
    // the route's. Collapse reads no reader context: the cores are the
    // document's, in its language, for every reader.
    const { missing } = currentCores(null, f.blocks, null);
    if (!(await featureConfigured("collapse"))) throw new Error("Collapse's model has no key: Claude Opus 5.5 needs ANTHROPIC_API_KEY");
    const call = await featureCall("collapse", COLLAPSE_EFFORT);
    const requests = collapseRequests(fixturePrefix(f), missing);
    const answers: CollapseAnswer[] = [];
    const raw: string[] = [];
    let ms = 0;
    const tokens = { input: 0, output: 0 };
    for (const request of requests) {
      const r = await callTool({ messages: request.messages, call, maxOutputTokens: COLLAPSE_MAX_OUTPUT_TOKENS });
      raw.push(r.text);
      ms += r.ms;
      tokens.input += r.inputTokens;
      tokens.output += r.outputTokens;
      const parsed = collapseWindowSchema.safeParse(extractJson(r.text));
      if (parsed.success) answers.push(parsed.data);
    }
    const cores = fittedCores(answers, missing);
    // The model's own core per block, before the fit cuts it: the length
    // check reads these. A core for no listed block, or a second one, strays.
    const listed = new Set(missing.map((b) => b.id));
    const written = new Map<string, string>();
    const strays: string[] = [];
    for (const answer of answers) {
      for (const core of answer.cores) {
        if (!listed.has(core.blockId) || written.has(core.blockId)) strays.push(core.blockId);
        else written.set(core.blockId, core.text);
      }
    }
    const short = (id: string) => id.replace(`${f.name}-`, "");
    const document = f.blocks.map((b) => b.text).join("\n");
    const ceiling = (text: string) => coreCeiling(collapseWords(text));
    const skipped = missing.filter((b) => !cores.has(b.id));
    const over = missing.filter((b) => written.has(b.id) && collapseWords(written.get(b.id)!) > ceiling(b.text));
    const each = (find: (core: string, block: string) => string[]) =>
      missing.flatMap((b) => {
        const core = cores.get(b.id)?.text;
        return core ? find(core, b.text).map((fault) => `${short(b.id)}: ${fault}`) : [];
      });
    const longer = each((core, block) => (collapseWords(core) > collapseWords(block) ? [`${collapseWords(core)} words, block ${collapseWords(block)}`] : []));
    const numbers = each((core, block) => numbersNotIn(core, block, document));
    const quotes = each((core, block) => quotesNotIn(core, block, document));
    const language = each((core) => {
      const check = languageCheck(core, c.lang);
      return check.ok ? [] : [check.detail ?? ""];
    });
    const meta = each((core) => (CORE_META_OPENERS.test(core) ? [core.slice(0, 40)] : []));
    const checks: Check[] = [
      { name: "valid JSON", ok: answers.length === requests.length, detail: `${answers.length} of ${requests.length} windows` },
      { name: "a core for every block", ok: skipped.length === 0, detail: skipped.length > 0 ? `none for ${skipped.map((b) => short(b.id)).join(", ")}` : `${cores.size} cores` },
      { name: "cores name listed blocks", ok: strays.length === 0, detail: strays.map(short).join(", ") },
      { name: "cores under their ceiling", ok: over.length === 0, detail: over.map((b) => `${short(b.id)}: ${collapseWords(written.get(b.id)!)} words, ceiling ${ceiling(b.text)}`).join("; ") },
      { name: "cores shorter than their blocks", ok: longer.length === 0, detail: longer.join("; ") },
      { name: "core numbers are in the block", ok: numbers.length === 0, detail: numbers.join("; ") },
      { name: "core quotes are the block's words", ok: quotes.length === 0, detail: quotes.join("; ") },
      { name: "cores in " + c.lang, ok: language.length === 0, detail: language.join("; ") },
      { name: "no core opens by describing the block", ok: meta.length === 0, detail: meta.join("; ") },
    ];
    // What the judge and the report read: each block, then the core the
    // reader sees in its place.
    const output = missing
      .map((b) =>
        [
          `[block ${b.id}] ${b.type}, ${collapseWords(b.text)} words, ceiling ${ceiling(b.text)}`,
          `Block: ${b.text.replace(/\s+/g, " ")}`,
          `Core: ${cores.get(b.id)?.text ?? "(none: the block shows as it is)"}`,
        ].join("\n"),
      )
      .join("\n\n");
    const prompt = requests.map((r) => r.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).slice(1).join("\n")).join("\n\n");
    return { input: `(the whole document: ${missing.length} blocks to collapse)`, prompt, raw: raw.join("\n\n"), output, checks, ms, tokens, model: call.modelId };
  },

  async summarize(c, f) {
    const depth = c.depth ?? "layman";
    const ctx = { ...promptCtx(f, c), depth };
    const prompt = summarizePrompt(ctx);
    const r = await callTool({ messages: [system(f), { role: "user", content: prompt }], effort: DERIVATION_EFFORT.SUMMARIZE, maxOutputTokens: MAX_OUTPUT_TOKENS.SUMMARIZE });
    const cap = depth === "layman" ? 180 : 400;
    const checks: Check[] = [capCheck(r.text, cap), tagCheck(r.text, f), languageCheck(r.text, c.lang), openerCheck(r.text)];
    return { input: `depth: ${depth}`, prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
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
    return { input: c.question ?? "", prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
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
    return { input: `selection: ${anchor.quotedText}\ncommand: ${c.question ?? "Explain this."}`, prompt, raw: r.text, output, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
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
    return { input: `range ${ctx.video.timeRange}: ${c.question}`, prompt, raw: r.text, output: r.text, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
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
    return { input: c.question ?? "", prompt, raw: r.text, output, checks, ms: r.ms, tokens: { input: r.inputTokens, output: r.outputTokens }, model: r.model };
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
  const language = c.lang === "zh" ? "Chinese" : "English";
  // Collapse reads no reader context: the cores are the document's, for
  // every reader, and one core that twists its block misleads them all.
  const collapse = c.tool === "collapse";
  return [
    `You judge the output of one AI reading tool, ${rubric.tool}, against what a valuable output is. Be strict and concrete: a reader's time is the cost.`,
    "",
    `What a valuable output is: ${rubric.what}`,
    "",
    "The document the tool read, every block tagged [block <id>]:",
    "",
    fixturePrefix(f),
    "",
    ...(collapse
      ? [`Collapse reads no reader context: the cores are the document's, written once for every reader, in the document's language (${language}).`]
      : [`The reader context the tool was given:\n${profile}`, "", `The reader's UI language: ${language}.`]),
    "",
    `The input the tool ran on:\n${input}`,
    ...(c.expect ? ["", `What a good output must contain (from the case's author):\n${c.expect}`] : []),
    "",
    "The output:",
    "",
    output || "(empty)",
    "",
    ...(collapse
      ? ["Read every core against its block and the whole document. A criterion scores by the worst core it asks about: one core that twists its block's meaning makes faithful 1 or 2.", ""]
      : []),
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
  const run: Run = { stamp, judge: judgeWanted, model: externalWanted ? "external" : "", results: [] };
  console.log(`eval ${stamp}: ${cases.length} cases, judge ${judgeWanted}, out ${outDir}`);

  for (const c of cases) {
    const f = fixtures.get(c.fixture);
    const started = Date.now();
    if (!f) {
      run.results.push({ id: c.id, tool: c.tool, fixture: c.fixture, lang: c.lang, input: "", prompt: "", raw: "", output: "", checks: [], judge: null, error: `fixture ${c.fixture} not found`, ms: 0, tokens: { input: 0, output: 0 } });
      continue;
    }
    try {
      setCurrentCase(c.id);
      const r = await adapters[c.tool](c, f);
      let judge: CaseResult["judge"] = null;
      // External mode: no judge until the agent's answer is there, and a
      // judge that has not answered yet is pending, not failed.
      const pending = isExternal() && r.raw === "";
      if (judgeWanted !== "none" && !pending) {
        const answer = judgeSchema.safeParse(await callJudge(judgeWanted, judgePrompt(c, f, r.input, r.output)));
        if (answer.success) judge = answer.data;
        else if (judgeWanted !== "external") r.checks.push({ name: "judge answered", ok: false, detail: "the judge's JSON did not parse" });
      }
      const failed = r.checks.filter((k) => !k.ok).map((k) => k.name);
      console.log(
        `  ${c.id.padEnd(34)} ${judge ? judge.overall.toFixed(1) : "  - "}  ${failed.length === 0 ? "checks ok" : `FAIL: ${failed.join("; ")}`}  ${(r.ms / 1000).toFixed(1)}s`,
      );
      run.results.push({ id: c.id, tool: c.tool, fixture: c.fixture, lang: c.lang, input: r.input, prompt: r.prompt, raw: r.raw, output: r.output, checks: r.checks, judge, error: null, ms: r.ms, tokens: r.tokens, model: r.model });
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

  // The models the tools ran on: Kimi K3, and a feature's own model where
  // the route calls one (Collapse on Claude Opus 5.5).
  const models = [...new Set(run.results.map((r) => r.model).filter((m): m is string => Boolean(m)))];
  run.model = `${models.join(", ") || "kimi-k3"}${process.env.MOONSHOT_BASE_URL?.includes("localhost") ? " (mock server)" : ""}`;
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  const report = renderReport(run, baseline);
  writeFileSync(join(outDir, "report.md"), report);
  mkdirSync(join(outRoot, ".."), { recursive: true });
  // latest.json holds the last result of every case: a run of one tool
  // replaces that tool's cases and keeps the rest, so --baseline latest
  // compares each tool with its own last run.
  const previous = existsSync(latestPath) ? (JSON.parse(readFileSync(latestPath, "utf8")) as Run) : null;
  const ran = new Set(run.results.map((r) => r.id));
  const latest: Run = { ...run, results: [...(previous?.results.filter((r) => !ran.has(r.id)) ?? []), ...run.results] };
  writeFileSync(latestPath, JSON.stringify(latest, null, 2));
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
type ToolRow = { tool: string; model: string; cases: number; errors: number; checksFailed: number; mean: number | null; min: number | null; baselineMean: number | null; delta: number | null; regressed: boolean };

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
      model: [...new Set(rows.map((r) => r.model).filter((id): id is string => Boolean(id)))].join(", ") || "-",
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
    "| Tool | Model | Cases | Errors | Checks failed | Mean | Min | Baseline | Delta |",
    "|---|---|---|---|---|---|---|---|---|",
    ...toolRows(run, baseline).map(
      (r) => `| ${r.tool} | ${r.model} | ${r.cases} | ${r.errors} | ${r.checksFailed} | ${fmt(r.mean)} | ${fmt(r.min)} | ${fmt(r.baselineMean)} | ${r.delta === null ? "-" : (r.delta >= 0 ? "+" : "") + r.delta.toFixed(2)}${r.regressed ? " REGRESSED" : ""} |`,
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
