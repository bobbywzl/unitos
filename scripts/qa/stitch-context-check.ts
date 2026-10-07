// Stitch context cost (SPEC.md §22): how much context every model call of a
// Stitch command sends, pass by pass, on projects of known size.
//
// Run (the local DB, no network model):
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dissect \
//   npx tsx scripts/qa/stitch-context-check.ts --texts .qa-tmp/stitch/cost-texts \
//     [--scenarios a,b,c,d,e] [--select focused|matched|generous] [--responder model|mock] \
//     [--impl src/lib/graph/stitch.ts] [--rebuild-skeletons] [--out stitch-cost.json]
//
// What it does:
// 1. Seeds one project per scenario (titles "QA Stitch Cost (<id>) …"; reused when
//    present, never deleted): (a) 2 short docs, (b) 7 docs just under
//    STITCH_WHOLE_THRESHOLD, (c) 7 docs ~400k chars, (d) 30 docs ~2M chars,
//    (e) a Chinese project ~150k chars. English text is sliced from the
//    public-domain .txt files in --texts (Project Gutenberg); Chinese text is
//    synthesised deterministically.
// 2. Intercepts every chat-completions request in-process (globalThis.fetch)
//    and records, per call: the pass (skeleton / contents / route / select /
//    answer), the chars and estimated tokens of the system message, the
//    history, and the final user message, the output cap (max tokens), the
//    effort, and the longest prefix it shares with an earlier call of the
//    same scenario (what an automatic prefix cache can serve).
// 3. Answers each call itself (--responder model, the default): skeleton lines
//    at about a tenth of the block, as the prompt asks; the select pass picks
//    by BM25 against the command (lib/graph/rank.ts) in one of three modes —
//    focused (top 30 matching lines), matched (every matching line, up to
//    400), generous (fill to 400, the prompt's "when in doubt, pick") —
//    and the answer pass returns a reply of realistic length with four block
//    citations and no links or page, so the project is not changed by the
//    run. --responder mock forwards to scripts/qa/mock-kimi.mjs on :3399
//    instead (whose answer pass writes a page: the project grows).
// 4. Per scenario: the one-time skeleton build per document, then four single
//    commands (an informational question, a comparison, a gather, a
//    contradictions command) and a 3-turn conversation, history as the box
//    sends it (each turn's command and the reply with stored block ids).
//
// Token estimator: Latin text at chars / 4; every CJK character (Han, kana,
// hangul, CJK punctuation, full-width forms) at 1 token. Real GLM/Kimi
// tokenizers put Chinese at about 0.6–0.8 tokens per character, so the
// Chinese figures are an upper bound.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Arguments ───────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--") ? process.argv[at + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const TEXTS = resolve(arg("texts", ".qa-tmp/stitch/cost-texts"));
const SCENARIOS = arg("scenarios", "a,b,c,d,e,f").split(",").map((s) => s.trim()).filter(Boolean);
const SELECT_MODE = arg("select", "matched") as "focused" | "matched" | "generous";
const RESPONDER = arg("responder", "model") as "model" | "mock";
const IMPL = resolve(arg("impl", "src/lib/graph/stitch.ts"));
const OUT = arg("out", "");
const REBUILD = flag("rebuild-skeletons");
const ONLY = arg("only", "");
const TURNS = Number(arg("turns", "3")); // turns of the conversation
const REPLY_CHARS = Number(arg("reply-chars", "0"));
// --conv mixed: a 6-turn conversation of mixed kinds (question, follow-up,
// links, question, page, new topic) in place of the 3-turn one. --repeat: run
// each single command twice, to check the prefix is byte-stable.
const CONV = arg("conv", "base") as "base" | "mixed";
const REPEAT = flag("repeat"); // pad each reply to this many chars (0: as written) // comma list of run names: info,compare,gather,contradictions,conv

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/dissect";
process.env.MOONSHOT_API_KEY ??= "mock";
process.env.MOONSHOT_BASE_URL ??= "http://localhost:3399/v1";

// ── The estimator ───────────────────────────────────────────────────────────

const CJK_RX = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/g;
export function cjkCount(s: string): number {
  return (s.match(CJK_RX) ?? []).length;
}
export function estTokens(s: string): number {
  const cjk = cjkCount(s);
  return Math.round(cjk + (s.length - cjk) / 4);
}

// The models the passes run on in production (lib/derive/config.ts), and
// their prices per million tokens (lib/usage.ts). Locally every GLM id
// resolves to Kimi K3 (no gateway), so the request names kimi-k3.
const PROD_MODEL: Record<string, string> = {
  skeleton: "glm-5.3-flash",
  contents: "glm-5.3",
  route: "glm-5.3-flash",
  select: "glm-5.3-flash",
  expand: "glm-5.3-flash",
  answer: "glm-5.3",
  other: "glm-5.3",
};
const PRICE: Record<string, { input: number; cacheRead: number; output: number }> = {
  "glm-5.3": { input: 1.4, cacheRead: 0.26, output: 4.4 },
  "glm-5.3-flash": { input: 0.15, cacheRead: 0.03, output: 0.5 },
};

