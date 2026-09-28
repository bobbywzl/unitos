import type { Doc } from "./adapt";
import { freeScores, type PdfText } from "./free";
import { flatten, score, type Flat } from "./metrics";
import type { RefDoc } from "./model";

// The detail report (--detail id): what a fix needs to see, printed to the
// terminal only (a private document's words never go to a file here).

type Input = { entry: { id: string; category: string }; ref?: RefDoc; docs?: { parse: Doc; import: Doc }; pdf?: PdfText; pages?: [number, number] };

const clip = (text: string, n = 240) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

function blockText(flat: Flat, b: number): string {
  if (b < 0) return "(none)";
  const block = flat.blocks[b];
  if (block.kind === "equation") return `$$ ${block.latex} $$`;
  if (block.kind === "figure" && block.mathImage !== undefined) return `(equation image) ${block.mathImage}`;
  if (block.kind === "separator") return "(rule)";
  const texts = flat.unitsOf[b].map((u) => flat.units[u].text);
  return texts.length > 0 ? texts.join(" | ") : `(${block.kind})`;
}

function kindOf(flat: Flat, b: number): string {
  if (b < 0) return "missing";
  const block = flat.blocks[b];
  return block.kind === "heading" ? `h${block.level}` : block.kind === "figure" && block.mathImage !== undefined ? "equation image" : block.kind;
}

/** The words one bag holds more often than the other, most first. */
function surplus(a: Flat, b: Flat, n = 20): string {
  const count = (flat: Flat) => {
    const m = new Map<string, number>();
    for (const t of flat.toks) m.set(t.w, (m.get(t.w) ?? 0) + 1);
    return m;
  };
  const [ca, cb] = [count(a), count(b)];
  const out = [...ca]
    .map(([w, k]) => [w, k - (cb.get(w) ?? 0)] as const)
    .filter(([, k]) => k > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n);
  return out.map(([w, k]) => `${w}×${k}`).join("  ") || "(none)";
}

