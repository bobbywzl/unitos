import type { Doc } from "./adapt";
import type { FreeScores, PdfText } from "./free";
import type { GlyphScores } from "./glyphs";
import { flatten, SCORED, score, type Flat } from "./metrics";
import type { Font, RefDoc } from "./model";

// The detail report (--detail id): what a fix needs to see, printed to the
// terminal only (a private document's words never go to a file here).

type Input = {
  entry: { id: string; category: string; pdf?: string; docx?: string };
  ref?: RefDoc;
  docs?: { parse: Doc; import: Doc };
  pdf?: PdfText;
  pages?: [number, number];
  glyphs?: { parse: GlyphScores; import?: GlyphScores };
  freeParse?: FreeScores;
  freeImport?: FreeScores;
};

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

/** A font as the detail prints it: "serif 10pt bold #1f3864". */
const fontText = (f: Font | null) => (f ? [f.shape, `${f.size}pt`, f.bold ? "bold" : "", f.color ?? ""].filter(Boolean).join(" ") : "(none)");

function referenceDetail(ref: RefDoc, candidate: Doc) {
  const { scores: s, ref: r, cand: c, al } = score({ blocks: ref.blocks, fonts: ref.fonts }, ref.furniture, candidate);
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

  console.log("");
  for (const style of SCORED) {
    const k = s.styles.counts[style];
    if (s.styles.f1[style] === null && k.candOnly === 0) continue;
    console.log(`${style}: F1 ${s.styles.f1[style]?.toFixed(2) ?? "— (the reference marks none)"}; characters so on both sides ${k.both}, only in the candidate ${k.candOnly}, only in the reference ${k.refOnly}.`);
  }
  const r2 = (x: number | null) => (x === null ? "—" : x.toFixed(2));
  const roles = s.roles;
  console.log(
    `Roles: alignment ${r2(roles.align)}, indentation ${r2(roles.indent)}, indent sizes ${r2(roles.indentSize)}, spacing ${r2(roles.spacing)}, captions ${r2(roles.captions)}, checkbox states ${r2(roles.checks)}, separators ${r2(roles.separators)}, quotations ${r2(roles.quotes)}, equation labels ${r2(s.math.labels.score)}, their side ${r2(s.math.labels.side.score)}.`,
  );
  for (const [name, misses] of [["alignment", roles.misses.align], ["indentation", roles.misses.indent], ["indent size", roles.misses.indentSize], ["spacing", roles.misses.spacing]] as const) {
    if (misses.length === 0) continue;
    console.log(`  ${name} wrong (${misses.length}; the reference's → the candidate's):`);
    for (const miss of misses.slice(0, 10)) console.log(`    ${miss.ref} → ${miss.cand}: ${miss.text}`);
  }
  if (s.fonts) {
    const f = s.fonts;
    console.log(`\nFonts: shape ${r2(f.shape)}, size ${r2(f.size)}, bold ${r2(f.bold)}, color ${r2(f.color)} (the reference's body: ${fontText(ref.fonts?.body ?? null)}).`);
    for (const [role, x] of Object.entries(f.roles)) {
      console.log(`  ${role.padEnd(8)} ${x.known} of ${x.blocks} blocks say their font; right: shape ${x.shape}, size ${x.size}, bold ${x.bold}, color ${x.color}`);
    }
    for (const m of f.misses.slice(0, 20)) console.log(`  ${m.role} ${m.why}: want ${fontText(m.want)}, got ${fontText(m.got)}  (${clip(blockText(r, m.ref), 60)})`);
  }
  if (s.notes) {
    const n = s.notes;
    console.log(`\nFootnotes: ${n.found} of ${n.ref} found, ${n.linked} of ${n.linkable} linked from the reference's mark, words F1 ${r2(n.words)}; ${n.extra} footnotes the reference does not have.`);
    for (const m of n.misses.slice(0, 20)) console.log(`  ${m.why}: ${clip(blockText(r, m.ref), 100)}${m.cand >= 0 ? `  →  ${clip(blockText(c, m.cand), 60)}` : ""}`);
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

  if (s.headings.ref > 0 || s.headings.cand > 0) {
    console.log(`\nHeadings: ${s.headings.atLevel} of ${s.headings.ref} at their level (level shift ${s.headings.shift}); ${s.headings.right} of the candidate's ${s.headings.cand} are one of them.`);
    for (const m of s.headings.misses) console.log(`  ${kindOf(r, m.ref)} "${clip(blockText(r, m.ref), 80)}" → ${kindOf(c, m.cand)} "${clip(blockText(c, m.cand), 80)}"`);
    for (const cb of s.headings.invented.slice(0, 20)) {
      const rb = al.main[cb];
      console.log(`  invented ${kindOf(c, cb)} "${clip(blockText(c, cb), 80)}"${rb >= 0 ? ` (the reference's ${kindOf(r, rb)})` : ""}`);
    }
  }

  if (s.lists.items > 0) {
    console.log(`\nList items: ${s.lists.found} of ${s.lists.items} found, ${s.lists.atDepth} at their depth, ${s.lists.marked} with their marker.`);
    console.log(`  Markers by depth: ${s.lists.byDepth.map((level, depth) => `${depth}: ${level.marked} of ${level.found}`).join(", ") || "—"}.`);
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
    const { labels } = s.math;
    if (labels.ref + labels.extra > 0) {
      console.log(`  Equation labels: ${labels.right} of ${labels.ref} right, ${labels.extra} the reference does not print.`);
      for (const m of labels.misses.slice(0, 20)) console.log(`    want ${m.want}, got ${m.got}`);
    }
    const misses = [...s.math.misses].sort((a, b) => Number(b.display) - Number(a.display) || a.similarity - b.similarity);
    for (const m of misses.slice(0, 80)) {
      console.log(`  ${m.display ? "display" : "inline "} ${m.similarity.toFixed(2)}  want ${clip(m.want, 100)}`);
      console.log(`                got  ${clip(m.got, 100)}`);
    }
    if (misses.length > 80) console.log(`  … and ${misses.length - 80} more`);
  }
}

/** The run's own reference-free scores of the candidate (so the composite is the table's). */
function freeDetail(f: FreeScores, candidate: Doc) {
  const c = flatten(candidate);
  console.log(`\nWithout a reference: composite ${f.composite.toFixed(1)}.`);
  console.log(
    f.coverage.blind
      ? `Coverage against pdftotext: not scored, the text layer reads blind (${f.coverage.expected} words, under half of the candidate's ${f.coverage.words}).`
      : `Coverage against pdftotext: recall ${pct(f.coverage.recall)}, precision ${pct(f.coverage.precision)} (${f.coverage.expected} words expected, ${f.coverage.words} in the candidate).`,
  );
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
  if (f.look) {
    const r2 = (x: number | null) => (x === null ? "—" : x.toFixed(2));
    console.log(`The import's look: inline formulas at their words' size ${r2(f.look.formulas)}, crops at their printed width ${r2(f.look.figures)}, Word borders ${r2(f.look.borders)}.`);
    for (const m of f.look.misses.slice(0, 20)) console.log(`  ${m}`);
  }
}

function glyphDetail(g: GlyphScores) {
  console.log(`\nThe PDF's math glyphs: ${g.hazards} whose text layer string is not their symbol; symbols the candidate prints fewer times than the pages draw them: ${g.garbles}.`);
  if (g.missing.length > 0) console.log(`  ${g.missing.map(([s, n]) => `${s}×${n}`).join("  ")}`);
  console.log(`Equations shown as pictures (a region of TeX fonts with a math glyph): ${g.mathImages}.`);
  console.log(`Display equations checked against the region's glyphs: ${g.passed} of ${g.checked} draw exactly its symbols at their script levels.`);
  for (const f of g.fails.slice(0, 30)) {
    console.log(`  ${clip(f.latex, 110)}`);
    console.log(`    the glyphs have, the LaTeX not: ${f.missing.slice(0, 12).join(" ") || "—"}; the LaTeX has, the glyphs not: ${f.extra.slice(0, 12).join(" ") || "—"}`);
  }
}

export function detailReport(r: Input, mode: "parse" | "import") {
  if (!r.docs) return;
  const candidate = r.docs[mode];
  console.log(`\n${r.entry.id} (${r.entry.category}) — the ${mode}${r.pages ? `, pages ${r.pages[0]}–${r.pages[1]}` : ", every page"}`);
  if (r.ref) referenceDetail(r.ref, candidate);
  const free = mode === "parse" ? r.freeParse : r.freeImport;
  if (free) freeDetail(free, candidate);
  const glyphs = r.glyphs?.[mode];
  if (glyphs) glyphDetail(glyphs);
}
