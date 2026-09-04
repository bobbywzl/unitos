// Wrap text (SPEC.md §6), driven in the built app: the gap hugs the floating
// card on every side, the lines beside it stop exactly GAP short, and a table
// or a figure clears the card instead of being squeezed beside it.
// Env: NB, DOC, NOTE (a notebook, an open document, an accepted note), CHROME.
import { chromium } from "playwright-core";

const [NB, DOC, NOTE] = [process.env.NB, process.env.DOC, process.env.NOTE];
const PORT = process.env.PORT ?? "3311";
const SHOT = process.env.SHOT_DIR ?? ".";
const DRAG_HINT = "Hold and drag sideways to float this note over the article";
const GAP = 18; // lib/note-wrap.ts NOTE_WRAP_GAP
const TOL = 1;

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
await page.waitForSelector(`[data-note-id="${NOTE}"]`, { timeout: 20000 });

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/wrap-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

/** Drag the note out of the tray and drop it at (x, y). */
async function float(x, y) {
  const header = page
    .locator(`aside[data-track-surface="tray"] [data-note-id="${NOTE}"]`)
    .locator(`[data-tip="${DRAG_HINT}"]`)
    .first();
  const h = await header.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 60, h.y + 6, { steps: 6 });
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

/** The card, the gap and every line and block, measured together. */
function survey() {
  return page.evaluate(() => {
    const cardEl = document.querySelector("[data-floating-note]");
    const c = cardEl.getBoundingClientRect();
    const gapEl = document.querySelector("[data-note-wrap-gap]");
    const g = gapEl?.getBoundingClientRect();
    const article = document.querySelector("article.reader-prose");
    const a = article.getBoundingClientRect();
    const cs = getComputedStyle(article);
    const textLeft = a.left + parseFloat(cs.paddingLeft);
    const textRight = a.right - parseFloat(cs.paddingRight);
    const side = gapEl?.style.float ?? null;
    const flow = new Set(["P", "H1", "H2", "H3"]);
    let intruding = 0;
    let beside = 0;
    let nearest = Infinity;
    const squeezed = [];
    for (const b of article.querySelectorAll("[data-block-id]")) {
      const br = b.getBoundingClientRect();
      const vOverlap = br.bottom > c.top && br.top < c.bottom;
      const isFlow = flow.has(b.tagName) || b.classList.contains("reader-block") && b.tagName === "DIV" && !b.querySelector("table, figure, svg, video, pre, .katex");
      if (!isFlow && vOverlap && br.right > c.left && br.left < c.right) {
        squeezed.push(`${b.tagName}#${b.dataset.blockId.slice(-4)}`);
      }
      const r = document.createRange();
      r.selectNodeContents(b);
      for (const line of r.getClientRects()) {
        if (line.width < 12 || line.height < 4) continue;
        if (!(line.bottom > c.top && line.top < c.bottom)) continue;
        beside++;
        const clearance = side === "right" ? c.left - line.right : line.left - c.right;
        if (clearance < 0) intruding++;
        nearest = Math.min(nearest, clearance);
      }
    }
    return {
      card: { l: c.left, r: c.right, t: c.top, b: c.bottom },
      gap: g ? { l: g.left, r: g.right, t: g.top, b: g.bottom } : null,
      side,
      text: { l: textLeft, r: textRight },
      beside,
      intruding,
      nearest,
      squeezed,
    };
  });
}

async function run() {
  // ── The card in the middle of the column: the gap hugs it on every side ──
  await float(180, 300);
  const floating = page.locator("[data-floating-note]");
  check("the note floats", (await floating.count()) === 1);
  await floating.locator('button[data-track="note-wrap"]').click();
  await page.waitForTimeout(600);
  check("the gap is drawn once", (await page.locator("[data-note-wrap-gap]").count()) === 1);

  let s = await survey();
  const near = (a, b) => Math.abs(a - b) <= TOL;
  check("gap top hugs the card", near(s.gap.t, s.card.t - GAP), `gap ${Math.round(s.gap.t)} vs card ${Math.round(s.card.t)} - ${GAP}`);
  check("gap bottom hugs the card", near(s.gap.b, s.card.b + GAP), `gap ${Math.round(s.gap.b)} vs card ${Math.round(s.card.b)} + ${GAP}`);
  const far = s.side === "right" ? s.gap.l : s.gap.r;
  const cardEdge = s.side === "right" ? s.card.l - GAP : s.card.r + GAP;
  check("gap side edge hugs the card", near(far, cardEdge), `gap ${Math.round(far)} vs card edge ${Math.round(cardEdge)}`);
  const columnEdge = s.side === "right" ? s.gap.r : s.gap.l;
  const columnSide = s.side === "right" ? s.text.r : s.text.l;
  check("gap reaches the column edge", near(columnEdge, columnSide), `${Math.round(columnEdge)} vs ${Math.round(columnSide)}`);
  check("lines beside the card stop short of it", s.beside > 0 && s.intruding === 0, `${s.beside} lines, ${s.intruding} intruding`);
  check("the nearest line stops one gap away", s.nearest >= GAP - TOL, `nearest ${Math.round(s.nearest)}px`);
  check("no table or figure squeezed beside the card", s.squeezed.length === 0, s.squeezed.join(", "));
  await page.screenshot({ path: `${SHOT}/wrap-mid.png` });

  // ── The card over the table and the figure: both clear it ──
  await page.locator("[data-reader-root]").first().evaluate((el) => el.scrollTo(0, 0));
  await floating.locator('button[data-track="note-dock"]').click();
  await page.waitForTimeout(600);
  await float(560, 760);
  await page.waitForTimeout(400);
  const wrapBtn = page.locator("[data-floating-note]").locator('button[data-track="note-wrap"]');
  if ((await wrapBtn.getAttribute("aria-pressed")) !== "true") await wrapBtn.click();
  await page.waitForTimeout(700);
  s = await survey();
  check("over a table and a figure: neither is squeezed", s.squeezed.length === 0, s.squeezed.join(", "));
  check("over a table and a figure: no line intrudes", s.intruding === 0, `${s.intruding} intruding`);
  check("gap still hugs the card", near(s.gap.t, s.card.t - GAP) && near(s.gap.b, s.card.b + GAP),
    `top ${Math.round(s.gap.t)}/${Math.round(s.card.t - GAP)} bottom ${Math.round(s.gap.b)}/${Math.round(s.card.b + GAP)}`);
  await page.screenshot({ path: `${SHOT}/wrap-blocks.png` });

  // The table below the card runs the full column width again.
  const table = await page.evaluate(() => {
    const t = document.querySelector("article.reader-prose .reader-table");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const a = document.querySelector("article.reader-prose").getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector("article.reader-prose"));
    return { w: r.width, full: a.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
  });
  check("the table keeps the full column width", table !== null && table.w >= table.full - 2,
    table ? `${Math.round(table.w)} of ${Math.round(table.full)}` : "no table");
}
