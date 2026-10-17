// Drives the running app against the mock model (scripts/qa/mock-kimi.mjs):
// words from a figure (SPEC.md §7) on an article, a document without the
// page editor. A seeded article with one captioned figure: the figure's
// tools open as a click on a figure opens them (docs:figure-tools), the
// selection chat asks for the words under the figure, the assistant's
// suggestion shows under the figure, ✕ drops it and writes nothing, and ✓
// writes the words as blocks after the figure. Prints PASS/FAIL.
//   node scripts/qa/ui-figure-words-article.mjs
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const base = process.env.BASE ?? "http://localhost:3311";
const SHOT = process.env.SHOT_DIR ?? ".";
const db = new PrismaClient();

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

let seeded = null;
try {
  seeded = await seed();
  await run(seeded);
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/figure-words-article-crash.png` }).catch(() => {});
}
if (seeded) {
  await db.notebook.delete({ where: { id: seeded.notebookId } }).catch(() => {});
  await db.document.delete({ where: { id: seeded.documentId } }).catch(() => {});
}
await db.$disconnect();
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function seed() {
  // A picture of a paragraph, as a screenshot of a page would be.
  const shot = await browser.newPage({ viewport: { width: 520, height: 140 } });
  await shot.setContent('<p style="font:18px Georgia;margin:16px">A study led by Jane Gillette (1999) tested college undergraduates on 24 video clips.</p>');
  const png = (await shot.screenshot()).toString("base64");
  await shot.close();
  const document = await db.document.create({
    data: {
      title: "Figure words article (QA)",
      blocks: {
        create: [
          { order: 0, type: "HEADING", html: "<h1>", text: "Learning words" },
          { order: 1, type: "PARAGRAPH", text: "Duality of patterning: meaningless sounds form words, and words form syntactic structures." },
          { order: 2, type: "FIGURE", html: `<figure><img src="data:image/png;base64,${png}"><figcaption>Figure 1. A page of the study.</figcaption></figure>`, text: "Figure 1. A page of the study." },
          { order: 3, type: "PARAGRAPH", text: "The next chapter turns to how children map words onto objects in the world around them." },
        ],
      },
    },
    include: { blocks: { orderBy: { order: "asc" } } },
  });
  const notebook = await db.notebook.create({ data: { title: `QA figure words article ${Date.now()}`, documents: { create: [{ documentId: document.id }] } } });
  return { notebookId: notebook.id, documentId: document.id, figureId: document.blocks[2].id };
}

async function ask(figureId, command) {
  // Hold the pointer on the figure and draw a circle: the figure's tools open.
  const box = await page.locator(`[data-block-id="${figureId}"] img`).first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 30, cy);
  await page.mouse.down();
  for (let k = 1; k <= 28; k++) {
    const a = (k / 24) * 2 * Math.PI;
    await page.mouse.move(cx + 30 * Math.cos(a), cy + 30 * Math.sin(a));
  }
  await page.mouse.up();
  const box2 = page.locator('[data-selection-popover]:has(button[data-track="assistant"])').first();
  await box2.locator('button[data-track="assistant"]').click();
  await box2.locator("textarea").fill(command);
  await box2.locator('button[data-track="assistant-run"]').click();
}

async function run({ notebookId, documentId, figureId }) {
  await page.goto(`${base}/n/${notebookId}?doc=${documentId}`, { waitUntil: "networkidle" });
  await page.locator(`[data-block-id="${figureId}"]`).first().waitFor({ timeout: 30000 });
  const card = page.locator(`[data-figure-suggestion="${figureId}"]`);

  // ✕: nothing is written.
  await ask(figureId, "Put the text under the image");
  await card.waitFor({ timeout: 20000 });
  check("the suggestion shows under the figure", await card.isVisible());
  check("the text chip's suggestion holds the text alone, no list", (await card.textContent())?.includes("Jane Gillette") && !(await card.textContent())?.includes("•"));
  check("the plan card does not open for the words under the figure", (await page.getByText(/Accept \d+ action/).count()) === 0);
  await page.screenshot({ path: `${SHOT}/figure-words-article-suggestion.png` });
  await card.locator('button[data-track="figure-suggestion-reject"]').click();
  await card.waitFor({ state: "detached", timeout: 5000 });
  const afterReject = await db.block.count({ where: { documentId } });
  check("✕ drops the suggestion and writes nothing", afterReject === 4, `blocks: ${afterReject}`);

  // ✓: the words become blocks right after the figure, in order.
  await page.keyboard.press("Escape");
  await ask(figureId, "Put the text under the image");
  await card.waitFor({ timeout: 20000 });
  await card.locator('button[data-track="figure-suggestion-accept"]').click();
  await card.waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(1500);
  const blocks = await db.block.findMany({ where: { documentId }, orderBy: { order: "asc" }, select: { type: true, text: true } });
  const at = blocks.findIndex((b) => b.type === "FIGURE");
  check(
    "✓ writes the words right after the figure",
    blocks[at + 1]?.text.includes("Jane Gillette") && blocks[at + 2]?.text.startsWith("The next chapter"),
    blocks.map((b) => `${b.type}:${b.text.slice(0, 20)}`).join(" | "),
  );
  await page.screenshot({ path: `${SHOT}/figure-words-article-accepted.png` });

  // The key points: the list alone.
  await page.keyboard.press("Escape");
  await ask(figureId, "Put the key points under the image");
  await card.waitFor({ timeout: 20000 });
  check("the key points' suggestion holds the list alone, not the text", (await card.textContent())?.includes("• Verbs were harder than nouns") && !(await card.textContent())?.includes("Jane Gillette"));
  await page.screenshot({ path: `${SHOT}/figure-words-article-points.png` });
}
