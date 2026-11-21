// Regions (SPEC.md §11, §16): the drawn region's schema and bounds. A stroke
// (the highlighter's band on a page) bounds the band, not the bare pointer
// path, half its width on each side; the old loops keep their bounds.
// Run: npx tsx scripts/qa/region-check.ts
import { parseRegion, regionBounds, strokePathD } from "@/lib/video/types";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const stroke = parseRegion({ kind: "stroke", width: 4, strokes: [[[10, 20], [30, 20]], [[10, 26]]] });
check("stroke: parses", stroke?.kind, "stroke");
check("stroke: bounds take the band in, square page", stroke && regionBounds(stroke), { x1: 8, y1: 18, x2: 32, y2: 28 });
check("stroke: a wider page pads less down", stroke && regionBounds(stroke, 0.5), { x1: 8, y1: 19, x2: 32, y2: 27 });
check("stroke: bounds stay inside the page", regionBounds({ kind: "stroke", width: 4, strokes: [[[1, 1], [99, 99]]] }), { x1: 0, y1: 0, x2: 100, y2: 100 });
check("stroke: a dot doubles its point so a round cap draws it", strokePathD([[5, 5]]), "M5 5 L5 5");
check("stroke: the path is open", strokePathD([[1, 2], [3, 4]]), "M1 2 L3 4");
check("stroke: no strokes is no region", parseRegion({ kind: "stroke", width: 4, strokes: [] }), null);
check("stroke: a width past the max is no region", parseRegion({ kind: "stroke", width: 40, strokes: [[[1, 1]]] }), null);
// The loops drawn before the highlighter read and bound as before.
const loop = parseRegion({ kind: "path", points: [[10, 10], [20, 10], [20, 30]] });
check("path: bounds as before", loop && regionBounds(loop), { x1: 10, y1: 10, x2: 20, y2: 30 });
check("path: the aspect changes nothing", loop && regionBounds(loop, 0.5), { x1: 10, y1: 10, x2: 20, y2: 30 });
const ellipse = parseRegion({ kind: "ellipse", cx: 50, cy: 50, rx: 10, ry: 5 });
check("ellipse: bounds as before", ellipse && regionBounds(ellipse), { x1: 40, y1: 45, x2: 60, y2: 55 });

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all ok");
