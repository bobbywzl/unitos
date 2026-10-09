// RETRIEVAL9: retrievers against the blocks a right Stitch answer needs
// (SPEC.md §22). Reads needed.json (one entry per judged command: the
// project, the documents read, the needed block groups, the skeleton lines
// the select pass saw) and ranks every readable block of the reading with
// each retriever; reports recall@K and the tokens the select pass would read
// at K. No model call: the expansion words come from the runs' dumps, or
// from --expansions (words written by hand as the model) where no run had
// an expansion.
// Run (from the repo root, two DB copies):
//   npx tsx scripts/qa/stitch-retrieval-eval.ts --needed <needed.json> --out <dir>
//     --expansions <json> --db-a postgresql://…/dissect_r9reta --db-i postgresql://…/dissect_r9ret
//   --ab 1 also runs the real cutLines on every select-path command twice —
//   as STITCH_INDEX=0 reads (the lines ranked alone) and as STITCH_INDEX
//   reads (the fused rank, the matches' lines kept) — at the kind's cut
//   budget and at a stress budget of 8,000 tokens, and reports the recall of
//   the needed groups in the lines shown and the tokens shown (out/ab.json).
import { PrismaClient, Prisma } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rank, tokenize } from "../../src/lib/graph/rank";
import { readSkeleton, type Skeleton } from "../../src/lib/graph/skeleton";
import { estTokens } from "../../src/lib/tokens";
import { searchQuery } from "../../src/lib/graph/search";
import { commandIntent } from "../../src/lib/graph/intent";
import { commandKind, cutLines, textMatches, type SkeletonView } from "../../src/lib/graph/stitch";
import { STITCH_INDEX_TOP, STITCH_LINKS_SKELETON, STITCH_QUESTION_SKELETON } from "../../src/lib/derive/config";

type Group = { ids: string[]; source: string };
type Needed = {
  id: string; project: string; lang: string; command: string; earlier: string[]; continued: boolean;
  pick: number[] | null; kind: string; intent: string; none: boolean; run: string; path: string;
  docsRead: string[]; needed: Group[]; also: Group[]; shownIds: string[]; shownAliases: string[];
  tokens: Record<string, number>; calls: Record<string, number>;
};
type Block = { id: string; text: string; documentId: string; order: number };
type Line = { blockId: string; text: string; partTitle: string };

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const NEEDED = args.get("needed") ?? "/home/user/unitos/.qa-tmp/stitch/r9/retrieval/needed.json";
const OUT = args.get("out") ?? "/home/user/unitos/.qa-tmp/stitch/r9/retrieval/out";
const ROOT = "/home/user/unitos/.qa-tmp/stitch";
const DB_A = args.get("db-a") ?? "postgresql://postgres:postgres@localhost:5432/dissect_r9reta";
const DB_I = args.get("db-i") ?? "postgresql://postgres:postgres@localhost:5432/dissect_r9ret";
const MINE: Record<string, string[]> = args.get("expansions") ? (JSON.parse(readFileSync(args.get("expansions")!, "utf8")) as Record<string, string[]>) : {};
const AB = args.get("ab") === "1";
const AB_STRESS = 8_000;
const KS = [10, 25, 50, 150];
const WINDOW_CHARS = 600; // a block read as a window: its first 600 characters
const RRF_K = 60;
const RARE_DF = 0.2; // a query term in at most this share of the blocks is rare: the prefilter's terms
// Words of a command that carry no topic: not counted when asking whether a
// needed block's text or line holds a term of the command.
const STOP = new Set(
  "what which who whom whose when where why how does did do is are was were has have had the a an and or of in on to for from with about i my me we our you your he his she her they their it its this that these those quote list compare gather collect write make find show tell give please can could would will should say says said each every all any document documents passage passages page link links draw connect between across other another different question answer first second third point points one two three into them both does different".split(" "),
);
mkdirSync(OUT, { recursive: true });

const clients = new Map<string, PrismaClient>();
function client(url: string): PrismaClient {
  let c = clients.get(url);
  if (!c) clients.set(url, (c = new PrismaClient({ datasources: { db: { url } } })));
  return c;
}
const dbOf = (project: string) => (project === "pi" ? DB_I : DB_A);

const blockCost = (text: string) => estTokens(text) + 10;
const windowCost = (text: string) => estTokens(text.slice(0, WINDOW_CHARS)) + 10;

