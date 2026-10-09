import { deflateSync } from "node:zlib";
import { sniffImage, type ImageMime } from "@/lib/handwritten/image";

// An image becomes a one-page PDF before ingest (SPEC.md §16), so it takes
// the handwritten path exactly as a scanned page does: the stored bytes are a
// PDF, the page renders through pdf.js, Circle & ask and conversion work
// unchanged — a new source, never a new parser. A JPEG embeds as it is, and
// its EXIF orientation becomes the page's rotation (and a mirror, for the
// four mirrored orientations), so a phone photo shows upright. Any other
// format decodes through @napi-rs/canvas onto a white ground and stores
// pixel for pixel (Flate) up to LOSSLESS_MAX_PIXELS, as JPEG above that.
// The canvas loads per call, like pages.ts.

// Pixel for pixel up to here (a Retina screenshot is about 5 MP); a larger
// image stores as JPEG — a photo, most likely, where JPEG is the right size.
const LOSSLESS_MAX_PIXELS = 6_000_000;
// The canvas path draws a huge image smaller: the page renders at 1400px
// wide (pages.ts), so pixels past this only cost memory.
const MAX_PIXELS = 24_000_000;
const JPEG_QUALITY = 92;
// The page fits inside Letter and never upscales: the page size sets the
// aspect only — every render scales to its own width.
const PAGE_MAX_WIDTH = 612;
const PAGE_MAX_HEIGHT = 792;

type Rotate = 0 | 90 | 180 | 270;
// EXIF orientation, 1-8; 1 = upright.
type Orientation = number;

type PdfImage = {
  width: number; // pixels
  height: number;
  colorSpace: "/DeviceRGB" | "/DeviceGray";
  filter: "/DCTDecode" | "/FlateDecode";
  data: Uint8Array;
  orientation: Orientation;
};

/** The image as a one-page PDF. Throws when the bytes are not an image the
    server decodes. */
export async function imageToPdf(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const mime = sniffImage(bytes);
  if (!mime) throw new Error("Not an image");
  const image = (mime === "image/jpeg" ? embedJpeg(bytes) : null) ?? (await decodeWithCanvas(bytes, mime));
  return wrapInPdf(image);
}

// ── JPEG as it is ───────────────────────────────────────────────────────────

type JpegHeader = {
  width: number;
  height: number;
  components: number;
  precision: number;
  // The SOF marker: which coding the file uses.
  sof: number;
  orientation: number; // EXIF, 1-8; 1 = upright
};

// pdf.js decodes Huffman-coded baseline, extended, and progressive JPEG. Any
// other coding (lossless, arithmetic, hierarchical) takes the canvas path.
const EMBEDDABLE_SOF = new Set([0xc0, 0xc1, 0xc2]);
// EXIF orientation → the page's /Rotate (clockwise): 6 = the camera was
// turned right, 8 = left, 3 = upside down. The mirrored values (2, 4, 5, 7)
// draw the image mirrored left to right, then turn the page: 2 = mirrored,
// 4 = mirrored and upside down, 5 = mirrored and turned left (transposed),
// 7 = mirrored and turned right (transversed) — Pillow's exif_transpose.
// Images benchmark finding: a mirrored orientation (a front camera, an
// edited photo) showed mirrored or on its side.
const ROTATE_FOR_ORIENTATION: Record<number, Rotate> = { 3: 180, 4: 180, 5: 270, 6: 90, 7: 90, 8: 270 };
const MIRRORED = new Set([2, 4, 5, 7]);

function embedJpeg(bytes: Uint8Array): PdfImage | null {
  const header = readJpegHeader(bytes);
  if (!header) return null;
  if (!EMBEDDABLE_SOF.has(header.sof) || header.precision !== 8) return null;
  if (header.components !== 1 && header.components !== 3) return null;
  return {
    width: header.width,
    height: header.height,
    colorSpace: header.components === 1 ? "/DeviceGray" : "/DeviceRGB",
    filter: "/DCTDecode",
    data: bytes,
    orientation: header.orientation,
  };
}

/** The frame header and the EXIF orientation, read marker by marker up to the
    scan. Null when the markers do not parse. */
function readJpegHeader(bytes: Uint8Array): JpegHeader | null {
  let width = 0;
  let height = 0;
  let components = 0;
  let precision = 0;
  let sof = 0;
  let orientation = 1;
  let i = 2; // past SOI
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // TEM, RSTn, SOI: standalone markers, no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    // EOI, SOS: the header is over.
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const start = i + 4;
    const end = i + 2 + length;
    if (end > bytes.length) return null;
    if (marker === 0xe1) orientation = exifOrientation(bytes.subarray(start, end)) ?? orientation;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (end - start < 6) return null;
      sof = marker;
      precision = bytes[start];
      height = (bytes[start + 1] << 8) | bytes[start + 2];
      width = (bytes[start + 3] << 8) | bytes[start + 4];
      components = bytes[start + 5];
    }
    i = end;
  }
  if (!width || !height || !components || !sof) return null;
  return { width, height, components, precision, sof, orientation };
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const startsWithExif = (data: Uint8Array) => data.length >= 6 && EXIF_HEADER.every((b, i) => data[i] === b);

/** The Orientation tag (0x0112) of an APP1 EXIF segment, or null. */
function exifOrientation(segment: Uint8Array): number | null {
  return startsWithExif(segment) ? tiffOrientation(segment.subarray(6)) : null;
}

