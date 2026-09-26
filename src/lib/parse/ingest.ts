import { createHash } from "node:crypto";
import { Prisma, type Document } from "@prisma/client";
import { carryContents } from "@/lib/contents";
import { db } from "@/lib/db";
import { deriveBlocks, ensureBlockIds, hasBlockIds } from "@/lib/docs/blocks";
import { richTextFromImport, type ImportFigure, type ImportKind } from "@/lib/docs/import";
import { sanitizeRichText, type PageSetup, type RichNode } from "@/lib/docs/schema";
import { syncRichText } from "@/lib/docs/sync";
import { keepNamedVersion } from "@/lib/docs/versions";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { serverT } from "@/lib/i18n/server";
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
  if (pageHtml && (await visionCheckPossible(blocks))) {
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
// those no block carries. blockDocument "size": the size guard kept the
// document out of the page editor (SPEC.md §29), and the done line says so.
async function saveDetail(
  blocks: ParsedBlock[],
  opts: {
    scriptedFigures?: boolean;
    render?: RenderReport | null;
    media?: MediaCheck;
    check?: VisionCheckReport | null;
    title?: string | null;
    blockDocument?: BlockDocumentReason | null;
  } = {},
): Promise<string> {
  const { scriptedFigures = false, render = null, media, check = null, title = null, blockDocument = null } = opts;
  const audit = await auditFiguresWithJev(blocks, title);
  return JSON.stringify({
    figures: audit.figures,
    captionsWithoutFigure: audit.captionsWithoutFigure,
    scriptedFigures,
    renderError: render?.error ?? null,
    ...(media ? { media: media.onPage, mediaLost: media.lost } : {}),
    ...(check ? { visionCheck: check } : {}),
    ...(blockDocument ? { blockDocument } : {}),
  });
}

// ── Imports (SPEC.md §29) ───────────────────────────────────────────────────
// A PDF judged an article, a web page, and a Markdown or text file become an
// import: rich text that opens in the page editor. The converter
// (lib/docs/import.ts) turns the parse's blocks into the rich text; the Block
// rows are derived from it in the same transaction (lib/docs/sync.ts, bulk),
// so the first save changes only the paragraph typed in.

/** The switch: IMPORT_PAGE_EDITOR=on makes new imports rich text; unset, a
    new import is a block document, as before. Read at import only: a
    document made while it was on keeps its rich text, and re-parses as rich
    text. */
export function importPageEditorOn(): boolean {
  return process.env.IMPORT_PAGE_EDITOR === "on";
}

// The size guard: past either, an import stays a block document and the
// done line says so. Every save sends the whole rich text and every row, so
// a document past these is slow to open, type in, and save.
export const IMPORT_MAX_ROWS = 1_500;
export const IMPORT_MAX_JSON_BYTES = 1_500_000;

/** Why an import stays a block document: the size guard. */
type BlockDocumentReason = "size";

/** The save stage detail of an add with no figure check (a PDF): only the
    size guard's line, when it kept a block document. */
function blockDocumentDetail(reason: BlockDocumentReason | null): string | undefined {
  return reason ? JSON.stringify({ blockDocument: reason }) : undefined;
}

// An import's writes: the rich text, its figures, and the rows in one
// transaction, as long as a bulk save may take (lib/docs/sync.ts).
const IMPORT_TX_MS = 120_000;

/** A parse as an import: the rich text, the figure media, the page setup. */
type Converted = { richText: RichNode; figures: ImportFigure[]; pageSetup: PageSetup };

/** The parse's blocks as an import, or "size" when the size guard keeps
    them a block document. titleFromOriginal: the title came from the
    original (the PDF's title, the page's, the front matter's), so the
    rich text opens with it in the Title style. */
function convertImport(input: {
  kind: ImportKind;
  title: string;
  titleFromOriginal: boolean;
  blocks: ParsedBlock[];
  pageSize?: { width: number; height: number };
}): Converted | "size" {
  // Contents entries point at their headings' orders; the converter links
  // them to the headings' block ids.
  const out = richTextFromImport({ ...input, blocks: resolveContentsLinks(input.blocks) });
  if (out.size.rows > IMPORT_MAX_ROWS || out.size.json > IMPORT_MAX_JSON_BYTES) return "size";
  // Past the node limit the sanitizer refuses the document: the guard holds.
  const clean = sanitizeRichText(out.richText);
  if (!clean) return "size";
  return {
    richText: hasBlockIds(clean) ? clean : ensureBlockIds(clean),
    figures: out.figures,
    pageSetup: out.pageSetup,
  };
}

/** The figure media of an import, written before its rows: the save's
    figure check drops a figure object whose media is not the document's. */
async function createFigureMedia(tx: Prisma.TransactionClient, documentId: string, figures: ImportFigure[]) {
  if (figures.length === 0) return;
  await tx.figureMedia.createMany({
    data: figures.map((f) => ({
      id: f.mediaId,
      documentId,
      html: f.html,
      caption: f.caption,
      page: f.page,
      region: f.region === null ? Prisma.DbNull : (f.region as unknown as Prisma.InputJsonValue),
    })),
  });
}

/** An import: the document with its rich text and page setup, its figure
    media, its Block rows derived from the rich text (no history rows), and
    the rich text kept as the version "Imported", in one transaction. */
async function createImportedDocument(data: {
  title: string;
  sourceUrl?: string;
  fileHash?: string;
  fileData?: Uint8Array<ArrayBuffer>;
  converted: Converted;
  pageLabels?: string[];
  references?: DocumentReference[];
  font?: ParsedDocument["font"];
  columnWidth?: number;
  render?: RenderReport | null;
  userId: string | null;
}): Promise<Document> {
  const t = await serverT();
  const { converted } = data;
  return db.$transaction(
    async (tx) => {
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
          ...renderColumns(data.render ?? null),
          richText: converted.richText as unknown as Prisma.InputJsonValue,
          pageSetup: converted.pageSetup as unknown as Prisma.InputJsonValue,
          pageLabels: data.pageLabels,
        },
      });
      await createFigureMedia(tx, document.id, converted.figures);
      // The rows, and importRev at the revision this write makes.
      const synced = await syncRichText({
        tx,
        documentId: document.id,
        userId: data.userId,
        baseRev: null,
        richText: converted.richText,
        bulk: true,
      });
      if (!synced.ok) throw new Error(`The import could not be saved (${synced.reason})`);
      await keepNamedVersion(tx, document.id, t("api.importVersionName"));
      await claimCapturedImages(tx, document.id, converted.figures);
      return document;
    },
    { timeout: IMPORT_TX_MS, maxWait: 15_000 },
  );
}

