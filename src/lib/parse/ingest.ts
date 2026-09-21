import { createHash } from "node:crypto";
import { Prisma, type Document } from "@prisma/client";
import { db } from "@/lib/db";
import { classifyPdf } from "@/lib/handwritten/classify";
import { storePageSizes } from "@/lib/handwritten/page-images";
import { pageBlockText, pdfPageCount } from "@/lib/handwritten/pages";
import { parsePdf } from "@/lib/parse/pdf";
import { auditFiguresWithJev } from "@/lib/parse/figure-audit";
import { wallOf } from "@/lib/parse/page-kind";
import { restoreFigures } from "@/lib/parse/figures";
import { layoutBlocks } from "@/lib/parse/layout";
import type { ParseModel } from "@/lib/parse/model";
import { pruneReferences } from "@/lib/parse/references";
import { browserConfigured } from "@/lib/browser";
import { needsBrowserRender, renderIfNeeded, type RenderReport } from "@/lib/parse/render-page";
import { visionCheck, visionCheckPossible, type VisionCheckReport } from "@/lib/parse/vision-check";
import { splitBlocks, splitPartCount } from "@/lib/parse/split";
import { selectCoreBlocks, structureBlocks } from "@/lib/parse/structure";
import { fetchPage, FetchPageError, hostOf, type FetchedPage } from "@/lib/parse/fetch-page";
import { parseFetchedPage, parseHtmlContent, resolveContentsLinks } from "@/lib/parse/url";
import {
  PARSER_VERSION,
  type DocumentReference,
  type MediaCheck,
  type ParsedBlock,
  type ParsedDocument,
} from "@/lib/parse/types";
import { parseMarkdownDocument } from "@/lib/parse/markdown-document";
import { sniffOfficeFile } from "@/lib/parse/office";
// The routes load this module per request (see /api/documents), so the
// sniff that decides a file's parser rides with it: jsdom must not load
// with a route module.
export { isZipBytes, sniffOfficeFile } from "@/lib/parse/office";
import { parseSlides, type SlideImageStore } from "@/lib/parse/slides";
import { parseDelimited, parseSheets, type Delimiter } from "@/lib/parse/sheets";
import {
  restoreSlidePictures,
  slidePicturesByPage,
  storeSlidePictureSizes,
} from "@/lib/handwritten/page-images";

// Ingest progress, reported to the caller as each stage starts. A repeated stage
// updates the detail line ("148 figures · 152 equations"). Dedupe hits report
// nothing — there is no parse or save to do, the caller treats "no events" as instant.
// PDF stages: parse, save. URL stages: fetch, extract, select, structure, layout, save.
// The upload assistant's review streams fetch, extract, review.
export type IngestStage =
  | "parse"
  | "save"
  | "fetch"
  | "extract"
  | "select"
  | "structure"
  | "layout"
  | "check"
  | "review";
export type OnIngestProgress = (stage: IngestStage, detail?: string) => void;

// The choices from the upload assistant (SPEC.md §15). pages and convert are
// the PDF directives the box's import pick sets (SPEC.md §16): pages imports
// the PDF as handwritten pages without judging it; convert false keeps
// conversion off — the pages stay as they are. The import is faithful: no
// option steers what the parse keeps or drops.
export type IngestOptions = {
  split?: boolean;
  pages?: boolean;
  convert?: boolean;
  // A PDF fetched from a link keeps the link, so adding the URL again dedupes.
  sourceUrl?: string;
  // When the model passes must be done, epoch ms (modelPassDeadline): a pass
  // that cannot finish in time aborts or is skipped, and the mechanical parse
  // stands (SPEC.md §2). Absent: no budget.
  deadline?: number;
};

// The time the model passes may use in one request: the route's limit less
// the fetch, the parse, the save, and a margin. Epoch ms.
export function modelPassDeadline(maxDurationSeconds: number): number {
  return Date.now() + Math.max(30, maxDurationSeconds - 45) * 1000;
}

