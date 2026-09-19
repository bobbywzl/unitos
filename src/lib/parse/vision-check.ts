import type { ModelMessage } from "ai";
import type { Page } from "playwright-core";
import { z } from "zod";
import { browserConfigured, launchBrowser, sessionLengthOf, withTimeout } from "@/lib/browser";
import { VISION_CHECK_EFFORT, VISION_CHECK_MODEL, VISION_CHECK_TILES } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { serverT } from "@/lib/i18n/server";
import { hasMedia, isFigureCaption } from "@/lib/parse/figure-audit";
import { applyLayoutOps, type LayoutOp } from "@/lib/parse/layout";
import { parseCall, parseConfigured } from "@/lib/parse/model";
import type { ParsedBlock } from "@/lib/parse/types";
import type { UsageMeta } from "@/lib/usage";

// The vision check (SPEC.md §2, §15): the last pass of a URL import. The
// passes before it read the page's HTML and never see the page; this one
// looks. In a browser the page is photographed as a reader scrolls it, one
// picture per screen, and the parsed blocks are drawn the way the reader
// draws them and photographed the same way. The vision model reads both
// sets side by side with the block listing and answers with ops in the
// layout pass's discipline — by block index, never writing text: figures
// that sit side by side on the page become a figure row, a row the page
// stacks comes apart, a figure that appears nowhere on the page goes, and a
// text block that is a figure's caption or label on the page joins the
// figure. On any failure, or past its time budget, the blocks stand.
//
// It runs when a browser is configured, the vision model has its key, and
// the blocks hold a figure: a page of text alone has little the pictures
// would add. One browser session for both sets of pictures.

export type VisionCheckReport = {
  // The check ran to the model.
  ran: boolean;
  // How many ops the model returned, and how many applied.
  ops: number;
  applied: number;
  // Why it did not run or did not finish; null when it did.
  error: string | null;
};

const NOT_RUN: VisionCheckReport = { ran: false, ops: 0, applied: 0, error: null };

const VIEWPORT = { width: 1280, height: 900 };
const NAVIGATION_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 10_000;
const STEP_TIMEOUT_MS = 15_000;
// A short wait after each scroll, for the pictures that load on scroll.
const SCROLL_WAIT_MS = 250;
const SETTLE_MS = 400;
const JPEG_QUALITY = 60;
// The whole check — both sets of pictures and the model — gets this long at
// most; less when the import's budget has less to give.
const CHECK_BUDGET_MS = 120_000;
const CHECK_MIN_MS = 45_000;
const SESSION_MARGIN_MS = 6_000;
const MAX_LISTED_BLOCKS = 500;
const LISTING_CHARS = 80;
// A page is a page: the model never drops more of its figures than this.
const DROP_CEILING = 0.34;

// ── The ops ─────────────────────────────────────────────────────────────────

const index = z.number().int().min(0);
const opSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("figure_row"), indexes: z.array(index).min(2).max(12) }),
  z.object({ action: z.literal("unrow"), index }),
  z.object({ action: z.literal("drop"), index }),
  z.object({ action: z.literal("caption"), index, figure: index }),
]);
const visionSchema = z.object({ ops: z.array(opSchema).max(200) });
type VisionOp = z.infer<typeof opSchema>;

// ── The pictures ────────────────────────────────────────────────────────────

type Tile = Uint8Array;

/** The page from the top, one picture per screen, as far as the tile cap
    allows. The page is scrolled through first so what loads on scroll is
    there, and a sticky header repeats in every tile as it would for a
    reader. */
async function tiles(page: Page, cap: number): Promise<Tile[]> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const count = Math.max(1, Math.min(cap, Math.ceil(height / VIEWPORT.height)));
  const out: Tile[] = [];
  for (let i = 0; i < count; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * VIEWPORT.height);
    await page.waitForTimeout(SCROLL_WAIT_MS);
    out.push(await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY }));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return out;
}