// The reading of a command: its documents' readable blocks in reading order
// and their skeleton lines (with the part title, as cutLines ranks them).
type Reading = { blocks: Block[]; lines: Line[]; lineOf: Map<string, Line>; tokens: Map<string, Set<string>>; df: Map<string, number>; skeletons: Map<string, Skeleton> };
const readings = new Map<string, Reading>();
async function reading(project: string, docIds: string[]): Promise<Reading> {
  const key = `${project}:${docIds.join(",")}`;
  const cached = readings.get(key);
  if (cached) return cached;
  const db = client(dbOf(project));
  const docs = await db.document.findMany({ where: { id: { in: docIds } }, select: { id: true, skeleton: true } });
  const rows = await db.block.findMany({
    where: { documentId: { in: docIds }, type: { notIn: ["VIDEO", "PAGE"] } },
    orderBy: [{ documentId: "asc" }, { order: "asc" }],
    select: { id: true, text: true, documentId: true, order: true },
  });
  const byDoc = new Map<string, Block[]>();
  for (const r of rows) {
    if (r.text.trim().length === 0) continue;
    if (!byDoc.has(r.documentId)) byDoc.set(r.documentId, []);
    byDoc.get(r.documentId)!.push(r);
  }
  const blocks = docIds.flatMap((d) => byDoc.get(d) ?? []);
  const lines: Line[] = [];
  const skeletons = new Map<string, Skeleton>();
  for (const d of docIds) {
    const sk = readSkeleton(docs.find((x) => x.id === d)?.skeleton);
    if (!sk) continue;
    skeletons.set(d, sk);
    const partAt = new Map(sk.parts.map((p) => [p.blockId, p.title]));
    let title = "";
    for (const l of sk.lines) {
      if (partAt.has(l.blockId)) title = partAt.get(l.blockId) ?? "";
      lines.push({ blockId: l.blockId, text: l.text, partTitle: /^Blocks \d+/.test(title) ? "" : title });
    }
  }
  const tokens = new Map(blocks.map((b) => [b.id, new Set(tokenize(b.text))]));
  const df = new Map<string, number>();
  for (const set of tokens.values()) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const out = { blocks, lines, lineOf: new Map(lines.map((l) => [l.blockId, l])), tokens, df, skeletons };
  readings.set(key, out);
  return out;
}

