// The page editor's margin (SPEC.md §29): where the Unitos layer puts its
// selection toolbar and its cards, the way Google Docs puts its floating
// buttons and its comment cards — beside the page's right edge, level with
// the words — and how far the page moves left to make room for a card, as
// Google Docs moves the page when comments are open. Geometry is in the
// reader pane's coordinates (reader-interactions.tsx), which carries the
// shift as --docs-shift.

/** Between the page's right edge (or the text column's) and a card. */
const MARGIN_GAP = 16;
/** Between a card and the pane's right edge. */
const EDGE = 12;
/** A card in the margin: Google Docs' comment card is 282 px wide. */
const MARGIN_CARD_WIDTH = 282;
/** The narrowest card the margin takes before cards dock under their words. */
const CARD_MIN = 260;
/** Google Docs' floating buttons: a 40 px pill centered 28 px right of the
    page's edge, so its left side is 8 px out. */
const TOOLBAR_GAP = 8;

export type PageGeometry = {
  /** The pane's width. */
  cw: number;
  /** The page's edges and the text column's, as they sit with the page
      unshifted. */
  pageLeft: number;
  pageRight: number;
  textLeft: number;
  textRight: number;
  /** The leftmost the page can sit: the canvas's own left padding, which
      the outline panel widens when it is open. */
  minLeft: number;
};

/** The page's geometry in a pane that shows the page editor, with `shift` —
    the shift the page has now — taken back out; null when the pane shows an
    article. */
export function pageGeometry(container: HTMLElement | null, shift: number): PageGeometry | null {
  const page = container?.querySelector<HTMLElement>("[data-docs-page]");
  const text = container?.querySelector<HTMLElement>("[data-docs-body]");
  if (!container || !page || !text) return null;
  const crect = container.getBoundingClientRect();
  const p = page.getBoundingClientRect();
  const t = text.getBoundingClientRect();
  const canvas = page.parentElement;
  const minLeft = canvas
    ? canvas.getBoundingClientRect().left - crect.left + (parseFloat(getComputedStyle(canvas).paddingLeft) || 0)
    : 0;
  return {
    cw: container.clientWidth,
    pageLeft: p.left - crect.left + shift,
    pageRight: p.right - crect.left + shift,
    textLeft: t.left - crect.left + shift,
    textRight: t.right - crect.left + shift,
    minLeft,
  };
}

/** A card's place with the page moved by `shift`: beside the page, else over
    the page's right margin clear of the text column; null when neither
    fits. */
export function slotAt(geo: PageGeometry, shift: number): { left: number; width: number } | null {
  for (const left of [geo.pageRight - shift + MARGIN_GAP, geo.textRight - shift + MARGIN_GAP]) {
    const width = Math.min(MARGIN_CARD_WIDTH, geo.cw - EDGE - left);
    if (width >= CARD_MIN) return { left, width };
  }
  return null;
}

export type MarginPlace = { shift: number; left: number; width: number };

/** A card's place in the margin and the least shift that gives it: beside
    the page at full width, else beside it at the least width, else over the
    page's margin with the page at its left edge. Null when the pane is too
    narrow for all three: the card docks under its words. */
export function marginPlace(geo: PageGeometry): MarginPlace | null {
  const most = Math.max(0, Math.floor(geo.pageLeft - geo.minLeft));
  for (const width of [MARGIN_CARD_WIDTH, CARD_MIN]) {
    const need = Math.max(0, Math.ceil(geo.pageRight + MARGIN_GAP + width + EDGE - geo.cw));
    const slot = need <= most ? slotAt(geo, need) : null;
    if (slot) return { shift: need, ...slot };
  }
  const slot = slotAt(geo, most);
  return slot ? { shift: most, ...slot } : null;
}

/** A card under its words when the margin has no room: the text column's
    width, inside the pane. */
export function belowSlot(geo: PageGeometry, shift: number): { left: number; width: number } {
  const left = Math.max(8, geo.textLeft - shift);
  return { left, width: Math.max(260, Math.min(geo.textRight - geo.textLeft, geo.cw - 8 - left)) };
}

/** Where the selection toolbar sits, `width` wide, with the page moved by
    `shift`: beside the page's right edge when the room is there, else over
    the page's right margin — never over the text column. Null when neither
    fits: the toolbar goes under the words. */
export function toolbarLeft(geo: PageGeometry, shift: number, width: number): number | null {
  const beside = geo.pageRight - shift + TOOLBAR_GAP;
  if (beside + width <= geo.cw - 6) return beside;
  const over = geo.cw - width - 6;
  return over >= geo.textRight - shift + TOOLBAR_GAP ? over : null;
}
