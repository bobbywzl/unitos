// The web benchmark: messy real web articles parsed in-process the way a URL
// add parses them (parseHtmlContent, lib/parse/url.ts), scored against the
// article's body as a person marked it.
//
//   npx tsx scripts/parse-bench/web.mts [--only id,id] [--limit n] [--json out.json]
//     [--baseline] [--save-baseline] [--worst n] [--detail id] [--others] [--extras]
//
// The corpus is Zyte's article extraction benchmark (github.com/scrapinghub/
// article-extraction-benchmark, MIT): 181 news and blog pages saved as the
// server sent them, each with its article body. The pages are other people's
// articles, so they are never committed: the first run clones the benchmark
// into .bench/web/aeb. A page's id is the first 10 characters of its hash.
//
// The score is the benchmark's own (evaluate.py): word 4-grams of the parse's
// body against the article's, precision and recall per page, F1 over the
// means. The parse's body is the text of its blocks but figures (a caption is
// not the article's body there) and separators. Page furniture shows as lost
// precision, a missed paragraph as lost recall. --others prints the
// benchmark's saved outputs of other extractors (Readability, Trafilatura,
// and the rest) scored the same way, for standing. --extras lists the blocks
// the articles do not have, the most frequent first (digits read as #): the
// furniture worth a rule.
//
// The run is offline: every outbound fetch fails, so a page parses as it would
// when its stylesheets will not load (bakeFigureStyles keeps the html as is).
// The production parse loads them; the bench measures the walk itself.
//
// Baseline: scripts/parse-bench/web-baseline.json holds each page's scores
// (numbers only). --baseline lists every page whose F1 dropped by more than
// 0.01 and exits 1 when one did; --save-baseline writes the run.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

// Offline: no stylesheet, image, or archive fetch reaches the network.
delete process.env.HTTPS_PROXY;
delete process.env.HTTP_PROXY;
delete process.env.https_proxy;
delete process.env.http_proxy;
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;

const { parseHtmlContent } = await import("@/lib/parse/url");

const ROOT = join(import.meta.dirname, "..", "..");
const AEB = join(ROOT, ".bench", "web", "aeb");
const AEB_REPO = "https://github.com/scrapinghub/article-extraction-benchmark.git";
const BASELINE = join(import.meta.dirname, "web-baseline.json");
const PAGE_TIMEOUT_MS = 60_000;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const limit = value("--limit") ? Number(value("--limit")) : undefined;
const worst = value("--worst") ? Number(value("--worst")) : 15;
const detail = value("--detail");

// ── The corpus ──────────────────────────────────────────────────────────────

if (!existsSync(join(AEB, "ground-truth.json"))) {
  mkdirSync(join(ROOT, ".bench", "web"), { recursive: true });
  console.log(`Cloning ${AEB_REPO} into .bench/web/aeb`);
  execFileSync("git", ["clone", "--quiet", "--depth", "1", AEB_REPO, AEB], { stdio: "inherit" });
}
type Truth = { articleBody: string; url: string };
const truth = JSON.parse(readFileSync(join(AEB, "ground-truth.json"), "utf8")) as Record<string, Truth>;
const idOf = (hash: string) => hash.slice(0, 10);
let hashes = Object.keys(truth).sort();
if (detail) hashes = hashes.filter((h) => idOf(h) === detail);
else if (only) hashes = hashes.filter((h) => only.includes(idOf(h)));
if (limit) hashes = hashes.slice(0, limit);

// ── The score (evaluate.py, word 4-gram shingles) ───────────────────────────

