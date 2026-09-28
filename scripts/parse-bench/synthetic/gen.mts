/**
 * Regenerates the synthetic documents: every spec in every rendering it names.
 * Writes .bench/synthetic/<id>.pdf with its source (.tex, .html, or .docx), scripts/parse-bench/refs/<id>.json,
 * and prints the pdftotext check of each rendering against its reference; exits 1 when a rendering's words
 * agree below 99%.
 *
 *   npx tsx scripts/parse-bench/synthetic/gen.mts [--only notes,synth-paper-tex]
 *
 * Every run writes the same bytes: the references, and the PDFs too (one fixed time, stamp.ts).
 *
 * To add a document: write specs/<name>.ts exporting a Spec (the blocks with the builders of spec.ts, and a
 * layout for each rendering), list it in SPECS, run this, and add each new id to corpus.json.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright-core";
import { loadRef } from "../load";
import type { RefDoc } from "../model";
import { checkRendering, furnitureOf, readPdf, TEX_FALLBACK_LETTERS, type Agreement } from "./check";
import { docxLooks, renderDocx } from "./render-docx";
import { renderHtml, withDrawn } from "./render-html";
import { renderTex, texLooks } from "./render-tex";
import { flatten, referenceBlocks, type Leaf, type LeafLook, type Renderer, type Spec } from "./spec";
import { agreement } from "./specs/agreement";
import { gdocs } from "./specs/gdocs";
import { math } from "./specs/math";
import { newsletter } from "./specs/newsletter";
import { notes } from "./specs/notes";
import { paper } from "./specs/paper";
import { report } from "./specs/report";
import { slides } from "./specs/slides";
import { tables } from "./specs/tables";

const SPECS: Spec[] = [notes, math, paper, tables, slides, agreement, report, gdocs, newsletter];

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT = ".bench/synthetic";
const REFS = "scripts/parse-bench/refs";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const only = (() => {
  const at = process.argv.indexOf("--only");
  return at === -1 ? null : new Set(process.argv[at + 1].split(","));
})();

const EXTENSION: Record<Renderer, string> = { tex: "tex", html: "html", docx: "docx" };

async function main() {
  mkdirSync(join(ROOT, OUT), { recursive: true });
  mkdirSync(join(ROOT, REFS), { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const rows: [string, Agreement][] = [];
  try {
    for (const spec of SPECS) {
      for (const renderer of Object.keys(spec.renderings) as Renderer[]) {
        const id = `synth-${spec.name}-${renderer}`;
        if (only && !only.has(id) && !only.has(spec.name)) continue;
        const dir = join(ROOT, OUT, "build", id);
        mkdirSync(dir, { recursive: true });
        const { leaves, looks, bands, fallback } = await render(spec, renderer, id, dir, browser);
        // The PDF, its source, and the source's pictures, so the source builds where it is kept.
        for (const file of [`${id}.pdf`, `${id}.${EXTENSION[renderer]}`, ...readdirSync(dir).filter((f) => f.startsWith(`${id}-figure-`))]) {
          copyFileSync(join(dir, file), join(ROOT, OUT, file));
        }

        const pages = readPdf(join(ROOT, OUT, `${id}.pdf`), bands);
        pages.forEach((page, k) => page.stray.forEach((line) => console.warn(`${id} page ${k + 1}: “${line}” looks like furniture but lies outside the bands`)));
        // A long table's "continued" line prints in the body, above the foot band: furniture when it prints.
        const body = pages.flatMap((page) => page.body).join(" ");
        const continued = leaves.flatMap(({ block }) => (block.kind === "table" && block.layout?.continued && body.includes(block.layout.continued) ? [block.layout.continued] : []));
        const { blocks, fonts } = referenceBlocks(leaves, looks);
        const ref: RefDoc = {
          id,
          category: spec.category,
          source: renderer === "docx" ? { pdf: `${OUT}/${id}.pdf`, docx: `${OUT}/${id}.docx` } : { pdf: `${OUT}/${id}.pdf` },
          blocks,
          furniture: [...furnitureOf(pages), ...new Set(continued)],
          ...(fonts ? { fonts } : {}),
          license: "open",
          provenance: "generated",
          ...(spec.notes ? { notes: spec.notes } : {}),
        };
        writeFileSync(join(ROOT, REFS, `${id}.json`), `${JSON.stringify(ref, null, 2)}\n`);
        const loaded = loadRef(join(ROOT, REFS, `${id}.json`));
        if ("problems" in loaded) throw new Error(`${id}: the reference does not load: ${loaded.problems.join("; ")}`);
        rows.push([id, checkRendering(leaves, pages, fallback)]);
      }
    }
  } finally {
    await browser.close();
  }
  printTable(rows);
}

/** A rendering's leaves, what the page shows of each (its font and alignment), and what its check needs; the
    renderer writes <id>.pdf into its build folder. */
