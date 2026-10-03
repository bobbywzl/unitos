// Downloads the corpus's public PDFs that are not on disk yet: every entry of
// corpus.json whose url is the PDF itself (an arXiv entry is built by
// arxiv/fetch.mts, and a page that is not a PDF is left to the owner). Each
// file lands at the entry's pdf path under .bench/, never committed. A host
// the network refuses is reported and skipped, so a session whose network
// reaches only some hosts still gets those.
//
//   npx tsx scripts/parse-bench/fetch.mts [--only id,id]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
    writeFileSync(path, bytes);
    fetched += 1;
    console.log(`fetched  ${entry.pdf}  (${Math.round(bytes.length / 1024)} KB)`);
  } catch (e) {
    failed += 1;
    console.log(`skipped  ${entry.pdf}  ${new URL(entry.url).host}: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}`);
  }
}
console.log(`\n${fetched} fetched, ${failed} skipped`);