function referenceDetail(ref: RefDoc, candidate: Doc) {
  const { scores: s, ref: r, cand: c, al } = score({ blocks: ref.blocks }, ref.furniture, candidate);
  console.log(`\nComposite ${s.composite.toFixed(1)}. Parts: ${Object.entries(s.parts).map(([k, v]) => `${k} ${v === null ? "—" : v.toFixed(2)}`).join(", ")}`);
  console.log(`Words: recall ${pct(s.words.recall)}, precision ${pct(s.words.precision)} (${s.words.refWords} reference, ${s.words.candWords} candidate); reading order ${pct(s.order)}`);
  console.log(`  Missing most: ${surplus(r, c)}`);
  console.log(`  Extra most:   ${surplus(c, r)}`);

  console.log("\nBlocks by kind (reference found / reference · candidate right / candidate):");
  for (const [kind, k] of Object.entries(s.blocks.byKind)) console.log(`  ${kind.padEnd(10)} ${k.found}/${k.ref} · ${k.right}/${k.cand}`);

  // The worst blocks: least of the block's words in its owner, the wrong
  // kind, or a unit of it cut up or merged.
  const split = new Map<number, number>();
  for (const x of s.blocks.splits) split.set(r.units[x.ref].block, (split.get(r.units[x.ref].block) ?? 0) + 1);
  const merged = new Map<number, number>();
  for (const m of s.blocks.merges) for (const ru of m.parts) merged.set(r.units[ru].block, (merged.get(r.units[ru].block) ?? 0) + 1);
  const rows = r.blocks
    .map((block, rb) => {
      const words = r.unitsOf[rb].reduce((n, u) => n + r.units[u].end - r.units[u].first, 0);
      const owner = al.owner[rb];
      const inOwner = owner >= 0 ? (al.overlap.get(rb)?.get(owner) ?? 0) : 0;
      const kept = words > 0 ? inOwner / words : owner >= 0 ? 1 : 0;
      const wrongKind = owner < 0 || c.blocks[owner].kind !== block.kind;
      const bad = 1 - kept + (wrongKind ? 0.5 : 0) + (split.has(rb) ? 0.3 : 0) + (merged.has(rb) ? 0.3 : 0);
      const notes = [
        `${Math.round(kept * 100)}% of its words in its counterpart`,
        wrongKind ? `read as ${kindOf(c, owner)}` : "",
        split.has(rb) ? `${split.get(rb)} of its units split` : "",
        merged.has(rb) ? `${merged.get(rb)} of its units merged` : "",
      ].filter(Boolean);
      return { rb, owner, bad, notes };
    })
    .filter((x) => x.bad > 0.05)
    .sort((a, b) => b.bad - a.bad);
  console.log(`\nThe worst blocks (${Math.min(15, rows.length)} of ${rows.length} with a fault):`);
  for (const row of rows.slice(0, 15)) {
    console.log(`  [${kindOf(r, row.rb)} → ${kindOf(c, row.owner)}] ${row.notes.join("; ")}`);
    console.log(`    reference: ${clip(blockText(r, row.rb))}`);
    console.log(`    candidate: ${clip(blockText(c, row.owner))}`);
  }

  console.log(`\nSplits (${s.blocks.splits.length}) and merges (${s.blocks.merges.length}) of paragraphs, headings, and list items:`);
  for (const x of s.blocks.splits.slice(0, 25)) {
    console.log(`  split in ${x.pieces.length}: ${clip(r.units[x.ref].text, 120)}`);
    for (const cu of x.pieces) console.log(`    · ${clip(c.units[cu].text, 120)}`);
  }
  for (const x of s.blocks.merges.slice(0, 25)) {
    console.log(`  ${x.parts.length} merged: ${clip(c.units[x.cand].text, 160)}`);
  }

  for (const style of ["bold", "italic"] as const) {
    const k = s.styles.counts[style];
    console.log(`${style === "bold" ? "\nBold" : "Italic"}: F1 ${s.styles[style]?.toFixed(2) ?? "—"}; characters ${style} on both sides ${k.both}, only in the candidate ${k.candOnly}, only in the reference ${k.refOnly}.`);
  }

  console.log(`\nFurniture: ${s.furniture.leaked} of ${s.furniture.strings} strings leak, ${s.furniture.leaks} times.`);
  for (const f of s.furniture.found) {
    console.log(`  "${f.text}": at ${f.at.length} edge${f.at.length === 1 ? "" : "s"} of the candidate, ${f.ref} of the reference`);
    for (const m of f.at) {
      const tok = c.toks[m.tok];
      console.log(`    … ${clip(c.units[m.unit].text.slice(Math.max(0, tok.start - 60), tok.end + 60), 160)}`);
    }
  }

  console.log(`\nGarbled glyphs: ${s.garbles.count} (${s.garbles.excess} past the reference's own).`);
  for (const g of s.garbles.found.slice(0, 60)) {
    console.log(`  ${g.kind}: "${g.match}" in … ${clip(g.text.slice(Math.max(0, g.at - 40), g.at + g.match.length + 40), 120)}`);
  }
  if (s.garbles.found.length > 60) console.log(`  … and ${s.garbles.found.length - 60} more`);

  if (s.headings.ref > 0) {
    console.log(`\nHeadings: ${s.headings.atLevel} of ${s.headings.ref} at their level (level shift ${s.headings.shift}).`);
    for (const m of s.headings.misses) console.log(`  ${kindOf(r, m.ref)} "${clip(blockText(r, m.ref), 80)}" → ${kindOf(c, m.cand)} "${clip(blockText(c, m.cand), 80)}"`);
  }

  if (s.lists.items > 0) {
    console.log(`\nList items: ${s.lists.found} of ${s.lists.items} found, ${s.lists.atDepth} at their depth, ${s.lists.marked} with their marker.`);
    for (const m of s.lists.misses.slice(0, 40)) {
      console.log(`  ${m.why}: ${clip(r.units[m.unit].text, 100)}${m.cand >= 0 ? `  →  ${clip(c.units[m.cand].text, 60)}` : ""}`);
    }
  }

  if (s.tables.refWords + s.tables.candWords > 0) {
    console.log(`\nTables: F1 ${s.tables.f1?.toFixed(2)}; ${s.tables.outside} table words outside a table, ${s.tables.inside} prose words inside one.`);
    for (const m of s.tables.misses.slice(0, 60)) console.log(`  cell (${m.row + 1}, ${m.col + 1}): want "${clip(m.want, 60)}", got "${clip(m.got, 60)}"`);
    if (s.tables.misses.length > 60) console.log(`  … and ${s.tables.misses.length - 60} more`);
  }

  if (s.math.equations + s.math.formulas > 0) {
    console.log(
      `\nMath: display ${s.math.display?.toFixed(2) ?? "—"} over ${s.math.equations} (${s.math.images} as images, ${s.math.plainDisplay} as words); inline ${s.math.inline?.toFixed(2) ?? "—"} over ${s.math.formulas} (${s.math.plainInline} as words).`,
    );
    const misses = [...s.math.misses].sort((a, b) => Number(b.display) - Number(a.display) || a.similarity - b.similarity);
    for (const m of misses.slice(0, 80)) {
      console.log(`  ${m.display ? "display" : "inline "} ${m.similarity.toFixed(2)}  want ${clip(m.want, 100)}`);
      console.log(`                got  ${clip(m.got, 100)}`);
    }
    if (misses.length > 80) console.log(`  … and ${misses.length - 80} more`);
  }
}

