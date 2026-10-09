// The images and scans benchmark (SPEC.md §15, §16): the deterministic path
// of a PDF's judgment (article, scan, or handwritten pages) and of an image
// dropped as a document, scored against references read by other code.
//
//   npx tsx scripts/parse-bench/images.mts [--fetch] [--section a|b] [--only id,id]
//     [--baseline] [--save-baseline] [--worst n] [--detail id] [--json out.json] [--mem]
//
// Two sections:
//   a. The judgment (lib/handwritten/classify.ts, lib/parse/ingest.ts
//      ingestPdf): each PDF parses as an add parses it (parsePdf, the chosen
//      pages when the corpus names them), and the text layer's verdict
//      (textLayerVerdict) says article with no model call, or hands the
//      PDF to the model with the sample pages drawn (classifySamplePages,
//      renderPdfPage at the classifier's width). The model cannot run here:
//      the bench scores what reaches it, and the outcome twice — once with a
//      model that answers each label right (the gate's own errors are all
//      that is left), and once keyless (the fallback the yield gives alone,
//      which is production's path when the model fails). A label of scan or
//      handwritten becomes page images and conversion input: those pages
//      are drawn at the page image's width (renderPdfPagesJpeg) and checked
//      too. Each label is the corpus's, made by looking at the pages
//      (images-corpus.json says why).
//   b. Images (lib/handwritten/image.ts sniffImage, image-pdf.ts
//      imageToPdf): each file is sniffed and wrapped into the one-page PDF
//      the add stores, then drawn as the page image the reader sees
//      (pdfPageSizes, renderPdfPagesJpeg at PAGE_IMAGE_WIDTH). Against
//      Pillow's reading (images-ref.py): nothing Pillow opens in a format the
//      add takes is refused; the page is upright (EXIF applied: the render
//      matches the upright picture better than any turn or mirror of it), at
//      the upright aspect, true to the picture (colors, alpha on white, the
//      first frame), and the stored image keeps the pixels the cap allows.
//      A format the add does not take (TIFF, HEIC, AVIF) must be refused
//      cleanly; it is listed apart.
//
// Model passes in the path: the classifier (CLASSIFY_MODEL) and a scan's read
// or a conversion (CONVERT_MODEL) read the page images. No key runs here;
// what reaches them is scored, nothing past it.
//
// Files: images-corpus.json (sources, licenses, labels). --fetch downloads
// them into .bench/images/files and builds the references (images-ref.py:
// Pillow, pillow-heif, PyMuPDF, img2pdf). Baseline: images-baseline.json
// (numbers only). --baseline lists every file whose score dropped by more
// than 0.01 and exits 1 when one did. --mem runs each file in a child
// process and reports its peak memory.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

// No model, no network: the keyless path.
for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "LITELLM_BASE_URL", "LITELLM_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  delete process.env[key];
}

const ROOT = join(import.meta.dirname, "..", "..", ".bench", "images");
const FILES = join(ROOT, "files");
const REFS = join(ROOT, "refs");
const OUT = join(ROOT, "out");
const CORPUS = join(import.meta.dirname, "images-corpus.json");
const BASELINE = join(import.meta.dirname, "images-baseline.json");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const sectionOnly = value("--section");
const worst = value("--worst") ? Number(value("--worst")) : 10;
const detail = value("--detail");
const child = value("--child");

if (flag("--fetch")) {
  execFileSync("python3", ["-I", join(import.meta.dirname, "images-ref.py"), CORPUS, ROOT], { stdio: "inherit" });
}

type Label = "article" | "scan" | "handwritten";
type CorpusFile = {
  id: string;
  section: "a" | "b";
  source?: string;
  path?: string;
  pages?: [number, number];
  label?: Label;
  shape?: string;
  why?: string;
  expect?: "refused";
  exercises?: string;
};
const corpus = JSON.parse(readFileSync(CORPUS, "utf8")) as { files: CorpusFile[] };

type Thumb = { w: number; h: number; rgb?: string; gray?: string };
type ImageRef = {
  opens: boolean;
  truncated?: boolean;
  format?: string;
  mode?: string;
  width?: number;
  height?: number;
  frames?: number;
  orientation?: number | null;
  uprightWidth?: number;
  uprightHeight?: number;
  thumb?: Thumb;
  error?: string;
};
type PdfPageRef = { width: number; height: number; rotate: number; chars: number; oneLetter: number; ink: number; thumb: Thumb };
type PdfRef = { opens: boolean; pageCount: number; encrypted: boolean; pages: PdfPageRef[] };