async function scrollThrough(page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    const atBottom = await page.evaluate(() => {
      const before = window.scrollY;
      window.scrollBy(0, window.innerHeight);
      return window.scrollY === before;
    });
    if (atBottom) break;
    await page.waitForTimeout(SCROLL_WAIT_MS);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(SETTLE_MS);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function classTokens(html: string | undefined): string {
  const m = /class="([^"]*)"/.exec(html ?? "");
  return m ? m[1] : "";
}

function headingLevel(html: string | undefined): number {
  const m = /^\s*<h([1-6])/i.exec(html ?? "");
  return m ? Number(m[1]) : 2;
}

// The reader's own rules for what the pictures show (globals.css): the text
// column at the document's width, a figure as one <figure> whose children
// lay out as a wrapping row, a figure row's columns side by side at their
// widths, the layout roles at their sizes.
const PROOF_CSS = `
  html { background: #faf7f2; }
  body { margin: 0; padding: 48px 24px 96px; color: #1f1d1a; font: 18px/1.6 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  body[data-font="serif"] { font-family: Georgia, "Times New Roman", serif; }
  body[data-font="mono"] { font-family: ui-monospace, Menlo, monospace; }
  main { margin: 0 auto; }
  h1 { font-size: 34px; line-height: 1.2; margin: 0 0 20px; }
  h2 { font-size: 26px; line-height: 1.25; margin: 32px 0 12px; }
  h3 { font-size: 21px; margin: 24px 0 8px; }
  h4, h5, h6 { font-size: 18px; margin: 20px 0 6px; }
  p, li { margin: 0 0 14px; }
  ul, ol { padding-left: 28px; margin: 0 0 14px; }
  pre { background: #f0ebe3; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 14px; }
  hr { border: 0; border-top: 1px solid #d8d1c6; margin: 28px 0; }
  .center { text-align: center; }
  .right { text-align: right; }
  .kicker { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #6b655c; }
  .meta { font-size: 14px; color: #6b655c; }
  .label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; font-weight: 600; color: #6b655c; }
  .display { font-size: 28px; line-height: 1.3; font-weight: 600; }
  .quote { border-left: 3px solid #d8d1c6; padding-left: 16px; color: #4b463f; font-style: italic; }
  .caption { font-size: 14px; color: #6b655c; }
  .reader-figure { margin: 24px 0; }
  .reader-figure > figure { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: center; column-gap: 2%; row-gap: 8px; margin: 0; }
  .reader-figure > figure > p, .reader-figure > figure > figcaption { flex-basis: 100%; font-size: 14px; color: #6b655c; text-align: center; margin: 0; }
  .reader-figure > figure:has(> figure) { column-gap: 0; }
  .reader-figure figure figure { display: flex; flex-direction: column; align-items: center; min-width: 0; margin: 0; padding: 0 1%; box-sizing: border-box; }
  .reader-figure figure figure > img, .reader-figure figure figure > svg, .reader-figure figure figure > video, .reader-figure figure figure > p, .reader-figure figure figure > figcaption { width: 100%; }
  .reader-figure img, .reader-figure video, .reader-figure svg, .reader-figure iframe { max-width: 100%; height: auto; }
  .reader-table table { border-collapse: collapse; width: 100%; font-size: 15px; }
  .reader-table td, .reader-table th { border: 1px solid #d8d1c6; padding: 6px 10px; vertical-align: top; text-align: left; }
`;

