// The page editor's margin (SPEC.md §29): where the Unitos layer puts its
// selection toolbar and its cards, the way Google Docs puts its floating
// buttons and its comment cards — beside the page's right edge, level with
// the words — and how far the page moves left to make room for a card, as
// Google Docs moves the page when comments are open. Geometry is in the
// reader pane's coordinates (reader-interactions.tsx); the page moves by
// the pane's --docs-shift (css/layer.css).

/** Between the page's right edge (or the text column's) and a card. */
const MARGIN_GAP = 16;
/** Between a card and the pane's right edge. */
const EDGE = 12;
/** The page never moves closer than this to the pane's left edge: the
    canvas's own padding (docs.css .docs-canvas). */
const MIN_LEFT = 24;
/** A card in the margin; Google's comment card is 282 px wide. */
const CARD_WIDTH = 300;
/** The narrowest card the margin takes before cards dock under their words. */
const CARD_MIN = 260;

export type PageGeometry = {
  /** The pane's width. */
  cw: number;
  /** The page's edges and the text column's right edge, as they sit with
      the page unshifted. */
  pageLeft: number;
  pageRight: number;
  textRight: number;
};

/** The page's geometry in a pane that shows the page editor, with the shift
    it has now taken back out; null when the pane shows an article. */
export function pageGeometry(container: HTMLElement | null, shift: number): PageGeometry | null {
  const page = container?.querySelector<HTMLElement>("[data-docs-page]");
  const text = container?.querySelector<HTMLElement>("[data-docs-body]");
  if (!container || !page || !text) return null;
  const crect = container.getBoundingClientRect();
  const p = page.getBoundingClientRect();
  const t = text.getBoundingClientRect();
  return {
    cw: container.clientWidth,
    pageLeft: p.left - crect.left + shift,
    pageRight: p.right - crect.left + shift,
    textRight: t.right - crect.left + shift,
  };
}

export type MarginPlace = { shift: number; left: number; width: number };

/** A card's place in the margin and the shift it needs: beside the page when
    the page can move left far enough; else over the page's right margin,
    clear of the text column, with the page at its left edge. Null when
    neither fits: the card docks under its words. */
export function marginPlace(geo: PageGeometry): MarginPlace | null {
  const maxShift = Math.max(0, Math.floor(geo.pageLeft - MIN_LEFT));
  for (const width of [CARD_WIDTH, CARD_MIN]) {
    const need = Math.ceil(geo.pageRight + MARGIN_GAP + width + EDGE - geo.cw);
    if (need > maxShift) continue;
    const shift = Math.max(0, need);
    const left = geo.pageRight - shift + MARGIN_GAP;
    return { shift, left, width: Math.min(CARD_WIDTH, geo.cw - EDGE - left) };
  }
  const left = geo.textRight - maxShift + MARGIN_GAP;
  const width = Math.min(CARD_WIDTH, geo.cw - EDGE - left);
  return width >= CARD_MIN ? { shift: maxShift, left, width } : null;
}

/** A card's place with the page moved by `shift` already: the same column. */
export function marginSlot(geo: PageGeometry, shift: number): { left: number; width: number } {
  const beside = geo.pageRight - shift + MARGIN_GAP;
  const left = beside + CARD_MIN + EDGE <= geo.cw ? beside : geo.textRight - shift + MARGIN_GAP;
  return { left, width: Math.max(CARD_MIN, Math.min(CARD_WIDTH, geo.cw - EDGE - left)) };
}

/** Where the selection toolbar sits, `width` wide, with the page moved by
    `shift`: beside the page's right edge when the room is there, else over
    the page's right margin — never over the text column. Null when neither
    fits: the toolbar goes under the words. */
export function toolbarLeft(geo: PageGeometry, shift: number, width: number): number | null {
  const beside = geo.pageRight - shift + 10;
  if (beside + width <= geo.cw - 6) return beside;
  const over = geo.cw - width - 6;
  return over >= geo.textRight - shift + 8 ? over : null;
}