// ── Dedupe (SPEC.md §13, §14) ───────────────────────────────────────────────
// An add of a file or an address already in the library attaches that
// document as it is — only while it is unedited: an import edited since it
// was imported is its readers' own, so the add imports anew beside it.

const UNEDITED: Prisma.DocumentWhereInput = {
  OR: [{ importRev: null }, { richTextRev: { lte: db.document.fields.importRev } }],
};

/** The oldest unedited document with these bytes. */
function dedupeByHash(fileHash: string) {
  return db.document.findFirst({ where: { fileHash, ...UNEDITED }, orderBy: { createdAt: "asc" } });
}

/** Edited since it was imported: the rich text moved past the revision the
    import, or its last re-parse, stored. Rich text without an import
    revision (a blank document's) is the reader's own words. */
export function importEdited(document: { richText: unknown; richTextRev: number; importRev: number | null }): boolean {
  if (document.richText === null) return false;
  return document.importRev === null || document.richTextRev > document.importRev;
}

/** A re-parse would replace an import's edits, and the reader has not said
    yes (replaceEdits): the re-parse route answers 409 "edited", and a
    silent run stops. */
export class ImportEditedError extends Error {
  constructor() {
    super("The import was edited after it was imported");
    this.name = "ImportEditedError";
  }
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
  const existing = await dedupeByHash(fileHash);
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
  // An article is an import while the switch is on: pages at the PDF's
  // size, its page numbers at the lines where its pages begin.
  const converted = importPageEditorOn()
    ? convertImport({
        kind: "pdf",
        title,
        titleFromOriginal: Boolean(parsed.title),
        blocks,
        pageSize: parsed.pageSize,
      })
    : null;
  onProgress?.("save", blockDocumentDetail(converted === "size" ? "size" : null));
  const document =
    converted && converted !== "size"
      ? await createImportedDocument({
          title,
          sourceUrl: opts.sourceUrl,
          fileHash,
          fileData: bytes,
          converted,
          pageLabels: parsed.pageLabels,
          userId,
        })
      : await createDocumentWithBlocks({
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
  userId: string | null = null,
) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await dedupeByHash(fileHash);
  if (existing) return { document: existing, deduped: true };

  onProgress?.("parse");
  const parsed = await parseMarkdownDocument(new TextDecoder("utf-8").decode(bytes), filename);
  const title = parsed.title ?? filename;
  const blocks = parsed.blocks;
  // A text file is an import while the switch is on: pageless.
  const converted = importPageEditorOn()
    ? convertImport({ kind: "markdown", title, titleFromOriginal: Boolean(parsed.title), blocks })
    : null;
  onProgress?.(
    "save",
    await saveDetail(blocks, {
      media: parsed.mediaCheck,
      title,
      blockDocument: converted === "size" ? "size" : null,
    }),
  );
  const document =
    converted && converted !== "size"
      ? await createImportedDocument({
          title,
          sourceUrl: opts.sourceUrl,
          fileHash,
          fileData: bytes,
          converted,
          references: parsed.references,
          userId,
        })
      : await createDocumentWithBlocks({
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
  const existing = await dedupeByHash(fileHash);
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
  const existing = await dedupeByHash(fileHash);
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

// URL path. Dedupe by exact sourceUrl, an unedited document only. A stale
// stored parse upgrades in place: adding the URL again must never hand back
// blocks from an older parser — and never replaces an import's edits: an
// import edited while the upgrade ran is left as it is, and the add imports
// anew. With split, one long page saves as multiple documents: `document` is
// the first part, `extra` the rest. Re-adding the same URL with split dedupes
// to the existing first part; without split it saves a fresh whole document.
export async function ingestUrl(
  url: string,
  onProgress?: OnIngestProgress,
  opts: IngestOptions = {},
  userId: string | null = null,
): Promise<{ document: Document; extra?: Document[]; deduped: boolean }> {
  const existing = await db.document.findFirst({
    where: { sourceUrl: url, ...UNEDITED },
    orderBy: { createdAt: "asc" },
  });
  if (existing && existing.parserVersion >= PARSER_VERSION) return { document: existing, deduped: true };
  if (existing) {
    try {
      const document = await reparseDocument(existing.id, onProgress, { deadline: opts.deadline, userId });
      if (document) return { document, deduped: false };
    } catch (err) {
      if (!(err instanceof ImportEditedError)) throw err;
    }
  }
  if (opts.split) {
    const part = await db.document.findFirst({
      where: { sourceUrl: { startsWith: `${url}${SPLIT_URL_MARKER}` }, ...UNEDITED },
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
  const detail = (blockDocument: BlockDocumentReason | null) =>
    saveDetail(blocks, {
      scriptedFigures: unrenderedScripts(fetched),
      render,
      media: parsed.mediaCheck,
      check,
      title,
      blockDocument,
    });

  if (opts.split) {
    const chars = blocks.reduce((n, b) => n + b.text.length, 0);
    const parts = splitBlocks(title, blocks, splitPartCount(chars));
    if (parts.length > 1) {
      // Each part is an import of its own, pageless; the part's title names
      // it, so no Title opens its text.
      const converted = parts.map((part) =>
        importPageEditorOn()
          ? convertImport({ kind: "url", title: part.title, titleFromOriginal: false, blocks: part.blocks })
          : null,
      );
      onProgress?.("save", await detail(converted.includes("size") ? "size" : null));
      const documents = [];
      for (let i = 0; i < parts.length; i++) {
        const data = {
          title: parts[i].title,
          sourceUrl: `${url}${SPLIT_URL_MARKER}${i + 1}`,
          references: referencesForPart(parts[i].blocks, references),
          font,
          columnWidth,
          render,
        };
        const part = converted[i];
        documents.push(
          part && part !== "size"
            ? await createImportedDocument({ ...data, converted: part, userId })
            : await createDocumentWithBlocks({ ...data, blocks: parts[i].blocks }),
        );
      }
      return { document: documents[0], extra: documents.slice(1), deduped: false };
    }
  }

  // A web page is an import while the switch is on: pageless, no page numbers.
  const converted = importPageEditorOn()
    ? convertImport({ kind: "url", title, titleFromOriginal: Boolean(parsed.title), blocks })
    : null;
  onProgress?.("save", await detail(converted === "size" ? "size" : null));
  const data = { title, sourceUrl: url, references, font, columnWidth, render };
  const document =
    converted && converted !== "size"
      ? await createImportedDocument({ ...data, converted, userId })
      : await createDocumentWithBlocks({ ...data, blocks });
  return { document, deduped: false };
}

export type ReparseOptions = {
  // Flips a PDF between the two shapes (SPEC.md §16).
  as?: "article" | "handwritten";
  // The model passes' time budget (modelPassDeadline); absent: no budget.
  deadline?: number;
  // The account the captured images, an import's rows, and its history
  // entry are recorded under.
  userId?: string | null;
  // The reader said yes to replacing an import's edits: the document menu
  // asks first (SPEC.md §29).
  replaceEdits?: boolean;
};

// Re-parse from stored bytes or source URL. Block ids change; anchors re-resolve by quote (SPEC.md §5).
// A re-parse never changes Document.font: the reader may have picked one.
// It does set Document.columnWidth: the page's width is the page's fact.
// The images the last parse captured go; the new parse's take their place —
// except those a figure object's media holds, which the versions point at.
// Video documents never re-parse: their blocks are the player and the transcript (SPEC.md §11).
// `as` flips a PDF between the two shapes (SPEC.md §16) — the escape hatch when
// Import PDF judged it wrong: "article" parses the stored bytes to text blocks;
// "handwritten" rebuilds the PAGE blocks (the caller starts conversion).
// Without `as`, a document keeps its shape.
// An import (SPEC.md §29) re-parses into rich text: a new row keeps the id of
// an old row with the same type and words, in order, so the anchors on it
// stay exact and the rest move by quote; the text it replaces stays as the
// version "Before re-parse", the new text as "Imported"; one history entry,
// no row history. An import edited since it was imported re-parses only with
// the reader's yes (replaceEdits), else ImportEditedError — the silent runs
// stop there. A switch to handwritten pages keeps the version and leaves the
// page editor; handwritten pages switched to computer text become an import
// while the switch is on.
export async function reparseDocument(
  documentId: string,
  onProgress?: OnIngestProgress,
  opts: ReparseOptions = {},
) {
  const { as, deadline, userId = null, replaceEdits = false } = opts;
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
  // An import's edits go only with the reader's yes (SPEC.md §29).
  if (importEdited(document) && !replaceEdits) throw new ImportEditedError();
  const wasImport = document.richText !== null;
  // The revision the re-parse replaces: a save after it is an edit the
  // reader never saw, and stops the write. With the reader's yes, the
  // version "Before re-parse" keeps whatever stands at the write.
  const baseRev = replaceEdits ? null : document.richTextRev;
  const t = await serverT();

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
    // The stored contents carry onto the new blocks by their text
    // (lib/contents.ts): the old blocks are read before they go.
    const oldBlocks = await db.block.findMany({
      where: { documentId },
      orderBy: { order: "asc" },
      select: { id: true, text: true },
    });
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
      const newBlocks = await tx.block.findMany({
        where: { documentId },
        orderBy: { order: "asc" },
        select: { id: true, text: true },
      });
      const carried = carryContents(document.contents, oldBlocks, newBlocks);
      await tx.document.update({
        where: { id: documentId },
        data: {
          parserVersion: PARSER_VERSION,
          columnWidth: document.format === "slides" ? SLIDES_COLUMN_WIDTH : SHEETS_COLUMN_WIDTH,
          contents: carried.length > 0 ? carried : Prisma.DbNull,
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
      // An import leaves the page editor: its words stay as a version.
      if (wasImport) await keepTextBeforeReparse(tx, documentId, baseRev, t("api.reparseVersionName"));
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
          ...(wasImport ? LEAVE_PAGE_EDITOR : {}),
        },
      });
      if (wasImport) await recordReparse(tx, documentId, userId);
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
  // What an import needs besides the blocks: the kind of original, its own
  // title, and a PDF's page size and page labels.
  let kind: ImportKind;
  let originalTitle: string | null;
  let pageSize: ParsedDocument["pageSize"];
  let pageLabels: ParsedDocument["pageLabels"];
  if (document.fileData) {
    onProgress?.("parse");
    const bytes = new Uint8Array(document.fileData);
    if (isPdfBytes(bytes)) {
      const parsed = await parsePdf(bytes);
      blocks = parsed.blocks;
      kind = "pdf";
      originalTitle = parsed.title;
      pageSize = parsed.pageSize;
      pageLabels = parsed.pageLabels;
    } else {
      // A Markdown file: the same walk as on the add (lib/parse/markdown-document.ts).
      const parsed = await parseMarkdownDocument(new TextDecoder("utf-8").decode(bytes), document.title);
      blocks = parsed.blocks;
      references = parsed.references;
      mediaCheck = parsed.mediaCheck;
      kind = "markdown";
      originalTitle = parsed.title;
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
    kind = "url";
    originalTitle = parsed.title;
  } else {
    throw new Error("Document has no stored file and no source URL");
  }

  // An import re-parses as an import; handwritten pages switched to computer
  // text become one while the switch is on. Past the size guard, a block
  // document.
  const converted =
    wasImport || (document.handwritten && importPageEditorOn())
      ? convertImport({
          kind,
          title: originalTitle ?? document.title,
          titleFromOriginal: Boolean(originalTitle),
          blocks,
          pageSize,
        })
      : null;
  // The figure check rides with the save stage, as on an add: the document
  // bar reports a caption left without its figure.
  onProgress?.(
    "save",
    await saveDetail(blocks, {
      scriptedFigures,
      render,
      media: mediaCheck,
      check,
      blockDocument: converted === "size" ? "size" : null,
    }),
  );
  if (converted && converted !== "size") {
    await reparseImport(document, converted, { baseRev, pageLabels, references, columnWidth, render, userId, t });
    return db.document.findUnique({ where: { id: documentId } });
  }

  const rows = resolveContentsLinks(blocks);
  // The stored contents carry onto the new blocks by their text
  // (lib/contents.ts): the old blocks are read before they go.
  const oldBlocks = await db.block.findMany({
    where: { documentId },
    orderBy: { order: "asc" },
    select: { id: true, text: true },
  });
  await db.$transaction(
    async (tx) => {
      // An import past the size guard leaves the page editor: its words stay
      // as a version.
      if (wasImport) await keepTextBeforeReparse(tx, documentId, baseRev, t("api.reparseVersionName"));
      await tx.block.deleteMany({ where: { documentId } });
      // The images a figure object's media holds stay: the versions point at them.
      const held = capturedImageIds(await tx.figureMedia.findMany({ where: { documentId }, select: { html: true } }));
      await tx.imageAsset.deleteMany({ where: { documentId, ...(held.length > 0 ? { id: { notIn: held } } : {}) } });
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
      const newBlocks = await tx.block.findMany({
        where: { documentId },
        orderBy: { order: "asc" },
        select: { id: true, text: true },
      });
      // The blocks are new, so the contents' and the skeleton's block ids are
      // stale: the contents carry onto the new blocks by their text (SPEC.md
      // §26) — cleared only when too few parts carry, so the next open of
      // Contents builds them again — and the skeleton builds again after the
      // response (§22).
      const carried = carryContents(document.contents, oldBlocks, newBlocks);
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
          contents: carried.length > 0 ? carried : Prisma.DbNull,
          skeleton: Prisma.DbNull,
          skeletonStartedAt: null,
          ...(wasImport ? LEAVE_PAGE_EDITOR : {}),
        },
      });
      if (wasImport) await recordReparse(tx, documentId, userId);
    },
    { timeout: IMPORT_TX_MS, maxWait: 15_000 },
  );
  return db.document.findUnique({ where: { id: documentId } });
}

// ── Re-parse of an import (SPEC.md §29) ─────────────────────────────────────

/** What leaving the page editor clears: the rich text (a version keeps its
    words), the page setup, and the import revision. */
const LEAVE_PAGE_EDITOR = {
  richText: Prisma.DbNull,
  pageSetup: Prisma.DbNull,
  importRev: null,
} satisfies Prisma.DocumentUpdateInput;

/** Before a re-parse replaces an import's rich text: its words kept as a
    version under the document's lock, and the revision still the one the
    re-parse started from (null: the reader said yes to replacing edits). */
async function keepTextBeforeReparse(
  tx: Prisma.TransactionClient,
  documentId: string,
  baseRev: number | null,
  name: string,
) {
  await keepNamedVersion(tx, documentId, name);
  if (baseRev === null) return;
  const row = await tx.document.findUnique({ where: { id: documentId }, select: { richTextRev: true } });
  if (row?.richTextRev !== baseRev) throw new ImportEditedError();
}

/** A re-parse of an import is one entry in the history (SPEC.md §12), never
    one row per paragraph. */
async function recordReparse(tx: Prisma.TransactionClient, documentId: string, userId: string | null) {
  await tx.blockEdit.create({ data: { documentId, blockId: null, kind: "REPARSE", userId } });
}

// The shared start and end of the two row lists match without the table
// below; past this many cells between them, a forward match within a window.
const MATCH_MAX_CELLS = 4_000_000;
const MATCH_WINDOW = 64;

type RowKey = { id: string; type: string; text: string };

/** The ids a re-parse's rows carry over (SPEC.md §29): a new row takes the id
    of an old row with the same type and words, in order — the longest run of
    rows the two lists share. A figure never keeps its id: its image route's
    answer is cached under the id. New id → old id. */
export function carriedIds(oldRows: RowKey[], newRows: RowKey[]): Map<string, string> {
  const ids = new Map<string, number>();
  const keyOf = (row: RowKey) => {
    const key = `${row.type}\u0000${row.text}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const a = oldRows.filter((r) => r.type !== "FIGURE");
  const b = newRows.filter((r) => r.type !== "FIGURE");
  const ak = a.map(keyOf);
  const bk = b.map(keyOf);
  const out = new Map<string, string>();
  let head = 0;
  while (head < a.length && head < b.length && ak[head] === bk[head]) {
    out.set(b[head].id, a[head].id);
    head++;
  }
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && ak[a.length - 1 - tail] === bk[b.length - 1 - tail]) {
    out.set(b[b.length - 1 - tail].id, a[a.length - 1 - tail].id);
    tail++;
  }
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n === 0 || m === 0) return out;
  if (n * m > MATCH_MAX_CELLS) {
    let from = head;
    for (let j = head; j < head + m; j++) {
      for (let i = from; i < Math.min(head + n, from + MATCH_WINDOW); i++) {
        if (ak[i] === bk[j]) {
          out.set(b[j].id, a[i].id);
          from = i + 1;
          break;
        }
      }
    }
    return out;
  }
  // The longest common subsequence of the middles, filled from the end.
  const width = m + 1;
  const len = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * width + j] =
        ak[head + i] === bk[head + j]
          ? len[(i + 1) * width + j + 1] + 1
          : Math.max(len[(i + 1) * width + j], len[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ak[head + i] === bk[head + j]) {
      out.set(b[head + j].id, a[head + i].id);
      i++;
      j++;
    } else if (len[(i + 1) * width + j] >= len[i * width + j + 1]) i++;
    else j++;
  }
  return out;
}

/** The rich text with the carried ids: each node the map names takes its old
    id, and a link to a heading follows its heading (as a copy relinks). */
function withCarriedIds(doc: RichNode, ids: Map<string, string>): RichNode {
  if (ids.size === 0) return doc;
  const walk = (node: RichNode): RichNode => {
    const out: RichNode = { ...node };
    const id = node.attrs?.blockId;
    const carried = typeof id === "string" ? ids.get(id) : undefined;
    if (carried) out.attrs = { ...node.attrs, blockId: carried };
    if (node.marks) {
      out.marks = node.marks.map((mark) => {
        const target = mark.type === "link" ? /^#heading=(.+)$/.exec(String(mark.attrs?.href ?? ""))?.[1] : undefined;
        const to = target ? ids.get(target) : undefined;
        return to ? { ...mark, attrs: { ...mark.attrs, href: `#heading=${to}` } } : mark;
      });
    }
    if (node.content) out.content = node.content.map(walk);
    return out;
  };
  return walk(doc);
}

/** An import's re-parse, written in one transaction: the text it replaces
    kept as "Before re-parse", the new figure media (the old stay for the
    versions), the rows synced in bulk with the carried ids (anchors on a
    carried row stay exact; the rest move by quote), the new text kept as
    "Imported", and one history entry. */
async function reparseImport(
  document: Document,
  converted: Converted,
  data: {
    baseRev: number | null;
    pageLabels?: string[];
    references?: DocumentReference[];
    columnWidth?: number;
    render: RenderReport | null;
    userId: string | null;
    t: TFunc;
  },
) {
  const documentId = document.id;
  const wasImport = document.richText !== null;
  // The old rows, read before they change: the ids the new rows carry over,
  // and the contents.
  const oldRows = await db.block.findMany({
    where: { documentId },
    orderBy: { order: "asc" },
    select: { id: true, type: true, text: true },
  });
  const richText = withCarriedIds(converted.richText, carriedIds(oldRows, deriveBlocks(converted.richText)));
  await db.$transaction(
    async (tx) => {
      if (wasImport) await keepTextBeforeReparse(tx, documentId, data.baseRev, data.t("api.reparseVersionName"));
      await createFigureMedia(tx, documentId, converted.figures);
      const synced = await syncRichText({
        tx,
        documentId,
        userId: data.userId,
        baseRev: data.baseRev,
        richText,
        bulk: true,
      });
      if (!synced.ok) {
        if (synced.reason === "rev") throw new ImportEditedError();
        throw new Error(`The re-parse could not be saved (${synced.reason})`);
      }
      await keepNamedVersion(tx, documentId, data.t("api.importVersionName"));
      const newRows = await tx.block.findMany({
        where: { documentId },
        orderBy: { order: "asc" },
        select: { id: true, text: true },
      });
      const carried = carryContents(document.contents, oldRows, newRows);
      await tx.document.update({
        where: { id: documentId },
        data: {
          parserVersion: PARSER_VERSION,
          references: data.references,
          columnWidth: data.columnWidth ?? null,
          ...renderColumns(data.render),
          handwritten: false,
          conversionStatus: "NONE",
          conversionError: null,
          conversionStartedAt: null,
          pageLabels: data.pageLabels ?? Prisma.DbNull,
          // A page setup the reader chose stays; pages switched to computer
          // text take the converter's.
          ...(wasImport ? {} : { pageSetup: converted.pageSetup as unknown as Prisma.InputJsonValue }),
          contents: carried.length > 0 ? carried : Prisma.DbNull,
          skeleton: Prisma.DbNull,
          skeletonStartedAt: null,
        },
      });
      if (wasImport) await recordReparse(tx, documentId, data.userId);
      await claimCapturedImages(tx, documentId, converted.figures);
    },
    { timeout: IMPORT_TX_MS, maxWait: 15_000 },
  );
}
