// The tool quality loop's library (SPEC.md §25): fixtures read as documents,
// the same prompt context the routes build, the model calls, and the judge.
// Runs outside Next.js: everything imported from src/ is pure or reads only
// env (lib/kimi.ts, lib/claude.ts). No database: lib/models.ts falls back to
// the default model ids when the ModelChoice table cannot be read.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { generateText, type ModelMessage } from "ai";
import { claude, claudeConfigured, claudeOptions } from "@/lib/claude";
import { anchorContext, documentPrefix } from "@/lib/derive/context";
import { extractJson } from "@/lib/derive/json";
import type { Lang } from "@/lib/i18n/config";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { KIMI_K3, CLAUDE_FABLE_5_1, type KimiEffort } from "@/lib/derive/config";
import type { ModelCall } from "@/lib/model-call";
import type { PromptCtx, ReaderProfileCtx } from "@/lib/prompts/types";

export const FIXTURES_DIR = join(process.cwd(), "scripts", "eval", "fixtures");

export type FixtureBlock = {
  id: string;
  type: "HEADING" | "PARAGRAPH" | "LIST" | "TABLE" | "CODE" | "TRANSCRIPT";
  text: string;
  html?: string;
  startTime?: number;
  endTime?: number;
};

export type Fixture = { name: string; title: string; blocks: FixtureBlock[] };

