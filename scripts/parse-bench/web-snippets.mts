// The web benchmark's held-out set: 990 pages in many languages (news, blogs,
// magazines, government and company pages), each marked with a few passages
// the article must hold and a few it must not (a date line, a menu, a
// footer). The URL parse (parseHtmlContent) reads each page offline, as
// web.mts does, each page decoded by its own charset (lib/parse/charset.ts),
// as the fetch decodes it; a passage counts when the document's title and body
// hold it, spaces read as one.
//
//   npx tsx scripts/parse-bench/web-snippets.mts [--limit n] [--only file,file]
//     [--baseline] [--save-baseline] [--worst n] [--detail file] [--parts-dir dir]
//
// jsdom keeps memory across pages, so a run of more than BATCH pages parses
// them in child runs of BATCH pages each (--part i/n, --out file) and reads
// their results back.
//
// The corpus is Trafilatura's evaluation set (github.com/adbar/trafilatura,
// tests/evaldata.json, tests/eval, tests/cache; Apache-2.0), cloned into
// .bench/web/trafilatura on the first run and never committed: the pages are
// other people's. Score as Trafilatura's own (tests/eval_common.py): a
// must-hold passage found is a true positive, missed a false negative; a
// must-not passage found is a false positive. Precision, recall, and F1 over
// the sums. Trafilatura's CI floor on this set is F1 0.920 (eval_baseline.json).
//
// This set is for checking that a rule found on web.mts's pages holds on
// pages it was not made from: change the parser against web.mts, then run
// this. Baseline: web-snippets-baseline.json, counts only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

delete process.env.HTTPS_PROXY;
delete process.env.HTTP_PROXY;
delete process.env.https_proxy;
delete process.env.http_proxy;
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;

const { parseHtmlContent } = await import("@/lib/parse/url");
const { decodePage } = await import("@/lib/parse/charset");

const ROOT = join(import.meta.dirname, "..", "..");
const TRAF = join(ROOT, ".bench", "web", "trafilatura");
const TRAF_REPO = "https://github.com/adbar/trafilatura.git";
const TESTS = join(TRAF, "tests");
const BASELINE = join(import.meta.dirname, "web-snippets-baseline.json");
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

if (!existsSync(join(TESTS, "evaldata.json"))) {
  mkdirSync(join(ROOT, ".bench", "web"), { recursive: true });
  console.log(`Cloning ${TRAF_REPO} (tests only) into .bench/web/trafilatura`);
  execFileSync("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", TRAF_REPO, TRAF], { stdio: "inherit" });
  execFileSync("git", ["-C", TRAF, "sparse-checkout", "set", "tests"], { stdio: "inherit" });
}

type Item = { file: string; with: string[]; without: string[] };
const data = JSON.parse(readFileSync(join(TESTS, "evaldata.json"), "utf8")) as Record<string, Item>;
let urls = Object.keys(data).sort();
if (detail) urls = urls.filter((u) => data[u].file === detail);
else if (only) urls = urls.filter((u) => only.includes(data[u].file));
if (limit) urls = urls.slice(0, limit);

// A soft hyphen (U+00AD) is drawn as nothing but at a line's end: a passage
// marked with or without one ("Ita­li­ens", "Italiens") is the same words.
const norm = (text: string) => text.replace(/­/g, "").replace(/\s+/g, " ").trim();
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms))]);
}