const tokenize = (text: string) => text.match(/[\p{L}\p{N}_]+/gu) ?? [];
function shingles(text: string, n = 4): Map<string, number> {
  const tokens = tokenize(text);
  const out = new Map<string, number>();
  for (let i = 0; i < Math.max(1, tokens.length - n + 1); i++) {
    const key = tokens.slice(i, i + n).join(" ");
    if (key) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
type Counts = { tp: number; fp: number; fn: number };
function match(truthText: string, predText: string): Counts {
  const t = shingles(truthText);
  const p = shingles(predText);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const key of new Set([...t.keys(), ...p.keys()])) {
    const a = t.get(key) ?? 0;
    const b = p.get(key) ?? 0;
    tp += Math.min(a, b);
    fp += Math.max(0, b - a);
    fn += Math.max(0, a - b);
  }
  const s = tp + fp + fn;
  return s > 0 ? { tp: tp / s, fp: fp / s, fn: fn / s } : { tp, fp, fn };
}
const precision = ({ tp, fp, fn }: Counts) => (fp === 0 && fn === 0 ? 1 : tp === 0 && fp === 0 ? 0 : tp / (tp + fp));
const recall = ({ tp, fp, fn }: Counts) => (fp === 0 && fn === 0 ? 1 : tp === 0 && fn === 0 ? 0 : tp / (tp + fn));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function summary(all: Counts[]) {
  const p = mean(all.filter((c) => c.tp + c.fp > 0).map(precision));
  const r = mean(all.filter((c) => c.tp + c.fn > 0).map(recall));
  return { f1: p + r > 0 ? (2 * p * r) / (p + r) : 0, precision: p, recall: r };
}
const pageF1 = (c: Counts) => {
  const p = precision(c);
  const r = recall(c);
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
};

// ── The run ─────────────────────────────────────────────────────────────────

type PageResult = { id: string; url: string; f1: number; precision: number; recall: number; ms: number; error?: string };
const results: PageResult[] = [];
const counts: Counts[] = [];
const bodies = new Map<string, string>();
/** Blocks the article does not have: their text (digits as #) → the pages. */
const extras = new Map<string, Set<string>>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms))]);
}