// ── Text sources ────────────────────────────────────────────────────────────

type Block = { type: "HEADING" | "PARAGRAPH"; text: string };

function gutenbergBlocks(file: string): Block[] {
  let raw = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const start = raw.search(/\*\*\* ?START OF/);
  if (start !== -1) raw = raw.slice(raw.indexOf("\n", start) + 1);
  const end = raw.search(/\*\*\* ?END OF|End of (the )?Project Gutenberg/i);
  if (end !== -1) raw = raw.slice(0, end);
  const out: Block[] = [];
  for (const chunk of raw.split(/\n\s*\n/)) {
    const text = chunk.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
    if (text.length < 2) continue;
    const heading =
      text.length < 80 &&
      (/^(CHAPTER|PART|BOOK|SECTION|APHORISM|PREFACE|INTRODUCTION)\b/i.test(text) ||
        (/[A-Z]/.test(text) && text === text.toUpperCase() && !/[.!?]$/.test(text)) ||
        /^[IVXLC]+\.?$/.test(text) ||
        /^\d+\.?$/.test(text));
    out.push({ type: heading ? "HEADING" : "PARAGRAPH", text });
  }
  return out;
}

/** Consecutive blocks of a book from `offset` chars in, up to `chars` of text. */
function slice(book: Block[], offset: number, chars: number): Block[] {
  const total = book.reduce((n, b) => n + b.text.length, 0);
  let skip = offset % Math.max(1, total - chars);
  let i = 0;
  while (i < book.length && skip > 0) skip -= book[i++].text.length;
  const out: Block[] = [];
  let used = 0;
  for (let n = 0; used < chars && n < book.length; n++) {
    const b = book[(i + n) % book.length];
    out.push(b);
    used += b.text.length;
  }
  return out;
}

// Chinese text, synthesised: sentences from a fixed vocabulary of the
// Nietzsche/Schopenhauer reading, a seeded generator, headings per part.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ZH_SUBJ = ["叔本华", "尼采", "意志", "生命", "人", "痛苦", "欲望", "艺术", "道德", "同情", "理性", "世界", "天才", "超人", "奴隶道德", "主人道德", "悲观主义", "禁欲", "音乐", "历史"];
const ZH_VERB = ["认为", "指出", "否定", "肯定", "揭示了", "批判", "超越了", "源于", "导致", "掩盖了", "表现为", "依赖于", "削弱了", "强化了"];
const ZH_OBJ = ["生存意志的盲目冲动", "痛苦是生命的本质", "同情是道德的基础", "权力意志的自我克服", "一切价值的重估", "艺术带来的短暂解脱", "理性只是意志的工具", "幸福不过是痛苦的暂时缺席", "永恒轮回的思想", "禁欲是对意志的否定", "群体道德对个体的压制", "悲剧精神中的肯定", "表象世界背后的物自体", "上帝已死之后的虚无", "欲望满足后的无聊", "苦难中生长出的力量"];
const ZH_CONN = ["因此", "然而", "换言之", "在这一点上", "与此相反", "更重要的是", "由此可见", "正如前文所述"];
function zhBlocks(seed: number, chars: number, title: string): Block[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const out: Block[] = [];
  let used = 0;
  let part = 1;
  while (used < chars) {
    if (out.length === 0 || rnd() < 0.08) {
      const h = `第${part++}节 ${pick(ZH_SUBJ)}与${pick(ZH_OBJ).slice(0, 6)}`;
      out.push({ type: "HEADING", text: h });
      used += h.length;
    }
    const n = 3 + Math.floor(rnd() * 6);
    const sentences: string[] = [];
    for (let s = 0; s < n; s++) {
      const year = 1818 + Math.floor(rnd() * 80);
      sentences.push(
        `${s > 0 ? pick(ZH_CONN) + "，" : ""}${pick(ZH_SUBJ)}在${year}年的${title}中${pick(ZH_VERB)}${pick(ZH_OBJ)}，并且${pick(ZH_VERB)}${pick(ZH_OBJ)}。`,
      );
    }
    const p = sentences.join("");
    out.push({ type: "PARAGRAPH", text: p });
    used += p.length;
  }
  return out;
}

// ── Scenarios ───────────────────────────────────────────────────────────────

type DocSpec = { title: string; blocks: Block[]; generatedCommand?: string };
type Commands = { info: string; compare: string; gather: string; contradictions: string; conv: [string, string, string] };
type Scenario = { id: string; title: string; docs: () => DocSpec[]; commands: Commands; lang: "en" | "zh" };