// A pass needs at least this long to answer; with less left it is skipped.
const PASS_MIN_MS = 20_000;

// A pass's abort signal against the deadline: undefined without a budget,
// null when the budget is spent (skip the pass), else a signal that aborts
// the call at the deadline.
export function modelPassSignal(deadline: number | undefined): AbortSignal | null | undefined {
  if (deadline === undefined) return undefined;
  const remaining = deadline - Date.now();
  if (remaining < PASS_MIN_MS) return null;
  return AbortSignal.timeout(remaining);
}

// A split part's sourceUrl carries this marker plus its part number, so parts
// stay distinct for dedupe and never re-parse (a re-parse would paste the whole
// page over one part).
export const SPLIT_URL_MARKER = "#unitos-part-";

// URL blocks pass through two model passes (SPEC.md §2): the core pass
// separates the article from page chrome, then the layout pass reads the
// page's HTML beside what survives and lays it out as the page does — the
// structure pass's work (drop, retype, merge) included. Without the page's
// html the structure pass runs alone. Each pass gets the request's time
// budget: past it a pass is skipped and the blocks stand. References prune
// afterwards: a link reference whose citing blocks were dropped was chrome,
// not a citation.
/** The model passes over a URL's mechanical blocks (SPEC.md §2): the core
    pass, then the layout pass on the page's html (the structure pass
    without it), then the figures the passes dropped between survivors
    restored. choice: the model to run on, the parse model by default
    (scripts/parse-compare.ts runs two). */
export async function refineUrlBlocks(
  parsed: ParsedDocument,
  onProgress: OnIngestProgress | undefined,
  opts: { deadline?: number; pageHtml: string | null; url: string; choice?: ParseModel },
) {
  const { deadline, pageHtml, url, choice } = opts;
  let blocks = parsed.blocks;
  let font: ParsedDocument["font"] | undefined;
  onProgress?.("select");
  const coreSignal = modelPassSignal(deadline);
  if (coreSignal === null) console.warn("[ingest] core pass skipped: the time budget is spent");
  else blocks = await selectCoreBlocks(blocks, parsed.title, coreSignal, choice);
  onProgress?.("structure");
  const signal = modelPassSignal(deadline);
  if (signal === null) console.warn("[ingest] layout pass skipped: the time budget is spent");
  else if (pageHtml) {
    onProgress?.("layout");
    const laid = await layoutBlocks({ blocks, title: parsed.title, pageHtml, url, signal, choice });
    blocks = laid.blocks;
    font = laid.font;
  } else blocks = await structureBlocks(blocks, parsed.title, signal, choice);
  // The passes reference blocks by index: a figure dropped between two
  // blocks that survived is restored (lib/parse/figures.ts restoreFigures).
  blocks = restoreFigures(parsed.blocks, blocks);
  // The vision check (lib/parse/vision-check.ts): the page and the reader's
  // rendering of the blocks, pictured in a browser and compared by the
  // vision model. Where it cannot run, the blocks stand and the report says why.
  let check: VisionCheckReport | null = null;
  if (pageHtml && visionCheckPossible(blocks)) {
    onProgress?.("check");
    const checked = await visionCheck({
      url,
      blocks,
      title: parsed.title,
      columnWidth: parsed.columnWidth,
      font: parsed.font ?? font ?? null,
      deadline,
      onProgress: (detail) => onProgress?.("check", detail),
    });
    blocks = checked.blocks;
    check = checked.report;
  }
  const references = pruneReferences(
    blocks,
    parsed.references ?? [],
    parsed.formalReferences ?? 0,
  );
  return { blocks, references, font, check };
}

