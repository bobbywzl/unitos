import type { PageSetup } from "@/lib/docs/schema";

// The page's numbers (SPEC.md §29), Google Docs': a point is 96/72 CSS px
// at 100%, and the paper sizes are Docs' list.

export const PX_PER_PT = 96 / 72;
/** From one page's top to the next page's top, past the page's height: 8 px
    between pages, and each page's 1 px border outside the page box. */
export const PAGE_PITCH_EXTRA = 10;
/** Where the header and the footer start, from the page's edge, in points. */
export const DEFAULT_HF_MARGIN_PT = 36;
/** The least room the margins leave for text, in points. */
export const MIN_TEXT_PT = 36;

/** Pageless: the text column's width in px at 100% by Text width. */
const TEXT_WIDTHS = { narrow: 830, medium: 1030, wide: 1230, full: Number.POSITIVE_INFINITY } as const;
export type TextWidth = keyof typeof TEXT_WIDTHS;
/** Pageless: the room above the text column. */
export const PAGELESS_TOP = 70;

type Paper = { id: string; name: string; width: number; height: number; inches: string; cm: string };

/** Google Docs' paper sizes, in points (portrait). */
export const PAPERS: Paper[] = [
  { id: "letter", name: "Letter", width: 612, height: 792, inches: '8.5" x 11"', cm: "21.6cm x 27.9cm" },
  { id: "tabloid", name: "Tabloid", width: 792, height: 1224, inches: '11" x 17"', cm: "27.9cm x 43.2cm" },
  { id: "legal", name: "Legal", width: 612, height: 1008, inches: '8.5" x 14"', cm: "21.6cm x 35.6cm" },
  { id: "statement", name: "Statement", width: 396, height: 612, inches: '5.5" x 8.5"', cm: "14.0cm x 21.6cm" },
  { id: "executive", name: "Executive", width: 522, height: 756, inches: '7.25" x 10.5"', cm: "18.4cm x 26.7cm" },
  { id: "folio", name: "Folio", width: 612, height: 936, inches: '8.5" x 13"', cm: "21.6cm x 33.0cm" },
  { id: "a3", name: "A3", width: 841.89, height: 1190.55, inches: '11.69" x 16.54"', cm: "29.7cm x 42.0cm" },
  { id: "a4", name: "A4", width: 595.28, height: 841.89, inches: '8.27" x 11.69"', cm: "21.0cm x 29.7cm" },
  { id: "a5", name: "A5", width: 419.53, height: 595.28, inches: '5.83" x 8.27"', cm: "14.8cm x 21.0cm" },
  { id: "b4", name: "B4", width: 708.66, height: 1000.63, inches: '9.84" x 13.90"', cm: "25.0cm x 35.3cm" },
  { id: "b5", name: "B5", width: 498.9, height: 708.66, inches: '6.93" x 9.84"', cm: "17.6cm x 25.0cm" },
];

/** The paper a setup's page is, either way round, within 5 pt (Docs' own
    tolerance); null for a size off the list. */
export function paperOf(setup: Pick<PageSetup, "width" | "height">): Paper | null {
  const short = Math.min(setup.width, setup.height);
  const long = Math.max(setup.width, setup.height);
  return PAPERS.find((p) => Math.abs(p.width - short) <= 5 && Math.abs(p.height - long) <= 5) ?? null;
}

/** The ruler's and the dialog's unit: inches, or centimeters. */
export type LengthUnit = "in" | "cm";
export const PT_PER_UNIT: Record<LengthUnit, number> = { in: 72, cm: 72 / 2.54 };

/** Points in a unit, shown with up to 2 decimals ("1", "0.75"). */
export function formatLength(pt: number, unit: LengthUnit): string {
  const v = Math.round((pt / PT_PER_UNIT[unit]) * 100) / 100;
  return String(Object.is(v, -0) ? 0 : v);
}

/** A length typed in a unit ("1", "0,75"), in points; null when it is not a
    number of 0 or more. */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const n = Number(text.replace(",", "."));
  return text.trim() === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n * PT_PER_UNIT[unit] * 100) / 100;
}

/** The page in CSS px at 100%: its size, its margins, and the header and
    footer margins. */
export type PageFrame = {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  headerMargin: number;
  footerMargin: number;
  /** From one page's top to the next page's top. */
  pitch: number;
};

export function pageFrame(setup: PageSetup): PageFrame {
  const m = setup.margins;
  const height = setup.height * PX_PER_PT;
  return {
    width: setup.width * PX_PER_PT,
    height,
    top: m.top * PX_PER_PT,
    bottom: m.bottom * PX_PER_PT,
    left: m.left * PX_PER_PT,
    right: m.right * PX_PER_PT,
    headerMargin: (setup.headerMargin ?? DEFAULT_HF_MARGIN_PT) * PX_PER_PT,
    footerMargin: (setup.footerMargin ?? DEFAULT_HF_MARGIN_PT) * PX_PER_PT,
    pitch: height + PAGE_PITCH_EXTRA,
  };
}

/** Pageless: the text column's width at 100% for a canvas `available` px
    wide at `scale`: the room there is less 40 px each side, at least 600 px,
    at most the Text width's cap. */
export function pagelessWidth(available: number, scale: number, width: TextWidth): number {
  return Math.max(600, Math.min(available / scale - 80, TEXT_WIDTHS[width]));
}

/** The pane that scrolls the pages: the nearest ancestor that scrolls
    vertically. */
export function scrollParent(el: Element | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
  }
  return null;
}