const EN: Commands = {
  info: "What does Schopenhauer say about the vanity of existence?",
  compare: "How do Nietzsche and Schopenhauer differ on pity and suffering?",
  gather: "Gather every passage about pity into one page.",
  contradictions: "Where do these documents contradict each other?",
  conv: [
    "What does Nietzsche say about the will to power?",
    "How does that compare with Schopenhauer's will to live?",
    "Which passages best support that difference?",
  ],
};
const ZH: Commands = {
  info: "叔本华如何看待痛苦？",
  compare: "尼采和叔本华在同情问题上有何不同？",
  gather: "把所有关于同情的段落汇集成一页。",
  contradictions: "这些文档在哪些地方相互矛盾？",
  conv: ["尼采如何论述权力意志？", "这与叔本华的生存意志相比如何？", "哪些段落最能支持这一区别？"],
};

// The mixed conversation (--conv mixed): six turns of mixed kinds.
const MIXED: Record<"en" | "zh", string[]> = {
  en: [
    "What does Schopenhauer say about the vanity of existence?",
    "How does Nietzsche answer that?",
    "Where do the two contradict each other on pity?",
    "Which passages best support that difference?",
    "Gather those passages into one page.",
    "What does The Wisdom of Life add about happiness?",
  ],
  zh: [
    "叔本华如何看待生存的虚无？",
    "尼采如何回应这一点？",
    "两人在同情问题上哪里相互矛盾？",
    "哪些段落最能支持这一区别？",
    "把这些段落汇集成一页。",
    "《人生的智慧》对幸福补充了什么？",
  ],
};

const BOOKS = ["bge", "pessimism", "antichrist", "wisdom", "zarathustra", "controversy", "pride", "moby"];
const bookCache = new Map<string, Block[]>();
function book(name: string): Block[] {
  let b = bookCache.get(name);
  if (!b) {
    b = gutenbergBlocks(join(TEXTS, `${name}.txt`));
    bookCache.set(name, b);
  }
  return b;
}
const NAMES: Record<string, string> = {
  bge: "Beyond Good and Evil",
  pessimism: "Studies in Pessimism",
  antichrist: "The Antichrist",
  wisdom: "The Wisdom of Life",
  zarathustra: "Thus Spake Zarathustra",
  controversy: "The Art of Controversy",
  pride: "Pride and Prejudice",
  moby: "Moby-Dick",
};
function englishDocs(sizes: number[], books: string[]): DocSpec[] {
  const seen = new Map<string, number>();
  return sizes.map((chars, i) => {
    const name = books[i % books.length];
    const k = seen.get(name) ?? 0;
    seen.set(name, k + 1);
    return { title: `${NAMES[name]} — part ${k + 1} (${Math.round(chars / 1000)}k)`, blocks: slice(book(name), k * 97_000 + 3_000, chars) };
  });
}

const SCENARIO_LIST: Scenario[] = [
  {
    id: "a",
    title: "QA Stitch Cost (a) 2 short docs",
    lang: "en",
    commands: EN,
    docs: () => englishDocs([5_000, 5_000], ["bge", "pessimism"]),
  },
  {
    id: "b",
    title: "QA Stitch Cost (b) 7 docs under the whole threshold",
    lang: "en",
    commands: EN,
    // 105k chars of text: with the block tags the rendering lands just under 120k.
    docs: () => englishDocs([3_000, 6_000, 9_000, 12_000, 18_000, 25_000, 32_000], ["bge", "pessimism", "antichrist", "wisdom", "zarathustra", "controversy", "bge"]),
  },
  {
    id: "c",
    title: "QA Stitch Cost (c) 7 docs 400k",
    lang: "en",
    commands: EN,
    docs: () => englishDocs([20_000, 35_000, 45_000, 55_000, 65_000, 80_000, 100_000], ["bge", "pessimism", "antichrist", "wisdom", "zarathustra", "controversy", "bge"]),
  },
  {
    id: "d",
    title: "QA Stitch Cost (d) 30 docs 2M",
    lang: "en",
    commands: EN,
    docs: () => englishDocs(Array.from({ length: 30 }, (_, i) => [28_000, 47_000, 66_000, 86_000, 105_000][i % 5]), BOOKS),
  },
  {
    id: "g",
    title: "QA Stitch Cost (g) scenario b plus one gather page",
    lang: "en",
    commands: EN,
    // Scenario b's documents, then the page a gather command wrote from them: every
    // fourth paragraph quoted whole, ~22k chars (what a "gather every passage" page holds).
    docs: () => {
      const base = englishDocs([3_000, 6_000, 9_000, 12_000, 18_000, 25_000, 32_000], ["bge", "pessimism", "antichrist", "wisdom", "zarathustra", "controversy", "bge"]);
      const quotes: Block[] = [{ type: "HEADING", text: "Passages on pity" }];
      let used = 0;
      for (const d of base) {
        quotes.push({ type: "HEADING", text: d.title });
        d.blocks.forEach((b, i) => {
          if (b.type === "PARAGRAPH" && i % 4 === 1 && used < 22_000) {
            quotes.push(b);
            used += b.text.length;
          }
        });
      }
      return [...base, { title: "Passages on pity (generated)", blocks: quotes, generatedCommand: EN.gather }];
    },
  },
  {
    id: "f",
    title: "QA Stitch Cost (f) Chinese 105k under the whole threshold",
    lang: "zh",
    commands: ZH,
    docs: () =>
      ["悲观主义论集", "权力意志", "道德的谱系", "作为意志和表象的世界", "悲剧的诞生"].map((t, i) => ({
        title: `${t}（短篇${i + 1}）`,
        blocks: zhBlocks(2000 + i, 21_000, `《${t}》`),
      })),
  },
  {
    id: "e",
    title: "QA Stitch Cost (e) Chinese 150k",
    lang: "zh",
    commands: ZH,
    docs: () =>
      ["悲观主义论集", "权力意志", "道德的谱系", "作为意志和表象的世界", "悲剧的诞生"].map((t, i) => ({
        title: `${t}（第${i + 1}篇）`,
        blocks: zhBlocks(1000 + i, 30_000, `《${t}》`),
      })),
  },
];

