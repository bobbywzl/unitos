import type { PageSetup } from "@/lib/docs/schema";

// The page's numbers (SPEC.md §29), Google Docs': a point is 96/72 CSS px
// at 100%, pages sit 8 px apart border to border with a 1 px border outside
// each, and the paper sizes are Docs' list.

export const PX_PER_PT = 96 / 72;
/** Between two pages, border to border. */
export const PAGE_GAP = 8;
/** The page's border, drawn outside the page box. */
export const PAGE_BORDER = 1;
/** From one page's top to the next page's top, past the page's own height. */
export const PAGE_PITCH_EXTRA = PAGE_GAP + 2 * PAGE_BORDER;
/** Where the header and the footer start, from the page's edge, in points. */
export const DEFAULT_HF_MARGIN_PT = 36;

/** Pageless: the text column's width in px at 100% by Text width, and its
    least width. */
export const TEXT_WIDTHS = { narrow: 830, medium: 1030, wide: 1230, full: Number.POSITIVE_INFINITY } as const;
export type TextWidth = keyof typeof TEXT_WIDTHS;
export const PAGELESS_MIN_WIDTH = 600;
/** Pageless: the least room beside the text column, and above it. */
export const PAGELESS_SIDE = 40;
export const PAGELESS_TOP = 70;

export type Paper = { id: string; name: string; width: number; height: number; inches: string; cm: string };

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

export function isLandscape(setup: Pick<PageSetup, "width" | "height">): boolean {
  return setup.width > setup.height;
}

/** The ruler's and the dialog's unit: inches, or centimeters. */
export type LengthUnit = "in" | "cm";
export const PT_PER_UNIT: Record<LengthUnit, number> = { in: 72, cm: 72 / 2.54 };

/** Points in a unit, shown with up to 2 decimals ("1", "0.75"). */
export function formatLength(pt: number, unit: LengthUnit): string {
  const v = Math.round((pt / PT_PER_UNIT[unit]) * 100) / 100;
  return String(Object.is(v, -0) ? 0 : v);
}

/** The page in CSS px at 100%, with its margins and the header and footer
    margins; pageless drops the margins' top and bottom. */
export type PageFrame = {
  pageless: boolean;
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
    pageless: setup.pageless,
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
    wide at `scale`: the room there is, at least 600 px, at most the Text
    width's cap. */
export function pagelessWidth(available: number, scale: number, width: TextWidth): number {
  const room = available / scale - 2 * PAGELESS_SIDE;
  return Math.max(PAGELESS_MIN_WIDTH, Math.min(room, TEXT_WIDTHS[width]));
}
