// The page image URL (SPEC.md §16), one place for the reader, the finishing
// step, and the offline copy. The route answers with an immutable cache
// header, so a page drawn again needs a new URL: r is the renderer's
// revision. 2 = pdfjs-dist with its wasm decoders (lib/handwritten/pages.ts);
// before it, a scan's JBIG2, CCITT, and JPEG 2000 images drew white and the
// browser kept the white page for a year. A stored image older than this
// revision is drawn again on its next request (PageImage.renderRev).
export const PAGE_RENDER_REV = 2;

export function pageImageUrl(documentId: string, blockId: string): string {
  return `/api/documents/${documentId}/page/${blockId}?r=${PAGE_RENDER_REV}`;
}
