import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

// Pagination (SPEC.md §29), Google Docs' way: line by line. A spacer at each
// page's end pushes what follows to the next page's text top. This module
// reads the layout with every spacer hidden and works out where they go:
//
// - a line that does not fit moves to the next page ("line" spacer);
// - a paragraph keeps at least two lines on each side of a split (Prevent
//   single lines), or moves whole;
// - a heading, the Title, and the Subtitle stay whole, on the page of the
//   paragraph after them (Keep lines together, Keep with next);
// - a table row, an image, and a line move whole ("row" and "block"
//   spacers); a table's pinned header rows stay with the row after them and
//   start every page the table continues on;
// - a page break sends what follows to the next page;
// - a footnote sits at the foot of the page that holds its number: the
//   line with the number moves on when the two do not fit.
//
// Every length is in CSS px at 100% zoom, from the editor's top.

export type SpacerKind = "block" | "line" | "row";

export type SpacerPlan = {
  kind: SpacerKind;
  /** The document position the spacer sits at. */
  pos: number;
  /** Where the spacer's bottom goes: the page's text top, content px. */
  target: number;
  /** A row spacer inside a table with pinned header rows: the table's
      position. The header is drawn again at the spacer's foot. */
  header?: number;
};

/** A footnote at its page's foot: its node's position, its top, its page,
    and whether it is the page's first (the separator line sits above it). */
export type FootnotePlan = { pos: number; top: number; page: number; first: boolean };

/** Page i's text area, in px from the page's own top. */
type PageArea = { top: number; bottom: number };

export type PaginationConfig = {
  /** Pages format; pageless has no pages. */
  enabled: boolean;
  /** From one page's top to the next page's top. */
  pitch: number;
  area: (page: number) => PageArea;
};

type PaginateResult = {
  spacers: SpacerPlan[];
  footnotes: FootnotePlan[];
  pages: number;
  /** Each textblock's natural height, content px: a later edit that keeps a
      paragraph's height changes nothing on the pages. */
  heights: Map<HTMLElement, number>;
};

type Ref = { id: string; dom: HTMLElement };
/** The pinned header rows of a row's table. */
type Header = { table: number; rows: HTMLElement[] };

type Unit = {
  type: "text" | "atom" | "row" | "break";
  pos: number;
  node: PMNode;
  dom: HTMLElement;
  /** Where a spacer goes when this unit moves whole: before the unit, or
      before the outermost block it starts (a list, a list item, a quote). */
  spacerPos: number;
  spacerKind: "block" | "row";
  /** The footnote numbers in it. */
  refs: Ref[];
  header: Header | null;
  keepNext: boolean;
  together: boolean;
  widow: boolean;
  breakBefore: boolean;
};

const EPS = 0.5;
/** Over a page's footnotes: the room for the separator line. */
const FOOTNOTE_GAP = 16;

function flag(node: PMNode, name: string): boolean | null {
  const value: unknown = node.attrs[name];
  return typeof value === "boolean" ? value : null;
}

/** Docs' named styles: Title, Subtitle, and the headings keep with next and
    keep their lines together; every style prevents single lines. A
    paragraph's own flags (ext/toolbar.ts, Line & paragraph spacing) win. */
function textFlags(node: PMNode) {
  const docStyle: unknown = node.attrs.docStyle;
  const titled = node.type.name === "heading" || docStyle === "title" || docStyle === "subtitle";
  return {
    keepNext: flag(node, "keepWithNext") ?? titled,
    together: flag(node, "keepLinesTogether") ?? titled,
    widow: flag(node, "preventSingleLines") ?? true,
    breakBefore: flag(node, "pageBreakBefore") ?? false,
  };
}

/** The layout units in document order — every textblock, table row, atom,
    and page break, each with its DOM — and the footnotes by id. */