for (const hash of hashes) {
  const { url, articleBody } = truth[hash];
  const html = gunzipSync(readFileSync(join(AEB, "html", `${hash}.html.gz`))).toString("utf8");
  const start = performance.now();
  let body = "";
  let error: string | undefined;
  try {
    const parsed = await withTimeout(parseHtmlContent(html, url), PAGE_TIMEOUT_MS);
    body = parsed.blocks
      .filter((b) => b.type !== "FIGURE" && b.type !== "SEPARATOR")
      .map((b) => b.text)
      .join("\n\n");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Math.round(performance.now() - start);
  const c = match(articleBody, body);
  const truthGrams = shingles(articleBody);
  const truthWords = new Set(tokenize(articleBody.toLowerCase()));
  for (const para of body.split("\n\n")) {
    const g = [...shingles(para).keys()];
    const tokens = tokenize(para.toLowerCase());
    const foreign = g.length > 1 ? g.filter((k) => !truthGrams.has(k)).length / g.length > 0.5 : tokens.some((t) => !truthWords.has(t));
    if (!foreign) continue;
    const key = para.replace(/\s+/g, " ").trim().replace(/\d+/g, "#").slice(0, 120);
    if (!extras.has(key)) extras.set(key, new Set());
    extras.get(key)!.add(idOf(hash));
  }
  counts.push(c);
  bodies.set(idOf(hash), body);
  results.push({ id: idOf(hash), url, f1: pageF1(c), precision: precision(c), recall: recall(c), ms, ...(error ? { error } : {}) });
  if (detail) {
    console.log(`── ${idOf(hash)} ${url}`);
    console.log(`F1 ${pageF1(c).toFixed(3)}  precision ${precision(c).toFixed(3)}  recall ${recall(c).toFixed(3)}${error ? `  error: ${error}` : ""}\n`);
    const truthGrams = shingles(articleBody);
    const predGrams = shingles(body);
    const extra = body.split("\n\n").filter((para) => {
      const g = [...shingles(para).keys()];
      return g.length > 0 && g.filter((k) => !truthGrams.has(k)).length / g.length > 0.5;
    });
    const lost = articleBody.split(/\n+/).filter((para) => {
      const g = [...shingles(para).keys()];
      return g.length > 0 && g.filter((k) => !predGrams.has(k)).length / g.length > 0.5;
    });
    console.log(`Blocks the article does not have (${extra.length}):`);
    for (const para of extra) console.log(`  + ${para.replace(/\s+/g, " ").slice(0, 200)}`);
    console.log(`\nArticle paragraphs the parse lost (${lost.length}):`);
    for (const para of lost) console.log(`  - ${para.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

// ── The report ──────────────────────────────────────────────────────────────

const total = summary(counts);
const fmt = (x: number) => x.toFixed(3);
if (!detail) {
  console.log(`Worst ${Math.min(worst, results.length)} pages by F1:`);
  for (const r of [...results].sort((a, b) => a.f1 - b.f1).slice(0, worst)) {
    console.log(`  ${r.id}  F1 ${fmt(r.f1)}  P ${fmt(r.precision)}  R ${fmt(r.recall)}  ${r.url.slice(0, 90)}${r.error ? `  error: ${r.error}` : ""}`);
  }
}
const errors = results.filter((r) => r.error).length;
console.log(
  `\nUnitos  F1 ${fmt(total.f1)}  precision ${fmt(total.precision)}  recall ${fmt(total.recall)}  ` +
    `pages ${results.length}  errors ${errors}  time ${(mean(results.map((r) => r.ms)) / 1000).toFixed(2)} s/page`,
);

if (flag("--others") && !only && !detail && !limit) {
  const rows: { name: string; f1: number; precision: number; recall: number }[] = [];
  for (const file of readdirSync(join(AEB, "output")).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(AEB, "output", file), "utf8")) as Record<string, unknown>;
    const out = (data.output && typeof data.output === "object" ? data.output : data) as Record<string, { articleBody?: string }>;
    if (!hashes.every((h) => h in out)) continue;
    rows.push({ name: file.replace(/\.json$/, ""), ...summary(hashes.map((h) => match(truth[h].articleBody, out[h]?.articleBody ?? ""))) });
  }
  rows.push({ name: "→ unitos", ...total });
  console.log("\nStanding (the benchmark's saved outputs, same score):");
  for (const r of rows.sort((a, b) => b.f1 - a.f1)) {
    console.log(`  ${r.name.padEnd(22)} F1 ${fmt(r.f1)}  P ${fmt(r.precision)}  R ${fmt(r.recall)}`);
  }
}

if (flag("--extras")) {
  console.log("\nBlocks the articles do not have, by the pages that hold them:");
  for (const [text, pages] of [...extras].sort((a, b) => b[1].size - a[1].size).slice(0, 80)) {
    console.log(`  ${String(pages.size).padStart(3)}  ${text}`);
  }
}

const json = value("--json");
if (json) writeFileSync(json, JSON.stringify({ total, results }, null, 2));

type Baseline = { total: ReturnType<typeof summary>; pages: Record<string, { f1: number; precision: number; recall: number }> };
const round = (x: number) => Math.round(x * 1000) / 1000;
if (flag("--save-baseline") && !detail) {
  const prior: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { total, pages: {} };
  for (const r of results) prior.pages[r.id] = { f1: round(r.f1), precision: round(r.precision), recall: round(r.recall) };
  if (!only && !limit) prior.total = { f1: round(total.f1), precision: round(total.precision), recall: round(total.recall) };
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${results.length} pages to ${BASELINE}`);
}
if (flag("--baseline") && existsSync(BASELINE)) {
  const base: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const drops = results.filter((r) => base.pages[r.id] && r.f1 < base.pages[r.id].f1 - 0.01);
  const rises = results.filter((r) => base.pages[r.id] && r.f1 > base.pages[r.id].f1 + 0.01);
  console.log(`\nAgainst the baseline (F1 ${fmt(base.total.f1)}): ${rises.length} pages rose, ${drops.length} dropped`);
  for (const r of drops) console.log(`  dropped ${r.id}  ${fmt(base.pages[r.id].f1)} → ${fmt(r.f1)}  ${r.url.slice(0, 80)}`);
  if (drops.length > 0) process.exitCode = 1;
}