// ── The interception ────────────────────────────────────────────────────────

type Msg = { role: string; content: string };
export type CallRecord = {
  scenario: string;
  run: string; // skeleton-build | info | compare | gather | contradictions | conv-1..3
  pass: string;
  requestModel: string;
  prodModel: string;
  effort: string | null;
  maxTokens: number | null;
  systemChars: number;
  historyChars: number;
  historyTurns: number;
  userChars: number;
  totalChars: number;
  systemTokens: number;
  historyTokens: number;
  userTokens: number;
  totalTokens: number;
  cjkChars: number;
  shown: string | null;
  openingChars: number; // answer pass: chars of documents shown as their opening (blocks 1..n, nothing picked) // answer pass: "<blocks shown>/<blocks total>" per document, from the headers
  sharedPrefixChars: number; // longest prefix shared with an earlier call of this scenario
  sharedPrefixTokens: number;
  outputTokensEst: number; // the responder's answer, no reasoning
  usdInput: number; // at the production model's input price, no cache
  usdInputCached: number; // the shared prefix at the cache price
  sharedSameModelTokens: number; // the prefix shared with an earlier call on the same production model: what the provider's cache can serve
  usdInputCachedModel: number; // input $ with that cache
};

const records: CallRecord[] = [];
let current = { scenario: "", run: "" };
const prior = new Map<string, string[]>(); // scenario -> serialized prompts
const priorByModel = new Map<string, string[]>(); // scenario|prod model -> serialized prompts

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("");
  return "";
}

function passOf(messages: Msg[]): string {
  const user = messages[messages.length - 1]?.content ?? "";
  if (user.includes("Write the document's skeleton")) return "skeleton";
  if (user.includes("Write the contents of this document")) return "contents";
  // The route and select prompts' JSON shapes: the rules may sit in the
  // system message, the shape is always in the last user message.
  if (user.includes("A second read will pick the blocks") || user.includes('Return ONLY JSON: {"parts": ["A1"')) return "route";
  if (user.includes("A second read will do what the command asks") || user.includes('Return ONLY JSON: {"blockIds"')) return "select";
  if (user.includes('Return ONLY JSON: {"reply"')) return "answer";
  if (user.includes('Return ONLY JSON: {"words"')) return "expand";
  if (user.includes("Return ONLY the corrected JSON")) return "retry";
  return "other";
}