function collectUnits(view: EditorView): { units: Unit[]; footnotes: Map<string, { pos: number; dom: HTMLElement }> } {
  const units: Unit[] = [];
  const footnotes = new Map<string, { pos: number; dom: HTMLElement }>();
  const dom = (pos: number): HTMLElement | null => {
    const el = view.nodeDOM(pos);
    return el instanceof HTMLElement ? el : null;
  };
  const refsIn = (node: PMNode, pos: number): Ref[] => {
    const refs: Ref[] = [];
    node.descendants((child, offset) => {
      const el = child.type.name === "footnoteReference" ? dom(pos + 1 + offset) : null;
      if (el) refs.push({ id: String(child.attrs.footnoteId), dom: el });
      return !child.isInline;
    });
    return refs;
  };
  const whole = { together: true, widow: false, breakBefore: false };
  const visit = (node: PMNode, pos: number, spacerPos: number, spacerKind: "block" | "row") => {
    const name = node.type.name;
    if (name === "table") {
      const header: Header = { table: pos, rows: [] };
      node.forEach((row, offset, index) => {
        const rowPos = pos + 1 + offset;
        const el = dom(rowPos);
        if (!el) return;
        const pinned = row.attrs.pinned === true && header.rows.length === index;
        if (pinned) header.rows.push(el);
        units.push({
          type: "row",
          pos: rowPos,
          node: row,
          dom: el,
          spacerPos: index === 0 ? spacerPos : rowPos,
          spacerKind: index === 0 ? spacerKind : "row",
          refs: refsIn(row, rowPos),
          header: pinned || header.rows.length === 0 ? null : header,
          keepNext: pinned,
          ...whole,
        });
      });
      return;
    }
    if (node.isTextblock) {
      const el = dom(pos);
      if (el) units.push({ type: "text", pos, node, dom: el, spacerPos, spacerKind, refs: refsIn(node, pos), header: null, ...textFlags(node) });
      return;
    }
    if (node.isLeaf || node.isAtom) {
      const el = dom(pos);
      const type = name === "pageBreak" ? "break" : "atom";
      if (el) units.push({ type, pos, node, dom: el, spacerPos, spacerKind, refs: [], header: null, keepNext: false, ...whole });
      return;
    }
    node.forEach((child, offset, index) => {
      const childPos = pos + 1 + offset;
      visit(child, childPos, index === 0 ? spacerPos : childPos, index === 0 ? spacerKind : "block");
    });
  };
  view.state.doc.forEach((child, offset) => {
    if (child.type.name !== "footnotes") return visit(child, offset, offset, "block");
    child.forEach((footnote, noteOffset) => {
      const el = dom(offset + 1 + noteOffset);
      if (el) footnotes.set(String(footnote.attrs.footnoteId), { pos: offset + 1 + noteOffset, dom: el });
    });
  });
  return { units, footnotes };
}

type Box = { top: number; bottom: number };
/** A line box in content px, and its top in client px (where the glyphs of
    the line before end and its own begin). */
type Line = Box & { clientTop: number };

const SKIP_TEXT = (n: Node) =>
  n.nodeType === Node.TEXT_NODE
    ? n.nodeValue
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_SKIP
    : n instanceof HTMLElement && n.hasAttribute("data-docs-spacer")
      ? NodeFilter.FILTER_REJECT
      : n.nodeName === "BR"
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;

