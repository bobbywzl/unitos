// The slides benchmark (SPEC.md §27): real .pptx files from public test
// suites parsed in-process the way an upload parses them (parseSlides,
// lib/parse/slides.ts), scored against each file's own XML read apart from
// the code under test (slides-ref.py, lxml).
//
//   npx tsx scripts/parse-bench/slides.mts [--only id,id] [--baseline]
//     [--save-baseline] [--worst n] [--detail id] [--dir path] [--json out.json]
//
// The corpus is slides-corpus.json: each file's source URL (pinned to a
// commit), its license, and what it exercises. Two kinds of files: decks
// from public test suites (Apache POI, LibreOffice, Open XML SDK,
// python-pptx, Tika) and real-world decks committed to permissively licensed
// repositories (course and workshop decks, talk decks, Chinese, Japanese and
// Korean decks, decks of 100 and more slides, Google Slides and LibreOffice
// exports). The files are other people's and are never committed: the first
// run downloads them into .bench/slides/files/ from the corpus alone. --dir
// scores every .pptx under a folder instead (ids are the paths), to look for
// new fixtures.
//
// What a reader would notice, per file (slides matched by number):
//
// - words: the slide's words (everything before "Speaker notes:") against the
//   reference's — text shapes, equations, table cells, chart titles, names,
//   categories and values as their number format shows them, SmartArt nodes —
//   as token F1 (letters and digits; a Han or kana character is a token; a
//   list label at a line's start is not a word on either side).
// - order: the pairs of pieces whose order the slide fixes — a text shape's
//   paragraphs in turn, the title before the rest, a shape wholly above
//   another before it, and in one row the left before the right — the share
//   in that order in the block's text.
// - bullets: each paragraph's bullet (none, its character as drawn, a number
//   label of its scheme), the share right among the paragraphs found.
// - tables: each table row, its cells joined by tabs, found whole.
// - notes: the speaker notes after "Speaker notes:", token F1.
// - replica: the replica's DOM text (every text node outside
//   [data-anchor-skip]) equals the block's text (SPEC.md §27, the one rule).
//
// Losses count apart: a reference piece (a paragraph, an equation, a table, a
// chart, a SmartArt node, a slide's notes) with under half of its tokens in
// the parse. The composite is the mean of the parts a file has; the total is
// the mean over files. Run time is the parse alone, per file.
//
// Baseline: slides-baseline.json holds each file's numbers. --baseline lists
// every file whose composite dropped by more than 0.01 and exits 1 when one
// did; --save-baseline writes the run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { JSDOM } from "jsdom";
import { z } from "zod";
import { outboundFetch } from "@/lib/outbound-fetch";
import { parseSlides, SLIDE_NOTES_LABEL } from "@/lib/parse/slides";
import type { ParsedBlock } from "@/lib/parse/types";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = join(ROOT, ".bench", "slides");
const FILES = join(DIR, "files");
const REF_CACHE = join(DIR, "ref.json");
const REF_SCRIPT = join(import.meta.dirname, "slides-ref.py");
const CORPUS = join(import.meta.dirname, "slides-corpus.json");
const BASELINE = join(import.meta.dirname, "slides-baseline.json");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const worst = value("--worst") ? Number(value("--worst")) : 15;
const detail = value("--detail");
const dir = value("--dir");

// ── The corpus ──────────────────────────────────────────────────────────────

const corpusSchema = z.object({
  files: z.array(
    z.object({
      id: z.string(),
      url: z.string().url(),
      source: z.string(),
      license: z.string(),
      covers: z.array(z.string()),
      note: z.string().optional(),
    }),
  ),
});
type Entry = { id: string; path: string };

