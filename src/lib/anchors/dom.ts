// DOM-side anchor capture (SPEC.md §5). The reader renders block text verbatim
// except for inline controls — extract chips, comment dots, link chains —
// marked [data-anchor-skip]: their DOM text is not in the stored block text.
// These helpers count offsets over the anchorable text only, so a captured
// anchor is exactly the text the reader selected.
//
// A table's stored text separates cells with a tab and rows with a newline.
// A table whose html carries the separators as invisible gaps (globals.css
// .cell-gap) is walked as it is. A table whose html has no gap — a web page's
// table (lib/parse/url.ts tableText) — draws no text between its cells, so the
// walk adds the separators itself, as tableText writes them: a tab between two
// cells, a blank cell for each extra column of a colspan, a rowspan's words
// again in each row under it, and a newline between two rows. The table's
// anchorable text is then its stored text, and a selection across two cells
// captures "Pages\t2", not "Pages2".

const SKIP = "[data-anchor-skip]";

/** One piece of a block's anchorable text, in reading order. `node` is the
    text node the piece is; null for a separator or a repeated rowspan the
    walk adds to a table, which stands at the DOM point `at`. `start` is the
    piece's offset in the anchorable text. */
export type AnchorPiece = {
  node: Text | null;
  text: string;
  start: number;
  at: { container: Node; offset: number } | null;
};

const isCell = (el: Element) => el.localName === "td" || el.localName === "th";
const isSection = (el: Element) => el.localName === "thead" || el.localName === "tbody" || el.localName === "tfoot";
const span = (cell: Element, name: string, max: number) =>
  Math.max(1, Math.min(max, Number(cell.getAttribute(name) ?? "1") || 1));

function childIndex(node: Node): number {
  let i = 0;
  for (let n = node.previousSibling; n; n = n.previousSibling) i++;
  return i;
}

/** The block's anchorable text, piece by piece. */
export function anchorablePieces(block: HTMLElement): AnchorPiece[] {
  const pieces: AnchorPiece[] = [];
  if (block.parentElement?.closest(SKIP)) return pieces;
  let at = 0;
  const add = (node: Text | null, text: string, point: AnchorPiece["at"]) => {
    if (!text) return;
    pieces.push({ node, text, start: at, at: point });
    at += text.length;
  };

  const visit = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) add(child as Text, (child as Text).data, null);
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (el.matches(SKIP)) continue;
        if (el.localName === "table" && !el.querySelector(".cell-gap")) visitTable(el);
        else visit(el);
      }
    }
  };

  // A cell's words on one line: what a rowspan repeats in the rows under it.
  const cellWords = (cell: Element) => {
    const [from, count] = [at, pieces.length];
    visit(cell);
    const words = pieces.slice(count).map((p) => p.text).join("");
    pieces.length = count;
    at = from;
    return words.replace(/\s+/g, " ").trim();
  };

  const visitTable = (table: Element) => {
    // The table's own rows; a nested table's rows belong to the nested table.
    // What is not a row (a caption) is walked as it is, where it stands; the
    // blank text between the table's tags is no text of the table.
    const rows: Element[] = [];
    const before: Element[] = [];
    const after: Element[] = [];
    for (const child of Array.from(table.children)) {
      if (child.localName === "tr") rows.push(child);
      else if (isSection(child)) rows.push(...Array.from(child.children).filter((c) => c.localName === "tr"));
      else (rows.length === 0 ? before : after).push(child);
    }
    for (const el of before) if (!el.matches(SKIP)) visit(el);
    // carried[r][c]: the words a rowspan from a row above puts in column c.
    const carried: (string | undefined)[][] = rows.map(() => []);
    rows.forEach((tr, r) => {
      if (r > 0) add(null, "\n", { container: tr.parentNode ?? table, offset: childIndex(tr) });
      let c = 0;
      const column = (offset: number) => {
        if (c > 0) add(null, "\t", { container: tr, offset });
      };
      const repeats = (offset: number) => {
        while (carried[r][c] !== undefined) {
          column(offset);
          add(null, carried[r][c] ?? "", { container: tr, offset });
          c++;
        }
      };
      for (const cell of Array.from(tr.children).filter(isCell)) {
        if (cell.matches(SKIP)) continue;
        const index = childIndex(cell);
        repeats(index);
        column(index);
        const colspan = span(cell, "colspan", 50);
        const rowspan = span(cell, "rowspan", 200);
        if (rowspan > 1) {
          const words = cellWords(cell);
          for (let dr = 1; dr < rowspan && r + dr < rows.length; dr++) {
            for (let dc = 0; dc < colspan; dc++) carried[r + dr][c + dc] = dc === 0 ? words : "";
          }
        }
        visit(cell);
        // A colspan's extra columns are blank cells.
        for (let dc = 1; dc < colspan; dc++) add(null, "\t", { container: tr, offset: index + 1 });
        c += colspan;
      }
      // Rowspans past the row's last cell, and the blank columns between them.
      const end = tr.childNodes.length;
      while (c < carried[r].length) {
        if (carried[r][c] !== undefined) repeats(end);
        else {
          column(end);
          c++;
        }
      }
    });
    for (const el of after) if (!el.matches(SKIP)) visit(el);
  };

  visit(block);
  return pieces;
}

/** The block's anchorable text: every text node except those inside skipped
    inline controls, with a gapless table's separators. In reading mode this
    equals the stored block text. */
export function anchorableText(block: HTMLElement): string {
  return anchorablePieces(block)
    .map((p) => p.text)
    .join("");
}

/** Anchorable text length strictly before the boundary (container, offset).
    A boundary inside a skipped control clamps to the text before it. */
export function anchorableOffset(block: HTMLElement, container: Node, offset: number): number {
  const boundary = document.createRange();
  boundary.selectNodeContents(block);
  try {
    boundary.setEnd(container, offset);
  } catch {
    return 0;
  }
  let total = 0;
  for (const piece of anchorablePieces(block)) {
    if (piece.node === container) return piece.start + Math.min(offset, piece.text.length);
    // A text node that ends at or before the boundary counts whole, and so
    // does a separator that stands at or before it; past it → done.
    const counts = piece.node
      ? boundary.comparePoint(piece.node, piece.node.length) <= 0
      : piece.at !== null && boundary.comparePoint(piece.at.container, piece.at.offset) <= 0;
    if (!counts) break;
    total = piece.start + piece.text.length;
  }
  return total;
}
