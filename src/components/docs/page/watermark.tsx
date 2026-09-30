"use client";

import { useEffect, type CSSProperties } from "react";
import { fontStack, loadFontInUse } from "@/components/docs/fonts";
import { PX_PER_PT, type PageFrame } from "@/components/docs/page/geometry";
import { FADED_OPACITY, type TextWatermark, type Watermark } from "@/lib/docs/watermark";
import "./watermark.css";

// The watermark (SPEC.md §29) as each page draws it: in the page's sheet,
// behind the text and the header and footer, centered on the page, and in
// print. The words are drawn live in their face; an image fits the text
// area (Auto) or takes a share of its own size.

/** A text watermark's line height over its size. */
const LINE = 1.2;
/** The Word download's image of the words: twice their size, at most this many px a side. */
const IMAGE_MAX_PX = 8000;

/** The CSS font of a text watermark. */
function fontOf(mark: TextWatermark): string {
  return `${mark.italic ? "italic " : ""}${mark.bold ? 700 : 400} ${mark.size * PX_PER_PT}px ${fontStack(mark.font)}`;
}

export function WatermarkMark({ mark, frame }: { mark: Watermark; frame: PageFrame }) {
  const face = mark.kind === "text" ? mark.font : null;
  const bold = mark.kind === "text" && mark.bold;
  // A face the page's font list leaves out loads first.
  useEffect(() => {
    if (face) loadFontInUse(face, bold ? 700 : 400);
  }, [face, bold]);
  if (mark.kind === "text") {
    const style: CSSProperties = {
      font: fontOf(mark),
      lineHeight: LINE,
      color: mark.color,
      opacity: mark.opacity,
      transform: mark.diagonal ? "rotate(-45deg)" : undefined,
    };
    return (
      <div className="docs-watermark" data-watermark="text">
        <span style={style}>{mark.text}</span>
      </div>
    );
  }
  const size: CSSProperties =
    mark.scale === null
      ? { width: frame.width - frame.left - frame.right, height: frame.height - frame.top - frame.bottom, objectFit: "contain" }
      : { zoom: mark.scale };
  return (
    <div className="docs-watermark" data-watermark="image">
      {/* eslint-disable-next-line @next/next/no-img-element -- a stored image or any address, at its own size */}
      <img src={mark.src} alt="" draggable={false} style={{ ...size, opacity: mark.faded ? FADED_OPACITY : 1 }} />
    </div>
  );
}

/** A text watermark drawn as an image for the Word download, as the page
    draws it: the file (twice the size) and its size in px at 100%. Null
    when the browser cannot draw it. */
export async function textWatermarkImage(mark: TextWatermark): Promise<{ file: File; width: number; height: number } | null> {
  try {
    const font = fontOf(mark);
    loadFontInUse(mark.font, mark.bold ? 700 : 400);
    await document.fonts.load(font, mark.text).catch(() => []);
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.font = font;
    const w = Math.max(1, g.measureText(mark.text).width);
    const h = mark.size * PX_PER_PT * LINE;
    const turn = mark.diagonal ? Math.PI / 4 : 0;
    const width = w * Math.cos(turn) + h * Math.sin(turn);
    const height = w * Math.sin(turn) + h * Math.cos(turn);
    const scale = Math.min(2, IMAGE_MAX_PX / width, IMAGE_MAX_PX / height);
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    // A new size clears the drawing state: the font goes on again.
    g.scale(scale, scale);
    g.translate(width / 2, height / 2);
    g.rotate(-turn);
    g.font = font;
    g.fillStyle = mark.color;
    g.globalAlpha = mark.opacity;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(mark.text, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? { file: new File([blob], "watermark.png", { type: "image/png" }), width, height } : null;
  } catch {
    return null;
  }
}