// One time stamp "m:ss" or "h:mm:ss" as seconds.
function seconds(stamp: string): number {
  const parts = stamp.split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// A fixture is markdown: "# " opens the title, blank lines separate blocks,
// "## " is a HEADING, "- " lines are one LIST, "|" lines are one TABLE,
// ``` fences are one CODE block, and "[m:ss–m:ss] text" lines are TRANSCRIPT
// blocks with their seconds. Block ids are the fixture name and the block
// order, so a report reads them at a glance.
export function parseFixture(path: string): Fixture {
  const name = basename(path).replace(/\.md$/, "");
  const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  let title = name;
  const chunks: string[] = [];
  let current: string[] = [];
  let inCode = false;
  const flush = () => {
    if (current.length > 0) chunks.push(current.join("\n"));
    current = [];
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        current.push(line);
        flush();
        inCode = false;
      } else {
        flush();
        current.push(line);
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      current.push(line);
      continue;
    }
    if (line.startsWith("# ") && chunks.length === 0 && current.length === 0) {
      title = line.slice(2).trim();
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    // A transcript line is a block of its own.
    if (/^\[\d+:\d\d(?::\d\d)?–\d+:\d\d(?::\d\d)?\]/.test(line)) {
      flush();
      chunks.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  const blocks: FixtureBlock[] = chunks.map((chunk, i) => {
    const id = `${name}-b${i + 1}`;
    const stamp = chunk.match(/^\[(\d+:\d\d(?::\d\d)?)–(\d+:\d\d(?::\d\d)?)\]\s*([\s\S]*)$/);
    if (stamp) {
      return { id, type: "TRANSCRIPT", text: stamp[3].trim(), startTime: seconds(stamp[1]), endTime: seconds(stamp[2]) };
    }
    if (chunk.startsWith("```")) {
      return { id, type: "CODE", text: chunk.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "") };
    }
    if (/^#{2,6} /.test(chunk)) return { id, type: "HEADING", text: chunk.replace(/^#{2,6} /, "").trim() };
    if (chunk.split("\n").every((l) => l.startsWith("- "))) return { id, type: "LIST", text: chunk };
    if (chunk.split("\n").every((l) => l.startsWith("|"))) {
      const rows = chunk
        .split("\n")
        .filter((l) => !/^\|[\s|:-]+\|$/.test(l))
        .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      const text = rows.map((r) => r.join("\t")).join("\n");
      const html = `<table>${rows.map((r, ri) => `<tr>${r.map((c) => (ri === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("")}</table>`;
      return { id, type: "TABLE", text, html };
    }
    return { id, type: "PARAGRAPH", text: chunk };
  });
  return { name, title, blocks };
}

export function loadFixtures(): Map<string, Fixture> {
  const out = new Map<string, Fixture>();
  for (const file of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".md")).sort()) {
    const fixture = parseFixture(join(FIXTURES_DIR, file));
    out.set(fixture.name, fixture);
  }
  return out;
}

// The blocks as the routes render them: the cached system prefix.
export function fixturePrefix(fixture: Fixture): string {
  return documentPrefix(fixture.title, fixture.blocks, null, null);
}

/** The anchor a case names: a block by its order (1-based) and the text
    selected inside it; the whole block when no text is named. */
export function selectionOf(
  fixture: Fixture,
  selection: { block: number; text?: string },
): { blockId: string; startOffset: number; endOffset: number; quotedText: string } {
  const block = fixture.blocks[selection.block - 1];
  if (!block) throw new Error(`block ${selection.block} is not in ${fixture.name}`);
  const start = selection.text ? block.text.indexOf(selection.text) : 0;
  if (start === -1) throw new Error(`"${selection.text}" is not in block ${selection.block} of ${fixture.name}`);
  const end = selection.text ? start + selection.text.length : block.text.length;
  return { blockId: block.id, startOffset: start, endOffset: end, quotedText: block.text.slice(start, end) };
}

/** The PromptCtx the derive route builds for a selection-level tool. */
export function promptCtx(
  fixture: Fixture,
  params: { profile: ReaderProfileCtx; lang: Lang; selection?: { block: number; text?: string } },
): PromptCtx {
  const anchor = params.selection ? selectionOf(fixture, params.selection) : null;
  const context = anchor ? anchorContext(fixture.blocks, anchor.blockId, anchor.startOffset, anchor.endOffset) : null;
  return {
    profile: params.profile,
    lang: params.lang,
    documentTitle: fixture.title,
    anchoredText: context?.anchoredText ?? "",
    contextBefore: context?.contextBefore ?? "",
    contextAfter: context?.contextAfter ?? "",
    sectionSkeleton: [],
  };
}

// ── Model calls ────────────────────────────────────────────────────────────

export type CallResult = { text: string; finishReason: string; inputTokens: number; outputTokens: number; ms: number; model: string };

// External mode (--external <dir>): no model is called. Each tool call writes
// its messages to <dir>/<case>/prompt.md and reads the answer an agent wrote
// to <dir>/<case>/answer.txt; the judge writes judge-prompt.md and reads
// judge.json. A run before the answers exist writes the prompts; a run after
// reads them. So a Claude session can stand in for the model and the judge
// when no key is set.
let externalDir: string | null = null;
let currentCase = "case";

export function setExternal(dir: string | null): void {
  externalDir = dir;
}

export function setCurrentCase(id: string): void {
  currentCase = id;
}

export function isExternal(): boolean {
  return externalDir !== null;
}

function renderMessages(messages: ModelMessage[]): string {
  return messages
    .map((m) => `=====[${m.role.toUpperCase()}]=====\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
    .join("\n\n");
}

function external(file: string, prompt: string, answer: string): string | null {
  const dir = join(externalDir!, currentCase);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), prompt);
  const path = join(dir, answer);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** One call on the tool's model with the same effort and budget the route
    uses: Kimi K3 at the route's effort, or the call a feature's model gives
    (featureCall in lib/feature-models.ts: Collapse runs on Claude Opus
    5.5). The text comes back whole: the eval reads finished outputs. */
export async function callTool(params: {
  messages: ModelMessage[];
  maxOutputTokens: number;
} & ({ effort: KimiEffort; call?: undefined } | { call: ModelCall; effort?: undefined })): Promise<CallResult> {
  if (externalDir) {
    const text = external("prompt.md", renderMessages(params.messages), "answer.txt");
    return { text: text ?? "", finishReason: text === null ? "pending" : "stop", inputTokens: 0, outputTokens: Math.round((text ?? "").length / 3.5), ms: 0, model: "external" };
  }
  if (!params.call && !kimiConfigured()) throw new Error("MOONSHOT_API_KEY is not set (MOONSHOT_API_KEY=mock with the mock server for a dry run)");
  const started = Date.now();
  const result = await generateText({
    model: params.call ? params.call.model : await kimi(KIMI_K3),
    maxOutputTokens: params.maxOutputTokens,
    providerOptions: params.call ? params.call.providerOptions : kimiOptions(params.effort),
    allowSystemInMessages: true,
    messages: params.messages,
  });
  return {
    text: result.text,
    finishReason: result.finishReason,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    ms: Date.now() - started,
    model: params.call ? params.call.modelId : KIMI_K3,
  };
}

export type JudgeModel = "claude" | "kimi" | "external" | "none";

/** Which judge the environment allows: Claude when its key is set, else
    Kimi, else none. --judge overrides. */
export function defaultJudge(): JudgeModel {
  if (claudeConfigured()) return "claude";
  if (kimiConfigured()) return "kimi";
  return "none";
}

/** One judge call: a JSON answer, parsed tolerantly. */
export async function callJudge(judge: JudgeModel, prompt: string): Promise<unknown | null> {
  if (judge === "none") return null;
  if (judge === "external") {
    const text = external("judge-prompt.md", prompt, "judge.json");
    return text === null ? null : extractJson(text);
  }
  const result =
    judge === "claude"
      ? await generateText({
          model: await claude(CLAUDE_FABLE_5_1),
          // The judge reasons before it scores, and the reasoning counts
          // against the budget: a whole collapsed document has many cores.
          maxOutputTokens: 16384,
          providerOptions: claudeOptions("high"),
          messages: [{ role: "user", content: prompt }],
        })
      : await generateText({
          model: await kimi(KIMI_K3),
          maxOutputTokens: 16384,
          providerOptions: kimiOptions("high"),
          messages: [{ role: "user", content: prompt }],
        });
  return extractJson(result.text);
}

// ── Text helpers the checks share ──────────────────────────────────────────

export function wordCount(text: string): number {
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const words = text.replace(/[㐀-鿿]/g, " ").split(/\s+/).filter(Boolean).length;
  // A CJK character reads as a word for the caps (SPEC.md §4).
  return words + cjk;
}

export function cjkShare(text: string): number {
  const letters = text.replace(/[\s\d\[\]().,;:!?"'“”‘’、，。！？：；（）【】—–-]/g, "");
  if (letters.length === 0) return 0;
  return (letters.match(/[㐀-鿿]/g) ?? []).length / letters.length;
}

export function blockTags(text: string): string[] {
  return [...text.matchAll(/\[block ([a-zA-Z0-9-]+)\]/g)].map((m) => m[1]);
}

// The numbers a source may write as words: "three" and "三" hold 3.
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  once: 1, twice: 2, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** The numbers a text states, each as one canonical form: "4,096" and
    "4096" are 4096, "3.0" is 3, "256k" is 256000. A number glued to a
    Latin letter before it ("Q2", "b5") is a name, not a number. With
    words, a number written as a word counts too — for the source a number
    is checked against, never for the text checked. */
export function numbersIn(text: string, words = false): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9_.])(\d+(?:,\d{3})*(?:\.\d+)?)([kK](?![A-Za-z]))?/g)) {
    const value = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    if (Number.isFinite(value)) out.add(String(value));
  }
  if (words) {
    for (const m of text.toLowerCase().matchAll(/[a-z]+|[一二两三四五六七八九十]/g)) {
      const value = NUMBER_WORDS[m[0]];
      if (value !== undefined) out.add(String(value));
    }
  }
  return out;
}

/** The spans a text puts in quotation marks — “…”, "…", 「…」, 『…』 —
    each trimmed of the punctuation that closes the sentence around it. */
export function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const pattern of [/“([^”]+)”/g, /"([^"]+)"/g, /「([^」]+)」/g, /『([^』]+)』/g]) {
    for (const m of text.matchAll(pattern)) spans.push(m[1]);
  }
  return spans.map((s) => s.trim().replace(/[\s.,;:!?。，；：！？、]+$/u, "")).filter((s) => s.length > 0);
}
