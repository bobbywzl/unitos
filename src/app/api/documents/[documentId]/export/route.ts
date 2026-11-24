import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { ensureBlockIds, hasBlockIds } from "@/lib/docs/blocks";
import { richTextDocx } from "@/lib/docs/export";
import { readPageSetup, sanitizeRichText, type RichNode } from "@/lib/docs/schema";
import { figureMedia } from "@/lib/docs/server";
import {
  documentHtml,
  documentMarkdown,
  documentText,
  exportBlocks,
  fileName,
  hasWords,
  storedPictureIds,
} from "@/lib/export/document";
import { figureCropSize, CROP_PAD, CROP_PAGE_WIDTH, WHOLE_PAGE_WIDTH } from "@/lib/figure-crop";
import { currentLang, serverT } from "@/lib/i18n/server";
import type { ParsedBlock } from "@/lib/parse/types";
import { parseRegion } from "@/lib/video/types";

export const maxDuration = 60;

// A document's download (SPEC.md §15, §29): the document as a file.
//   docx      Microsoft Word. A document with rich text (a blank document,
//             an import): from the stored rich text. Any other document:
//             its blocks through the import's converter (lib/docs/import.ts),
//             then the same writer.
//   html, md, txt
//             a document without rich text, from its blocks
//             (lib/export/document.ts). A document with rich text makes
//             these in the browser from the page (docs/page/download.ts).
//   original  the stored file as it was added: a PDF, a Word file, slides,
//             sheets, a Markdown or text file, a picture of a page.
// A download is a read: viewers download too. No download holds the
// reader's notes, annotations, comments, or replies: they stay in Unitos.
// A recording's download is its transcript; its video or audio file is
// never served here (the file is not Document.fileData).

const FORMATS = ["docx", "html", "md", "txt", "original"] as const;
type Format = (typeof FORMATS)[number];

/** How long the web page's PDF figure crops may take, together. */
const CROPS_MS = 25_000;