/** The Orientation tag (0x0112) of EXIF data that starts at its TIFF header
    (byte order, 42, the offset of IFD0), or null. */
function tiffOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (o: number) =>
    o + 2 <= tiff.length ? (little ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1]) : -1;
  const u32 = (o: number) =>
    o + 4 <= tiff.length
      ? little
        ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0
        : ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0
      : -1;
  if (u16(2) !== 0x2a) return null;
  const ifd = u32(4);
  const count = u16(ifd);
  if (count < 0) return null;
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      // A SHORT sits in the first two bytes of the value field.
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** The EXIF orientation a PNG (its eXIf chunk) or a WebP (its EXIF chunk)
    carries, or 1. The canvas decodes these two as stored and leaves the
    orientation to the caller; a JPEG it turns upright itself. Images
    benchmark finding: a WebP or PNG picture with an orientation tag showed
    on its side or upside down. */
function containerOrientation(bytes: Uint8Array, mime: ImageMime): number {
  const fourcc = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  let exif: Uint8Array | null = null;
  if (mime === "image/png") {
    // Chunks after the 8-byte signature: length, type, data, CRC. eXIf
    // stands before the image data.
    for (let at = 8; at + 8 <= bytes.length; ) {
      const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
      const type = fourcc(at + 4);
      if (type === "eXIf") exif = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length));
      if (type === "eXIf" || type === "IDAT" || type === "IEND") break;
      at += 12 + length;
    }
  } else if (mime === "image/webp") {
    // RIFF chunks after "RIFF", the size, "WEBP": type, little-endian size,
    // data padded to an even length.
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = (bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24)) >>> 0;
      if (fourcc(at) === "EXIF") {
        exif = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
        break;
      }
      at += 8 + size + (size & 1);
    }
  }
  if (!exif) return 1;
  // Some writers keep the JPEG's "Exif\0\0" before the TIFF header.
  return tiffOrientation(startsWithExif(exif) ? exif.subarray(6) : exif) ?? 1;
}

// ── Everything else through the canvas ──────────────────────────────────────

async function decodeWithCanvas(bytes: Uint8Array, mime: ImageMime): Promise<PdfImage> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(bytes));
  const orientation = containerOrientation(bytes, mime);
  const sourceWidth = img.width;
  const sourceHeight = img.height;
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error("Image has no pixels");
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (sourceWidth * sourceHeight)));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // A transparent image (a screenshot with a cut-out) lands on white, as on
  // a page.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  if (width * height <= LOSSLESS_MAX_PIXELS) {
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
      rgb[q] = rgba[p];
      rgb[q + 1] = rgba[p + 1];
      rgb[q + 2] = rgba[p + 2];
    }
    return {
      width,
      height,
      colorSpace: "/DeviceRGB",
      filter: "/FlateDecode",
      data: new Uint8Array(deflateSync(rgb)),
      orientation,
    };
  }
  return {
    width,
    height,
    colorSpace: "/DeviceRGB",
    filter: "/DCTDecode",
    data: new Uint8Array(canvas.toBuffer("image/jpeg", JPEG_QUALITY)),
    orientation,
  };
}

// ── The PDF around the image ────────────────────────────────────────────────

const encoder = new TextEncoder();
const ascii = (text: string) => encoder.encode(text);

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// A PDF number: an integer as it is, else two decimals.
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** One page, the image filling it (PDF 1.4: a catalog, the page tree, the
    page, the image XObject, the content stream, and a classic xref table). */
function wrapInPdf(image: PdfImage): Uint8Array<ArrayBuffer> {
  const fit = Math.min(1, PAGE_MAX_WIDTH / image.width, PAGE_MAX_HEIGHT / image.height);
  const pageWidth = image.width * fit;
  const pageHeight = image.height * fit;
  // A mirrored orientation draws the image right to left across the page.
  const content = MIRRORED.has(image.orientation)
    ? `q -${num(pageWidth)} 0 0 ${num(pageHeight)} ${num(pageWidth)} 0 cm /Im0 Do Q`
    : `q ${num(pageWidth)} 0 0 ${num(pageHeight)} 0 0 cm /Im0 Do Q`;
  const turn = ROTATE_FOR_ORIENTATION[image.orientation] ?? 0;
  const rotate = turn ? ` /Rotate ${turn}` : "";
  const objects: Uint8Array[] = [
    ascii("<< /Type /Catalog /Pages 2 0 R >>"),
    ascii("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}]${rotate}` +
        " /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    ),
    concat([
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}` +
          ` /ColorSpace ${image.colorSpace} /BitsPerComponent 8 /Filter ${image.filter}` +
          ` /Length ${image.data.length} >>\nstream\n`,
      ),
      image.data,
      ascii("\nendstream"),
    ]),
    ascii(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
  ];
  // The header's second line is the binary comment the format asks for.
  const parts: Uint8Array[] = [ascii("%PDF-1.4\n"), Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let offset = parts[0].length + parts[1].length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const head = ascii(`${index + 1} 0 obj\n`);
    const tail = ascii("\nendobj\n");
    parts.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  });
  // Every xref entry is exactly 20 bytes: offset, generation, in use, and a
  // two-character line end.
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(offset),
    "%%EOF",
    "",
  ].join("\n");
  parts.push(ascii(xref));
  return concat(parts);
}