/** The blocks as the reader draws them: one page, the reader's rules. */
export function proofHtml(blocks: ParsedBlock[], options: { title?: string | null; columnWidth?: number; font?: string | null } = {}): string {
  const width = Math.min(960, Math.max(480, options.columnWidth ?? 760));
  const body = blocks
    .map((block) => {
      const tokens = classTokens(block.html);
      const attr = tokens ? ` class="${escapeHtml(tokens)}"` : "";
      switch (block.type) {
        case "HEADING":
          return `<h${headingLevel(block.html)}${attr}>${escapeHtml(block.text)}</h${headingLevel(block.html)}>`;
        case "LIST": {
          const ordered = /^\s*\d{1,3}[.)]\s/.test(block.text);
          const items = block.text
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => `<li>${escapeHtml(line.replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, ""))}</li>`)
            .join("");
          return `<${ordered ? "ol" : "ul"}${attr}>${items}</${ordered ? "ol" : "ul"}>`;
        }
        case "CODE":
          return `<pre>${escapeHtml(block.text)}</pre>`;
        case "SEPARATOR":
          return "<hr>";
        case "FIGURE":
          return `<div class="reader-figure">${block.html ?? `<figure><p>${escapeHtml(block.text)}</p></figure>`}</div>`;
        case "TABLE":
          return `<div class="reader-table">${block.html ?? `<pre>${escapeHtml(block.text)}</pre>`}</div>`;
        default:
          return `<p${attr}>${escapeHtml(block.text)}</p>`;
      }
    })
    .join("\n");
  const title = options.title ? `<h1>${escapeHtml(options.title)}</h1>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PROOF_CSS}</style></head><body${options.font ? ` data-font="${escapeHtml(options.font)}"` : ""}><main style="max-width:${width}px">${title}${body}</main></body></html>`;
}

/** Both sets of pictures from one browser session: the page, then the
    reader's rendering of the blocks. */
export async function pictureBoth(input: {
  url: string;
  proof: string;
  deadline: number;
  onProgress?: (detail: string) => void;
}): Promise<{ page: Tile[]; reader: Tile[] }> {
  const t = await serverT();
  const browser = await launchBrowser("parse");
  const sessionMs = sessionLengthOf(browser);
  const sessionEnd = sessionMs === null ? Infinity : Date.now() + sessionMs - SESSION_MARGIN_MS;
  const deadline = Math.min(input.deadline, sessionEnd);
  const left = () => deadline - Date.now();
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: VIEWPORT, deviceScaleFactor: 1 });
    try {
      // The pictures need the page's images and fonts; media never plays.
      await context.route("**/*", (route) =>
        route.request().resourceType() === "media" ? route.abort() : route.continue(),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      input.onProgress?.(t("api.checkingPagePictures"));
      await withTimeout(
        (async () => {
          await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
          await page.waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS }).catch(() => {});
          await scrollThrough(page, VISION_CHECK_TILES * 2);
        })(),
        Math.max(1_000, left() / 2),
        "the page took too long to picture",
      );
      const pageTiles = await tiles(page, VISION_CHECK_TILES);
      input.onProgress?.(t("api.checkingReaderPictures"));
      await withTimeout(
        (async () => {
          await page.setContent(input.proof, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS }).catch(() => {});
          await scrollThrough(page, VISION_CHECK_TILES * 2);
        })(),
        Math.max(1_000, left()),
        "the reader's rendering took too long to picture",
      );
      const readerTiles = await tiles(page, VISION_CHECK_TILES);
      return { page: pageTiles, reader: readerTiles };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── The prompt ──────────────────────────────────────────────────────────────

function listBlocks(blocks: ParsedBlock[]): string {
  return blocks
    .slice(0, MAX_LISTED_BLOCKS)
    .map((b, i) => {
      const text = b.text.replace(/\s+/g, " ").trim();
      const short = text.length > LISTING_CHARS ? `${text.slice(0, LISTING_CHARS - 1)}…` : text;
      const columns = b.type === "FIGURE" ? (b.html?.match(/<figure\b/gi)?.length ?? 1) - 1 : 0;
      const kind = b.type === "FIGURE" ? (columns >= 2 ? `FIGURE ROW (${columns} columns)` : "FIGURE") : b.type;
      return `[${i}] ${kind}: ${short}`;
    })
    .join("\n");
}

