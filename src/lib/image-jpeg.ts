// Photos the server would not take as they are, made into a JPEG in the
// browser before they upload (page editor and notes):
// - a HEIC photo (an iPhone's camera format): the server stores and draws
//   png, jpg, gif, webp, and bmp only (lib/handwritten/image.ts), and Chrome
//   cannot draw a HEIC;
// - an image over the size cap for the reader's tier (lib/images.ts): a
//   photo copied from Photos or an iPhone pastes as a PNG of 15 to 40 MB.
// Client only. The HEIC decoder (heic-to, libheif in wasm, about 3 MB) loads
// the first time a HEIC is added, never before.

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_EXTENSIONS = /\.(heic|heif)$/i;
// What the browser itself draws onto a canvas. Not a GIF: it may move.
const DRAWN_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp"]);
const DRAWN_EXTENSIONS = /\.(png|jpe?g|webp|bmp)$/i;

/** The file input's accept list for HEIC, beside IMAGE_ACCEPT. */
export const HEIC_ACCEPT = "image/heic,image/heif,.heic,.heif";

/** The longest side of a JPEG made here, in px: a 12 MP iPhone photo
    (4032 × 3024) keeps its size; a 24 or 48 MP one is scaled down. */
const MAX_SIDE = 4096;
const QUALITY = 0.9;
// Below this quality the JPEG gets smaller sides instead.
const MIN_QUALITY = 0.7;
const MAX_TRIES = 8;

export function isHeicFile(file: { type: string; name: string }): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || HEIC_EXTENSIONS.test(file.name);
}

/** Whether `file` goes in as a JPEG made here: a HEIC photo, or a png,
    jpg, webp, or bmp larger than `maxBytes`. */
export function needsJpeg(file: { type: string; name: string; size: number }, maxBytes: number): boolean {
  if (isHeicFile(file)) return true;
  const drawn = DRAWN_TYPES.has(file.type.toLowerCase()) || (!file.type && DRAWN_EXTENSIONS.test(file.name));
  return drawn && file.size > maxBytes;
}

async function decode(file: File): Promise<ImageBitmap> {
  if (!isHeicFile(file)) return createImageBitmap(file);
  const { heicTo } = await import("heic-to");
  return heicTo({ blob: file, type: "bitmap" });
}

/** `file` as a JPEG of at most `maxBytes`, named like it ("IMG_5179.HEIC"
    → "IMG_5179.jpg"): its longest side at most 4096 px, on white (a PNG's
    clear parts), quality 0.9; lower quality, then smaller sides, until it
    fits. Null when the browser cannot read it or it does not fit; the
    error goes to the console. */
export async function imageToJpeg(file: File, maxBytes: number): Promise<File | null> {
  try {
    const bitmap = await decode(file);
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    let quality = QUALITY;
    const canvas = document.createElement("canvas");
    let blob: Blob | null = null;
    for (let i = 0; i < MAX_TRIES; i++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      if (canvas.width !== width || canvas.height !== height || i === 0) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) break;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
      }
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.size <= maxBytes) break;
      if (quality > MIN_QUALITY + 0.01) quality -= 0.1;
      else scale *= 0.75;
    }
    bitmap.close();
    if (!blob || blob.size > maxBytes) {
      console.warn("Image not made small enough:", file.name, blob?.size ?? 0, maxBytes);
      return null;
    }
    const base = file.name.replace(/\.[a-z0-9]+$/i, "") || "image";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch (err) {
    console.warn("Image not read:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** `files` with each one needsJpeg names made into a JPEG, in order, and
    the first the browser could not make one of (it stays out), or null. */
export async function jpegsWhereNeeded(
  files: File[],
  maxBytes: number,
): Promise<{ files: File[]; unread: File | null }> {
  const made = await Promise.all(files.map((file) => (needsJpeg(file, maxBytes) ? imageToJpeg(file, maxBytes) : file)));
  return {
    files: made.filter((file): file is File => file !== null),
    unread: files.find((_, i) => made[i] === null) ?? null,
  };
}