type Result = { id: string; section: "a" | "b"; score: number; metrics: Record<string, number>; ms: number; notes: string[]; tag?: string };

const { parsePdf } = await import("@/lib/parse/pdf");
const { textLayerVerdict, classifySamplePages } = await import("@/lib/handwritten/classify");
const { CLASSIFY_IMAGE_WIDTH, PAGE_IMAGE_WIDTH, pdfPageCount, pdfPageSizes, renderPdfPage, renderPdfPagesJpeg } = await import(
  "@/lib/handwritten/pages"
);
const { sniffImage } = await import("@/lib/handwritten/image");
const { imageToPdf } = await import("@/lib/handwritten/image-pdf");
const { createCanvas, loadImage } = await import("@napi-rs/canvas");

// The parse and the renders warn on odd PDFs; the bench reads its own notes.
const quiet = <T,>(f: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  const log = console.log;
  const error = console.error;
  console.warn = () => {};
  console.log = () => {};
  console.error = () => {};
  return f().finally(() => {
    console.warn = warn;
    console.log = log;
    console.error = error;
  });
};

// ── Pixels ──────────────────────────────────────────────────────────────────

type Pixels = { w: number; h: number; c: 1 | 3; data: Uint8Array };

async function decode(bytes: Uint8Array): Promise<Pixels> {
  const img = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
  const data = new Uint8Array(img.width * img.height * 3);
  for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
    data[q] = rgba[p];
    data[q + 1] = rgba[p + 1];
    data[q + 2] = rgba[p + 2];
  }
  return { w: img.width, h: img.height, c: 3, data };
}

function toGray(px: Pixels): Pixels {
  if (px.c === 1) return px;
  const data = new Uint8Array(px.w * px.h);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(0.299 * px.data[3 * i] + 0.587 * px.data[3 * i + 1] + 0.114 * px.data[3 * i + 2]);
  return { w: px.w, h: px.h, c: 1, data };
}

/** Box-average downscale to w x h (each target pixel the mean of the source
    pixels under it). */
function shrink(px: Pixels, w: number, h: number): Pixels {
  const out = new Uint8Array(w * h * px.c);
  const sum = new Float64Array(w * h * px.c);
  const count = new Float64Array(w * h);
  for (let y = 0; y < px.h; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / px.h));
    for (let x = 0; x < px.w; x++) {
      const tx = Math.min(w - 1, Math.floor((x * w) / px.w));
      const t = ty * w + tx;
      count[t]++;
      for (let k = 0; k < px.c; k++) sum[t * px.c + k] += px.data[(y * px.w + x) * px.c + k];
    }
  }
  for (let t = 0; t < w * h; t++) {
    const n = count[t] || 1;
    for (let k = 0; k < px.c; k++) out[t * px.c + k] = Math.round(sum[t * px.c + k] / n);
  }
  // A target pixel no source pixel fell on (an upscale): its nearest.
  if (px.w < w || px.h < h) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = y * w + x;
        if (count[t]) continue;
        const s = Math.min(px.h - 1, Math.floor((y * px.h) / h)) * px.w + Math.min(px.w - 1, Math.floor((x * px.w) / w));
        for (let k = 0; k < px.c; k++) out[t * px.c + k] = px.data[s * px.c + k];
      }
  }
  return { w, h, c: px.c, data: out };
}

function fromThumb(t: Thumb): Pixels {
  if (t.rgb) return { w: t.w, h: t.h, c: 3, data: new Uint8Array(Buffer.from(t.rgb, "base64")) };
  return { w: t.w, h: t.h, c: 1, data: new Uint8Array(Buffer.from(t.gray!, "base64")) };
}