function prompt(title: string | null, blocks: ParsedBlock[], pages: number, readers: number): string {
  return [
    `A web page${title ? ` titled "${title}"` : ""} was parsed into the numbered blocks below, and the reader draws those blocks in order. Two sets of pictures follow: PAGE pictures 1 to ${pages}, the page as a browser shows it, top to bottom, one per screen; and READER pictures 1 to ${readers}, the blocks as the reader draws them, top to bottom, one per screen.`,
    "Compare the READER pictures with the PAGE pictures and return ops that make the reader match the page. Ops reference blocks by index. Never write, rewrite, or shorten text.",
    "1. figure_row: consecutive FIGURE blocks (with the caption blocks between them) that sit side by side in one row on the page, and that the reader stacks. Consecutive indexes only.",
    "2. unrow: a FIGURE ROW the reader draws side by side whose figures the page stacks one under another.",
    "3. drop: a FIGURE the reader shows that appears nowhere in the PAGE pictures — a picture from a sidebar, a related-posts strip, an advertisement, a logo. Only when you can see every PAGE picture and the figure is in none of them. Never a figure the page shows.",
    "4. caption: a text block that on the page is the caption or the label of a figure — set under it, over it, or inside its box — and that the reader shows as a separate paragraph. index is the text block, figure is the FIGURE block it belongs to.",
    "5. Leave what already matches alone. When unsure, leave it. An empty ops array is a valid answer.",
    'Return ONLY JSON: {"ops": [{"action": "figure_row", "indexes": [12, 13, 14]}, {"action": "unrow", "index": 30}, {"action": "drop", "index": 41}, {"action": "caption", "index": 20, "figure": 19}]}',
    "",
    "Blocks:",
    listBlocks(blocks),
  ].join("\n");
}

function pictureParts(label: string, set: Tile[]) {
  return set.flatMap((tile, i) => [
    { type: "text" as const, text: `${label} picture ${i + 1} of ${set.length}:` },
    { type: "file" as const, data: tile, mediaType: "image/jpeg" },
  ]);
}

// ── Applying the ops ────────────────────────────────────────────────────────

function figureInner(html: string | undefined): string {
  const m = /^\s*<figure\b[^>]*>([\s\S]*)<\/figure>\s*$/i.exec(html ?? "");
  return m ? m[1] : (html ?? "");
}

/** A figure row's columns as figures of their own again (the row the
    layout pass built: one nested figure per column, its caption a centered
    paragraph at its end). Null when the block is not a row. */
function unrow(block: ParsedBlock): ParsedBlock[] | null {
  const inner = figureInner(block.html);
  const columns = [...inner.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)];
  if (columns.length < 2) return null;
  return columns.map((m) => {
    let body = m[1];
    let caption: string | null = null;
    const cap = /<p class="center">([\s\S]*?)<\/p>\s*$/i.exec(body);
    if (cap) {
      caption = cap[1].replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
      body = body.slice(0, cap.index);
    }
    const figure: ParsedBlock = { type: "FIGURE", text: caption ?? "Figure", html: `<figure>${body}</figure>` };
    return figure;
  });
}

/** The caption text joins its figure: under the media, as the layout pass
    writes a column's caption; the figure's text is the caption. */
function captioned(figure: ParsedBlock, caption: ParsedBlock): ParsedBlock {
  const inner = figureInner(figure.html);
  // A label the figure already carries stays; the caption goes under it.
  const already = figure.text.trim() !== "" && figure.text !== "Figure";
  const text = already ? `${figure.text}\n${caption.text}` : caption.text;
  const next: ParsedBlock = { ...figure, text, html: `<figure>${inner}<p class="center">${escapeHtml(caption.text)}</p></figure>` };
  delete next.styles;
  delete next.links;
  delete next.citations;
  return next;
}

/** Apply the model's ops. The rows first, through the layout pass's own
    application; then, on the rows' result, the ops that change the count.
    Ops that break the rules are skipped one by one. */
