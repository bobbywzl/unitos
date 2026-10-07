// Where a curve's marks sit (VIEW3-01): the count pill, the open replies,
// and the notes quoting both documents ride the curve at its middle, unless
// a node's room or another curve's marks cover that point; then they slide
// along the curve to the first free point, or step beside its middle when
// the curve is too short to have one. A node's room is its dot's row
// and the label under it. Flow units throughout; a pure helper, so a check
// can run it.

export type Point = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };

// Where on the curve to try, middle first, then out toward the ends.
const TRIES = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];

/** The point at t of the quadratic curve s → c → e. */
export function quadAt(s: Point, c: Point, e: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * s.x + 2 * u * t * c.x + t * t * e.x, y: u * u * s.y + 2 * u * t * c.y + t * t * e.y };
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function boxAt(p: Point, w: number, h: number): Box {
  return { x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 };
}

// A node's box in flow units (graph-view.tsx): the dot's row is 144 × 32;
// the label hangs from 36 px down, at most two lines of 11 px, both grown
// by the label scale when the view zooms out (the width less).
const NODE_W = 144;
const LABEL_WIDTH_SCALE_MAX = 1.35;

// About how wide a label's text runs at 11 px semibold: a CJK character is
// square, a Latin capital about two thirds of it, a small letter about half.
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
function textWidth(title: string): number {
  let w = 0;
  for (const ch of title) w += CJK.test(ch) ? 11 : /[A-Z]/.test(ch) ? 7.6 : 6;
  return w;
}

/** A node's room, from its box's top-left corner, its label, and the label
    scale: two boxes, the dot with the notes chip right of it, and the
    label's one or two lines under them. [layer5] chipW: the comments chip
    right of the notes chip, in flow units (VIEW5-01 (a)); 0 for none. */
export function nodeRoom(x: number, y: number, scale = 1, title = "", chipW = 0): Box[] {
  const box = NODE_W * Math.min(scale, LABEL_WIDTH_SCALE_MAX);
  const text = textWidth(title) * scale;
  const lines = text > box ? 2 : 1;
  const half = Math.min(box, text) / 2 + 2;
  const cx = x + NODE_W / 2;
  return [
    { x0: cx - 22, y0: y - 2, x1: cx + 64 + (chipW > 0 ? chipW + 4 : 0), y1: y + 34 },
    { x0: cx - half, y0: y + 34, x1: cx + half, y1: y + 38 + 16 * scale * lines },
  ];
}

/** One curve's marks to place: the quadratic it draws (null for a loop,
    whose marks sit at `at`), and the marks' size in flow units. */
export type MarkCurve = { id: string; curve: { s: Point; c: Point; e: Point } | null; at: Point; w: number; h: number };

/** The points to try: along the curve, then (a short curve whose length
    the two nodes cover) beside its middle third, one and two marks'
    heights off it on either side. */
function candidates(m: MarkCurve): Point[] {
  if (!m.curve) return [];
  const { s, c, e } = m.curve;
  const along = TRIES.map((t) => quadAt(s, c, e, t));
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  // The normal, turned to point down the screen first: marks under a
  // curve read with it.
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const off = [1.2, -1.2, 2.2, -2.2].flatMap((k) =>
    along.slice(0, 3).map((p) => ({ x: p.x + nx * m.h * k, y: p.y + ny * m.h * k })),
  );
  return [...along, ...off];
}

/** Each curve's marks' centre: the first point of its curve where they
    cover no node's room and no marks placed before them; else the point
    where they cover the least. */
export function placeMarks(curves: MarkCurve[], rooms: Box[]): Map<string, Point> {
  const placed: Box[] = [];
  const out = new Map<string, Point>();
  for (const m of curves) {
    let best: { p: Point; cover: number } | null = null;
    for (const p of candidates(m)) {
      const box = boxAt(p, m.w, m.h);
      let cover = 0;
      for (const r of rooms) cover += overlap(box, r);
      for (const r of placed) cover += overlap(box, r) * 2;
      if (cover === 0) {
        best = { p, cover };
        break;
      }
      if (!best || cover < best.cover) best = { p, cover };
    }
    const p = best?.p ?? m.at;
    out.set(m.id, p);
    placed.push(boxAt(p, m.w, m.h));
  }
  return out;
}
