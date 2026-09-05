// Undo and redo, and list behavior in a note (SPEC.md §6), driven in the built
// app: the two symbols sit on both bars, Cmd+Z steps back and Shift+Cmd+Z
// forward, in the note editor and in the article; and a note's bullets and
// numbering start, continue, nest and outdent as they do in a document editor.
// Env: NB, DOC, NOTE, CHROME.
import { chromium } from "playwright-core";

const [NB, DOC, NOTE] = [process.env.NB, process.env.DOC, process.env.NOTE];
const PORT = process.env.PORT ?? "3311";
const SHOT = process.env.SHOT_DIR ?? ".";
const results = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  results.push(line);
  if (process.env.VERBOSE) console.error(line);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 20000 });

const card = page.locator(`aside[data-track-surface="tray"] [data-note-id="${NOTE}"]`).first();
const editable = page.locator('aside[data-track-surface="tray"] [role="textbox"].note-doc').first();

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
const openEditor = async () => {
  await expand();
  await card.locator('button[data-track="note-edit"]').first().evaluate((el) => el.click());
  await page.waitForTimeout(700);
};

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/undo-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  // ── The note editor: the symbols, the keys, the buttons ──
  await setNote("alpha beta gamma");
  await openEditor();
  const undo = page.locator('aside[data-track-surface="tray"] button[data-track="note-undo"]');
  const redo = page.locator('aside[data-track-surface="tray"] button[data-track="note-redo"]');
  check("the note bar has an undo symbol", (await undo.locator("svg").count()) === 1);
  check("the note bar has a redo symbol", (await redo.locator("svg").count()) === 1);
  check("undo is off with nothing to take back", await undo.isDisabled());
  check("redo is off with nothing to put back", await redo.isDisabled());

  await editable.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" delta");
  await page.waitForTimeout(400);
  check("the typing lands", (await editable.innerText()).includes("delta"));
  check("undo lights up once there is an edit", !(await undo.isDisabled()));
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  check("Cmd+Z takes the typing back in a note", !(await editable.innerText()).includes("delta"),
    JSON.stringify(await editable.innerText()));
  check("redo lights up after an undo", !(await redo.isDisabled()));
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(400);
  check("Shift+Cmd+Z puts it back", (await editable.innerText()).includes("delta"));
  await undo.evaluate((el) => el.click());
  await page.waitForTimeout(400);
  check("the undo button takes it back too", !(await editable.innerText()).includes("delta"));
  await redo.evaluate((el) => el.click());
  await page.waitForTimeout(400);
  check("the redo button puts it back too", (await editable.innerText()).includes("delta"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ── Lists in a note ──
  await setNote("first");
  await openEditor();
  await editable.click();
  await page.keyboard.press("Control+End");
  const lines = async () =>
    editable.evaluate((el) => ({
      html: el.innerHTML,
      bullets: el.querySelectorAll("ul > li").length,
      numbers: el.querySelectorAll("ol > li").length,
      nestedBullets: el.querySelectorAll("ul ul > li, ol ul > li").length,
      nestedNumbers: el.querySelectorAll("ul ol > li, ol ol > li").length,
    }));
  // Typing the marker starts the list, as in a document editor.
  await page.keyboard.press("Enter");
  await page.keyboard.type("- one");
  await page.waitForTimeout(400);
  check("typing a dash and a space starts a bullet", (await lines()).bullets === 1, (await lines()).html.slice(0, 90));
  // Enter continues the list without retyping the marker.
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.waitForTimeout(400);
  check("Enter continues the bullet list", (await lines()).bullets === 2);
  // Tab nests the item; Shift+Tab brings it back.
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400);
  check("Tab nests the item", (await lines()).nestedBullets === 1, (await lines()).html.slice(0, 140));
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(400);
  check("Shift+Tab brings it back out", (await lines()).nestedBullets === 0);
  // Enter on an empty item ends the list.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("Enter on an empty item ends the list", (await lines()).bullets === 2);
  // A numbered list, the same way.
  await page.keyboard.type("1. one");
  await page.waitForTimeout(400);
  check("typing 1. and a space starts a numbered list", (await lines()).numbers === 1, (await lines()).html.slice(0, 120));
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.waitForTimeout(400);
  check("Enter continues the numbered list", (await lines()).numbers === 2);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400);
  check("Tab nests a numbered item", (await lines()).nestedNumbers === 1, (await lines()).html.slice(0, 160));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  // Each level draws its own marker, as a document editor does. A note with
  // both nestings, so every level is on screen at once.
  await setNote("- one\n  - nested\n\n1. first\n  1. inner");
  await openEditor();
  const markers = async () =>
    editable.evaluate((el) => {
      const of = (sel) => {
        const node = el.querySelector(sel);
        return node ? getComputedStyle(node).listStyleType : null;
      };
      return { ul: of("ul"), ul2: of("ul ul"), ol: of("ol"), ol2: of("ol ol") };
    });
  const m = await markers();
  check("a bullet list is discs", m.ul === "disc", String(m.ul));
  check("a nested bullet changes shape", m.ul2 === "circle", String(m.ul2));
  check("a numbered list is numbers", m.ol === "decimal", String(m.ol));
  check("a nested number changes series", m.ol2 === "lower-alpha", String(m.ol2));
  await page.screenshot({ path: `${SHOT}/lists.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ── The rendered note nests the same way ──
  await expand();
  const body = card.locator(".note-body").first();
  const rendered = await body.evaluate((el) => {
    const of = (sel) => {
      const node = el.querySelector(sel);
      return node ? getComputedStyle(node).listStyleType : null;
    };
    return {
      bullets: el.querySelectorAll("ul > li").length,
      nested: el.querySelectorAll("ul ul > li").length,
      numbers: el.querySelectorAll("ol > li").length,
      nestedNumbers: el.querySelectorAll("ol ol > li").length,
      ul2: of("ul ul"),
      ol2: of("ol ol"),
    };
  });
  check("the rendered note nests bullets", rendered.nested === 1, JSON.stringify(rendered));
  check("the rendered note nests numbers", rendered.nestedNumbers === 1, JSON.stringify(rendered));
  check("the rendered note's nested bullet changes shape", rendered.ul2 === "circle", String(rendered.ul2));
  check("the rendered note's nested number changes series", rendered.ol2 === "lower-alpha", String(rendered.ol2));

  // ── The article: the symbols and the steps ──
  const para = page.locator("article.reader-prose p[data-block-id]").first();
  const blockId = await para.getAttribute("data-block-id");
  await para.dblclick({ force: true });
  await page.waitForTimeout(600);
  const bar = page.locator("[data-edit-toolbar]");
  const aUndo = bar.locator('button[data-track="undo"]');
  const aRedo = bar.locator('button[data-track="redo"]');
  check("the article bar has an undo symbol", (await aUndo.locator("svg").count()) === 1);
  check("the article bar has a redo symbol", (await aRedo.locator("svg").count()) === 1);
  check("the article's undo starts off", await aUndo.isDisabled());

  const block = page.locator(`[data-edit-block="${blockId}"]`);
  const boldSpans = () => block.locator(".font-bold").count();
  await block.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const n = walker.nextNode();
    const r = document.createRange();
    r.setStart(n, 0);
    r.setEnd(n, 12);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  const wasBold = await boldSpans();
  await bar.locator('button[data-track="style:bold"]').first().evaluate((el) => el.click());
  await page.waitForTimeout(1200);
  check("the article takes the style", (await boldSpans()) !== wasBold);
  check("the article's undo lights up", !(await aUndo.isDisabled()));
  await aUndo.evaluate((el) => el.click());
  await page.waitForTimeout(1600);
  check("undo takes the style back", (await boldSpans()) === wasBold, `${wasBold} vs ${await boldSpans()}`);
  await aRedo.evaluate((el) => el.click());
  await page.waitForTimeout(1600);
  check("redo puts the style back", (await boldSpans()) !== wasBold);

  // Typing, then Cmd+Z: the typing is what comes back.
  await block.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ZZTOP");
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(2000);
  check("Cmd+Z takes typing back in the article", !(await block.innerText()).includes("ZZTOP"),
    JSON.stringify((await block.innerText()).slice(-40)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
}