export function applyVisionOps(blocks: ParsedBlock[], ops: VisionOp[]): { blocks: ParsedBlock[]; applied: number } {
  const listed = Math.min(blocks.length, MAX_LISTED_BLOCKS);
  const inRange = (i: number) => i >= 0 && i < listed;
  const captionText = (b: ParsedBlock) => b.type === "PARAGRAPH" && b.text.length <= 300;

  // Rows: validated here as the layout pass validates them, so the index
  // map below matches what it applies.
  const rows: number[][] = [];
  const inRow = new Set<number>();
  for (const op of ops) {
    if (op.action !== "figure_row") continue;
    const indexes = [...new Set(op.indexes)].sort((a, b) => a - b);
    if (!indexes.every(inRange) || indexes.some((i) => inRow.has(i))) continue;
    if (!indexes.every((n, i) => i === 0 || n === indexes[i - 1] + 1)) continue;
    const members = indexes.map((i) => blocks[i]);
    const figures = members.filter((b) => b.type === "FIGURE").length;
    if (figures < 2 || !members.every((b) => b.type === "FIGURE" || (captionText(b) && isFigureCaption(b.text)))) continue;
    rows.push(indexes);
    for (const i of indexes) inRow.add(i);
  }
  const rowOps: LayoutOp[] = rows.map((indexes) => ({ action: "figure_row", indexes }));
  const rowed = rowOps.length > 0 ? applyLayoutOps(blocks, { ops: rowOps }) : { blocks, applied: 0 };
  let applied = rowed.applied;
  // Original index → index after the rows; a row's members map to the row.
  const after = new Map<number, number>();
  let next = 0;
  for (let i = 0; i < blocks.length; i++) {
    const row = rows.find((r) => r.includes(i));
    if (row && row[0] !== i) {
      after.set(i, after.get(row[0]) ?? next - 1);
      continue;
    }
    after.set(i, next);
    next += 1;
  }
  const laid = rowed.blocks;

  // Drops: figures the page does not show, under a ceiling; never a block
  // in a row just built.
  const drops = new Set<number>();
  for (const op of ops) {
    if (op.action !== "drop" || !inRange(op.index) || inRow.has(op.index)) continue;
    const at = after.get(op.index);
    if (at !== undefined && laid[at]?.type === "FIGURE") drops.add(at);
  }
  const figures = laid.filter((b) => hasMedia(b)).length;
  if (drops.size > Math.max(1, figures) * DROP_CEILING) {
    console.warn(`[ingest] vision check wanted ${drops.size}/${figures} figure drops, drops ignored`);
    drops.clear();
  }
  // Captions: the text joins its figure; the text block goes.
  const captions = new Map<number, number>(); // figure → caption
  const captionBlocks = new Set<number>();
  for (const op of ops) {
    if (op.action !== "caption" || !inRange(op.index) || !inRange(op.figure)) continue;
    const text = after.get(op.index);
    const figure = after.get(op.figure);
    if (text === undefined || figure === undefined || text === figure) continue;
    if (drops.has(figure) || captions.has(figure) || captionBlocks.has(text) || inRow.has(op.index)) continue;
    if (laid[figure]?.type !== "FIGURE" || !captionText(laid[text]) || Math.abs(text - figure) > 2) continue;
    captions.set(figure, text);
    captionBlocks.add(text);
  }
  // Unrows: a row the page stacks comes apart.
  const unrows = new Set<number>();
  for (const op of ops) {
    if (op.action !== "unrow" || !inRange(op.index) || inRow.has(op.index)) continue;
    const at = after.get(op.index);
    if (at !== undefined && !drops.has(at) && !captions.has(at)) unrows.add(at);
  }

  const out: ParsedBlock[] = [];
  for (let i = 0; i < laid.length; i++) {
    if (drops.has(i) || captionBlocks.has(i)) {
      applied += 1;
      continue;
    }
    const block = laid[i];
    if (unrows.has(i)) {
      const parts = unrow(block);
      if (parts) {
        out.push(...parts);
        applied += 1;
        continue;
      }
    }
    const caption = captions.get(i);
    if (caption !== undefined) {
      out.push(captioned(block, laid[caption]));
      applied += 1;
      continue;
    }
    out.push(block);
  }
  return { blocks: out.length > 0 ? out : blocks, applied };
}