// ── The A/B of the real cut (--ab): STITCH_INDEX=0 against STITCH_INDEX ──
type AbArm = { recall: number; lines: number; tokens: number };
type AbRow = { budget: number; off: AbArm; on: AbArm; matches: number; matchesNeeded: number };
const docLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) - 1)}`);
const lineCost = (alias: string, text: string) => estTokens(text) + Math.ceil((alias.length + 9) / 4);

/** The reading as pickBlocks sees it (aliases per document in reading
    order, the skeleton lines under them), cut by the real cutLines with
    and without the text-match channel, at the kind's budget and at the
    stress budget. No route pass: at 200 documents production routes
    first, so the cut there reads the routed parts' lines. */
async function abCut(n: Needed, r: Reading, query: string): Promise<AbRow[]> {
  const aliasOf = new Map<string, string>();
  const aliased: { id: string; alias: string; text: string }[] = [];
  n.docsRead.forEach((d, i) => {
    let k = 0;
    for (const b of r.blocks) {
      if (b.documentId !== d) continue;
      const alias = `${docLetter(i)}${++k}`;
      aliasOf.set(b.id, alias);
      aliased.push({ id: b.id, alias, text: b.text });
    }
  });
  const textOf = new Map<string, string>();
  const views = n.docsRead.flatMap((d, i) => {
    const sk = r.skeletons.get(d);
    if (!sk) return [];
    const parts = sk.parts.flatMap((p) => {
      const alias = aliasOf.get(p.blockId);
      return alias ? [{ alias, title: p.title, summary: "" }] : [];
    });
    const partStarts = new Set(parts.map((p) => p.alias));
    let partAlias: string | null = null;
    const lines = sk.lines.flatMap((l) => {
      const alias = aliasOf.get(l.blockId);
      if (!alias) return [];
      if (partStarts.has(alias)) partAlias = alias;
      textOf.set(alias, l.text);
      return [{ alias, text: l.text, partAlias }];
    });
    return [{ r: { letter: docLetter(i) }, gist: "", parts, lines } as unknown as SkeletonView];
  });
  const matches = textMatches(aliased, query, STITCH_INDEX_TOP);
  const neededAliases = new Set(n.needed.flatMap((g) => g.ids.map((id) => aliasOf.get(id) ?? "")));
  const arm = (shown: Set<string>): AbArm => ({
    recall: n.needed.length === 0 ? 1 : n.needed.filter((g) => g.ids.some((id) => shown.has(aliasOf.get(id) ?? ""))).length / n.needed.length,
    lines: shown.size,
    tokens: [...shown].reduce((s, a) => s + lineCost(a, textOf.get(a) ?? ""), 0),
  });
  const rows: AbRow[] = [];
  for (const budget of [n.kind === "links" ? STITCH_LINKS_SKELETON : STITCH_QUESTION_SKELETON, AB_STRESS]) {
    const off = await cutLines(views, null, async () => query, budget);
    const on = await cutLines(views, null, async () => query, budget, { matches });
    rows.push({ budget, off: arm(off), on: arm(on), matches: matches.length, matchesNeeded: matches.filter((a) => neededAliases.has(a)).length });
  }
  return rows;
}

// The expansion words of a run, from its dump (answers/<run>.expand.*.json),
// else the hand-written ones.
function expansionWords(n: Needed): { words: string[]; source: "dump" | "mine" | "none" } {
  const dir = `${ROOT}/${n.run}`;
  const runFile = `${dir}/runs/${n.id}.json`;
  if (existsSync(runFile)) {
    const run = JSON.parse(readFileSync(runFile, "utf8")) as { calls: { pass: string; key: string }[] };
    for (const c of run.calls) {
      if (c.pass !== "expand") continue;
      for (const f of [`${dir}/answers/${c.key}.json`, `${dir}/answers/${n.id}.expand.json`]) {
        if (!existsSync(f)) continue;
        try {
          const words = (JSON.parse(readFileSync(f, "utf8")) as { words?: string[] }).words ?? [];
          return { words: words.map((w) => w.trim()).filter(Boolean), source: "dump" };
        } catch {
          /* a non-JSON dump */
        }
      }
    }
  }
  const mine = MINE[n.id];
  return mine ? { words: mine, source: "mine" } : { words: [], source: "none" };
}

function rrf(lists: string[][], k = RRF_K): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

async function fts(db: PrismaClient, docIds: string[], query: string, normalization = 0): Promise<{ ids: string[]; top: number; ms: number }> {
  const tsq = searchQuery(query);
  if (!tsq) return { ids: [], top: 0, ms: 0 };
  const t0 = performance.now();
  const rows = await db.$queryRaw<{ id: string; r: number }[]>(Prisma.sql`
    SELECT b.id, ts_rank_cd(b.search, q, ${normalization}::int)::float8 AS r
    FROM "Block" b, to_tsquery('simple', ${tsq}) q
    WHERE b."documentId" IN (${Prisma.join(docIds)}) AND b.search @@ q
    ORDER BY r DESC, b."documentId", b."order" LIMIT 300`);
  return { ids: rows.map((r) => r.id), top: rows[0]?.r ?? 0, ms: performance.now() - t0 };
}

async function trgm(db: PrismaClient, docIds: string[], query: string): Promise<{ ids: string[]; top: number; ms: number }> {
  const t0 = performance.now();
  const rows = await db.$queryRaw<{ id: string; s: number }[]>(Prisma.sql`
    SELECT b.id, word_similarity(${query}, b.text)::float8 AS s
    FROM "Block" b WHERE b."documentId" IN (${Prisma.join(docIds)})
    ORDER BY s DESC, b."documentId", b."order" LIMIT 300`);
  return { ids: rows.map((r) => r.id), top: rows[0]?.s ?? 0, ms: performance.now() - t0 };
}

type RetrieverResult = { recall: number[]; hit: boolean[]; alsoRecall: number[]; tokens: number[]; windows: number[]; firstRank: number | null; top: number; ms: number; candidates?: number };
type Result = {
  id: string; project: string; lang: string; intent: string; kind: string; path: string; none: boolean; continued: boolean;
  groups: number; alsoGroups: number; blocks: number; tokensWhole: number;
  shown: { k: number; recall: number; hit: boolean; alsoRecall: number; selectTokens: number } | null;
  expansion: number; expansionSource: string;
  retrievers: Record<string, RetrieverResult>;
  needRanks: Record<string, number[]>; // the rank of each needed group's best block per retriever (1-based; -1 missing)
  // Per needed group: does a topic term of the query occur in the best block's text, and in its skeleton line?
  termInText: boolean[]; termInLine: boolean[];
  rareTerms: number;
  classified: string;
  ab?: AbRow[];
};

function recallAt(ranked: string[], groups: Group[], k: number): number {
  if (groups.length === 0) return 1;
  const top = new Set(ranked.slice(0, k));
  return groups.filter((g) => g.ids.some((id) => top.has(id))).length / groups.length;
}
function groupRanks(ranked: string[], groups: Group[]): number[] {
  const pos = new Map(ranked.map((id, i) => [id, i + 1]));
  return groups.map((g) => Math.min(...g.ids.map((id) => pos.get(id) ?? Infinity))).map((r) => (r === Infinity ? -1 : r));
}

async function main() {
  const needed = JSON.parse(readFileSync(NEEDED, "utf8")) as Needed[];
  const results: Result[] = [];
  const timing: Record<string, { n: number; ms: Record<string, number> }> = {};
  for (const n of needed) {
    const r = await reading(n.project, n.docsRead);
    const db = client(dbOf(n.project));
    const exp = expansionWords(n);
    const words = exp.words;
    const baseQuery = [...n.earlier, n.command].join("\n");
    const xQuery = words.length > 0 ? `${baseQuery}\n${words.join(" ")}` : baseQuery;
    const timed = async <T,>(f: () => Promise<T> | T): Promise<[T, number]> => {
      const t0 = performance.now();
      const v = await f();
      return [v, performance.now() - t0];
    };
    const lists: Record<string, { ids: string[]; top: number; ms: number; candidates?: number }> = {};
    const [bm25, msB] = await timed(() => rank(r.blocks, (b) => b.text, baseQuery));
    lists.bm25 = { ids: bm25.filter((x) => x.score > 0).map((x) => x.item.id), top: bm25[0]?.score ?? 0, ms: msB };
    const [bm25x, msBx] = await timed(() => rank(r.blocks, (b) => b.text, xQuery));
    lists.bm25x = { ids: bm25x.filter((x) => x.score > 0).map((x) => x.item.id), top: bm25x[0]?.score ?? 0, ms: msBx };
    const [skel, msS] = await timed(() => rank(r.lines, (l) => `${l.text} ${l.partTitle}`, xQuery));
    lists.skeleton = { ids: skel.filter((x) => x.score > 0).map((x) => x.item.blockId), top: skel[0]?.score ?? 0, ms: msS };
    const [skel0, msS0] = await timed(() => rank(r.lines, (l) => `${l.text} ${l.partTitle}`, baseQuery));
    lists.skeleton0 = { ids: skel0.filter((x) => x.score > 0).map((x) => x.item.blockId), top: skel0[0]?.score ?? 0, ms: msS0 };
    // The prefilter: the query's rare terms (df at most RARE_DF of the
    // blocks), the blocks that hold any, then BM25 over them.
    const qTerms = new Set(tokenize(xQuery));
    const rare = [...qTerms].filter((t) => (r.df.get(t) ?? 0) > 0 && (r.df.get(t) ?? 0) / r.blocks.length <= RARE_DF);
    const [pre, msP] = await timed(() => {
      const cands = rare.length > 0 ? r.blocks.filter((b) => rare.some((t) => r.tokens.get(b.id)!.has(t))) : r.blocks;
      return { ranked: rank(cands, (b) => b.text, xQuery), count: cands.length };
    });
    lists.pre = { ids: pre.ranked.filter((x) => x.score > 0).map((x) => x.item.id), top: pre.ranked[0]?.score ?? 0, ms: msP, candidates: pre.count };
    lists.fts = await fts(db, n.docsRead, baseQuery);
    lists.ftsx = await fts(db, n.docsRead, xQuery);
    lists.ftsx1 = await fts(db, n.docsRead, xQuery, 1);
    lists.ftsx2 = await fts(db, n.docsRead, xQuery, 2);
    lists.trgm = await trgm(db, n.docsRead, xQuery);
    lists.rrf = { ids: rrf([lists.bm25x.ids.slice(0, 300), lists.skeleton.ids.slice(0, 300)]), top: 0, ms: 0 };
    lists.rrfFts = { ids: rrf([lists.ftsx.ids.slice(0, 300), lists.skeleton.ids.slice(0, 300)]), top: 0, ms: 0 };
    const textOf = new Map(r.blocks.map((b) => [b.id, b.text]));
    // Topic terms of the query: in the best needed block's text? in its line?
    const topic = [...qTerms].filter((t) => !STOP.has(t) && (t.length > 2 || /[぀-ヿ㐀-䶿一-鿿가-힯]/u.test(t)));
    const termInText: boolean[] = []; const termInLine: boolean[] = [];
    const bestRanks = groupRanks(lists.bm25x.ids, n.needed);
    n.needed.forEach((g, i) => {
      const pos = new Map(lists.bm25x.ids.map((id, j) => [id, j]));
      const best = bestRanks[i] > 0 ? g.ids.reduce((a, b) => ((pos.get(a) ?? 1e9) <= (pos.get(b) ?? 1e9) ? a : b)) : g.ids[0];
      const tt = r.tokens.get(best) ?? new Set<string>();
      const lt = new Set(tokenize(r.lineOf.get(best)?.text ?? ""));
      termInText.push(topic.some((t) => tt.has(t)));
      termInLine.push(topic.some((t) => lt.has(t)));
    });
    const res: Result = {
      id: n.id, project: n.project, lang: n.lang, intent: n.intent, kind: n.kind, path: n.path, none: n.none, continued: n.continued,
      groups: n.needed.length, alsoGroups: n.also.length, blocks: r.blocks.length,
      tokensWhole: r.blocks.reduce((s, b) => s + blockCost(b.text), 0),
      shown: n.path === "select" ? {
        k: n.shownIds.length,
        recall: recallAt(n.shownIds, n.needed, n.shownIds.length),
        hit: recallAt(n.shownIds, n.needed, n.shownIds.length) === 1,
        alsoRecall: recallAt(n.shownIds, n.also, n.shownIds.length),
        selectTokens: n.tokens.select ?? 0,
      } : null,
      expansion: words.length, expansionSource: exp.source,
      retrievers: {},
      needRanks: {},
      termInText, termInLine, rareTerms: rare.length,
      classified: commandIntent(n.command, n.continued, commandKind(n.command) as "question" | "links" | "page"),
    };
    if (AB && n.path === "select") res.ab = await abCut(n, r, xQuery);
    for (const [name, l] of Object.entries(lists)) {
      const first = n.needed.length > 0 ? Math.min(...groupRanks(l.ids, n.needed).map((x) => (x === -1 ? Infinity : x))) : null;
      res.retrievers[name] = {
        recall: KS.map((k) => recallAt(l.ids, n.needed, k)),
        hit: KS.map((k) => recallAt(l.ids, n.needed, k) === 1),
        alsoRecall: KS.map((k) => recallAt(l.ids, n.also, k)),
        tokens: KS.map((k) => l.ids.slice(0, k).reduce((s, id) => s + blockCost(textOf.get(id) ?? ""), 0)),
        windows: KS.map((k) => l.ids.slice(0, k).reduce((s, id) => s + windowCost(textOf.get(id) ?? ""), 0)),
        firstRank: first === Infinity ? -1 : first,
        top: l.top,
        ms: l.ms,
        ...(l.candidates !== undefined ? { candidates: l.candidates } : {}),
      };
      res.needRanks[name] = groupRanks(l.ids, n.needed);
      const t = (timing[n.project] ??= { n: 0, ms: {} });
      t.ms[name] = (t.ms[name] ?? 0) + l.ms;
    }
    timing[n.project].n++;
    results.push(res);
    writeFileSync(`${OUT}/ranked-${n.id}.json`, JSON.stringify({ id: n.id, query: xQuery, expansion: exp, lists: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.ids.slice(0, 150)])) }));
  }
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ ks: KS, results, timing }, null, 1));
  console.log(`done: ${results.length} commands → ${OUT}/results.json`);
  for (const [p, t] of Object.entries(timing)) console.log(p, t.n, Object.fromEntries(Object.entries(t.ms).map(([k, v]) => [k, (v / t.n).toFixed(1)])));
  for (const c of clients.values()) await c.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