function lcp(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  // Compare in chunks first for speed.
  while (i + 256 <= n && a.slice(i, i + 256) === b.slice(i, i + 256)) i += 256;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

// A document section of the answer pass shown as blocks 1..n of m (n < m): the
// opening the code reads of a document the select pass picked nothing of.
function openingChars(system: string): number {
  let total = 0;
  const sections = system.split(/\n\n(?=\[document [A-Z]+\] ")/);
  for (const sec of sections) {
    const head = /^\[document ([A-Z]+)\] "[^"]*" \((?:[a-z]+, )?(\d+) of (\d+) (?:blocks|transcript lines|converted blocks) shown\)/.exec(sec);
    if (!head) continue;
    const n = Number(head[2]);
    if (n === 0) continue;
    const aliases = [...sec.matchAll(/\[block ([A-Z]+)(\d+)\]/g)].map((m) => Number(m[2]));
    if (aliases.length === n && aliases.every((v, i) => v === i + 1) && !sec.includes("blocks not shown")) total += sec.length;
  }
  return total;
}

function record(body: Record<string, unknown>, outputText: string): void {
  const messages = ((body.messages as { role: string; content: unknown }[]) ?? []).map((m) => ({ role: m.role, content: contentText(m.content) }));
  const pass = passOf(messages);
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = messages.filter((m) => m.role !== "system");
  const user = rest[rest.length - 1]?.content ?? "";
  const history = rest.slice(0, -1);
  const historyText = history.map((m) => m.content).join("\n");
  const serialized = messages.map((m) => `<${m.role}>\n${m.content}\n`).join("");
  const earlier = prior.get(current.scenario) ?? [];
  let shared = 0;
  for (const p of earlier) shared = Math.max(shared, lcp(p, serialized));
  earlier.push(serialized);
  prior.set(current.scenario, earlier);
  const sharedText = serialized.slice(0, shared);
  const sharedTokens = estTokens(sharedText) >= 256 ? estTokens(sharedText) : 0;
  const prodModel = PROD_MODEL[pass] ?? "glm-5.3";
  // The provider caches per model: only an earlier call on the same model serves the prefix.
  const modelKey = `${current.scenario}|${prodModel}`;
  const sameModel = priorByModel.get(modelKey) ?? [];
  let sharedModel = 0;
  for (const p of sameModel) sharedModel = Math.max(sharedModel, lcp(p, serialized));
  sameModel.push(serialized);
  priorByModel.set(modelKey, sameModel);
  const sharedModelText = estTokens(serialized.slice(0, sharedModel));
  const sharedModelTokens = sharedModelText >= 256 ? sharedModelText : 0;
  const price = PRICE[prodModel];
  const total = estTokens(system) + estTokens(historyText) + estTokens(user);
  records.push({
    scenario: current.scenario,
    run: current.run,
    pass,
    requestModel: String(body.model ?? ""),
    prodModel,
    effort: typeof body.reasoning_effort === "string" ? body.reasoning_effort : null,
    maxTokens: Number(body.max_tokens ?? body.max_completion_tokens ?? 0) || null,
    systemChars: system.length,
    historyChars: historyText.length,
    historyTurns: history.length,
    userChars: user.length,
    totalChars: system.length + historyText.length + user.length,
    systemTokens: estTokens(system),
    historyTokens: estTokens(historyText),
    userTokens: estTokens(user),
    totalTokens: total,
    cjkChars: cjkCount(system) + cjkCount(historyText) + cjkCount(user),
    shown: pass === "answer" && system.includes("blocks shown)")
      ? [...system.matchAll(/\((?:[a-z]+, )?(\d+) of (\d+) blocks shown\)/g)].map((m) => `${m[1]}/${m[2]}`).join(" ")
      : null,
    openingChars: pass === "answer" ? openingChars(system) : 0,
    sharedPrefixChars: shared,
    sharedPrefixTokens: sharedTokens,
    outputTokensEst: estTokens(outputText),
    usdInput: (total / 1e6) * price.input,
    usdInputCached: ((total - sharedTokens) / 1e6) * price.input + (sharedTokens / 1e6) * price.cacheRead,
    sharedSameModelTokens: Math.min(total, sharedModelTokens),
    usdInputCachedModel: ((total - Math.min(total, sharedModelTokens)) / 1e6) * price.input + (Math.min(total, sharedModelTokens) / 1e6) * price.cacheRead,
  });
}

// ── The responder: answers shaped like the real models' ─────────────────────

const BLOCK_RX = /^\[block ([^\]]+)\] \(([^)]*)\)\n([\s\S]*?)(?=\n\n\[block |\n\n\(|\n\n\[document |$)/gm;
function parseBlocks(text: string): { id: string; type: string; text: string }[] {
  return [...text.matchAll(BLOCK_RX)].map((m) => ({ id: m[1], type: m[2].split(",")[0], text: m[3].trim() }));
}
function commandOf(user: string): string {
  const m = /The reader's command:\n([\s\S]*?)\n\n/.exec(user);
  return m ? m[1].trim() : "";
}

let rankFn: (<T>(items: T[], textOf: (item: T) => string, query: string) => { item: T; score: number }[]) | null = null;

function skeletonLine(text: string, type: string): string {
  if (type === "HEADING") return text.slice(0, 300);
  const cjk = cjkCount(text);
  if (cjk > text.length / 3) {
    const n = Math.min(70, Math.max(10, Math.ceil(text.length * 0.12)));
    return text.slice(0, n);
  }
  const words = text.split(/\s+/);
  const n = Math.min(40, Math.max(4, Math.ceil(words.length * 0.12)));
  return words.slice(0, n).join(" ");
}

function respond(body: Record<string, unknown>): string {
  const messages = ((body.messages as { role: string; content: unknown }[]) ?? []).map((m) => ({ role: m.role, content: contentText(m.content) }));
  const pass = passOf(messages);
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const user = messages[messages.length - 1]?.content ?? "";
  const zh = cjkCount(system) > system.length / 4;
  if (pass === "skeleton") {
    const blocks = parseBlocks(system);
    const parts = [...user.matchAll(/\[part ([^\]]+)\] "([^"]*)"/g)].map((m) => ({
      blockId: m[1],
      summary: zh ? `本部分讨论${m[2]}，并给出主要论点与例证。` : `This part treats ${m[2]}: it states its main claim, gives two examples, and draws one conclusion from them.`,
    }));
    const lines = blocks.map((b) => ({ blockId: b.id, text: skeletonLine(b.text, b.type) }));
    const gist = user.includes("3. gist: one sentence") ? (zh ? "本文论述意志、痛苦与道德之间的关系。" : "The document argues about will, suffering, and morality, and draws its conclusions from examples.") : "";
    return JSON.stringify({ gist, parts, lines });
  }
  if (pass === "contents") {
    const blocks = parseBlocks(system);
    const parts: { title: string; blockId: string; level: number }[] = [];
    blocks.forEach((b, i) => {
      if (parts.length >= 80) return;
      if (b.type === "HEADING" || (i > 0 && i % 25 === 0)) parts.push({ title: b.text.slice(0, 60), blockId: b.id, level: 1 });
    });
    return JSON.stringify({ parts });
  }
  if (pass === "route") {
    const partsRx = [...system.matchAll(/\[part at ([A-Z]+\d+)\] "([^"]*)"(?:: (.*))?/g)].map((m) => ({ alias: m[1], text: `${m[2]} ${m[3] ?? ""}` }));
    const ranked = rankFn!(partsRx, (p) => p.text, commandOf(user));
    return JSON.stringify({ parts: ranked.slice(0, 80).map((r) => r.item.alias) });
  }
  if (pass === "select") {
    const lines = [...system.matchAll(/^\[block ([A-Z]+\d+)\] (.*)$/gm)].map((m) => ({ alias: m[1], text: m[2] }));
    const ranked = rankFn!(lines, (l) => l.text, commandOf(user));
    const matching = ranked.filter((r) => r.score > 0).map((r) => r.item.alias);
    let picks: string[];
    if (SELECT_MODE === "focused") picks = matching.slice(0, 30);
    else if (SELECT_MODE === "matched") picks = matching.slice(0, 400);
    else {
      picks = matching.slice(0, 400);
      const have = new Set(picks);
      for (const l of lines) {
        if (picks.length >= 400) break;
        if (!have.has(l.alias)) picks.push(l.alias);
      }
    }
    if (picks.length === 0) picks = lines.slice(0, 3).map((l) => l.alias);
    return JSON.stringify({ blockIds: picks });
  }
  if (pass === "expand") {
    // The expansion's words: the command's own content words (a stand-in
    // that measures the call's tokens; a real model adds synonyms).
    const words = [...new Set(commandOf(user).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 15);
    return JSON.stringify({ words });
  }
  if (pass === "answer" || pass === "other") {
    // The blocks the call shows: the system message's, and the last user
    // message's (the append-only layout puts the command's blocks there).
    let aliases = [...`${system}\n${user}`.matchAll(/\[block ([A-Z]+\d+)\]/g)].map((m) => m[1]);
    if (aliases.length === 0) aliases = [...messages.map((m) => m.content).join("\n").matchAll(/\[block ([A-Z]+\d+)\]/g)].map((m) => m[1]);
    const cite = [aliases[0], aliases[Math.floor(aliases.length / 3)], aliases[Math.floor((2 * aliases.length) / 3)], aliases[aliases.length - 1]].filter(Boolean);
    let reply = zh
      ? `叔本华认为痛苦是生命的本质 [block ${cite[0]}]，而尼采把痛苦看作力量生长的条件 [block ${cite[1]}]。两人都从意志出发，但叔本华主张否定意志 [block ${cite[2]}]，尼采主张肯定并超越它 [block ${cite[3]}]。第一篇和第三篇对同情的评价正好相反：前者把同情视为道德的基础，后者把同情视为削弱生命的力量。最容易误解的是“意志”一词：两人用的是同一个词，指的却不是同一件事。`
      : `Schopenhauer holds that existence is vain because every satisfaction ends in boredom or new want [block ${cite[0]}], and he grounds ethics in pity [block ${cite[1]}]. Nietzsche turns this around: pity multiplies suffering and weakens the one who feels it [block ${cite[2]}], and the will to power affirms life where Schopenhauer's will to live is to be denied [block ${cite[3]}]. The two documents agree that the will drives life; they disagree on whether that is a reason to deny it or to affirm it. The point most likely to trip a reader up is the word "will": both use it, but Schopenhauer means a blind striving that causes suffering, and Nietzsche means a drive to grow that suffering serves.`;
    if (REPLY_CHARS > 0) {
      const base = reply;
      while (reply.length < REPLY_CHARS) reply += ` ${base}`;
      reply = reply.slice(0, Math.min(REPLY_CHARS, 4_000));
    }
    return JSON.stringify({ reply, links: [], document: null });
  }
  return JSON.stringify({});
}

