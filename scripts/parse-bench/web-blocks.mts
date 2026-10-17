// Prints the blocks the URL parse reads from one page of the web benchmark
// (web.mts): each block's type and its first words. For reading a weak page.
//
//   npx tsx scripts/parse-bench/web-blocks.mts <id>
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

delete process.env.HTTPS_PROXY;
delete process.env.HTTP_PROXY;
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;
const { parseHtmlContent } = await import("@/lib/parse/url");
const { decodePage } = await import("@/lib/parse/charset");

const AEB = join(import.meta.dirname, "..", "..", ".bench", "web", "aeb");
const id = process.argv[2];
const file = readdirSync(join(AEB, "html")).find((f) => f.startsWith(id));
if (!file) throw new Error(`No page ${id}`);
const truth = JSON.parse(readFileSync(join(AEB, "ground-truth.json"), "utf8")) as Record<string, { url: string }>;
const hash = file.replace(/\.html\.gz$/, "");
const html = decodePage(gunzipSync(readFileSync(join(AEB, "html", file))));
const parsed = await parseHtmlContent(html, truth[hash].url);
console.log(`title: ${parsed.title}`);
for (const b of parsed.blocks) console.log(`${b.type.padEnd(9)} ${b.text.replace(/\s+/g, " ").slice(0, 160)}`);
