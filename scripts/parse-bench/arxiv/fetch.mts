/**
 * Downloads each paper of papers.ts to .bench/arxiv/: the PDF, the LaTeXML HTML, the abstract page (it states
 * the license), and the e-print source (it holds the paper's macros). One request at a time, three seconds apart.
 * A file already there is kept unless --force.
 *
 *   npx tsx scripts/parse-bench/arxiv/fetch.mts [--only 2411.09614v2,2502.02648v2] [--force]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { EnvHttpProxyAgent, fetch } from "undici";
import { PAPERS, benchFile } from "./papers";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const force = args.includes("--force");
const dispatcher = new EnvHttpProxyAgent(); // HTTPS_PROXY when the environment sets one
const pause = () => new Promise((resolve) => setTimeout(resolve, 3000));

mkdirSync(".bench/arxiv", { recursive: true });
for (const paper of PAPERS) {
  if (only && !only.includes(paper.id)) continue;
  const files: [string, string][] = [
    [`https://arxiv.org/pdf/${paper.id}`, benchFile(paper, "pdf")],
    [`https://arxiv.org/html/${paper.id}`, benchFile(paper, "html")],
    [`https://arxiv.org/abs/${paper.id}`, benchFile(paper, "abs.html")],
    [`https://arxiv.org/e-print/${paper.id}`, benchFile(paper, "src")],
  ];
  for (const [url, path] of files) {
    if (existsSync(path) && !force) continue;
    const res = await fetch(url, { dispatcher, headers: { "user-agent": "unitos-parse-bench/0.1 (one request at a time)" } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(path, bytes);
    console.log(`${path} ${Math.round(bytes.length / 1024)} KB`);
    await pause();
  }
}