type Rendered = { leaves: Leaf[]; looks: LeafLook[]; bands: { top: number; bottom: number }; fallback: string };

async function render(spec: Spec, renderer: Renderer, id: string, dir: string, browser: Browser): Promise<Rendered> {
  const { tex, html, docx } = spec.renderings;
  if (renderer === "tex" && tex) {
    const leaves = flatten(spec, { footnotes: "after", smallCaps: tex.smallCaps, captionJoin: tex.captionJoin });
    await renderTex({ name: id, layout: tex, leaves, dir, browser });
    return { leaves, looks: texLooks(tex, leaves), bands: tex.bands, fallback: TEX_FALLBACK_LETTERS };
  }
  if (renderer === "html" && html) {
    const leaves = flatten(spec, { footnotes: "end", smallCaps: "keep" });
    const { looks, drawn } = await renderHtml({ name: id, title: spec.title, layout: html, leaves, dir, browser });
    return { leaves: withDrawn(leaves, drawn), looks, bands: html.bands, fallback: "" };
  }
  if (renderer === "docx" && docx) {
    const leaves = flatten(spec, { footnotes: "after", smallCaps: "keep" });
    await renderDocx({ name: id, title: spec.title, layout: docx, leaves, dir, browser });
    return { leaves, looks: docxLooks(docx, leaves), bands: docx.bands, fallback: "" };
  }
  throw new Error(`${id}: no ${renderer} layout`);
}

function printTable(rows: [string, Agreement][]) {
  const pct = (n: number) => `${(100 * n).toFixed(2)}%`;
  console.log(`${"id".padEnd(28)} pages  words  recall   precision  agreement  segments`);
  for (const [id, a] of rows) {
    console.log(
      `${id.padEnd(28)} ${String(a.pages).padStart(5)}  ${String(a.refWords).padStart(5)}  ${pct(a.recall).padStart(7)}  ${pct(a.precision).padStart(9)}  ${pct(a.agreement).padStart(9)}  ${a.segments.found}/${a.segments.total}`,
    );
  }
  for (const [id, a] of rows) {
    if (a.missing.length || a.extra.length || a.segments.misses.length) {
      console.log(`\n${id}`);
      if (a.missing.length) console.log(`  missing: ${a.missing.map(([t, n]) => `${t}×${n}`).join(" ")}`);
      if (a.extra.length) console.log(`  extra:   ${a.extra.map(([t, n]) => `${t}×${n}`).join(" ")}`);
      for (const miss of a.segments.misses) console.log(`  segment not found: “${miss}”`);
    }
  }
  const corpus = readFileSync(join(ROOT, "scripts/parse-bench/corpus.json"), "utf8");
  const absent = rows.map(([id]) => id).filter((id) => !corpus.includes(`"${id}"`));
  if (absent.length) console.log(`\nNot in corpus.json yet: ${absent.join(", ")}`);
  const below = rows.filter(([, a]) => a.agreement < 0.99).map(([id]) => id);
  if (below.length) {
    console.log(`\nBelow 99% word agreement: ${below.join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