// ── fetch, patched ──────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  const bodyText = typeof init?.body === "string" ? init.body : "";
  const body = JSON.parse(bodyText || "{}") as Record<string, unknown>;
  if (RESPONDER === "mock") {
    const res = await realFetch(input, init);
    const json = (await res.clone().json()) as { choices?: { message?: { content?: string } }[] };
    record(body, json.choices?.[0]?.message?.content ?? "");
    return res;
  }
  const content = respond(body);
  record(body, content);
  const prompt = records[records.length - 1].totalTokens;
  const completion = estTokens(content);
  return new Response(
    JSON.stringify({
      id: `cost-${records.length}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: String(body.model ?? "mock"),
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

// ── Main ────────────────────────────────────────────────────────────────────

type StitchFn = (input: {
  notebookId: string;
  documentIds: string[] | null;
  userId: string | null;
  lang: "en" | "zh";
  command: string;
  history: { role: "user" | "assistant"; content: string; picked?: string[] }[];
  onFailure: (reason: string) => Error;
}) => Promise<{ reply: string; picked?: string[] }>;

async function main() {
  if (!existsSync(TEXTS) || readdirSync(TEXTS).filter((f) => f.endsWith(".txt")).length < 8) {
    console.error(`--texts ${TEXTS}: needs ${BOOKS.map((b) => `${b}.txt`).join(", ")} (Project Gutenberg plain text).`);
    process.exit(1);
  }
  const { db } = await import("../../src/lib/db");
  const { rank } = await import("../../src/lib/graph/rank");
  rankFn = rank;
  const { buildSkeleton, readSkeleton, skeletonStale } = await import("../../src/lib/graph/skeleton");
  const config = await import("../../src/lib/derive/config");
  const impl = (await import(IMPL)) as { stitch: StitchFn };

  for (const id of SCENARIOS) {
    const sc = SCENARIO_LIST.find((s) => s.id === id);
    if (!sc) continue;
    current = { scenario: sc.id, run: "seed" };
    prior.set(sc.id, []);

    // Seed, or reuse the project of the same title.
    let notebook = await db.notebook.findFirst({ where: { title: sc.title }, include: { documents: true } });
    if (!notebook) {
      const specs = sc.docs();
      const ids: string[] = [];
      for (const spec of specs) {
        const doc = await db.document.create({
          data: {
            title: spec.title,
            generatedCommand: spec.generatedCommand ?? null,
            blocks: { create: spec.blocks.map((b, i) => ({ order: i, type: b.type, text: b.text, html: b.type === "HEADING" ? "<h2>" : null })) },
          },
        });
        ids.push(doc.id);
        await new Promise((r) => setTimeout(r, 5)); // distinct createdAt: the attach order
      }
      notebook = await db.notebook.create({
        data: { title: sc.title, documents: { create: ids.map((documentId) => ({ documentId })) } },
        include: { documents: true },
      });
      console.log(`seeded ${sc.title}: ${ids.length} documents`);
    }
    const docIds = notebook.documents.map((d) => d.documentId);
    const docs = await db.document.findMany({
      where: { id: { in: docIds } },
      select: { id: true, title: true, skeleton: true, blocks: { select: { id: true, type: true, text: true } } },
    });
    const textChars = docs.reduce((n, d) => n + d.blocks.reduce((m, b) => m + b.text.length, 0), 0);
    const blockCount = docs.reduce((n, d) => n + d.blocks.length, 0);
    console.log(`\n== (${sc.id}) ${sc.title}: ${docs.length} docs, ${blockCount} blocks, ${textChars.toLocaleString()} chars of text`);

    // The one-time skeleton build, per document (also its contents, when missing).
    current.run = "skeleton-build";
    for (const d of docs) {
      if (!REBUILD && !skeletonStale(readSkeleton(d.skeleton), d.blocks)) continue;
      await buildSkeleton(d.id, null);
    }

    const runs: [string, string, number][] = [
      ["info", sc.commands.info, 0],
      ["compare", sc.commands.compare, 0],
      ["gather", sc.commands.gather, 0],
      ["contradictions", sc.commands.contradictions, 0],
    ];
    const only = ONLY ? new Set(ONLY.split(",")) : null;
    for (const [run, command] of runs) {
      if (only && !only.has(run)) continue;
      for (let rep = 0; rep < (REPEAT ? 2 : 1); rep++) {
        current.run = rep === 0 ? run : `${run}-again`;
        await impl.stitch({ notebookId: notebook.id, documentIds: null, userId: null, lang: sc.lang, command, history: [], onFailure: (r) => new Error(r) });
      }
    }
    if (!only || only.has("conv")) {
      const history: { role: "user" | "assistant"; content: string; picked?: string[] }[] = [];
      const script = CONV === "mixed" ? MIXED[sc.lang] : null;
      const turns = script ? script.length : TURNS;
      for (let t = 0; t < turns; t++) {
        current.run = `conv-${t + 1}`;
        const command = script ? script[t] : t < 3 ? sc.commands.conv[t] : `${sc.commands.conv[t % 3]} (${t + 1})`;
        const result = await impl.stitch({ notebookId: notebook.id, documentIds: null, userId: null, lang: sc.lang, command, history: [...history], onFailure: (r) => new Error(r) });
        // The box keeps each answer's pick with its turn (the append-only layout sends it back).
        history.push({ role: "user", content: command }, { role: "assistant", content: result.reply, ...(result.picked ? { picked: result.picked } : {}) });
        // The box sends the last 20 turns with text (components/graph/stitch-box.tsx).
        while (history.length > 20) history.shift();
      }
    }
  }

  // ── The table ──
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(
    `\nconstants: STITCH_WHOLE_THRESHOLD=${config.STITCH_WHOLE_THRESHOLD} STITCH_SELECTED_BUDGET=${JSON.stringify(config.STITCH_SELECTED_BUDGET)} ` +
      `STITCH_SKELETON_BUDGET=${config.STITCH_SKELETON_BUDGET} STITCH_SKELETON_GROUP=${config.STITCH_SKELETON_GROUP} select=${SELECT_MODE} responder=${RESPONDER}`,
  );
  console.log(
    ["sc", "run", "pass", "model", "effort", "max_out", "sys_ch", "hist_ch", "user_ch", "sys_tok", "hist_tok", "user_tok", "tot_tok", "cached_tok", "usd", "usd_cache"]
      .map((h, i) => (i < 3 ? h.padEnd(i === 1 ? 15 : i === 2 ? 9 : 3) : pad(h, 10)))
      .join(" "),
  );
  for (const r of records) {
    console.log(
      [
        r.scenario.padEnd(3),
        r.run.padEnd(15),
        r.pass.padEnd(9),
        pad(r.prodModel, 13),
        pad(r.effort ?? "-", 10),
        pad(r.maxTokens ?? "-", 10),
        pad(r.systemChars, 10),
        pad(r.historyChars, 10),
        pad(r.userChars, 10),
        pad(r.systemTokens, 10),
        pad(r.historyTokens, 10),
        pad(r.userTokens, 10),
        pad(r.totalTokens, 10),
        pad(r.sharedPrefixTokens, 10),
        pad(r.usdInput.toFixed(4), 10),
        pad(r.usdInputCached.toFixed(4), 10),
      ].join(" "),
    );
  }
  // Per command: the sum over its passes.
  console.log("\nper command (sum of passes):");
  const byRun = new Map<string, CallRecord[]>();
  for (const r of records) {
    const k = `${r.scenario}|${r.run}`;
    byRun.set(k, [...(byRun.get(k) ?? []), r]);
  }
  for (const [k, rs] of byRun) {
    const sum = (f: (r: CallRecord) => number) => rs.reduce((n, r) => n + f(r), 0);
    console.log(
      `${k.padEnd(22)} calls=${pad(rs.length, 3)} input_tok=${pad(sum((r) => r.totalTokens), 9)} cached_tok=${pad(sum((r) => r.sharedPrefixTokens), 9)} ` +
        `answer_tok=${pad(sum((r) => (r.pass === "answer" ? r.totalTokens : 0)), 8)} select_tok=${pad(sum((r) => (r.pass === "select" ? r.totalTokens : 0)), 8)} ` +
        `route_tok=${pad(sum((r) => (r.pass === "route" ? r.totalTokens : 0)), 7)} expand_tok=${pad(sum((r) => (r.pass === "expand" ? r.totalTokens : 0)), 5)} usd=${sum((r) => r.usdInput).toFixed(4)} usd_cache=${sum((r) => r.usdInputCached).toFixed(4)} ` +
        `model_cached_tok=${pad(sum((r) => r.sharedSameModelTokens), 9)} usd_model_cache=${sum((r) => r.usdInputCachedModel).toFixed(4)} ` +
        `answer_cached=${pad(sum((r) => (r.pass === "answer" ? r.sharedSameModelTokens : 0)), 8)}`,
    );
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ selectMode: SELECT_MODE, responder: RESPONDER, impl: IMPL, records }, null, 2));
    console.log(`\nwrote ${records.length} calls to ${OUT}`);
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
