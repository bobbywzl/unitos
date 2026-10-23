// Downloads the corpus's public PDFs that are not on disk yet: every entry of
// corpus.json whose url is the PDF itself (an arXiv entry is built by
// arxiv/fetch.mts, and a page that is not a PDF is left to the owner). Each
// file lands at the entry's pdf path under .bench/, never committed. A host
// the network refuses is reported and skipped, so a session whose network
// reaches only some hosts still gets those. An entry with a cut keeps those
// pages of the download alone (a chapter cut from a whole book: the
// reference's pages count from the cut's first page), with PyMuPDF, else
// poppler's pdfseparate and pdfunite; with neither the whole download is
// kept and the entry is reported, its pages off.
//
//   npx tsx scripts/parse-bench/fetch.mts [--only id,id]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { outboundFetch } from "@/lib/outbound-fetch";
import { loadCorpus, ROOT } from "./load";

const argv = process.argv.slice(2);
const at = argv.indexOf("--only");
const only = at >= 0 ? new Set(argv[at + 1]?.split(",") ?? []) : null;

const seen = new Set<string>();
let fetched = 0;
let failed = 0;
for (const entry of loadCorpus().entries) {
  if (only && !only.has(entry.id)) continue;
  if (!entry.url || !entry.pdf || seen.has(entry.pdf)) continue;
  seen.add(entry.pdf);
  const path = join(ROOT, entry.pdf);
  if (existsSync(path)) continue;
  if (/arxiv\.org\/abs\//.test(entry.url)) continue;
  try {
    const res = await outboundFetch(entry.url, { signal: AbortSignal.timeout(120_000) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    if (!res.ok || !isPdf) throw new Error(res.ok ? "not a PDF" : `HTTP ${res.status}`);
    mkdirSync(dirname(path), { recursive: true });
    const kept = entry.cut ? cutPages(bytes, entry.cut) : bytes;
    if (entry.cut && !kept) console.log(`whole    ${entry.pdf}  pages ${entry.cut[0]}–${entry.cut[1]} not cut: no PyMuPDF and no poppler; its pages are off`);
    writeFileSync(path, kept ?? bytes);
    fetched += 1;
    console.log(`fetched  ${entry.pdf}  (${Math.round((kept ?? bytes).length / 1024)} KB${entry.cut && kept ? `, pages ${entry.cut[0]}–${entry.cut[1]} of the download` : ""})`);
  } catch (e) {
    failed += 1;
    console.log(`skipped  ${entry.pdf}  ${new URL(entry.url).host}: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}`);
  }
}
console.log(`\n${fetched} fetched, ${failed} skipped`);

/** The pages first–last (1-based) of a PDF as a PDF of their own; null
    when no tool on the machine cuts one. */
function cutPages(bytes: Uint8Array, [first, last]: [number, number]): Uint8Array | null {
  const dir = mkdtempSync(join(tmpdir(), "parse-bench-cut-"));
  const whole = join(dir, "whole.pdf");
  const out = join(dir, "cut.pdf");
  writeFileSync(whole, bytes);
  try {
    try {
      execFileSync("python3", ["-I", "-c", "import sys, pymupdf\nd = pymupdf.open(sys.argv[1])\nd.select(list(range(int(sys.argv[3]) - 1, int(sys.argv[4]))))\nd.save(sys.argv[2], garbage=3)", whole, out, String(first), String(last)], { stdio: "pipe" });
      return new Uint8Array(readFileSync(out));
    } catch {
      /* no PyMuPDF: poppler next */
    }
    try {
      execFileSync("pdfseparate", ["-f", String(first), "-l", String(last), whole, join(dir, "p-%d.pdf")], { stdio: "pipe" });
      const pages = Array.from({ length: last - first + 1 }, (_, i) => join(dir, `p-${first + i}.pdf`));
      execFileSync("pdfunite", [...pages, out], { stdio: "pipe" });
      return new Uint8Array(readFileSync(out));
    } catch {
      return null;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
