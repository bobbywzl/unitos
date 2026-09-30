// Mask image (SPEC.md §29), Google Docs' crop to a shape: an image drawn
// inside a shape instead of its rectangle. Each shape is one SVG path in a
// box one unit wide and one unit high, stretched to the image's box: the
// page clips the image with it (insert/image.ts) and draws the image's
// border along it; the Word download clips the image's pixels with it
// (lib/docs/export.ts).

export const MASKS = ["rounded", "oval", "triangle", "diamond", "pentagon", "hexagon", "star", "heart"] as const;

export type Mask = (typeof MASKS)[number];

export function isMask(value: unknown): value is Mask {
  return typeof value === "string" && (MASKS as readonly string[]).includes(value);
}

const n = (v: number) => String(Math.round(v * 10_000) / 10_000);

/** A five-pointed star that fills its box. */
function star(): string {
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 0.5 : 0.2;
    return [0.5 + r * Math.cos(angle), 0.5 + r * Math.sin(angle)];
  });
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return `M${points.map(([x, y]) => `${n((x - x0) / (x1 - x0))},${n((y - y0) / (y1 - y0))}`).join(" L")} Z`;
}

const PATHS: Record<Mask, string> = {
  rounded: "M0.12,0 H0.88 A0.12,0.12 0 0 1 1,0.12 V0.88 A0.12,0.12 0 0 1 0.88,1 H0.12 A0.12,0.12 0 0 1 0,0.88 V0.12 A0.12,0.12 0 0 1 0.12,0 Z",
  oval: "M0.5,0 A0.5,0.5 0 1 1 0.5,1 A0.5,0.5 0 1 1 0.5,0 Z",
  triangle: "M0.5,0 L1,1 L0,1 Z",
  diamond: "M0.5,0 L1,0.5 L0.5,1 L0,0.5 Z",
  pentagon: "M0.5,0 L1,0.382 L0.809,1 L0.191,1 L0,0.382 Z",
  hexagon: "M0.25,0 L0.75,0 L1,0.5 L0.75,1 L0.25,1 L0,0.5 Z",
  star: star(),
  heart: "M0.5,0.3 C0.5,0.27 0.45,0 0.25,0 C0,0 0,0.3 0,0.3 C0,0.55 0.25,0.77 0.5,1 C0.75,0.77 1,0.55 1,0.3 C1,0.3 1,0 0.75,0 C0.55,0 0.5,0.27 0.5,0.3 Z",
};

/** The shape's path in the unit box. */
export function maskPath(mask: Mask): string {
  return PATHS[mask];
}