// The final figure check, reported with the save stage so the upload
// assistant and the document bar can show it: how many figures, the captions
// whose figure the parse did not load, whether the page draws figures with
// scripts that no configured browser could render, why a browser render
// that ran did not deliver (the reasons a caption stands alone;
// lib/parse/render-page.ts), and the media check (SPEC.md §15): how many
// images, videos, and charts the page's content holds and the names of
// those no block carries.
async function saveDetail(
  blocks: ParsedBlock[],
  scriptedFigures = false,
  render: RenderReport | null = null,
  media: MediaCheck | undefined = undefined,
  check: VisionCheckReport | null = null,
  title: string | null = null,
): Promise<string> {
  const audit = await auditFiguresWithJev(blocks, title);
  return JSON.stringify({
    figures: audit.figures,
    captionsWithoutFigure: audit.captionsWithoutFigure,
    scriptedFigures,
    renderError: render?.error ?? null,
    ...(media ? { media: media.onPage, mediaLost: media.lost } : {}),
    ...(check ? { visionCheck: check } : {}),
  });
}

// The render's state as the document stores it: when a browser render last
// ran for the document, and why it did not deliver. No render: both null,
// so the reader tries one on open once a browser is configured.
function renderColumns(render: RenderReport | null) {
  return {
    figureRenderAt: render?.attempted ? new Date() : null,
    figureRenderError: render?.attempted ? render.error : null,
  };
}

/** Does the page draw figures with scripts that this deployment cannot
    render: scripted charts in the static page and no browser configured. */
function unrenderedScripts(fetched: FetchedPage): boolean {
  return fetched.kind === "html" && !browserConfigured() && needsBrowserRender(fetched.html);
}

// Each split part keeps only the references its own blocks cite.
function referencesForPart(
  blocks: ParsedBlock[],
  references: DocumentReference[],
): DocumentReference[] | undefined {
  const cited = new Set(blocks.flatMap((b) => (b.citations ?? []).map((c) => c.refId)));
  const kept = references.filter((r) => cited.has(r.id));
  return kept.length > 0 ? kept : undefined;
}

// Contents links resolve here, after every pass that drops or merges blocks:
// each entry's targetOrder is the order of its heading, and the in-memory
// fragments never reach the database.
async function createDocumentWithBlocks(data: {
  title: string;
  sourceUrl?: string;
  fileHash?: string;
  fileData?: Uint8Array<ArrayBuffer>;
  blocks: ParsedBlock[];
  references?: DocumentReference[];
  font?: ParsedDocument["font"];
  columnWidth?: number;
  render?: RenderReport | null;
  // Slides and sheets (SPEC.md §27): the stored file's format.
  format?: ParsedDocument["format"];
}) {
  const blocks = resolveContentsLinks(data.blocks);
  return db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title: data.title,
        sourceUrl: data.sourceUrl,
        fileHash: data.fileHash,
        fileData: data.fileData,
        parserVersion: PARSER_VERSION,
        references: data.references,
        font: data.font,
        columnWidth: data.columnWidth,
        format: data.format,
        ...renderColumns(data.render ?? null),
      },
    });
    await tx.block.createMany({
      data: blocks.map((b, i) => ({
        documentId: document.id,
        order: i,
        type: b.type,
        text: b.text,
        html: b.html,
        page: b.page,
        region: b.region,
        citations: b.citations,
        styles: b.styles,
        links: b.links,
      })),
    });
    await claimCapturedImages(tx, document.id, blocks);
    return document;
  });
}

// An image the parse stored itself (a captured chart animation,
// lib/parse/render-page.ts; a slide's picture, lib/parse/slides.ts)
// belongs to the document whose block carries it — as an <img src> or as
// a CSS background url(): it goes with the document, and a re-parse
// replaces it.
const OWN_IMAGE_SRC_RX = /(?:\ssrc="|url\()\/api\/images\/([A-Za-z0-9_-]+)/g;

function capturedImageIds(blocks: { html?: string | null }[]): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    for (const match of (block.html ?? "").matchAll(OWN_IMAGE_SRC_RX)) ids.add(match[1]);
  }
  return [...ids];
}