function freeDetail(pdf: PdfText, candidate: Doc) {
  const c = flatten(candidate);
  const f = freeScores(pdf, c);
  console.log(`\nWithout a reference: composite ${f.composite.toFixed(1)}.`);
  console.log(`Coverage against pdftotext: recall ${pct(f.coverage.recall)}, precision ${pct(f.coverage.precision)} (${f.coverage.expected} words expected, ${f.coverage.words} in the candidate).`);
  const list = (words: [string, number][]) => words.map(([w, n]) => `${w}×${n}`).join("  ") || "(none)";
  console.log(`  Missing most: ${list(f.coverage.missing)}`);
  console.log(`  Extra most:   ${list(f.coverage.extra)}`);
  console.log(`Furniture lines found by position: ${f.furniture.strings}; ${f.furniture.leaked} leak, ${f.furniture.leaks} times.`);
  for (const leak of f.furniture.found.slice(0, 40)) {
    console.log(`  "${clip(leak.text, 100)}"`);
    for (const m of leak.at.slice(0, 6)) {
      const tok = c.toks[m.tok];
      console.log(`    … ${clip(c.units[m.unit].text.slice(Math.max(0, tok.start - 60), tok.end + 60), 160)}`);
    }
  }
  console.log(`Lines that are only a page number: ${f.numberLines.count}.`);
  for (const l of f.numberLines.found.slice(0, 20)) console.log(`  "${l.text}" in … ${clip(c.units[l.unit].text, 100)}`);
  console.log(`Garbled glyphs: ${f.garbles.count}.`);
  for (const g of f.garbles.found.slice(0, 40)) console.log(`  ${g.kind}: "${g.match}" in … ${clip(g.text, 100)}`);
}

export function detailReport(r: Input, mode: "parse" | "import") {
  if (!r.docs) return;
  const candidate = r.docs[mode];
  console.log(`\n${r.entry.id} (${r.entry.category}) — the ${mode}${r.pages ? `, pages ${r.pages[0]}–${r.pages[1]}` : ", every page"}`);
  if (r.ref) referenceDetail(r.ref, candidate);
  if (r.pdf) freeDetail(r.pdf, candidate);
}