/** Reads the natural layout. Every read is in content px. */
class Measure {
  readonly origin: number;
  readonly scale: number;
  private rects = new Map<number, Box>();
  private lineCache = new Map<HTMLElement, Line[]>();
  constructor(readonly view: EditorView) {
    const r = view.dom.getBoundingClientRect();
    this.origin = r.top;
    this.scale = view.dom.offsetWidth > 0 && r.width > 0 ? r.width / view.dom.offsetWidth : 1;
  }
  y(clientY: number): number {
    return (clientY - this.origin) / this.scale;
  }
  box(el: Element): Box {
    const r = el.getBoundingClientRect();
    return { top: this.y(r.top), bottom: this.y(r.bottom) };
  }
  height(el: Element): number {
    return el.getBoundingClientRect().height / this.scale;
  }
  unit(index: number, u: Unit): Box {
    let box = this.rects.get(index);
    if (!box) {
      const r = u.dom.getBoundingClientRect();
      // A unit that is not drawn (display: none) takes no room where the
      // unit before it ends.
      if (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0) {
        const before = index > 0 ? this.rects.get(index - 1) : undefined;
        const at = before ? before.bottom : 0;
        box = { top: at, bottom: at };
      } else {
        box = { top: this.y(r.top), bottom: this.y(r.bottom) };
      }
      this.rects.set(index, box);
    }
    return box;
  }
  marginTop(el: Element): number {
    const v = parseFloat(getComputedStyle(el).marginTop);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  /** A textblock's text: its top and bottom inside the padding. */
  contentBox(el: HTMLElement): Box {
    const box = this.box(el);
    const cs = getComputedStyle(el);
    const pt = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.borderTopWidth) || 0);
    const pb = (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    return { top: box.top + pt, bottom: box.bottom - pb };
  }
  /** A textblock's line boxes, top to bottom, from the boxes of its text and
      its line breaks in reading order: a box that starts below the current
      line's glyphs starts the next line. Two line boxes meet halfway between
      their glyphs; the first and the last run to the text's top and bottom. */
  lines(el: HTMLElement): Line[] {
    const cached = this.lineCache.get(el);
    if (cached) return cached;
    const glyphs: Box[] = [];
    const add = (r: DOMRect) => {
      if (r.height <= 0) return;
      const last = glyphs[glyphs.length - 1];
      if (last && r.top < last.bottom - Math.min(r.height, last.bottom - last.top) * 0.35) {
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else {
        glyphs.push({ top: r.top, bottom: r.bottom });
      }
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: SKIP_TEXT });
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) add(r);
      } else if (n instanceof Element) {
        for (const r of Array.from(n.getClientRects())) add(r);
      }
    }
    const content = this.contentBox(el);
    const tops = glyphs.map((g, i) => (i === 0 ? g.top : (glyphs[i - 1].bottom + g.top) / 2));
    const lines =
      glyphs.length === 0
        ? [{ top: content.top, bottom: content.bottom, clientTop: 0 }]
        : glyphs.map((_, i) => ({
            top: i === 0 ? content.top : this.y(tops[i]),
            bottom: i === glyphs.length - 1 ? content.bottom : this.y(tops[i + 1]),
            clientTop: tops[i],
          }));
    this.lineCache.set(el, lines);
    return lines;
  }
  /** The line of a textblock an element in it sits on. */
  lineOf(lines: Line[], el: HTMLElement): number {
    const b = this.box(el);
    const i = lines.findIndex((line) => (b.top + b.bottom) / 2 < line.bottom);
    return i < 0 ? lines.length - 1 : i;
  }
  /** The position where line `line` of a textblock starts: the first
      position drawn at or below the line's top. Null when there is none
      inside the textblock. */
  lineStart(u: Unit, line: Line): number | null {
    const from = u.pos + 1;
    const to = u.pos + u.node.nodeSize - 1;
    let lo = from + 1;
    let hi = to;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      let top: number;
      try {
        top = this.view.coordsAtPos(mid, 1).top;
      } catch {
        return null;
      }
      if (top >= line.clientTop - 0.5) {
        found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return found > from && found <= to ? found : null;
  }
}

/** Where the spacers and the footnotes go for the document as it lies now.
    Call it with every spacer hidden (display: none): it reads the natural
    layout. */
