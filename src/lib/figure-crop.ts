import { regionBounds, type Region } from "@/lib/video/types";

// A PDF figure's image (the figure route, SPEC.md §16): its page rendered
// CROP_PAGE_WIDTH px wide and cut to its region, CROP_PAD percent of the page
// wider on every side; a figure without a region is its whole page,
// WHOLE_PAGE_WIDTH px wide. The page data sends the size each image is
// drawn at (figureCropSize: its printed size), so the page editor keeps the
// figure's place before the image loads and the words under it never jump.
export const CROP_PAGE_WIDTH = 2000;
export const WHOLE_PAGE_WIDTH = 1200;
export const CROP_PAD = 0.15;

/** The part of a page image `width` × `height` px that a crop takes: the
    region's bounding box, `pad` percent of the page wider on every side,
    clamped to the page. */
export function cropBox(region: Region, width: number, height: number, pad: number) {
  const b = regionBounds(region);
  const x1 = (Math.max(0, b.x1 - pad) / 100) * width;
  const y1 = (Math.max(0, b.y1 - pad) / 100) * height;
  const x2 = (Math.min(100, b.x2 + pad) / 100) * width;
  const y2 = (Math.min(100, b.y2 + pad) / 100) * height;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** The px (96 to the inch) a PDF figure's image takes in the page editor,
    on a page `page` points big: the size the PDF prints it at, scaled down
    to fit the page's text box when it would not (the import's 1 in margins
    are wider than many a PDF's). Drawn at the column's width, a figure of
    one column of a two-column paper drew twice its printed size, and a
    figure as tall as its page ran onto the next page. */
export function figureCropSize(
  region: Region | null,
  page: { width: number; height: number; margins?: { top: number; right: number; bottom: number; left: number } },
) {
  const px = 96 / 72;
  const [pageWidth, pageHeight] = [page.width * px, page.height * px];
  const box = region ? cropBox(region, pageWidth, pageHeight, CROP_PAD) : { width: pageWidth, height: pageHeight };
  const m = page.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const room = { width: pageWidth - (m.left + m.right) * px, height: pageHeight - (m.top + m.bottom) * px };
  const scale = Math.min(1, room.width / Math.max(1, box.width), room.height / Math.max(1, box.height));
  return { width: Math.max(1, Math.round(box.width * scale)), height: Math.max(1, Math.round(box.height * scale)) };
}
