// The page editor's margin (SPEC.md §29): the layer's toolbar and cards sit
// beside the page's right edge, level with their words, and the page moves
// left (--docs-shift) to make room for a card, as in Google Docs. Values are
// in the reader pane's coordinates.

const GAP = 16; // the page's edge to a card
const EDGE = 12; // a card to the pane's edge
const CARD_WIDTH = 282; // Google Docs' comment card
const CARD_MIN = 260;
const TOOLBAR_GAP = 8; // Google Docs' floating buttons sit 8 px out

export type PageGeometry = {
  cw: number;
  pageLeft: number;
  pageRight: number;
  textLeft: number;
  textRight: number;
  /** The leftmost the page can sit: the canvas's left padding. */
  minLeft: number;
};

/** The page and its text column with the current `shift` taken out; null
    when the pane shows an article. */
export function pageGeometry(container: HTMLElement | null, shift: number): PageGeometry | null {
  const page = container?.querySelector<HTMLElement>("[data-docs-page]");
  const text = container?.querySelector<HTMLElement>("[data-docs-body]");
  const canvas = page?.parentElement;
  if (!container || !page || !text || !canvas) return null;
  const left = container.getBoundingClientRect().left;
  const p = page.getBoundingClientRect();
  const t = text.getBoundingClientRect();
  return {
    cw: container.clientWidth,
    pageLeft: p.left - left + shift,
    pageRight: p.right - left + shift,
    textLeft: t.left - left + shift,
    textRight: t.right - left + shift,
    minLeft: canvas.getBoundingClientRect().left - left + (parseFloat(getComputedStyle(canvas).paddingLeft) || 0),
  };
}

/** A card with the page moved by `shift`: beside the page, else over its
    margin clear of the text; null when neither fits. */
export function slotAt(geo: PageGeometry, shift: number): { left: number; width: number } | null {
  for (const left of [geo.pageRight - shift + GAP, geo.textRight - shift + GAP]) {
    const width = Math.min(CARD_WIDTH, geo.cw - EDGE - left);
    if (width >= CARD_MIN) return { left, width };
  }
  return null;
}

/** A card's place and the least shift that gives it; null when the pane is
    too narrow, and the card goes under its words. */
export function marginPlace(geo: PageGeometry): { shift: number; left: number; width: number } | null {
  const most = Math.max(0, Math.floor(geo.pageLeft - geo.minLeft));
  for (const width of [CARD_WIDTH, CARD_MIN]) {
    const need = Math.max(0, Math.ceil(geo.pageRight + GAP + width + EDGE - geo.cw));
    const slot = need <= most ? slotAt(geo, need) : null;
    if (slot) return { shift: need, ...slot };
  }
  const slot = slotAt(geo, most);
  return slot && { shift: most, ...slot };
}

/** A card under its words: the text column's width, inside the pane. */
export function belowSlot(geo: PageGeometry, shift: number): { left: number; width: number } {
  const left = Math.max(8, geo.textLeft - shift);
  return { left, width: Math.max(CARD_MIN, Math.min(geo.textRight - geo.textLeft, geo.cw - 8 - left)) };
}

/** The toolbar's left: beside the page, else over its margin, never over the
    text; null when neither fits, and it goes under the words. */
export function toolbarLeft(geo: PageGeometry, shift: number, width: number): number | null {
  const beside = geo.pageRight - shift + TOOLBAR_GAP;
  if (beside + width <= geo.cw - 6) return beside;
  const over = geo.cw - width - 6;
  return over >= geo.textRight - shift + TOOLBAR_GAP ? over : null;
}
