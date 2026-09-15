import { db } from "@/lib/db";
import {
  PAGE_IMAGE_WIDTH,
  pdfPageSizes,
  renderPdfPagesJpeg,
  type PageSize,
} from "@/lib/handwritten/pages";

// The stored page images of a handwritten document (SPEC.md §16): PageImage,
// one row per PAGE block. The sizes land with the document, so the reader
// lays the pages out before any image arrives and loads them lazily; the
// renders fill in after the response (renderPageImages, in after()), and the
// page image route renders any page still missing on its first request. A
// document from before pages were kept gets its sizes on the reader's next
// open (pageSizesFor) and its renders on request, the same way.

// The bytes stay in the row for the block's life: a re-parse recreates the
// blocks, and the cascade drops the rows with them.

type PageBlock = { id: string; page: number | null };

async function pageBlocksOf(documentId: string): Promise<PageBlock[]> {
  return db.block.findMany({
    where: { documentId, type: "PAGE" },
    select: { id: true, page: true },
    orderBy: { order: "asc" },
  });
}

/** Every PAGE block's size stored, no render. Rows that exist stay. */
export async function storePageSizes(documentId: string, bytes: Uint8Array): Promise<void> {
  await storeSizes(await pageBlocksOf(documentId), bytes);
}

async function storeSizes(blocks: PageBlock[], bytes: Uint8Array): Promise<void> {
  if (blocks.length === 0) return;
  const sizes = await pdfPageSizes(bytes);
  const rows = blocks.flatMap((b) => {
    const size = b.page === null ? undefined : sizes[b.page - 1];
    return size ? [{ blockId: b.id, width: size.width, height: size.height }] : [];
  });
  if (rows.length === 0) return;
  await db.pageImage.createMany({ data: rows, skipDuplicates: true });
}

/** Every PAGE block without a stored render, rendered and stored in page
    order. Stops at budgetMs — the route renders the rest on request. */
export async function renderPageImages(
  documentId: string,
  opts: { budgetMs?: number } = {},
): Promise<void> {
  const blocks = await pageBlocksOf(documentId);
  if (blocks.length === 0) return;
  const stored = await db.pageImage.findMany({
    where: { blockId: { in: blocks.map((b) => b.id) }, data: { not: null } },
    select: { blockId: true },
  });
  const done = new Set(stored.map((r) => r.blockId));
  const todo = blocks.filter((b) => b.page !== null && !done.has(b.id));
  if (todo.length === 0) return;
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { fileData: true },
  });
  if (!document?.fileData) return;
  const bytes = new Uint8Array(document.fileData);
  const blockByPage = new Map(todo.map((b) => [b.page as number, b.id]));
  const started = Date.now();
  await renderPdfPagesJpeg(bytes, [...blockByPage.keys()], PAGE_IMAGE_WIDTH, async (page, image, size) => {
    await storeRender(blockByPage.get(page) as string, image, size);
    return opts.budgetMs === undefined || Date.now() - started < opts.budgetMs;
  });
}

/** One page rendered and stored now, for the route's first request of a
    page without a render. Null when the render failed. */
export async function renderPageImage(
  blockId: string,
  bytes: Uint8Array,
  page: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  let rendered: Uint8Array<ArrayBuffer> | null = null;
  await renderPdfPagesJpeg(bytes, [page], PAGE_IMAGE_WIDTH, async (_page, image, size) => {
    await storeRender(blockId, image, size);
    rendered = image;
  });
  return rendered;
}

async function storeRender(blockId: string, image: Uint8Array<ArrayBuffer>, size: PageSize): Promise<void> {
  await db.pageImage.upsert({
    where: { blockId },
    create: { blockId, width: size.width, height: size.height, data: image },
    update: { width: size.width, height: size.height, data: image },
  });
}

/** The stored size per PAGE block, for the reader's layout. Blocks without a
    row (a document from before pages were kept) get theirs from the PDF now,
    once. */
export async function pageSizesFor(
  documentId: string,
  blocks: PageBlock[],
): Promise<Record<string, PageSize>> {
  const pageBlocks = blocks.filter((b) => b.page !== null);
  if (pageBlocks.length === 0) return {};
  const read = async () =>
    db.pageImage.findMany({
      where: { blockId: { in: pageBlocks.map((b) => b.id) } },
      select: { blockId: true, width: true, height: true },
    });
  let rows = await read();
  if (rows.length < pageBlocks.length) {
    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { fileData: true },
    });
    if (document?.fileData) {
      try {
        await storeSizes(pageBlocks, new Uint8Array(document.fileData));
        rows = await read();
      } catch (err) {
        console.warn("[handwritten] page sizes failed:", err);
      }
    }
  }
  return Object.fromEntries(rows.map((r) => [r.blockId, { width: r.width, height: r.height }]));
}