export function paginate(view: EditorView, config: PaginationConfig): PaginateResult {
  const { units, footnotes } = collectUnits(view);
  const m = new Measure(view);
  const first = config.area(0);
  const areaOf = (page: number): Box => {
    const a = config.area(page);
    return { top: page * config.pitch + a.top - first.top, bottom: page * config.pitch + a.bottom - first.top };
  };
  const out: SpacerPlan[] = [];
  let page = 0;
  let offset = 0;
  // The unit that starts the page (a spacer put it there, or the one before
  // it overflowed its page): nothing moves back past it.
  let firstOnPage = 0;
  // A textblock that continues from the page before: its lines before this.
  let startLine = 0;
  const snaps = new Map<number, { page: number; offset: number; outLength: number; firstOnPage: number; placed: number }>();

  // The footnotes placed so far, in the numbers' order, with their pages.
  const placed: { id: string; page: number }[] = [];
  const heightOf = new Map<string, number>();
  const footnoteHeight = (id: string) => {
    let h = heightOf.get(id);
    if (h === undefined) {
      const footnote = footnotes.get(id);
      h = footnote ? m.height(footnote.dom) : 0;
      heightOf.set(id, h);
    }
    return h;
  };
  /** Where the current page's text ends, over its footnotes and `more`. */
  const limit = (more: Ref[]) => {
    let h = more.reduce((sum, ref) => sum + footnoteHeight(ref.id), 0);
    let any = more.length > 0;
    for (let i = placed.length - 1; i >= 0 && placed[i].page === page; i--) {
      h += footnoteHeight(placed[i].id);
      any = true;
    }
    return areaOf(page).bottom - (any ? h + FOOTNOTE_GAP : 0) + EPS;
  };
  const place = (refs: Ref[]) => {
    for (const ref of refs) placed.push({ id: ref.id, page });
  };
  /** A unit's footnote numbers on its lines [from, to). */
  const refsOn = (u: Unit, from: number, to = Number.POSITIVE_INFINITY): Ref[] => {
    if (u.refs.length === 0 || u.type !== "text" || (from === 0 && to === Number.POSITIVE_INFINITY)) return u.refs;
    const lines = m.lines(u.dom);
    return u.refs.filter((ref) => {
      const line = m.lineOf(lines, ref.dom);
      return line >= from && line < to;
    });
  };
  const headerHeight = (header: Header | null) =>
    header ? m.box(header.rows[header.rows.length - 1]).bottom - m.box(header.rows[0]).top : 0;

  /** A block or row spacer at `pos` that starts page `to`; what follows it
      is `after`, else the unit at `next`. A row after a table's header rows
      starts under them. */
  const blockSpacer = (pos: number, kind: "block" | "row", to: number, next: number, header: Header | null = null) => {
    const target = areaOf(to).top + headerHeight(header);
    out.push(header ? { kind, pos, target, header: header.table } : { kind, pos, target });
    const after = view.nodeDOM(pos);
    if (after instanceof HTMLElement && !after.hasAttribute("data-docs-spacer")) {
      offset = target + (kind === "row" ? 0 : m.marginTop(after)) - m.box(after).top;
    } else if (next < units.length) {
      offset = target - m.unit(next, units[next]).top;
    }
    page = to;
  };

  // Every pass through the loop places a unit or starts a page.
  let guard = units.length * 6 + 5000;
  let k = 0;
  while (k < units.length && guard-- > 0) {
    const u = units[k];
    if (startLine === 0 && !snaps.has(k)) snaps.set(k, { page, offset, outLength: out.length, firstOnPage, placed: placed.length });
    const box = m.unit(k, u);

    if (u.type === "break") {
      // What follows the break starts the next page.
      blockSpacer(u.pos + u.node.nodeSize, "block", page + 1, k + 1);
      k += 1;
      firstOnPage = k;
      startLine = 0;
      continue;
    }

    const forced = u.breakBefore && k > firstOnPage && startLine === 0;
    const bottom = box.bottom + offset;
    const rest = refsOn(u, startLine);
    let fits = !forced && bottom <= limit(rest);
    if (!fits && !forced && u.type === "text" && u.together) {
      // Only the space after the paragraph runs past the page: it fits.
      fits = m.contentBox(u.dom).bottom + offset <= limit(rest);
    }
    if (fits) {
      place(rest);
      k += 1;
      startLine = 0;
      continue;
    }

    if (u.type === "text" && !u.together && !forced) {
      const lines = m.lines(u.dom);
      let x = -1;
      for (let i = startLine; i < lines.length; i++) {
        if (lines[i].bottom + offset > limit(refsOn(u, startLine, i + 1))) {
          x = i;
          break;
        }
      }
      if (x === -1) {
        place(rest);
        k += 1;
        startLine = 0;
        continue;
      }
      if (u.widow && lines.length >= 2) {
        // Prevent single lines: never one line of the paragraph alone at a
        // page's bottom or at the next page's top.
        if (lines.length - x === 1 && x - 1 > startLine) x -= 1;
        if (x === 1 && startLine === 0) x = 0;
      }
      if (x === startLine && k === firstOnPage) {
        // Not even one line fits on the page: the line runs past its end,
        // and the page after takes the next line.
        x += 1;
        if (x >= lines.length) {
          place(rest);
          firstOnPage = k;
          k += 1;
          startLine = 0;
          continue;
        }
      }
      if (x > startLine) {
        const pos = m.lineStart(u, lines[x]);
        if (pos !== null) {
          place(refsOn(u, startLine, x));
          const target = areaOf(page + 1).top;
          out.push({ kind: "line", pos, target });
          offset = target - lines[x].top;
          page += 1;
          firstOnPage = k;
          startLine = x;
          continue;
        }
      }
    }

    if (k === firstOnPage && !forced) {
      // Taller than a page: it runs past the page's end. What follows goes on
      // the page its end falls on, or after.
      place(rest);
      while (bottom > areaOf(page).bottom + EPS && bottom >= areaOf(page + 1).top) page += 1;
      firstOnPage = k;
      k += 1;
      startLine = 0;
      continue;
    }

    // Keep with next: the headings and header rows right before this unit
    // move with it.
    let from = k;
    if (startLine === 0 && !forced) {
      while (from - 1 > firstOnPage && units[from - 1].keepNext) from -= 1;
    }
    if (from < k) {
      const snap = snaps.get(from);
      if (snap) {
        out.length = snap.outLength;
        placed.length = snap.placed;
        page = snap.page;
        offset = snap.offset;
        firstOnPage = snap.firstOnPage;
        for (const key of [...snaps.keys()]) if (key > from) snaps.delete(key);
        k = from;
      }
    }
    const v = units[k];
    blockSpacer(v.spacerPos, v.spacerKind, page + 1, k, v.spacerKind === "row" ? v.header : null);
    firstOnPage = k;
    startLine = 0;
    snaps.set(k, { page, offset, outLength: out.length, firstOnPage, placed: placed.length });
  }

  // Each page's footnotes stand on its text's bottom, in the numbers' order.
  const planned: FootnotePlan[] = [];
  for (let i = 0; i < placed.length; ) {
    const p = placed[i].page;
    let j = i;
    let top = areaOf(p).bottom;
    while (j < placed.length && placed[j].page === p) top -= footnoteHeight(placed[j++].id);
    for (let q = i; q < j; q++) {
      const footnote = footnotes.get(placed[q].id);
      if (footnote) planned.push({ pos: footnote.pos, top, page: p, first: q === i });
      top += footnoteHeight(placed[q].id);
    }
    i = j;
  }

  const heights = new Map<HTMLElement, number>();
  units.forEach((u, i) => {
    if (u.type !== "text") return;
    const box = m.unit(i, u);
    heights.set(u.dom, box.bottom - box.top);
  });
  return { spacers: out, footnotes: planned, pages: page + 1, heights };
}
