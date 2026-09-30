import { z } from "zod";

// Insert > Watermark (SPEC.md §29), Google Docs': words or an image behind
// the text of every page, centered on the page. Pageless shows none. The
// page draws the words live (page/watermark.tsx); the Word download takes
// them as the image the dialog drew (`image`), and an image watermark as its
// image, faded when Faded is on.

/** Faded: an image watermark's opacity. */
export const FADED_OPACITY = 0.3;
/** Scale: Auto (null) or a share of the image's own size. */
export const WATERMARK_SCALES = [0.5, 1, 1.5, 2] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[\w\s'\-.]{1,80}$/;
/** A stored image's address or an image on the web. */
const SRC = /^(\/api\/images\/[a-z0-9]+|https?:\/\/\S+)$/i;
const src = z.string().max(2000).regex(SRC);

const textWatermarkSchema = z.object({
  kind: z.literal("text"),
  text: z.string().trim().min(1).max(200),
  font: z.string().regex(FONT),
  /** In points. */
  size: z.number().min(8).max(400),
  bold: z.boolean(),
  italic: z.boolean(),
  color: z.string().regex(HEX),
  opacity: z.number().min(0.05).max(1),
  /** Diagonal: the words rise 45° from left to right; else Horizontal. */
  diagonal: z.boolean(),
  /** The words drawn as an image, for the Word download: its address and
      its size in px at 100%. */
  image: z
    .object({ src, width: z.number().min(1).max(20_000), height: z.number().min(1).max(20_000) })
    .nullable()
    .optional(),
});

const imageWatermarkSchema = z.object({
  kind: z.literal("image"),
  src,
  /** Null is Auto: the image fits the text area. */
  scale: z.number().min(0.1).max(5).nullable(),
  faded: z.boolean(),
});

export const watermarkSchema = z.discriminatedUnion("kind", [textWatermarkSchema, imageWatermarkSchema]);

export type Watermark = z.infer<typeof watermarkSchema>;
export type TextWatermark = z.infer<typeof textWatermarkSchema>;
export type ImageWatermark = z.infer<typeof imageWatermarkSchema>;

/** A new text watermark's look: Google Docs' gray, half seen, diagonal. */
export const DEFAULT_TEXT_WATERMARK: TextWatermark = {
  kind: "text",
  text: "",
  font: "Arial",
  size: 60,
  bold: false,
  italic: false,
  color: "#999999",
  opacity: 0.5,
  diagonal: true,
};

type Size = { width: number; height: number };

/** An image watermark's size in px at 100%: Auto fits `room` (the text
    area); a scale is a share of the image's own size `natural`. */
export function watermarkImageSize(scale: number | null, natural: Size, room: Size): Size {
  const k = scale ?? Math.min(room.width / natural.width, room.height / natural.height);
  return { width: natural.width * k, height: natural.height * k };
}

/** Two text watermarks draw the same words the same way. */
export function sameTextLook(a: TextWatermark, b: TextWatermark): boolean {
  return (
    a.text === b.text &&
    a.font === b.font &&
    a.size === b.size &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color.toLowerCase() === b.color.toLowerCase() &&
    a.opacity === b.opacity &&
    a.diagonal === b.diagonal
  );
}
