// Stacked effects (SPEC.md §6), driven in the built app: two or more styles on
// the same text must never leave their markers showing — not in the note
// editor, not in the article, not in the one-line summary a collapsed note or
// annotation shows, and not in the rendered note.
// Env: NB, DOC, NOTE, CHROME. Expects a freshly seeded document: the article
// checks read whether a click changed the paint, which an earlier run's
// leftover spans can mask.
import { chromium } from "playwright-core";

const [NB, DOC, NOTE] = [process.env.NB, process.env.DOC, process.env.NOTE];
const PORT = process.env.PORT ?? "3311";
const SHOT = process.env.SHOT_DIR ?? ".";
// Any marker the editor writes, left where a reader would see it.
const RAW = /[*_~`]|<\/?u>|<\/?(clay|sage|gold|plum)>|\]\(|\[block /;

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 20000 });

const card = page.locator(`aside[data-track-surface="tray"] [data-note-id="${NOTE}"]`).first();
const editable = page.locator('aside[data-track-surface="tray"] [role="textbox"].note-doc').first();
const styleButton = page.locator('aside[data-track-surface="tray"] button[data-track^="note-style:"]');
const colorButton = page.locator('aside[data-track-surface="tray"] button[data-track="note-text-color"]');

/** Set the note's text and reload, so each case starts from a known note. */
async function setNote(content) {
  await page.request.patch(`http://localhost:${PORT}/api/notes/${NOTE}`, { data: { content } });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(`[data-note-id="${NOTE}"]`, { timeout: 15000 });
}

const expand = async () => {
  if ((await card.locator(".note-body").count()) === 0) {
    await card.locator('button[data-track="note-collapse"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(300);
  }
};

/** Select visible characters [from, to) inside an element's text. */
function selectIn(locator, from, to) {
  return locator.evaluate((el, [from, to]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let at = 0, sn = null, so = 0, en = null, eo = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.data.length;
      if (sn === null && at + len >= from) { sn = n; so = from - at; }
      if (at + len >= to) { en = n; eo = to - at; break; }
      at += len;
    }
    if (!sn || !en) return;
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, [from, to]);
}

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/effects-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  // ── Every stack the editor can write, as a collapsed note's summary line ──
  // The collapsed line is the default view, so it is what a reader sees first.
  const stacks = [
    ["bold", "**alpha** beta"],
    ["bold + italic", "**_alpha_** beta"],
    ["underline + bold", "<u>**alpha**</u> beta"],
    ["underline + bold + italic", "<u>**_alpha_**</u> beta"],
    ["colour + underline + bold + italic", "<clay><u>**_alpha_**</u></clay> beta"],
    ["strike + bold", "~~**alpha**~~ beta"],
    ["code + bold", "**`alpha`** beta"],
    ["link + bold", "**[alpha](https://x.test)** beta"],
    ["heading + bold", "### **alpha** beta"],
    ["bullet + underline", "- <u>alpha</u> beta"],
  ];
  // The two atoms inside a colour: neither can sit inside a link, so the
  // colour has to pass over them rather than wrap them.
  const atoms = [
    ["a chip inside a colour", "<clay>alpha [block abc123] beta</clay>"],
    ["a link inside a colour", "<clay>alpha [beta](https://x.test) gamma</clay>"],
  ];
  for (const [label, content] of stacks) {
    await setNote(content);
    const line = (await card.innerText()).split("\n").slice(1).join(" ").trim();
    check(`collapsed line, ${label}`, !RAW.test(line) && line.includes("alpha"), JSON.stringify(line.slice(0, 44)));
  }

  // ── The same stacks, rendered whole ──
  for (const [label, content] of stacks.slice(0, 6)) {
    await setNote(content);
    await expand();
    const body = await card.locator(".note-body").first().innerText();
    check(`rendered note, ${label}`, !RAW.test(body) && body.includes("alpha"), JSON.stringify(body.slice(0, 44)));
  }

  for (const [label, content] of atoms) {
    await setNote(content);
    await expand();
    const body = await card.locator(".note-body").first();
    const text = await body.innerText();
    check(`rendered note, ${label}`, !RAW.test(text) && text.includes("alpha"), JSON.stringify(text.slice(0, 44)));
    check(`the colour paints, ${label}`, (await body.locator(".text-color-clay").count()) > 0);
  }

  // ── Applying the effects, one on top of another, in the note editor ──
  await setNote("alpha beta gamma");
  await expand();
  await card.locator('button[data-track="note-edit"]').first().evaluate((el) => el.click());
  await page.waitForTimeout(700);
  const press = async (loc) => {
    await loc.evaluate((el) => el.click());
    await page.waitForTimeout(350);
  };
  // Nested: the same words take every style in turn.
  await selectIn(editable, 0, 5);
  for (const [i, name] of [[0, "bold"], [2, "underline"], [1, "italic"]]) {
    await press(styleButton.nth(i));
    const text = await editable.innerText();
    check(`note editor, ${name} on the same words`, !RAW.test(text), JSON.stringify(text.slice(0, 40)));
  }
  await press(colorButton.nth(0));
  check("note editor, a colour on top", !RAW.test(await editable.innerText()));
  // Overlapping: a second range that starts inside the first.
  await selectIn(editable, 3, 12);
  await press(styleButton.nth(2));
  check("note editor, an overlapping range", !RAW.test(await editable.innerText()),
    JSON.stringify((await editable.innerText()).slice(0, 40)));
  const stacked = await editable.evaluate((el) => el.innerHTML);
  check("note editor paints the stack", /<u>|text-color-clay/.test(stacked) && /<strong>/.test(stacked));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ── The article takes the same treatment ──
  const para = page.locator("article.reader-prose p[data-block-id]").first();
  const blockId = await para.getAttribute("data-block-id");
  await para.dblclick({ force: true });
  await page.waitForTimeout(600);
  const block = page.locator(`[data-edit-block="${blockId}"]`);
  const bar = page.locator("[data-edit-toolbar]");
  // The block keeps whatever earlier runs left, so each style is checked by
  // its own toggle: applying it changes the painted spans.
  const painted = () => block.evaluate((el) => el.innerHTML);
  for (const name of ["bold", "underline", "italic"]) {
    const was = await painted();
    await selectIn(block, 0, 12);
    await bar.locator(`button[data-track="style:${name}"]`).first().evaluate((el) => el.click());
    await page.waitForTimeout(900);
    const now = await painted();
    check(`article, ${name} on the same words`, now !== was && !RAW.test(await block.innerText()),
      now === was ? "the paint did not change" : "");
  }
  await selectIn(block, 6, 20);
  await bar.locator('button[data-track="style:underline"]').first().evaluate((el) => el.click());
  await page.waitForTimeout(900);
  check("article, an overlapping range", !RAW.test(await block.innerText()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  check("the article reads clean", !RAW.test(await page.locator(`article.reader-prose [data-block-id="${blockId}"]`).innerText()));
  await page.screenshot({ path: `${SHOT}/effects.png` });
}