async function claimCapturedImages(
  tx: Pick<typeof db, "imageAsset">,
  documentId: string,
  blocks: { html?: string | null }[],
) {
  const ids = capturedImageIds(blocks);
  if (ids.length === 0) return;
  await tx.imageAsset.updateMany({ where: { id: { in: ids }, documentId: null }, data: { documentId } });
}

// A handwritten document: no text blocks — one PAGE block per PDF page, the
// bytes kept for the page image route, Circle & ask, and conversion (SPEC.md §16).
async function createHandwrittenDocument(data: {
  title: string;
  sourceUrl?: string;
  fileHash: string;
  fileData: Uint8Array<ArrayBuffer>;
  pageCount: number;
  convert: boolean;
}) {
  return db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title: data.title,
        sourceUrl: data.sourceUrl,
        fileHash: data.fileHash,
        fileData: data.fileData,
        parserVersion: PARSER_VERSION,
        handwritten: true,
        // OFF records the reader's "do not convert": nothing auto-starts, the
        // strip offers Convert to text (SPEC.md §16).
        conversionStatus: data.convert ? "NONE" : "OFF",
      },
    });
    await tx.block.createMany({ data: pageBlockRows(document.id, data.pageCount) });
    return document;
  });
}

// The page sizes are the reader's layout (SPEC.md §16); a failure here
// leaves the pages sizeless, never the document unsaved.
async function storePageSizesQuietly(documentId: string, bytes: Uint8Array): Promise<void> {
  try {
    await storePageSizes(documentId, bytes);
  } catch (err) {
    console.warn("[handwritten] page sizes failed:", err);
  }
}

function pageBlockRows(documentId: string, pageCount: number) {
  return Array.from({ length: pageCount }, (_, i) => ({
    documentId,
    order: i,
    type: "PAGE" as const,
    text: pageBlockText(i + 1),
    page: i + 1,
  }));
}

// Upload path. Dedupe by fileHash: a re-upload returns the existing document, no re-parse.
// Import PDF judges each PDF (SPEC.md §16): a computer-text article parses to
// text blocks; rough handwritten notes and drawings become a handwritten
// document. opts.pages skips the judgment — the PDF imports as handwritten
// pages because the instructions said so; opts.convert false marks conversion
// OFF, so the caller starts nothing. The caller starts conversion for a
// handwritten document with conversionStatus NONE. With instructions, the
// structure pass runs over the parsed blocks — the other lever instructions
// have on a PDF (§15); userId is who the classification records usage under.
export async function ingestPdf(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  onProgress?: OnIngestProgress,
  opts: IngestOptions = {},
  userId: string | null = null,
) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) return { document: existing, deduped: true };

  onProgress?.("parse");
  const parsed = await parsePdf(bytes);
  const pageCount = await pdfPageCount(bytes);
  const kind = opts.pages
    ? "handwritten"
    : await classifyPdf(bytes, parsed.blocks, pageCount, userId);
  if (kind === "handwritten") {
    onProgress?.("save");
    const document = await createHandwrittenDocument({
      title: filename.replace(/\.pdf$/i, ""),
      sourceUrl: opts.sourceUrl,
      fileHash,
      fileData: bytes,
      pageCount,
      convert: opts.convert !== false,
    });
    await storePageSizesQuietly(document.id, bytes);
    return { document, deduped: false };
  }
  const title = parsed.title ?? filename.replace(/\.pdf$/i, "");
  const blocks = parsed.blocks;
  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title,
    sourceUrl: opts.sourceUrl,
    fileHash,
    fileData: bytes,
    blocks,
  });
  return { document, deduped: false };
}