type Result = { file: string; url: string; tp: number; fp: number; fn: number; missed: string[]; leaked: string[]; error?: string };
const results: Result[] = [];
const BATCH = 120;
const part = value("--part");
const out = value("--out");
if (part) {
  const [i, n] = part.split("/").map(Number);
  urls = urls.slice(Math.floor((urls.length * i) / n), Math.floor((urls.length * (i + 1)) / n));
}
// Each run's parts carry its process id, so two runs never read each other's.
// --parts-dir keeps them somewhere else, for a script that compares runs.
const partsDir = value("--parts-dir") ?? join(ROOT, ".bench", "web");
const parts = !part && urls.length > BATCH ? Math.ceil(urls.length / BATCH) : 0;
if (parts > 0) {
  const pass = argv.filter((a, i) => !["--baseline", "--save-baseline"].includes(a) && argv[i - 1] !== "--worst" && a !== "--worst");
  for (let i = 0; i < parts; i++) {
    const file = join(partsDir, `snippets-part-${process.pid}-${i}.json`);
    execFileSync("npx", ["tsx", join(import.meta.dirname, "web-snippets.mts"), ...pass, "--part", `${i}/${parts}`, "--out", file, "--worst", "0"], {
      stdio: "ignore",
    });
    results.push(...(JSON.parse(readFileSync(file, "utf8")) as Result[]));
  }
}
for (const url of parts > 0 ? [] : urls) {
  const item = data[url];
  const path = [join(TESTS, "cache", item.file), join(TESTS, "eval", item.file)].find((p) => existsSync(p));
  let text = "";
  let error: string | undefined;
  if (!path) error = "file not found";
  else {
    try {
      const parsed = await withTimeout(parseHtmlContent(decodePage(readFileSync(path)), url), PAGE_TIMEOUT_MS);
      text = [parsed.title ?? "", ...parsed.blocks.filter((b) => b.type !== "SEPARATOR").map((b) => b.text)].join("\n\n");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const body = norm(text);
  const missed = item.with.filter((w) => !body.includes(norm(w)));
  const leaked = item.without.filter((w) => body.includes(norm(w)));
  results.push({ file: item.file, url, tp: item.with.length - missed.length, fp: leaked.length, fn: missed.length, missed, leaked, ...(error ? { error } : {}) });
}

if (out) {
  writeFileSync(out, JSON.stringify(results));
  process.exit(0);
}

const sum = (k: "tp" | "fp" | "fn") => results.reduce((a, r) => a + r[k], 0);
const tp = sum("tp");
const fp = sum("fp");
const fn = sum("fn");
const precision = tp + fp ? tp / (tp + fp) : 0;
const recall = tp + fn ? tp / (tp + fn) : 0;
const f1 = 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0;
const fmt = (x: number) => x.toFixed(3);

const errorsOf = (r: Result) => r.fp + r.fn;
console.log(`Worst ${Math.min(worst, results.length)} pages by passages wrong:`);
for (const r of [...results].sort((a, b) => errorsOf(b) - errorsOf(a)).slice(0, worst)) {
  if (errorsOf(r) === 0) break;
  console.log(`  ${r.file}  missed ${r.fn}  leaked ${r.fp}  ${r.url.slice(0, 90)}${r.error ? `  error: ${r.error}` : ""}`);
  if (detail || worst <= 30) {
    for (const m of r.missed) console.log(`      - ${norm(m).slice(0, 110)}`);
    for (const l of r.leaked) console.log(`      + ${norm(l).slice(0, 110)}`);
  }
}
const errors = results.filter((r) => r.error).length;
console.log(`\nUnitos  F1 ${fmt(f1)}  precision ${fmt(precision)}  recall ${fmt(recall)}  pages ${results.length}  errors ${errors}`);

type Baseline = { total: { f1: number; precision: number; recall: number }; pages: Record<string, { tp: number; fp: number; fn: number }> };
const round = (x: number) => Math.round(x * 1000) / 1000;
if (flag("--save-baseline") && !detail) {
  const prior: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { total: { f1, precision, recall }, pages: {} };
  for (const r of results) prior.pages[r.file] = { tp: r.tp, fp: r.fp, fn: r.fn };
  if (!only && !limit) prior.total = { f1: round(f1), precision: round(precision), recall: round(recall) };
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${results.length} pages to ${BASELINE}`);
}
if (flag("--baseline") && existsSync(BASELINE)) {
  const base: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const worse = results.filter((r) => base.pages[r.file] && errorsOf(r) > base.pages[r.file].fp + base.pages[r.file].fn);
  const better = results.filter((r) => base.pages[r.file] && errorsOf(r) < base.pages[r.file].fp + base.pages[r.file].fn);
  console.log(`\nAgainst the baseline (F1 ${fmt(base.total.f1)}): ${better.length} pages better, ${worse.length} worse`);
  for (const r of worse) {
    const b = base.pages[r.file];
    console.log(`  worse ${r.file}  missed ${b.fn} → ${r.fn}  leaked ${b.fp} → ${r.fp}  ${r.url.slice(0, 70)}`);
  }
  if (worse.length > 0) process.exitCode = 1;
}