/** The 8 turns and mirrors of an image (EXIF orientations 1-8 undone). */
function transforms(px: Pixels): { name: string; px: Pixels }[] {
  const at = (x: number, y: number, k: number) => px.data[(y * px.w + x) * px.c + k];
  const make = (w: number, h: number, src: (x: number, y: number) => [number, number]): Pixels => {
    const data = new Uint8Array(w * h * px.c);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [sx, sy] = src(x, y);
        for (let k = 0; k < px.c; k++) data[(y * w + x) * px.c + k] = at(sx, sy, k);
      }
    return { w, h, c: px.c, data };
  };
  const { w, h } = px;
  return [
    { name: "upright", px },
    { name: "mirrored", px: make(w, h, (x, y) => [w - 1 - x, y]) },
    { name: "upside down", px: make(w, h, (x, y) => [w - 1 - x, h - 1 - y]) },
    { name: "flipped", px: make(w, h, (x, y) => [x, h - 1 - y]) },
    { name: "transposed", px: make(h, w, (x, y) => [y, x]) },
    { name: "turned right", px: make(h, w, (x, y) => [y, h - 1 - x]) },
    { name: "transversed", px: make(h, w, (x, y) => [w - 1 - y, h - 1 - x]) },
    { name: "turned left", px: make(h, w, (x, y) => [w - 1 - y, x]) },
  ];
}

/** Mean absolute difference, 0-255. */
function mad(a: Pixels, b: Pixels): number {
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / Math.max(1, a.data.length);
}

const inkOf = (px: Pixels) => {
  const g = toGray(px);
  let n = 0;
  for (const v of g.data) if (v < 200) n++;
  return n / Math.max(1, g.data.length);
};

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n: number) => n.toFixed(3);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// How close a render must be to the reference picture: 1 - MAD/255 at or
// above FAITHFUL scores 1, at or below LOST scores 0. Two renderers (pdf.js
// and MuPDF, Skia and Pillow) disagree a little on every edge; a wrong
// turn, a lost alpha, or inverted colors moves far past that.
const FAITHFUL = 0.95;
const LOST = 0.8;
const fidelityScore = (sim: number) => clamp01((sim - LOST) / (FAITHFUL - LOST));

/** A render against its reference thumbnail: similarity, and which of the 8
    turns and mirrors of the reference it matches best. */
// The pictures compare at this size (the long side): coarse enough that two
// resamplers agree on dither and noise (a 1-bit dithered BMP, a noise test
// JPEG), fine enough that a turn, a mirror, or a lost color shows.
const COMPARE = 32;

function compare(render: Pixels, refThumb: Pixels): { sim: number; best: string; bestSim: number } {
  const r = refThumb.c === 1 ? toGray(render) : render;
  const k = COMPARE / Math.max(refThumb.w, refThumb.h);
  const ref = k < 1 ? shrink(refThumb, Math.max(1, Math.round(refThumb.w * k)), Math.max(1, Math.round(refThumb.h * k))) : refThumb;
  const sims = transforms(ref).map((t) => ({ name: t.name, sim: 1 - mad(shrink(r, t.px.w, t.px.h), t.px) / 255 }));
  const upright = sims[0].sim;
  const best = sims.reduce((a, b) => (b.sim > a.sim + 0.002 ? b : a), sims[0]);
  return { sim: upright, best: best.name, bestSim: best.sim };
}

// ── Section a: the judgment ─────────────────────────────────────────────────

function pagesOf(file: CorpusFile, count: number): number[] {
  const [from, to] = file.pages ?? [1, count];
  return Array.from({ length: Math.min(to, count) - from + 1 }, (_, i) => from + i);
}

type PageCheck = { ok: number; notes: string[]; ms: number };

/** Pages drawn the way the app draws them, each against MuPDF's drawing of
    the page: not blank where the page has ink, the page's shape (with its
    /Rotate), and the picture itself. */
async function checkRenders(
  bytes: Uint8Array,
  ref: PdfRef,
  pages: number[],
  width: number,
  jpeg: boolean,
  what: string,
): Promise<PageCheck> {
  const notes: string[] = [];
  const t0 = performance.now();
  const drawn = new Map<number, Uint8Array>();
  if (jpeg) {
    await quiet(() => renderPdfPagesJpeg(bytes, pages, width, async (page, image) => void drawn.set(page, image)));
  } else {
    for (const page of pages) {
      try {
        drawn.set(page, await quiet(() => renderPdfPage(bytes, page, width)));
      } catch (err) {
        notes.push(`${what} page ${page} did not render: ${err instanceof Error ? err.message.slice(0, 80) : err}`);
      }
    }
  }
  const ms = performance.now() - t0;
  const scores: number[] = [];
  for (const page of pages) {
    const pref = ref.pages[page - 1];
    const image = drawn.get(page);
    if (!image) {
      if (jpeg) notes.push(`${what} page ${page} did not render`);
      scores.push(0);
      continue;
    }
    const px = await decode(image);
    const refPx = fromThumb(pref.thumb);
    const aspect = px.w / px.h / (pref.width / pref.height);
    const shapeOk = Math.abs(aspect - 1) < 0.02;
    const appInk = inkOf(shrink(toGray(px), refPx.w, refPx.h));
    const blank = pref.ink > 0.003 && appInk < pref.ink * 0.25;
    const { sim, best } = compare(px, refPx);
    const s = blank ? 0 : mean([shapeOk ? 1 : 0, fidelityScore(sim)]);
    scores.push(s);
    if (blank) notes.push(`${what} page ${page} draws blank (ink ${round(appInk, 4)}, MuPDF ${pref.ink})`);
    else if (!shapeOk) notes.push(`${what} page ${page} shape ${px.w}x${px.h}, the page is ${pref.width}x${pref.height}`);
    else if (s < 0.999) notes.push(`${what} page ${page} similarity ${round(sim)}${best !== "upright" ? `, matches the page ${best}` : ""}`);
    if (px.w !== width) notes.push(`${what} page ${page} drawn ${px.w} px wide, not ${width}`);
  }
  return { ok: mean(scores), notes, ms };
}