/** Are these bytes a PDF: the file starts with its magic. A stored file
    that is not a PDF is a Markdown file. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
}

// Markdown upload path (SPEC.md §2). Dedupe by fileHash like a PDF; the
// bytes are kept for re-parse. The file parses through the URL walk, no
// model pass.
export async function ingestMarkdown(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  onProgress?: OnIngestProgress,
  opts: IngestOptions = {},
) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) return { document: existing, deduped: true };

  onProgress?.("parse");
  const parsed = await parseMarkdownDocument(new TextDecoder("utf-8").decode(bytes), filename);
  const title = parsed.title ?? filename;
  const blocks = parsed.blocks;
  onProgress?.("save", await saveDetail(blocks, false, null, parsed.mediaCheck, null, title));
  const document = await createDocumentWithBlocks({
    title,
    sourceUrl: opts.sourceUrl,
    fileHash,
    fileData: bytes,
    blocks,
    references: parsed.references,
  });
  return { document, deduped: false };
}

// ── Slides and sheets (SPEC.md §27) ─────────────────────────────────────────

// The reader's column for a slides document: the replica scales to the
// column, so a wide column shows a slide large enough to read; sheets take
// the widest column, and the pane caps it.
const SLIDES_COLUMN_WIDTH = 960;
const SHEETS_COLUMN_WIDTH = 1600;

/** A slide's pictures stored as images of the document (claimed on save,
    like a captured chart). */
function slideImageStore(userId: string | null): SlideImageStore {
  return async (bytes, mimeType) => {
    const image = await db.imageAsset.create({
      data: { mimeType, size: bytes.length, data: Buffer.from(bytes), userId },
      select: { id: true },
    });
    return `/api/images/${image.id}`;
  };
}

export type SlidesIngestOptions = IngestOptions & {
  // Drive's PDF export of the same file (SPEC.md §14): one page per slide,
  // the picture the reader draws over each replica. The sizes are stored
  // with the document; the caller renders the pages after the response
  // (renderSlidePictures).
  picture?: Uint8Array;
};

// Slides upload path (SPEC.md §27): a .pptx, or a Google Slides file Drive
// exported as one. Dedupe by fileHash like a PDF; the bytes are kept for
// re-parse. No model pass: the parse is the file's own structure.
export async function ingestSlides(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  onProgress?: OnIngestProgress,
  opts: SlidesIngestOptions = {},
  userId: string | null = null,
) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) return { document: existing, deduped: true };

  onProgress?.("parse");
  const parsed = await parseSlides(bytes, filename, {
    storeImage: slideImageStore(userId),
    picture: opts.picture !== undefined,
  });
  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title: parsed.title ?? filename.replace(/\.pptx$/i, ""),
    sourceUrl: opts.sourceUrl,
    fileHash,
    fileData: bytes,
    blocks: parsed.blocks,
    format: "slides",
    columnWidth: SLIDES_COLUMN_WIDTH,
  });
  if (opts.picture) {
    try {
      await storeSlidePictureSizes(document.id, opts.picture);
    } catch (err) {
      console.warn("[slides] picture sizes failed:", err);
    }
  }
  return { document, deduped: false };
}

/** The delimiter a sheets file name promises: tabs for a .tsv; otherwise
    the text decides (lib/parse/sheets.ts sniffDelimiter). */
function delimiterOf(filename: string): Delimiter | undefined {
  return /\.tsv$/i.test(filename) ? "\t" : undefined;
}

async function parseSheetsBytes(bytes: Uint8Array, filename: string, userId: string | null): Promise<ParsedDocument> {
  if (sniffOfficeFile(bytes) === "xlsx") return parseSheets(bytes, filename, { storeImage: slideImageStore(userId) });
  return parseDelimited(new TextDecoder("utf-8").decode(bytes), filename, delimiterOf(filename));
}

