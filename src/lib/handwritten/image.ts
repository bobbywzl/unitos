// Image documents (SPEC.md §16): a dropped or uploaded image imports as one
// handwritten page. This file is imported by both the client (the drop
// filter, the file input, the upload assistant) and the server (the sniff
// before ingest) — one definition of what is supported, never two that can
// drift apart. The PDF wrap itself lives in image-pdf.ts, server only.

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp";

// The formats the server decodes (@napi-rs/canvas), by mime type and by
// extension — a dropped file's type is empty on some platforms.
const IMAGE_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);
export const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp)$/i;

// The file input's accept list: the same formats.
export const IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.bmp";

export function isImageFile(file: { type: string; name: string }): boolean {
  return IMAGE_MIME_TYPES.has(file.type) || IMAGE_EXTENSIONS.test(file.name);
}

// The DIB header sizes a BMP starts its second header with.
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 108, 124]);

/** The image format the bytes carry, read from their first bytes; null for
    anything else (a PDF, a video, text). */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  const at = (i: number) => (i < bytes.length ? bytes[i] : -1);
  const ascii = (start: number, text: string) => {
    for (let i = 0; i < text.length; i++) if (at(start + i) !== text.charCodeAt(i)) return false;
    return true;
  };
  if (at(0) === 0x89 && ascii(1, "PNG") && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return "image/png";
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "BM") && bytes.length >= 26) {
    const dibSize = at(14) | (at(15) << 8) | (at(16) << 16) | (at(17) << 24);
    if (BMP_HEADER_SIZES.has(dibSize)) return "image/bmp";
  }
  return null;
}
