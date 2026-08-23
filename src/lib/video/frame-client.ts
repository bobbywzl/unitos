"use client";

import { regionBounds, type Region } from "@/lib/video/types";

// The real frame of a YouTube video at a moment, as a JPEG data URL
// (SPEC.md §11). The player's iframe is cross-origin, so the frame comes from
// the storyboard sheet YouTube publishes for its scrubber — proxied through
// this origin so the canvas stays readable. With a region, the frame is
// cropped to what the reader circled, the same shape the upload path attaches.

type FrameMeta = { url: string; x: number; y: number; width: number; height: number };

const metaCache = new Map<string, FrameMeta | null>();

async function frameMeta(documentId: string, time: number): Promise<FrameMeta | null> {
  const key = `${documentId}@${time.toFixed(1)}`;
  const cached = metaCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(`/api/video/${documentId}/frame?t=${time.toFixed(1)}`);
    const meta = res.ok ? ((await res.json()) as FrameMeta) : null;
    metaCache.set(key, meta);
    return meta;
  } catch {
    metaCache.set(key, null);
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function captureStoryboardFrame(
  documentId: string,
  time: number,
  region: Region | null,
): Promise<string | null> {
  const meta = await frameMeta(documentId, time);
  if (!meta) return null;
  const img = await loadImage(meta.url);
  if (!img) return null;

  // The tile, then the circled part of it with a little context around.
  let sx = meta.x;
  let sy = meta.y;
  let sw = meta.width;
  let sh = meta.height;
  if (region) {
    const b = regionBounds(region);
    const pad = 2.5; // percent of the frame
    const x1 = Math.max(0, (b.x1 - pad) / 100) * meta.width;
    const y1 = Math.max(0, (b.y1 - pad) / 100) * meta.height;
    const x2 = Math.min(100, b.x2 + pad) / 100 * meta.width;
    const y2 = Math.min(100, b.y2 + pad) / 100 * meta.height;
    if (x2 - x1 > 8 && y2 - y1 > 8) {
      sx = meta.x + x1;
      sy = meta.y + y1;
      sw = x2 - x1;
      sh = y2 - y1;
    }
  }

  try {
    const canvas = document.createElement("canvas");
    // Storyboard tiles are small. Scale the crop up so the model is not handed
    // a thumbnail of a thumbnail; it adds no detail, only legible size.
    const scale = Math.max(1, Math.min(4, 480 / Math.max(sw, sh)));
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}