// ── The check ───────────────────────────────────────────────────────────────

/** Whether the check has what it needs: a browser, the vision model's key,
    and a figure to look at. */
export function visionCheckPossible(blocks: ParsedBlock[]): boolean {
  if (process.env.VISION_CHECK === "off") return false;
  const choice = { id: VISION_CHECK_MODEL, effort: VISION_CHECK_EFFORT };
  return browserConfigured() && parseConfigured(choice) && blocks.some((b) => hasMedia(b));
}

/** Check the blocks against the page as pictures and fix what the pictures
    show. The blocks come back unchanged when the check cannot run, and with
    the report of why. */
export async function visionCheck(input: {
  url: string;
  blocks: ParsedBlock[];
  title: string | null;
  columnWidth?: number;
  font?: string | null;
  // The import's time budget: the check takes what is left, up to its own
  // cap, and skips when too little is left.
  deadline?: number;
  onProgress?: (detail: string) => void;
}): Promise<{ blocks: ParsedBlock[]; report: VisionCheckReport }> {
  const { blocks } = input;
  if (!visionCheckPossible(blocks)) return { blocks, report: NOT_RUN };
  const remaining = input.deadline === undefined ? CHECK_BUDGET_MS : input.deadline - Date.now();
  if (remaining < CHECK_MIN_MS) {
    console.warn("[ingest] vision check skipped: the time budget is spent");
    return { blocks, report: { ...NOT_RUN, error: "the time budget is spent" } };
  }
  const deadline = Date.now() + Math.min(CHECK_BUDGET_MS, remaining);
  try {
    const proof = proofHtml(blocks, { title: input.title, columnWidth: input.columnWidth, font: input.font });
    const pictures = await pictureBoth({ url: input.url, proof, deadline, onProgress: input.onProgress });
    const modelMs = deadline - Date.now();
    if (modelMs < 10_000) throw new Error("the pictures used up the time budget");
    const t = await serverT();
    input.onProgress?.(t("api.checkingComparing"));
    const listed = blocks.slice(0, MAX_LISTED_BLOCKS);
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt(input.title, listed, pictures.page.length, pictures.reader.length) },
          ...pictureParts("PAGE", pictures.page),
          ...pictureParts("READER", pictures.reader),
        ],
      },
    ];
    const choice = { id: VISION_CHECK_MODEL, effort: VISION_CHECK_EFFORT };
    const { model, providerOptions, modelId } = await parseCall(choice);
    const result = await callForJson({
      model,
      messages,
      maxOutputTokens: 8192,
      providerOptions,
      schema: visionSchema,
      label: "INGEST_VISION_CHECK",
      usage: { userId: null, feature: "parse", model: modelId } satisfies UsageMeta,
      abortSignal: AbortSignal.timeout(modelMs),
    });
    if (!result.ok) {
      console.warn(`[ingest] vision check failed, keeping blocks as they are: ${result.error}`);
      return { blocks, report: { ran: true, ops: 0, applied: 0, error: result.error } };
    }
    const { blocks: checked, applied } = applyVisionOps(blocks, result.data.ops);
    console.log(`[ingest] vision check: ${applied} of ${result.data.ops.length} ops applied`);
    return { blocks: checked, report: { ran: true, ops: result.data.ops.length, applied, error: null } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[ingest] vision check failed, keeping blocks as they are: ${message}`);
    return { blocks, report: { ran: false, ops: 0, applied: 0, error: message.split("\n")[0].slice(0, 200) } };
  }
}