function attachment(body: Uint8Array | string, type: string, name: string): NextResponse {
  // The name in ASCII for a client that reads no other, then whole.
  const ascii = name.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** The stored file's type and extension, told by its first bytes. */
function storedFileType(bytes: Uint8Array, format: string | null): { type: string; extension: string } {
  const head = (n: number) => Buffer.from(bytes.subarray(0, n)).toString("latin1");
  if (head(5) === "%PDF-") return { type: "application/pdf", extension: "pdf" };
  if (head(2) === "PK") {
    if (format === "slides") return { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: "pptx" };
    if (format === "sheets") return { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };
    return { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" };
  }
  if (head(8) === "\x89PNG\r\n\x1a\n") return { type: "image/png", extension: "png" };
  if (head(3) === "\xff\xd8\xff") return { type: "image/jpeg", extension: "jpg" };
  if (head(4) === "RIFF" && head(12).slice(8) === "WEBP") return { type: "image/webp", extension: "webp" };
  if (format === "sheets") return { type: "text/csv; charset=utf-8", extension: "csv" };
  return { type: "text/markdown; charset=utf-8", extension: "md" };
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") as Format | null;
  if (!format || !FORMATS.includes(format)) {
    return NextResponse.json({ error: t("api.documentExportFormatInvalid") }, { status: 400 });
  }
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { title: true, richText: true, pageSetup: true, sourceUrl: true, fileHash: true, format: true },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const storedFile = async () =>
    document.fileHash === null
      ? null
      : ((await db.document.findUnique({ where: { id: documentId }, select: { fileData: true } }))?.fileData ?? null);

  if (format === "original") {
    const bytes = await storedFile();
    if (!bytes) return NextResponse.json({ error: t("api.documentExportNoFile") }, { status: 404 });
    const file = storedFileType(bytes, document.format);
    return attachment(bytes, file.type, fileName(document.title, file.extension));
  }

  // A document with rich text: Word from the stored rich text. Its other
  // formats are the browser's.
  if (document.richText) {
    if (format !== "docx") return NextResponse.json({ error: t("api.documentExportFormatInvalid") }, { status: 400 });
    const richText = document.richText as unknown as RichNode;
    const setup = readPageSetup(document.pageSetup);
    const media = (await figureMedia(documentId, richText, setup)) ?? {};
    // A PDF figure is the crop of its page: the PDF is read only when one is there.
    const crops = Object.values(media).some((m) => m.html === null && m.page !== null);
    const file = crops ? await storedFile() : null;
    // No comment goes into the file: annotations stay in Unitos.
    const docx = await richTextDocx(document.title, richText, setup, url.origin, [], {
      media,
      pdf: file ? new Uint8Array(file) : null,
      pageUrl: document.sourceUrl,
    });
    return attachment(docx, DOCX, fileName(document.title, "docx"));
  }

  // A document without rich text: from its blocks.
  const [rows, video] = await Promise.all([
    db.block.findMany({
      where: { documentId },
      orderBy: { order: "asc" },
      select: { id: true, type: true, text: true, html: true, styles: true, links: true, page: true, region: true, startTime: true, speaker: true },
    }),
    db.videoAsset.findUnique({ where: { documentId }, select: { speakers: true } }),
  ]);
  const blocks = exportBlocks(
    { title: document.title, sourceUrl: document.sourceUrl, speakers: video?.speakers ?? null, rows },
    { slide: (n) => t("api.exportSlide", { n }), page: (n) => t("api.exportPage", { n }) },
  );
  if (!hasWords(blocks)) return NextResponse.json({ error: t("api.documentExportEmpty") }, { status: 404 });
  const pageUrl = document.sourceUrl && /^https?:/i.test(document.sourceUrl) ? document.sourceUrl : null;

  if (format === "txt") return attachment(documentText(document.title, blocks), "text/plain; charset=utf-8", fileName(document.title, "txt"));
  if (format === "md") {
    return attachment(documentMarkdown(document.title, blocks, pageUrl), "text/markdown; charset=utf-8", fileName(document.title, "md"));
  }

  const crops = blocks.some((b) => b.type === "FIGURE" && !b.html && b.page !== undefined);
  const file = crops ? await storedFile() : null;
  const pdf = file && Buffer.from(file.subarray(0, 5)).toString("latin1") === "%PDF-" ? new Uint8Array(file) : null;

  if (format === "html") {
    const pictures = new Map<string, string>();
    // The app's own pictures go inside the file: it opens anywhere, signed in or not.
    const stored = storedPictureIds(blocks);
    if (stored.size > 0) {
      const images = await db.imageAsset.findMany({ where: { id: { in: [...new Set(stored.values())] } }, select: { id: true, data: true, mimeType: true } });
      const byId = new Map(images.map((i) => [i.id, `data:${i.mimeType};base64,${Buffer.from(i.data).toString("base64")}`]));
      for (const [src, id] of stored) {
        const data = byId.get(id);
        if (data) pictures.set(src, data);
      }
    }
    // A PDF figure is the crop of its page, as the figure route cuts it; one
    // not cut in time leaves its caption.
    if (pdf) {
      const { cropPageRegion, renderPdfPage } = await import("@/lib/handwritten/pages");
      const deadline = Date.now() + CROPS_MS;
      for (const [index, block] of blocks.entries()) {
        if (block.type !== "FIGURE" || block.html || block.page === undefined || Date.now() > deadline) continue;
        try {
          const region = parseRegion(block.region);
          const page = await renderPdfPage(pdf, block.page, region ? CROP_PAGE_WIDTH : WHOLE_PAGE_WIDTH);
          const png = region ? ((await cropPageRegion(page, region, { pad: CROP_PAD, scaleUp: false })) ?? page) : page;
          pictures.set(`#${index}`, `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
        } catch {
          // The caption alone.
        }
      }
    }
    const html = documentHtml(document.title, blocks, { pageUrl, pictures, lang: await currentLang() });
    // inline: the page's PDF download prints this page in a frame.
    if (url.searchParams.get("inline") === "1") {
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
    }
    return attachment(html, "text/html; charset=utf-8", fileName(document.title, "html"));
  }

  // Word: the blocks become rich text as an import's do, then the same writer.
  const [{ richTextFromImport }, { resolveContentsLinks }] = await Promise.all([import("@/lib/docs/import"), import("@/lib/parse/url")]);
  const converted = richTextFromImport({
    kind: pdf ? "pdf" : pageUrl ? "url" : "markdown",
    title: document.title,
    titleFromOriginal: false,
    blocks: resolveContentsLinks(blocks as ParsedBlock[]),
  });
  const clean = sanitizeRichText(converted.richText);
  if (!clean) return NextResponse.json({ error: t("api.documentExportTooLarge") }, { status: 413 });
  const media = Object.fromEntries(
    converted.figures.map((f) => {
      const crop = f.html === null && f.page !== null;
      return [f.mediaId, { html: f.html, caption: f.caption, page: f.page, region: f.region, src: null, size: crop ? figureCropSize(f.region, converted.pageSetup) : null }];
    }),
  );
  const docx = await richTextDocx(document.title, hasBlockIds(clean) ? clean : ensureBlockIds(clean), converted.pageSetup, url.origin, [], {
    media,
    pdf,
    pageUrl,
  });
  return attachment(docx, DOCX, fileName(document.title, "docx"));
}
