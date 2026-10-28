// HEIC photos (an iPhone's camera format) in the page editor: the browser
// turns one into a JPEG before it uploads, because the server stores and
// draws png, jpg, gif, webp, and bmp only (lib/handwritten/image.ts) and
// Chrome cannot draw a HEIC. Client only: the decoder (heic-to, libheif in
// wasm, about 3 MB) loads the first time a HEIC is added, never before.

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_EXTENSIONS = /\.(heic|heif)$/i;

/** The file input's accept list for HEIC, beside IMAGE_ACCEPT. */
export const HEIC_ACCEPT = "image/heic,image/heif,.heic,.heif";

/** The longest side of a converted photo, in px: a 12 MP iPhone photo
    (4032 × 3024) keeps its size; a 48 MP one is scaled down, so its JPEG
    stays under the upload caps (lib/images.ts). */
const MAX_SIDE = 4096;
const QUALITY = 0.9;

export function isHeicFile(file: { type: string; name: string }): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || HEIC_EXTENSIONS.test(file.name);
}

/** `file` as a JPEG named like it ("IMG_5179.HEIC" → "IMG_5179.jpg"), or
    null when the browser cannot read it; the error goes to the console. */
export async function heicToJpeg(file: File): Promise<File | null> {
  try {
    const { heicTo } = await import("heic-to");
    const bitmap = await heicTo({ blob: file, type: "bitmap" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) return null;
    const name = `${file.name.replace(HEIC_EXTENSIONS, "") || "image"}.jpg`;
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch (err) {
    console.warn("HEIC not read:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