// Sheets upload path (SPEC.md §27): a .xlsx, a Google Sheets file Drive
// exported as one, or a .csv/.tsv. Dedupe by fileHash; the bytes are kept
// for re-parse. No model pass.
export async function ingestSheets(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  onProgress?: OnIngestProgress,
  opts: IngestOptions = {},
  userId: string | null = null,
) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) return { document: existing, deduped: true };

  onProgress?.("parse");
  const parsed = await parseSheetsBytes(bytes, filename, userId);
  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title: parsed.title ?? filename,
    sourceUrl: opts.sourceUrl,
    fileHash,
    fileData: bytes,
    blocks: parsed.blocks,
    format: "sheets",
    columnWidth: SHEETS_COLUMN_WIDTH,
  });
  return { document, deduped: false };
}

// The file name a PDF link carries, for the document title fallback.
function filenameOfUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return last || "document.pdf";
  } catch {
    return "document.pdf";
  }
}

// URL path. Dedupe by exact sourceUrl. A stale stored parse upgrades in place:
// adding the URL again must never hand back blocks from an older parser.
// With split, one long page saves as multiple documents: `document` is the
// first part, `extra` the rest. Re-adding the same URL with split dedupes to
// the existing first part; without split it saves a fresh whole document.
export async function ingestUrl(
  url: string,
  onProgress?: OnIngestProgress,
  opts: IngestOptions = {},
  userId: string | null = null,
): Promise<{ document: Document; extra?: Document[]; deduped: boolean }> {
  const existing = await db.document.findFirst({ where: { sourceUrl: url } });
  if (existing) {
    if (existing.parserVersion < PARSER_VERSION) {
      const document = await reparseDocument(existing.id, onProgress, undefined, opts.deadline, userId);
      if (document) return { document, deduped: false };
    }
    return { document: existing, deduped: true };
  }
  if (opts.split) {
    const part = await db.document.findFirst({
      where: { sourceUrl: { startsWith: `${url}${SPLIT_URL_MARKER}` } },
      orderBy: { createdAt: "asc" },
    });
    if (part) return { document: part, deduped: true };
  }

  // A link to a PDF file adds the PDF itself: same parse, same judgment, same
  // stored bytes as an upload, with the link kept for dedupe.
  const fetched = await fetchPage(url, onProgress);
  if (fetched.kind === "pdf") {
    const { document, deduped } = await ingestPdf(
      fetched.bytes,
      filenameOfUrl(url),
      onProgress,
      { ...opts, sourceUrl: url },
      userId,
    );
    return { document, deduped };
  }
  // A page whose figures its scripts draw renders in a browser first, where
  // one is configured (lib/parse/render-page.ts); an animated chart's loop
  // is stored as an image of the document.
  const { page, render } = await renderIfNeeded(fetched, url, onProgress, { store: { userId } });
  const pageHtml = page.kind === "html" ? page.html : fetched.html;
  onProgress?.("extract");
  const parsed = await parseHtmlContent(pageHtml, url, onProgress);
  // A wall is not the article (lib/parse/page-kind.ts): the add stops here
  // with the reason, before any model pass reads the wall's words.
  const wall = await wallOf(parsed.title ?? url, parsed.blocks);
  if (wall) throw new FetchPageError("wall", hostOf(url), null);
  const { blocks, references, font: laidFont, check } = await refineUrlBlocks(parsed, onProgress, {
    deadline: opts.deadline,
    pageHtml,
    url,
  });
  // The page's font comes from the parse, else from the layout pass.
  const font = parsed.font ?? laidFont;
  const columnWidth = parsed.columnWidth;
  const title = parsed.title ?? url;

  if (opts.split) {
    const chars = blocks.reduce((n, b) => n + b.text.length, 0);
    const parts = splitBlocks(title, blocks, splitPartCount(chars));
    if (parts.length > 1) {
      onProgress?.("save", await saveDetail(blocks, unrenderedScripts(fetched), render, parsed.mediaCheck, check, title));
      const documents = [];
      for (let i = 0; i < parts.length; i++) {
        documents.push(
          await createDocumentWithBlocks({
            title: parts[i].title,
            sourceUrl: `${url}${SPLIT_URL_MARKER}${i + 1}`,
            blocks: parts[i].blocks,
            references: referencesForPart(parts[i].blocks, references),
            font,
            columnWidth,
            render,
          }),
        );
      }
      return { document: documents[0], extra: documents.slice(1), deduped: false };
    }
  }

  onProgress?.("save", await saveDetail(blocks, unrenderedScripts(fetched), render, parsed.mediaCheck, check, title));
  const document = await createDocumentWithBlocks({
    title,
    sourceUrl: url,
    blocks,
    references,
    font,
    columnWidth,
    render,
  });
  return { document, deduped: false };
}

