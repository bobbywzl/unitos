import { regionBounds, type Region } from "@/lib/video/types";

// A PDF figure's image (the figure route, SPEC.md §16): its page rendered
// CROP_PAGE_WIDTH px wide and cut to its region, CROP_PAD percent of the page
// wider on every side; a figure without a region is its whole page,
// WHOLE_PAGE_WIDTH px wide. The page data sends each image's size
// (figureCropSize), so the page editor keeps the figure's place before the
// image loads and the words under it never jump.
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

/** The size in px of a PDF figure's image, on a page `page` points big. */
export function figureCropSize(region: Region | null, page: { width: number; height: number }) {
  const width = region ? CROP_PAGE_WIDTH : WHOLE_PAGE_WIDTH;
  const height = Math.round((width * page.height) / Math.max(1, page.width));
  if (!region) return { width, height };
  const box = cropBox(region, width, height, CROP_PAD);
  return { width: Math.round(box.width), height: Math.round(box.height) };
}