async function scoreA(file: CorpusFile, bytes: Uint8Array, ref: PdfRef): Promise<Result> {
  const notes: string[] = [];
  const label = file.label!;
  const t0 = performance.now();
  const count = await quiet(() => pdfPageCount(bytes));
  const pages = pagesOf(file, count);
  const parsed = await quiet(() => parsePdf(bytes, { pages: file.pages ? pages : undefined }));
  const parseMs = performance.now() - t0;
  const verdict = textLayerVerdict(parsed.blocks, pages.length);
  // With a model that answers each label right, only the gate can be wrong.
  const withModel: Label = verdict.kind ?? label;
  const keyless: Label = verdict.kind ?? verdict.fallback;
  const keylessWant: Label = label === "article" ? "article" : "handwritten";
  const choice = withModel === label ? 1 : 0;
  const keylessOk = keyless === keylessWant ? 1 : 0;
  const toModel = verdict.kind === null;
  const refChars = pages.reduce((n, p) => n + (ref.pages[p - 1]?.chars ?? 0), 0) / Math.max(1, pages.length);
  notes.push(
    `text layer ${Math.round(verdict.perPage)} chars/page (MuPDF ${Math.round(refChars)})${verdict.junk ? ", junk" : ""}: ` +
      `${toModel ? "to the model" : "article, no model call"}; keyless ${keyless}; label ${label} (${file.shape})`,
  );
  if (!choice) notes.unshift(`the gate takes a ${label} (${file.shape}) for an article: its text layer is read as the text`);
  if (!keylessOk && label === "article") notes.unshift(`keyless, an article (${file.shape}) becomes handwritten pages`);

  const metrics: Record<string, number> = {
    choice,
    keyless: keylessOk,
    toModel: toModel ? 1 : 0,
    needlessModel: toModel && label === "article" ? 1 : 0,
    articleAsPages: label === "article" && keyless !== "article" ? 1 : 0,
    unreadableScan: label === "scan" && verdict.kind === "article" ? 1 : 0,
    pages: pages.length,
  };
  const parts: { w: number; s: number }[] = [
    { w: 2, s: choice },
    { w: 1, s: keylessOk },
  ];
  let renderMs = 0;
  const samples = classifySamplePages(pages);
  if (toModel) {
    const check = await checkRenders(bytes, ref, samples, CLASSIFY_IMAGE_WIDTH, false, "classifier sample");
    parts.push({ w: 1, s: check.ok });
    metrics.modelInput = round(check.ok);
    notes.push(...check.notes);
    renderMs += check.ms;
  }
  if (label !== "article") {
    const check = await checkRenders(bytes, ref, samples, PAGE_IMAGE_WIDTH, true, "page image");
    parts.push({ w: 1, s: check.ok });
    metrics.pageImages = round(check.ok);
    notes.push(...check.notes);
    renderMs += check.ms;
  }
  metrics.parseMs = Math.round(parseMs);
  metrics.renderMs = Math.round(renderMs);
  const score = parts.reduce((t, p) => t + p.w * p.s, 0) / parts.reduce((t, p) => t + p.w, 0);
  return { id: file.id, section: "a", score: round(score), metrics, ms: parseMs + renderMs, notes, tag: `${label}/${file.shape}` };
}

// ── Section b: images ───────────────────────────────────────────────────────