async function corpusEntries(): Promise<Entry[]> {
  if (dir) {
    const out: Entry[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (name === ".git") continue;
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.pptx$/i.test(name)) out.push({ id: relative(dir, p), path: p });
      }
    };
    walk(dir);
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
  const corpus = corpusSchema.parse(JSON.parse(readFileSync(CORPUS, "utf8")));
  mkdirSync(FILES, { recursive: true });
  const out: Entry[] = [];
  for (const f of corpus.files) {
    const path = join(FILES, `${f.id}.pptx`);
    if (!existsSync(path)) {
      try {
        // GitHub's raw host answers 429 to a burst of downloads: wait and
        // ask again.
        let res = await outboundFetch(f.url, { signal: AbortSignal.timeout(120_000) });
        for (let attempt = 1; attempt <= 5 && (res.status === 429 || res.status >= 500); attempt++) {
          await new Promise((r) => setTimeout(r, 15_000 * attempt));
          res = await outboundFetch(f.url, { signal: AbortSignal.timeout(120_000) });
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
        console.log(`fetched  ${f.id}`);
      } catch (e) {
        console.log(`skipped  ${f.id}  ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    out.push({ id: f.id, path });
  }
  return out;
}

let entries = await corpusEntries();
if (detail) entries = entries.filter((e) => e.id === detail);
else if (only) entries = entries.filter((e) => only.includes(e.id));

// ── The reference (slides-ref.py), cached by file and script hash ──────────

type RefPara = { text: string; level: number; bullet: string | null; math: boolean };
type RefShape =
  | { kind: "text"; title: boolean; box: number[] | null; paras: RefPara[] }
  | { kind: "table"; title: boolean; box: number[] | null; rows: string[][]; mathRows?: number[] }
  | { kind: "chart"; title: boolean; box: number[] | null; titleText?: string; words: string[]; values: number[]; shown: string[] }
  | { kind: "smartart"; title: boolean; box: number[] | null; texts: string[] };
type RefSlide = { n: number; hidden?: boolean; missing?: boolean; shapes: RefShape[]; notes: string };
type Ref = { error?: string; slideW?: number; slideH?: number; slides?: RefSlide[] };

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const scriptHash = sha(readFileSync(REF_SCRIPT));
type Cache = Record<string, { file: string; script: string; ref: Ref }>;
const cache: Cache = existsSync(REF_CACHE) ? JSON.parse(readFileSync(REF_CACHE, "utf8")) : {};
const fileHash = new Map(entries.map((e) => [e.id, sha(readFileSync(e.path))]));
const stale = entries.filter((e) => cache[e.id]?.file !== fileHash.get(e.id) || cache[e.id]?.script !== scriptHash);
if (stale.length > 0) {
  const out = execFileSync("python3", ["-I", REF_SCRIPT, "-"], {
    input: stale.map((e) => e.path).join("\n"),
    maxBuffer: 1 << 30,
  }).toString("utf8");
  const refs = JSON.parse(out) as Record<string, Ref & { title?: string }>;
  for (const e of stale) cache[e.id] = { file: fileHash.get(e.id)!, script: scriptHash, ref: refs[e.path] };
  mkdirSync(DIR, { recursive: true });
  if (!dir) writeFileSync(REF_CACHE, JSON.stringify(cache));
}

// ── Text measures ───────────────────────────────────────────────────────────

// A list label at a line's start — a bullet glyph, "1.", "(a)", "iv)",
// an East Asian number ("一.", "１．", "①") — is the list's drawing, not a
// word: dropped on both sides alike. Text is
// compared in its compatibility form (NFKC): an equation's math italic 𝑎 is
// the letter a, a full-width Ａ is A. A math letter (U+1D400–U+1D7FF) is
// one variable, a token of its own: "𝜋𝑟²" is π, r, 2 on both sides, however
// an equation's parts are spaced. An underscore joins the words of a name
// (snake_case is one token) but is no word alone: a linear equation's
// subscript mark ("𝑥_𝐾") is notation, as "^" is.
const LABEL = /^\s*(?:[^\p{L}\p{N}\s]{1,2}|\(?(?:\d{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,6})[.)]|\p{sc=Han}{1,5}[.．]|[０-９]{1,3}．?|[\u2460-\u2473\u2776-\u277F\u24EB-\u24F4\u3251-\u325F\u32B1-\u32BF])\s+/u;
function tokens(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(LABEL, ""));
  return (
    lines
      .join("\n")
      .replace(/[\u{1D400}-\u{1D7FF}]/gu, " $& ")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{N}\p{M}_])+/gu) ?? []
  ).filter((t) => !/^_+$/.test(t));
}
type Counts = { tp: number; fp: number; fn: number };
function bag(ts: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of ts) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
function counts(ref: string[], got: string[]): Counts {
  const a = bag(ref);
  const b = bag(got);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    tp += Math.min(x, y);
    fp += Math.max(0, y - x);
    fn += Math.max(0, x - y);
  }
  return { tp, fp, fn };
}
/** A text's letters and digits alone, in their compatibility form. */
const letters = (text: string) => (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []).join("");
const add = (a: Counts, b: Counts): Counts => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn });
const f1 = ({ tp, fp, fn }: Counts) => (tp + fp + fn === 0 ? 1 : (2 * tp) / (2 * tp + fp + fn));
/** Share of a piece's tokens the parse holds. */
function recallIn(piece: string[], got: Map<string, number>): number {
  if (piece.length === 0) return 1;
  const need = bag(piece);
  let hit = 0;
  for (const [k, n] of need) hit += Math.min(n, got.get(k) ?? 0);
  return hit / piece.length;
}

/** The replica's DOM text: every text node outside [data-anchor-skip]. */
function domText(html: string): string {
  const frag = JSDOM.fragment(html);
  let out = "";
  const walk = (node: Node) => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 3) out += c.textContent ?? "";
      else if (c.nodeType === 1 && !(c as Element).hasAttribute("data-anchor-skip")) walk(c);
    }
  };
  walk(frag);
  return out;
}

// ── Scoring one file ────────────────────────────────────────────────────────

type Piece = { kind: "text" | "math" | "table" | "chart" | "smartart"; text: string; shape: number };
type FileScore = {
  id: string;
  slides: number;
  composite: number;
  words: number;
  order: number | null;
  bullets: number | null;
  tables: number | null;
  notes: number | null;
  chartValues: number | null;
  replica: number;
  lost: number;
  lostBy: Record<string, number>;
  ms: number;
  error?: string;
};

/** The slide's words and its notes apart. The replica's notes strip says
    where the notes start: their own words may hold the line "Speaker
    notes:" (a deck whose notes open with it), so the label's last line is
    no boundary. Without the strip, the label's last line is. */
function bodyAndNotes(text: string, html: string | undefined): { body: string; notes: string | null } {
  const strip = html && html.includes('class="slide-notes-body"') ? JSDOM.fragment(html).querySelector(".slide-notes-body") : null;
  if (strip) {
    const notes = domText(strip.outerHTML);
    const tail = `${SLIDE_NOTES_LABEL}\n${notes}`;
    if (text.endsWith(tail)) return { body: text.slice(0, text.length - tail.length).replace(/\n$/, ""), notes };
  }
  const lines = text.split("\n");
  const at = lines.lastIndexOf(SLIDE_NOTES_LABEL);
  if (at < 0) return { body: text, notes: null };
  return { body: lines.slice(0, at).join("\n"), notes: lines.slice(at + 1).join("\n") };
}

function piecesOf(slide: RefSlide): Piece[] {
  const out: Piece[] = [];
  slide.shapes.forEach((s, i) => {
    if (s.kind === "text") for (const p of s.paras) out.push({ kind: p.math ? "math" : "text", text: p.text, shape: i });
    else if (s.kind === "table") out.push({ kind: "table", text: s.rows.map((r) => r.join("\t")).join("\n"), shape: i });
    else if (s.kind === "chart") out.push({ kind: "chart", text: [s.titleText ?? "", ...s.words, ...s.shown].join("\n"), shape: i });
    else for (const t of s.texts) out.push({ kind: "smartart", text: t, shape: i });
  });
  return out;
}

/** Where a piece starts in the parse's token stream: its first tokens (up to
    five), when they occur once in the reference slide; else null. */
function startOf(piece: string[], refStream: string[], got: string[]): number | null {
  const k = Math.min(5, piece.length);
  if (k === 0) return null;
  const key = piece.slice(0, k);
  const find = (stream: string[], from = 0) => {
    for (let i = from; i + k <= stream.length; i++) {
      let ok = true;
      for (let j = 0; j < k; j++) if (stream[i + j] !== key[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  };
  const first = find(refStream);
  if (first < 0 || find(refStream, first + 1) >= 0) return null;
  const at = find(got);
  return at >= 0 ? at : null;
}

const norm = (s: string) => s.replace(/[  ]+/g, " ").trim();

type SlideDetail = { n: number; lines: string[] };

function scoreFile(id: string, ref: Ref, blocks: ParsedBlock[], ms: number, details: SlideDetail[] | null): FileScore {
  const slides = ref.slides ?? [];
  const byPage = new Map<number, ParsedBlock>();
  for (const b of blocks) if (b.type === "SLIDE" && b.page) byPage.set(b.page, b);
  let words: Counts = { tp: 0, fp: 0, fn: 0 };
  let notesCounts: Counts = { tp: 0, fp: 0, fn: 0 };
  let notesSlides = 0;
  let orderOk = 0;
  let orderAll = 0;
  let bulletOk = 0;
  let bulletAll = 0;
  let rowOk = 0;
  let rowAll = 0;
  let valueOk = 0;
  let valueAll = 0;
  let replicaOk = 0;
  const lostBy: Record<string, number> = {};
  const lose = (kind: string) => (lostBy[kind] = (lostBy[kind] ?? 0) + 1);
  for (const slide of slides) {
    const block = byPage.get(slide.n);
    const say: string[] = [];
    const text = block?.text ?? "";
    if (!block) lose("slide");
    const { body, notes } = bodyAndNotes(text, block?.html);
    const got = tokens(body);
    const gotBag = bag(got);
    const pieces = piecesOf(slide);
    const refTokens = pieces.flatMap((p) => tokens(p.text));
    const c = counts(refTokens, got);
    words = add(words, c);
    for (const p of pieces) {
      const pt = tokens(p.text);
      if (pt.length > 0 && recallIn(pt, gotBag) < 0.5) {
        lose(p.kind);
        say.push(`  lost ${p.kind}: ${norm(p.text).slice(0, 160)}`);
      }
    }
    if (c.fp > 0 && details) {
      const refBag = bag(refTokens);
      const extra = body.split("\n").filter((l) => {
        const lt = tokens(l);
        return lt.length > 0 && recallIn(lt, refBag) < 0.5;
      });
      for (const l of extra.slice(0, 12)) say.push(`  extra line: ${norm(l).slice(0, 160)}`);
    }
    if ((c.fp > 0 || c.fn > 0) && details) {
      // The words apart, each with how many more one side has.
      const refBag = bag(refTokens);
      const diff = (a: Map<string, number>, b: Map<string, number>) =>
        [...a].filter(([t, n]) => n > (b.get(t) ?? 0)).map(([t, n]) => `${t}×${n - (b.get(t) ?? 0)}`).slice(0, 20).join(" ");
      if (c.fn > 0) say.push(`  words missing: ${diff(refBag, gotBag)}`);
      if (c.fp > 0) say.push(`  words extra: ${diff(gotBag, refBag)}`);
    }

    // Notes.
    if (slide.notes.trim()) {
      notesSlides++;
      const nc = counts(tokens(slide.notes), tokens(notes ?? ""));
      notesCounts = add(notesCounts, nc);
      if (recallIn(tokens(slide.notes), bag(tokens(notes ?? ""))) < 0.5) {
        lose("notes");
        say.push(`  lost notes: ${norm(slide.notes).slice(0, 160)}`);
      }
    } else if (notes !== null) {
      notesCounts = add(notesCounts, counts([], tokens(notes)));
      say.push(`  notes the slide has none of: ${norm(notes).slice(0, 120)}`);
    }

    // Order: constrained pairs of pieces.
    const refStream = refTokens;
    type At = { at: number; shape: number };
    const firstOfShape = new Map<number, number>();
    const shapeRuns = new Map<number, At[]>();
    for (const p of pieces) {
      if (p.kind === "smartart") continue;
      const at = startOf(tokens(p.text), refStream, got);
      if (at === null) continue;
      if (!firstOfShape.has(p.shape)) firstOfShape.set(p.shape, at);
      if (!shapeRuns.has(p.shape)) shapeRuns.set(p.shape, []);
      shapeRuns.get(p.shape)!.push({ at, shape: p.shape });
    }
    for (const run of shapeRuns.values()) {
      for (let i = 1; i < run.length; i++) {
        orderAll++;
        if (run[i - 1].at < run[i].at) orderOk++;
        else say.push(`  order inside a shape: a paragraph comes before the one ahead of it`);
      }
    }
    const shapes = [...firstOfShape.keys()];
    for (const a of shapes) {
      for (const b of shapes) {
        if (a === b) continue;
        const A = slide.shapes[a];
        const B = slide.shapes[b];
        let before = false;
        if (A.title !== B.title) before = A.title;
        else if (!A.title && A.box && B.box) {
          const [ax, ay, aw, ah] = A.box;
          const [bx, by, , bh] = B.box;
          const overlap = Math.min(ay + ah, by + bh) - Math.max(ay, by);
          if (ay + ah <= by) before = true;
          else if (overlap > 0.5 * Math.min(ah, bh) && ax + aw <= bx) before = true;
        }
        if (!before) continue;
        orderAll++;
        if (firstOfShape.get(a)! < firstOfShape.get(b)!) orderOk++;
        else say.push(`  order: "${norm(firstText(A)).slice(0, 50)}" should come before "${norm(firstText(B)).slice(0, 50)}"`);
      }
    }

    // Bullets: each paragraph's first line found as a line of the body, the
    // line's start before it a list label or nothing. Lines with the same
    // words go first to the paragraphs whose label they carry, then to the
    // rest: a slide of "nnn" lines, some with "•", pairs each line once.
    const lines = body.split("\n").map(norm);
    const used = new Set<number>();
    const labelish = (pre: string) => pre === "" || /^(?:[^\p{L}\p{N}\s]{1,3}|\(?[\p{L}\p{N}]{1,6}[.)．、-]|\p{N}{1,4}) $/u.test(pre);
    const wanted: { first: string; want: string | null }[] = [];
    for (const s of slide.shapes) {
      if (s.kind !== "text") continue;
      for (const p of s.paras) {
        const first = norm(p.text.split("\n")[0]);
        if (first) wanted.push({ first, want: p.bullet });
      }
    }
    const fits = (prefix: string, want: string | null) => (want === null ? /^[^\p{L}\p{N}]$/u.test(prefix) : prefix === want);
    const take = (first: string, ok: (prefix: string) => boolean): string | null => {
      for (let i = 0; i < lines.length; i++) {
        if (used.has(i) || !lines[i].endsWith(first)) continue;
        const pre = lines[i].slice(0, lines[i].length - first.length);
        if (!labelish(pre) || !ok(pre.trimEnd())) continue;
        used.add(i);
        return pre.trimEnd();
      }
      return null;
    };
    const missed: typeof wanted = [];
    for (const w of wanted) {
      if (take(w.first, (pre) => fits(pre, w.want)) !== null) {
        bulletAll++;
        bulletOk++;
      } else missed.push(w);
    }
    for (const w of missed) {
      const prefix = take(w.first, () => true);
      if (prefix === null) continue;
      bulletAll++;
      say.push(`  bullet: want "${w.want ?? "a symbol"}" got "${prefix}" on "${w.first.slice(0, 60)}"`);
    }

    // Tables: rows found whole. A row holding an equation is found by its
    // letters and digits in order: an equation's notation (spaces,
    // brackets, fraction bars: "5 𝑎𝑠 h" or "5(𝑎𝑠)/h") is the writer's.
    const bodyLetters = letters(body);
    for (const s of slide.shapes) {
      if (s.kind !== "table") continue;
      s.rows.forEach((row, r) => {
        if (!row.some((c) => c.trim())) return;
        rowAll++;
        const cellNorm = (l: string) => l.split("\t").map(norm).join("\t");
        const want = row.map((c) => c.split("\n").map(cellNorm).join("\n")).join("\t");
        const bodyNorm = body.split("\n").map(cellNorm).join("\n");
        if (bodyNorm.includes(want) || (s.mathRows?.includes(r) && bodyLetters.includes(letters(row.join(""))))) rowOk++;
        else say.push(`  table row: ${want.replace(/\t/g, " | ").replace(/\n/g, " / ").slice(0, 160)}`);
      });
    }

    // Chart values: each value as a number in the slide's words.
    const numbers = new Set((body.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))));
    for (const s of slide.shapes) {
      if (s.kind !== "chart") continue;
      for (const v of s.values) {
        valueAll++;
        const near = [...numbers].some((n) => [v, v * 100].some((x) => Math.abs(n - x) <= Math.max(1e-9, Math.abs(x) * 0.005) || Math.abs(n - x) < 0.5 * 10 ** -decimalsOf(n)));
        if (near) valueOk++;
      }
    }

    // The one rule: the replica's DOM text is the block's text.
    if (block?.html) {
      const dom = domText(block.html);
      if (dom === text) replicaOk++;
      else {
        let i = 0;
        while (i < dom.length && dom[i] === text[i]) i++;
        say.push(`  replica text differs at ${i}: dom ${JSON.stringify(dom.slice(i, i + 40))} text ${JSON.stringify(text.slice(i, i + 40))}`);
      }
    } else if (!block) {
      // No block: counted as lost above.
    }
    if (details) details.push({ n: slide.n, lines: say });
  }
  const extraBlocks = blocks.filter((b) => b.type === "SLIDE").length - slides.length;
  if (extraBlocks > 0) lostBy.extraSlides = extraBlocks;
  const parts = {
    words: f1(words),
    order: orderAll ? orderOk / orderAll : null,
    bullets: bulletAll ? bulletOk / bulletAll : null,
    tables: rowAll ? rowOk / rowAll : null,
    notes: notesSlides || notesCounts.fp ? f1(notesCounts) : null,
    chartValues: valueAll ? valueOk / valueAll : null,
    replica: slides.length ? replicaOk / slides.length : 1,
  };
  const present = Object.values(parts).filter((v): v is number => v !== null);
  const lost = Object.entries(lostBy).reduce((a, [k, n]) => a + (k === "extraSlides" ? 0 : n), 0);
  return { id, slides: slides.length, composite: present.reduce((a, b) => a + b, 0) / present.length, ...parts, lost, lostBy, ms };
}

function decimalsOf(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

function firstText(s: RefShape): string {
  if (s.kind === "text") return s.paras[0]?.text ?? "";
  if (s.kind === "table") return s.rows.flat().find((c) => c.trim()) ?? "";
  if (s.kind === "chart") return s.titleText || s.words[0] || "";
  return s.texts[0] ?? "";
}

// ── The run ─────────────────────────────────────────────────────────────────

const results: FileScore[] = [];
for (const e of entries) {
  const ref = cache[e.id].ref;
  if (!ref || ref.error) {
    console.log(`no reference  ${e.id}  ${ref?.error ?? ""}`);
    continue;
  }
  const bytes = new Uint8Array(readFileSync(e.path));
  const start = performance.now();
  let blocks: ParsedBlock[] = [];
  let error: string | undefined;
  try {
    const parsed = await parseSlides(bytes, `${e.id}.pptx`, { storeImage: async () => "/api/images/bench" });
    blocks = parsed.blocks;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Math.round(performance.now() - start);
  const details: SlideDetail[] | null = detail ? [] : null;
  const s = scoreFile(e.id, ref, blocks, ms, details);
  if (error) s.error = error;
  results.push(s);
  if (details) {
    console.log(`── ${e.id}  composite ${s.composite.toFixed(3)}  words ${s.words.toFixed(3)}  order ${fmt(s.order)}  bullets ${fmt(s.bullets)}  tables ${fmt(s.tables)}  notes ${fmt(s.notes)}  chart values ${fmt(s.chartValues)}  replica ${s.replica.toFixed(3)}  lost ${s.lost} ${JSON.stringify(s.lostBy)}  ${ms} ms${error ? `  error: ${error}` : ""}`);
    for (const d of details) {
      if (d.lines.length === 0) continue;
      console.log(`slide ${d.n}`);
      for (const l of d.lines) console.log(l);
    }
    if (flag("--text")) for (const b of blocks) console.log(`\n[${b.type} ${b.page ?? ""}]\n${b.text}`);
  }
}

// ── The report ──────────────────────────────────────────────────────────────

function fmt(x: number | null): string {
  return x === null ? "  -  " : x.toFixed(3);
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const meanOf = (k: keyof Pick<FileScore, "words" | "order" | "bullets" | "tables" | "notes" | "chartValues" | "replica">) =>
  mean(results.map((r) => r[k]).filter((v): v is number => v !== null));
const lostTotal: Record<string, number> = {};
for (const r of results) for (const [k, n] of Object.entries(r.lostBy)) lostTotal[k] = (lostTotal[k] ?? 0) + n;
const total = {
  composite: mean(results.map((r) => r.composite)),
  words: meanOf("words"),
  order: meanOf("order"),
  bullets: meanOf("bullets"),
  tables: meanOf("tables"),
  notes: meanOf("notes"),
  chartValues: meanOf("chartValues"),
  replica: meanOf("replica"),
  lost: results.reduce((a, r) => a + r.lost, 0),
  files: results.length,
  slides: results.reduce((a, r) => a + r.slides, 0),
  errors: results.filter((r) => r.error).length,
  msPerFile: Math.round(mean(results.map((r) => r.ms))),
};
if (!detail) {
  console.log(`Worst ${Math.min(worst, results.length)} files by composite:`);
  for (const r of [...results].sort((a, b) => a.composite - b.composite).slice(0, worst)) {
    console.log(
      `  ${r.id.padEnd(34)} ${r.composite.toFixed(3)}  words ${r.words.toFixed(3)}  order ${fmt(r.order)}  bullets ${fmt(r.bullets)}  tables ${fmt(r.tables)}  notes ${fmt(r.notes)}  values ${fmt(r.chartValues)}  replica ${r.replica.toFixed(3)}  lost ${r.lost}${r.error ? `  error: ${r.error}` : ""}`,
    );
  }
  console.log(
    `\nUnitos slides  composite ${total.composite.toFixed(3)}  words ${total.words.toFixed(3)}  order ${total.order.toFixed(3)}  bullets ${total.bullets.toFixed(3)}  tables ${total.tables.toFixed(3)}  notes ${total.notes.toFixed(3)}  chart values ${total.chartValues.toFixed(3)}  replica ${total.replica.toFixed(3)}`,
  );
  console.log(`  files ${total.files}  slides ${total.slides}  errors ${total.errors}  lost pieces ${total.lost} ${JSON.stringify(lostTotal)}  time ${total.msPerFile} ms/file`);
}

const json = value("--json");
if (json) writeFileSync(json, JSON.stringify({ total, results }, null, 2));

const round = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
type BaseFile = { composite: number; words: number; order: number | null; bullets: number | null; tables: number | null; notes: number | null; chartValues: number | null; replica: number; lost: number };
type Baseline = { total: Record<string, number>; files: Record<string, BaseFile> };
if (flag("--save-baseline") && !detail && !dir) {
  const prior: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { total: {}, files: {} };
  for (const r of results) {
    prior.files[r.id] = { composite: round(r.composite)!, words: round(r.words)!, order: round(r.order), bullets: round(r.bullets), tables: round(r.tables), notes: round(r.notes), chartValues: round(r.chartValues), replica: round(r.replica)!, lost: r.lost };
  }
  if (!only) {
    prior.total = Object.fromEntries(Object.entries(total).filter(([k]) => k !== "msPerFile").map(([k, v]) => [k, typeof v === "number" ? round(v)! : v]));
  }
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${results.length} files to ${BASELINE}`);
}
if (flag("--baseline") && existsSync(BASELINE) && !dir) {
  const base: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const drops = results.filter((r) => base.files[r.id] && r.composite < base.files[r.id].composite - 0.01);
  const rises = results.filter((r) => base.files[r.id] && r.composite > base.files[r.id].composite + 0.01);
  console.log(`\nAgainst the baseline (composite ${base.total.composite}): ${rises.length} files rose, ${drops.length} dropped`);
  for (const r of rises) console.log(`  rose    ${r.id}  ${base.files[r.id].composite.toFixed(3)} → ${r.composite.toFixed(3)}`);
  for (const r of drops) console.log(`  dropped ${r.id}  ${base.files[r.id].composite.toFixed(3)} → ${r.composite.toFixed(3)}`);
  if (drops.length > 0) process.exitCode = 1;
}