// Re-parse from stored bytes or source URL. Block ids change; anchors re-resolve by quote (SPEC.md §5).
// A re-parse never changes Document.font: the reader may have picked one.
// It does set Document.columnWidth: the page's width is the page's fact.
// The images the last parse captured go; the new parse's take their place.
// Video documents never re-parse: their blocks are the player and the transcript (SPEC.md §11).
// `as` flips a PDF between the two shapes (SPEC.md §16) — the escape hatch when
// Import PDF judged it wrong: "article" parses the stored bytes to text blocks;
// "handwritten" rebuilds the PAGE blocks (the caller starts conversion).
// Without `as`, a document keeps its shape.
export async function reparseDocument(
  documentId: string,
  onProgress?: OnIngestProgress,
  as?: "article" | "handwritten",
  // The model passes' time budget (modelPassDeadline); absent: no budget.
  deadline?: number,
  // The account the captured images are recorded under.
  userId: string | null = null,
) {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { video: { select: { id: true } } },
  });
  if (!document) return null;
  if (document.video) throw new Error("Video documents do not re-parse");
  // A split part holds one slice of its page; a re-parse would paste the whole
  // page over it (SPEC.md §15).
  if (document.sourceUrl?.includes(SPLIT_URL_MARKER)) {
    throw new Error("Split documents do not re-parse");
  }

  // A slides or sheets document (SPEC.md §27) parses its stored file with
  // its own parser; the slides' stored pictures carry over by slide number.
  if (document.format === "slides" || document.format === "sheets") {
    if (!document.fileData) throw new Error("Document has no stored file");
    onProgress?.("parse");
    const bytes = new Uint8Array(document.fileData);
    const pictures = document.format === "slides" ? await slidePicturesByPage(documentId) : new Map();
    const parsed =
      document.format === "slides"
        ? await parseSlides(bytes, document.title, { storeImage: slideImageStore(userId), picture: pictures.size > 0 })
        : await parseSheetsBytes(bytes, document.title, userId);
    onProgress?.("save", await saveDetail(parsed.blocks));
    await db.$transaction(async (tx) => {
      await tx.block.deleteMany({ where: { documentId } });
      await tx.imageAsset.deleteMany({ where: { documentId } });
      await tx.block.createMany({
        data: parsed.blocks.map((b, i) => ({
          documentId,
          order: i,
          type: b.type,
          text: b.text,
          html: b.html,
          page: b.page,
        })),
      });
      await claimCapturedImages(tx, documentId, parsed.blocks);
      await tx.document.update({
        where: { id: documentId },
        data: {
          parserVersion: PARSER_VERSION,
          columnWidth: document.format === "slides" ? SLIDES_COLUMN_WIDTH : SHEETS_COLUMN_WIDTH,
          contents: Prisma.DbNull,
          skeleton: Prisma.DbNull,
          skeletonStartedAt: null,
        },
      });
    });
    await restoreSlidePictures(documentId, pictures);
    return db.document.findUnique({ where: { id: documentId } });
  }

  const target = as ?? (document.handwritten ? "handwritten" : "article");
  if (target === "handwritten") {
    if (!document.fileData) throw new Error("Document has no stored file");
    if (!isPdfBytes(new Uint8Array(document.fileData))) throw new Error("Only a PDF has pages");
    onProgress?.("save");
    const pageCount = await pdfPageCount(new Uint8Array(document.fileData));
    await db.$transaction(async (tx) => {
      await tx.block.deleteMany({ where: { documentId } });
      await tx.block.createMany({ data: pageBlockRows(documentId, pageCount) });
      await tx.document.update({
        where: { id: documentId },
        data: {
          handwritten: true,
          parserVersion: PARSER_VERSION,
          conversionStatus: "NONE",
          conversionError: null,
          conversionStartedAt: null,
        },
      });
    });
    await storePageSizesQuietly(documentId, new Uint8Array(document.fileData));
    return db.document.findUnique({ where: { id: documentId } });
  }

  let blocks: ParsedBlock[];
  let references: DocumentReference[] | undefined;
  let columnWidth: number | undefined;
  let scriptedFigures = false;
  let render: RenderReport | null = null;
  let mediaCheck: MediaCheck | undefined;
  let check: VisionCheckReport | null = null;
  if (document.fileData) {
    onProgress?.("parse");
    const bytes = new Uint8Array(document.fileData);
    if (isPdfBytes(bytes)) blocks = (await parsePdf(bytes)).blocks;
    else {
      // A Markdown file: the same walk as on the add (lib/parse/markdown-document.ts).
      const parsed = await parseMarkdownDocument(new TextDecoder("utf-8").decode(bytes), document.title);
      blocks = parsed.blocks;
      references = parsed.references;
      mediaCheck = parsed.mediaCheck;
    }
  } else if (document.sourceUrl) {
    const url = document.sourceUrl;
    const fetched = await fetchPage(url, onProgress);
    scriptedFigures = unrenderedScripts(fetched);
    // A page whose figures its scripts draw renders in a browser first, where
    // one is configured (lib/parse/render-page.ts); an animated chart's loop
    // is stored as an image of the document.
    const rendered = await renderIfNeeded(fetched, url, onProgress, { store: { userId } });
    const page = rendered.page;
    render = rendered.render;
    onProgress?.("extract");
    const parsed = await parseFetchedPage(page, url, onProgress);
    const refined = await refineUrlBlocks(parsed, onProgress, {
      deadline,
      pageHtml: page.kind === "html" ? page.html : null,
      url,
    });
    references = refined.references;
    blocks = refined.blocks;
    check = refined.check;
    columnWidth = parsed.columnWidth;
    mediaCheck = parsed.mediaCheck;
  } else {
    throw new Error("Document has no stored file and no source URL");
  }

  // The figure check rides with the save stage, as on an add: the document
  // bar reports a caption left without its figure.
  onProgress?.("save", await saveDetail(blocks, scriptedFigures, render, mediaCheck, check));
  const rows = resolveContentsLinks(blocks);
  await db.$transaction(async (tx) => {
    await tx.block.deleteMany({ where: { documentId } });
    await tx.imageAsset.deleteMany({ where: { documentId } });
    await tx.block.createMany({
      data: rows.map((b, i) => ({
        documentId,
        order: i,
        type: b.type,
        text: b.text,
        html: b.html,
        page: b.page,
        region: b.region,
        citations: b.citations,
        styles: b.styles,
        links: b.links,
      })),
    });
    await claimCapturedImages(tx, documentId, rows);
    await tx.document.update({
      where: { id: documentId },
      data: {
        parserVersion: PARSER_VERSION,
        references,
        columnWidth: columnWidth ?? null,
        ...renderColumns(render),
        handwritten: false,
        conversionStatus: "NONE",
        conversionError: null,
        conversionStartedAt: null,
        // The blocks are new, so the contents' and the skeleton's block ids
        // are stale: the next open of Contents builds them again (SPEC.md
        // §26), and the skeleton builds again after the response (§22).
        contents: Prisma.DbNull,
        skeleton: Prisma.DbNull,
        skeletonStartedAt: null,
      },
    });
  });
  return db.document.findUnique({ where: { id: documentId } });
}