// imageToPdf draws no more pixels than this (image-pdf.ts MAX_PIXELS); a
// JPEG it embeds as it is keeps every pixel.
const DRAW_CAP = 24_000_000;

function embeddedSize(pdf: Uint8Array): { w: number; h: number } | null {
  const head = Buffer.from(pdf.subarray(0, 4096)).toString("latin1");
  const m = /\/Subtype \/Image \/Width (\d+) \/Height (\d+)/.exec(head);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

async function scoreB(file: CorpusFile, bytes: Uint8Array, ref: ImageRef): Promise<Result> {
  const notes: string[] = [];
  const expectRefused = file.expect === "refused";
  const t0 = performance.now();
  const mime = sniffImage(bytes);
  let pdf: Uint8Array | null = null;
  let refusal = "";
  if (!mime) refusal = "not sniffed as an image";
  else {
    try {
      pdf = await imageToPdf(bytes);
    } catch (err) {
      refusal = `the wrap threw: ${err instanceof Error ? err.message.slice(0, 100) : err}`;
    }
  }
  const wrapMs = performance.now() - t0;
  const metrics: Record<string, number> = { wrapMs: Math.round(wrapMs) };
  if (!pdf) {
    metrics.refused = 1;
    if (expectRefused) {
      metrics.notTaken = 1;
      return { id: file.id, section: "b", score: 1, metrics, ms: wrapMs, notes: [`refused (${refusal}): a format the add does not take`], tag: ref.format };
    }
    // An image Pillow cannot read either is refused rightly.
    const wrong = ref.opens ? 1 : 0;
    metrics.wrongRefusal = wrong;
    return {
      id: file.id,
      section: "b",
      score: wrong ? 0 : 1,
      metrics,
      ms: wrapMs,
      notes: [`refused: ${refusal}${wrong ? `; Pillow reads it (${ref.format} ${ref.mode} ${ref.width}x${ref.height})` : ""}`],
      tag: ref.format,
    };
  }
  if (expectRefused) {
    notes.push("a format the add does not take was taken");
  }
  metrics.pdfBytes = pdf.length;
  metrics.sourceBytes = bytes.length;
  const t1 = performance.now();
  const [size] = await quiet(() => pdfPageSizes(pdf!));
  let image: Uint8Array | null = null;
  await quiet(() => renderPdfPagesJpeg(pdf!, [1], PAGE_IMAGE_WIDTH, async (_p, jpeg) => void (image = jpeg)));
  const renderMs = performance.now() - t1;
  metrics.renderMs = Math.round(renderMs);
  if (!image || !size || !ref.thumb || !ref.uprightWidth || !ref.uprightHeight) {
    notes.push(!image ? "the page did not render" : "no reference picture");
    metrics.crashed = image ? 0 : 1;
    return { id: file.id, section: "b", score: 0, metrics, ms: wrapMs + renderMs, notes, tag: ref.format };
  }
  const px = await decode(image);
  if (detail) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${file.id}.jpg`), image);
  }
  const want = ref.uprightWidth / ref.uprightHeight;
  const aspectErr = Math.abs(size.width / size.height / want - 1);
  const aspect = aspectErr < 0.01 ? 1 : clamp01(1 - aspectErr * 5);
  const refPx = fromThumb(ref.thumb);
  const { sim, best, bestSim } = compare(px, refPx);
  // Upright: the render is the upright picture, not a turn or mirror of it.
  // A picture that looks the same turned (a symmetric one) ties, and passes.
  const upright = best === "upright" || bestSim - sim < 0.003 ? 1 : 0;
  const fidelity = fidelityScore(sim);
  const embedded = embeddedSize(pdf);
  const sourcePx = ref.uprightWidth * ref.uprightHeight;
  const kept = embedded ? clamp01((embedded.w * embedded.h) / Math.min(sourcePx, DRAW_CAP)) : 0;
  Object.assign(metrics, {
    upright,
    aspect: round(aspect),
    similarity: round(sim),
    fidelity: round(fidelity),
    kept: round(kept),
    pageW: size.width,
    pageH: size.height,
    embeddedMp: embedded ? round((embedded.w * embedded.h) / 1e6, 2) : 0,
    sourceMp: round(sourcePx / 1e6, 2),
  });
  if (!upright) notes.unshift(`the page shows the picture ${best} (orientation ${ref.orientation ?? "none"}): similarity ${round(sim)} upright, ${round(bestSim)} ${best}`);
  if (aspect < 1) notes.push(`page ${size.width}x${size.height}, the picture is ${ref.uprightWidth}x${ref.uprightHeight}`);
  if (fidelity < 0.999 && upright) notes.push(`similarity ${round(sim)} to Pillow's picture (${ref.mode}${ref.frames && ref.frames > 1 ? `, ${ref.frames} frames` : ""})`);
  if (kept < 0.999) notes.push(`stored ${embedded?.w}x${embedded?.h} of ${ref.uprightWidth}x${ref.uprightHeight}`);
  if (ref.truncated) notes.push("the file is cut short; Pillow draws what it holds");
  const score = expectRefused ? 0 : mean([upright, aspect, fidelity, kept]);
  return { id: file.id, section: "b", score: round(score), metrics, ms: wrapMs + renderMs, notes, tag: ref.format };
}

// ── Peak memory, one file per process ───────────────────────────────────────

async function runOne(file: CorpusFile): Promise<Result | null> {
  const refPath = join(REFS, `${file.id}.json`);
  if (!existsSync(refPath)) return null;
  const bytes = new Uint8Array(readFileSync(join(FILES, file.id)));
  const ref = JSON.parse(readFileSync(refPath, "utf8"));
  return file.section === "a" ? scoreA(file, bytes, ref as PdfRef) : scoreB(file, bytes, ref as ImageRef);
}

if (child) {
  const file = corpus.files.find((f) => f.id === child)!;
  const before = process.resourceUsage().maxRSS;
  await runOne(file);
  process.stdout.write(JSON.stringify({ before, after: process.resourceUsage().maxRSS }));
  process.exit(0);
}

function peakMb(id: string): number {
  const out = execFileSync("npx", ["tsx", join(import.meta.dirname, "images.mts"), "--child", id], { encoding: "utf8", maxBuffer: 1 << 20 });
  const { before, after } = JSON.parse(out.slice(out.lastIndexOf("{"))) as { before: number; after: number };
  return Math.round((after - before) / 1024);
}

// ── Run ─────────────────────────────────────────────────────────────────────

if (!existsSync(FILES) || !existsSync(REFS)) {
  console.log("No files yet: run with --fetch first.");
  process.exit(1);
}

const pick = (f: CorpusFile) =>
  (!sectionOnly || f.section === sectionOnly) && (!only || only.includes(f.id)) && (!detail || detail === f.id) && existsSync(join(FILES, f.id));

const results: Result[] = [];
const missing: string[] = [];
for (const file of corpus.files.filter(pick)) {
  try {
    const r = await runOne(file);
    if (!r) {
      missing.push(file.id);
      continue;
    }
    if (flag("--mem")) r.metrics.peakMb = peakMb(file.id);
    results.push(r);
  } catch (err) {
    console.log(`  ${file.id}: the bench failed: ${err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" ") : err}`);
    results.push({ id: file.id, section: file.section, score: 0, metrics: { crashed: 1 }, ms: 0, notes: [`crashed: ${err}`] });
  }
}

if (detail) {
  for (const r of results) {
    console.log(`\n${r.id}  score ${fmt(r.score)}  ${r.ms.toFixed(0)} ms  ${r.tag ?? ""}`);
    console.log(`  ${Object.entries(r.metrics).map(([k, v]) => `${k} ${v}`).join("  ")}`);
    for (const n of r.notes) console.log(`  · ${n}`);
    if (r.section === "b") console.log(`  page image: ${join(OUT, `${r.id}.jpg`)}`);
  }
  process.exit(0);
}

const sections = ["a", "b"].filter((s) => results.some((r) => r.section === s));
const total: Record<string, number> = {};
for (const s of sections) total[s] = round(mean(results.filter((r) => r.section === s).map((r) => r.score)));
total.all = round(mean(sections.map((s) => total[s])));
const sum = (s: string, key: string) => results.filter((r) => r.section === s).reduce((t, r) => t + (r.metrics[key] ?? 0), 0);
const avgOf = (rs: Result[], key: string) => mean(rs.filter((r) => r.metrics[key] !== undefined).map((r) => r.metrics[key]));

for (const s of sections) {
  const rs = results.filter((r) => r.section === s);
  const ms = rs.reduce((t, r) => t + r.ms, 0);
  if (s === "a") {
    console.log(`\na. the judgment: ${rs.length} PDFs, score ${fmt(total.a)}, ${(ms / 1000).toFixed(1)} s in the code under test`);
    const labels: Label[] = ["article", "scan", "handwritten"];
    const n = (label: Label, f: (r: Result) => boolean) => rs.filter((r) => r.tag?.startsWith(label) && f(r)).length;
    console.log(`  with a right model: ${sum("a", "choice")}/${rs.length} right   keyless: ${sum("a", "keyless")}/${rs.length} right`);
    console.log(`  label        to the model  article, no call  keyless article  keyless pages`);
    for (const l of labels) {
      const keylessPages = n(l, (r) => (l === "article" ? r.metrics.keyless === 0 : r.metrics.keyless === 1));
      const ofLabel = n(l, () => true);
      console.log(
        `  ${l.padEnd(12)} ${String(n(l, (r) => r.metrics.toModel === 1)).padStart(12)}  ${String(n(l, (r) => r.metrics.toModel === 0)).padStart(16)}  ${String(ofLabel - keylessPages).padStart(15)}  ${String(keylessPages).padStart(13)}`,
      );
    }
    console.log(
      `  losses: articles taken for pages (keyless) ${sum("a", "articleAsPages")}   scans whose text is left unreadable ${sum("a", "unreadableScan")}   ` +
        `articles sent to the model ${sum("a", "needlessModel")}`,
    );
    console.log(`  what reaches the model: classifier samples ${fmt(avgOf(rs, "modelInput"))}   page images ${fmt(avgOf(rs, "pageImages"))}`);
  } else {
    const taken = rs.filter((r) => !r.metrics.notTaken);
    console.log(`\nb. images: ${rs.length} files, score ${fmt(total.b)}, ${(ms / 1000).toFixed(1)} s in the code under test`);
    console.log(
      `  refused that should import ${sum("b", "wrongRefusal")}   crashed ${sum("b", "crashed")}   not upright ${taken.filter((r) => r.metrics.upright === 0).length}   ` +
        `aspect off ${taken.filter((r) => (r.metrics.aspect ?? 1) < 1).length}   fidelity ${fmt(avgOf(taken, "fidelity"))}   pixels kept ${fmt(avgOf(taken, "kept"))}`,
    );
    console.log(`  formats not taken (refused cleanly): ${rs.filter((r) => r.metrics.notTaken).map((r) => r.id).join(", ") || "none"}`);
    const slow = [...rs].sort((x, y) => y.ms - x.ms).slice(0, 3);
    console.log(`  slowest: ${slow.map((r) => `${r.id} ${r.ms.toFixed(0)} ms${r.metrics.peakMb !== undefined ? ` ${r.metrics.peakMb} MB` : ""}`).join(", ")}`);
  }
  for (const r of [...rs].sort((x, y) => x.score - y.score).slice(0, worst)) {
    if (r.score >= 0.9995) break;
    console.log(`  ${fmt(r.score)}  ${r.id.padEnd(26)} ${r.notes[0]?.slice(0, 120) ?? ""}`);
  }
}
console.log(`\nTotal ${fmt(total.all)}  (${sections.map((s) => `${s} ${fmt(total[s])}`).join(", ")})  ${results.length} results`);
if (missing.length > 0) console.log(`No reference for: ${missing.join(", ")}`);

const jsonOut = value("--json");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));

type Baseline = { total: Record<string, number>; files: Record<string, number> };
if (flag("--save-baseline")) {
  const prior: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { total: {}, files: {} };
  for (const r of results) prior.files[r.id] = round(r.score);
  if (!only && !sectionOnly) prior.total = total;
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${results.length} results to ${BASELINE}`);
}
if (flag("--baseline") && existsSync(BASELINE)) {
  const base: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const drops = results.filter((r) => base.files[r.id] !== undefined && r.score < base.files[r.id] - 0.01);
  const rises = results.filter((r) => base.files[r.id] !== undefined && r.score > base.files[r.id] + 0.01);
  console.log(`\nAgainst the baseline (total ${base.total.all !== undefined ? fmt(base.total.all) : "?"}): ${rises.length} rose, ${drops.length} dropped`);
  for (const r of rises) console.log(`  rose    ${r.id.padEnd(26)} ${fmt(base.files[r.id])} → ${fmt(r.score)}`);
  for (const r of drops) console.log(`  dropped ${r.id.padEnd(26)} ${fmt(base.files[r.id])} → ${fmt(r.score)}`);
  if (drops.length > 0) process.exitCode = 1;
}
