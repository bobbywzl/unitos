// Re-renders stored answers with the renderer as it now stands, into another
// directory, and lints them: the way to measure a change to the server's
// drawing (lib/derive/visualize.ts, simulate.ts) with no model call.
//   npx tsx scripts/eval/visualize/rerender.ts <from dir> <to dir> [case …]
import "../env";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "@/lib/derive/json";
import { renderVisual, visualizeOutputSchema } from "@/lib/derive/visualize";
import { lintLines, openBrowser, rasterize } from "./raster";

async function main(): Promise<void> {
  const [from, to, ...wanted] = process.argv.slice(2);
  const ids = wanted.length ? wanted : readdirSync(from).filter((d) => existsSync(join(from, d, "draw.json")));
  const browser = await openBrowser();
  try {
    for (const id of ids) {
      const parsed = parseJson(visualizeOutputSchema, readFileSync(join(from, id, "draw.json"), "utf8"));
      if (!parsed?.visual) continue;
      const kind = parsed.visual.kind;
      if (kind === "picture" || kind === "animation") continue;
      const rendered = await renderVisual(parsed.visual);
      if ("error" in rendered) {
        console.log(`${id}: ${rendered.error}`);
        continue;
      }
      mkdirSync(join(to, id), { recursive: true });
      writeFileSync(join(to, id, "draw.svg"), rendered.svg);
      const lint = await rasterize(browser, rendered.svg, { png: join(to, id, "draw.png") }, { modelDrawn: false });
      writeFileSync(join(to, id, "lint.json"), JSON.stringify(lint, null, 2));
      console.log(`${id}: ${kind} viewBox ${lint.viewBox} min text ${lint.minTextPx} px; ${lintLines(lint).length} faults`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
