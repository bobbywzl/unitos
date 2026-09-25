// The page editor's margin (SPEC.md §29): the layer's toolbar and cards sit
// beside the page's right edge, level with their words, and the page moves
// left (--docs-shift) to make room for a card, as in Google Docs. A pane too
// narrow for the card column lets it reach over the notes tray beside the
// pane, never over the text. Values are in the reader pane's coordinates.

const GAP = 16; // the page's edge to a card
const EDGE = 12; // a card to the window's edge
const CARD_WIDTH = 282; // Google Docs' comment card
const CARD_MIN = 260;
const TOOLBAR_GAP = 8; // Google Docs' floating buttons sit 8 px out
const TOOLBAR_EDGE = 6; // the toolbar to the window's edge

export type PageGeometry = {
  cw: number;
  /** How far right the toolbar and the cards may reach: the window's right
      edge, over the notes tray; in a split pane, the pane's own. */
  room: number;
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
  const split = container.querySelector("[data-docs-column]")?.hasAttribute("data-split");
  return {
    cw: container.clientWidth,
    room: split ? container.clientWidth : document.documentElement.clientWidth - left,
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
    const width = Math.min(CARD_WIDTH, geo.room - EDGE - left);
    if (width >= CARD_MIN) return { left, width };
  }
  return null;
}

/** A card's place and the least shift that gives it room in the pane, at
    most the page's way to the canvas's left edge; past that the card reaches
    over the notes tray. Null when there is no room at all, and the card goes
    under its words. */
export function marginPlace(geo: PageGeometry): { shift: number; left: number; width: number } | null {
  const most = Math.max(0, Math.floor(geo.pageLeft - geo.minLeft));
  const shift = Math.min(most, Math.max(0, Math.ceil(geo.pageRight + GAP + CARD_WIDTH + EDGE - geo.cw)));
  const slot = slotAt(geo, shift);
  return slot && { shift, ...slot };
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
  if (beside + width <= geo.room - TOOLBAR_EDGE) return beside;
  const over = geo.room - width - TOOLBAR_EDGE;
  return over >= geo.textRight - shift + TOOLBAR_GAP ? over : null;
}

/** The least shift, `shift` or more, that gives the toolbar a place clear of
    the text; null when even the page at the canvas's left edge leaves none. */
export function toolbarShift(geo: PageGeometry, shift: number, width: number): number | null {
  const need = Math.max(shift, Math.ceil(geo.textRight + TOOLBAR_GAP + width + TOOLBAR_EDGE - geo.room));
  return need <= Math.max(shift, Math.floor(geo.pageLeft - geo.minLeft)) ? need : null;
}
