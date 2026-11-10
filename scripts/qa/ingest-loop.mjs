// The ingest loop (SPEC.md §25): every kind of document the app takes, and
// kinds it must refuse, added through the add route, then each new document
// opened in the reader and pressed on. An add must end in a document or in
// a refusal with words: never a 5xx, never a hang. A reader page must draw
// the document: never the crash page, never a page error.
//
//   node scripts/qa/ingest-loop.mjs <files dir> <out dir> [urls|files|all] [name filter]
//
// Needs the app on QA_BASE with the mock models (see tools-loop.mjs). The
// files come from any directory: one add per file. Env: QA_BASE.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require("/usr/local/lib/node_modules_global/playwright");
  }
})();

const BASE = process.env.QA_BASE ?? "http://localhost:3111";
const FILES = process.argv[2];
const OUT = process.argv[3];
const WHAT = process.argv[4] ?? "all";
const FILTER = process.argv[5] ?? "";
const ADD_TIMEOUT_MS = 240_000;
mkdirSync(path.join(OUT, "shots"), { recursive: true });

// expect: "doc" a document must come; "refuse" the add must be refused with
// words; "any" either, as long as it is clean (a site may block a robot).
const URLS = [
  ["https://example.com/", "doc"],
  ["https://paulgraham.com/greatwork.html", "doc"],
  ["https://en.wikipedia.org/wiki/Matrix_(mathematics)", "doc"],
  ["https://en.wikipedia.org/wiki/Photosynthesis", "doc"],
  ["https://zh.wikipedia.org/wiki/%E5%85%89%E5%90%88%E4%BD%9C%E7%94%A8", "doc"],
  ["https://ar.wikipedia.org/wiki/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA", "doc"],
  ["https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC", "doc"],
  ["https://plato.stanford.edu/entries/nietzsche/", "doc"],
  ["https://slatestarcodex.com/2014/07/30/meditations-on-moloch/", "any"],
  ["https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions", "doc"],
  ["https://docs.python.org/3/tutorial/classes.html", "doc"],
  ["https://react.dev/learn/thinking-in-react", "doc"],
  ["https://www.rfc-editor.org/rfc/rfc2616", "doc"],
  ["https://www.w3.org/TR/WCAG21/", "any"],
  ["https://news.ycombinator.com/", "any"],
  ["https://www.bbc.com/news", "any"],
  ["https://www.cdc.gov/flu/about/index.html", "any"],
  ["https://www.nature.com/articles/s41586-021-03819-2", "any"],
  ["https://arxiv.org/abs/1706.03762", "doc"],
  ["https://arxiv.org/pdf/1706.03762", "doc"],
  ["https://www.irs.gov/pub/irs-pdf/fw4.pdf", "any"],
  ["https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", "any"],
  ["https://www.gutenberg.org/cache/epub/84/pg84.txt", "any"],
  ["https://www.gutenberg.org/files/1342/1342-h/1342-h.htm", "any"],
  ["https://raw.githubusercontent.com/torvalds/linux/master/README", "any"],
  ["https://raw.githubusercontent.com/facebook/react/main/README.md", "any"],
  ["https://github.com/facebook/react", "any"],
  ["https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array", "any"],
  ["https://medium.com/@karpathy/software-2-0-a64152b37c35", "any"],
  ["https://seekingalpha.com/article/3992960-alphabet-goog-q2-2016-results-earnings-call-transcript", "any"],
  ["https://www.sec.gov/Archives/edgar/data/1652044/000165204423000016/goog-20221231.htm", "any"],
  ["https://www.economist.com/", "any"],
  ["https://www.reddit.com/r/programming/", "any"],
  ["https://x.com/elonmusk", "any"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "any"],
  ["https://vimeo.com/76979871", "any"],
  // A link that is a file, not a page: refused in words that say which.
  ["https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png", "refuse", /image/],
  ["https://httpbin.org/image/jpeg", "refuse", /image/],
  ["https://httpbin.org/image/webp", "refuse", /image/],
  ["https://httpbin.org/image/svg", "refuse", /image/],
  ["https://httpbin.org/bytes/4096", "refuse", /file/],
  ["https://httpbin.org/gzip", "any"],
  ["https://github.com/git/git/archive/refs/tags/v2.0.0.zip", "refuse", /file|refused/],
  ["https://file-examples.com/storage/fe0b9bd3fd6710a7e9b2b2e/2017/02/file-sample_100kB.docx", "any"],
  // More kinds of page.
  ["https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)", "doc"],
  ["https://en.wikipedia.org/wiki/Maxwell%27s_equations", "doc"],
  ["https://de.wikipedia.org/wiki/Quantenmechanik", "doc"],
  ["https://ko.wikipedia.org/wiki/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C", "doc"],
  ["https://he.wikipedia.org/wiki/%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D", "doc"],
  ["https://simple.wikipedia.org/wiki/Cat", "doc"],
  ["https://www.gnu.org/philosophy/free-sw.html", "doc"],
  ["https://www.kernel.org/doc/html/latest/process/coding-style.html", "any"],
  ["https://go.dev/doc/effective_go", "any"],
  ["https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html", "any"],
  ["https://www.postgresql.org/docs/current/tutorial-join.html", "any"],
  ["https://sqlite.org/howtocorrupt.html", "any"],
  ["https://martinfowler.com/articles/microservices.html", "any"],
  ["https://blog.samaltman.com/how-to-be-successful", "any"],
  ["https://waitbutwhy.com/2015/01/artificial-intelligence-revolution-1.html", "any"],
  ["https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/", "any"],
  ["https://stratechery.com/2015/aggregation-theory/", "any"],
  ["https://www.federalreserve.gov/monetarypolicy/fomcminutes20230201.htm", "any"],
  ["https://www.who.int/news-room/fact-sheets/detail/diabetes", "any"],
  ["https://www.nasa.gov/", "any"],
  ["https://www.theguardian.com/international", "any"],
  ["https://apnews.com/", "any"],
  ["https://www.npr.org/sections/news/", "any"],
  ["https://text.npr.org/", "any"],
  ["https://lite.cnn.com/", "any"],
  ["https://www.nytimes.com/", "any"],
  ["https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7119388/", "any"],
  ["https://pubmed.ncbi.nlm.nih.gov/33301246/", "any"],
  ["https://www.biorxiv.org/content/10.1101/2020.02.07.937862v1.full", "any"],
  ["https://openreview.net/forum?id=YicbFdNTTy", "any"],
  ["https://arxiv.org/abs/2303.08774", "any"],
  ["https://arxiv.org/pdf/2005.14165", "any"],
  ["https://www.bis.org/publ/bcbs189.pdf", "any"],
  ["https://www.un.org/en/about-us/universal-declaration-of-human-rights", "any"],
  ["https://www.constituteproject.org/constitution/United_States_of_America_1992", "any"],
  ["https://www.law.cornell.edu/uscode/text/17/107", "any"],
  ["https://www.imdb.com/title/tt0111161/", "any"],
  ["https://www.amazon.com/dp/B08N5WRWNW", "any"],
  ["https://www.linkedin.com/in/williamhgates", "any"],
  ["https://www.quora.com/What-is-the-meaning-of-life", "any"],
  ["https://substack.com/home", "any"],
  ["https://www.notion.so/", "any"],
  ["https://docs.github.com/en/get-started/quickstart/hello-world", "any"],
  ["https://kubernetes.io/docs/concepts/overview/", "any"],
  ["https://tailwindcss.com/docs/installation", "any"],
  ["https://nextjs.org/docs", "any"],
  ["https://www.bbc.com/zhongwen/simp", "any"],
  ["https://www3.nhk.or.jp/news/easy/", "any"],
  ["https://www.lemonde.fr/", "any"],
  ["https://www.spiegel.de/", "any"],
  ["https://www.aljazeera.net/", "any"],
  ["https://httpbin.org/encoding/utf8", "any"],
  ["https://httpbin.org/robots.txt", "any"],
  ["https://httpbin.org/deny", "any"],
  ["https://httpbin.org/status/403", "refuse"],
  ["https://httpbin.org/status/429", "refuse"],
  ["https://httpbin.org/status/204", "refuse"],
  ["https://httpbin.org/absolute-redirect/9", "refuse"],
  ["https://httpbin.org/drip?duration=2&numbytes=200&code=200", "any"],
  ["https://expired.badssl.com/", "refuse"],
  ["https://self-signed.badssl.com/", "refuse"],
  ["https://example.com:81/", "refuse"],
  ["https://example.com/a-page-that-is-not-there-unitos", "refuse"],
  ["HTTPS://EXAMPLE.COM/", "doc"],
  ["https://example.com/#fragment", "doc"],
  ["https://example.com/?utm_source=test&q=%E4%B8%AD%E6%96%87", "doc"],
  ["https://people.sc.fsu.edu/~jburkardt/data/csv/addresses.csv", "any"],
  ["https://feeds.bbci.co.uk/news/rss.xml", "any"],
  ["https://httpbin.org/html", "any"],
  ["https://httpbin.org/json", "any"],
  ["https://httpbin.org/xml", "any"],
  ["https://httpbin.org/redirect/3", "any"],
  ["https://httpbin.org/delay/3", "any"],
  ["https://httpbin.org/status/404", "refuse"],
  ["https://httpbin.org/status/500", "refuse"],
  ["https://this-domain-does-not-exist-unitos-qa.example/", "refuse"],
  ["https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit", "refuse"],
  // Addresses the server must never fetch.
  ["http://localhost:3399/", "refuse", /private network/],
  ["http://127.0.0.1:5432/", "refuse", /private network/],
  ["http://169.254.169.254/latest/meta-data/", "refuse", /private network/],
  ["http://[::1]:3111/", "refuse", /private network/],
  ["http://2130706433:3399/", "refuse", /private network/],
  ["http://0x7f.1:3399/", "refuse", /private network/],
  ["http://user:pass@127.0.0.1:3399/", "refuse", /private network/],
  ["http://10.0.0.1/", "refuse", /private network/],
  ["http://192.168.1.1/admin", "refuse", /private network/],
  ["http://printer.local/", "refuse", /private network/],
  // A public page that redirects to this machine: refused at the redirect.
  ["https://postman-echo.com/redirect-to?url=http%3A%2F%2F127.0.0.1%3A3399%2F", "refuse", /private network/],
  ["https://postman-echo.com/redirect-to?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F", "refuse", /private network/],
  ["ftp://example.com/file.txt", "refuse", /http/],
  ["file:///etc/passwd", "refuse", /http/],
  ["javascript:alert(1)", "refuse", /http/],
  ["not a url", "refuse", /http/],
];
// Files the add must refuse; every other file must become a document.
// A one-pixel image is an image and an empty .csv is an empty sheet: both add.
const REFUSED = /^(corrupt\.|not-really\.pdf|archive\.zip|binary\.bin|zero\.pdf|data\.json|empty\.(txt|docx))/;
const EITHER = /^(page\.html|header-only\.csv|blank-slide\.pptx|crlf-latin1\.txt|huge\.txt|empty\.csv|tiny\.gif|pixel\.webp)/;
// What a refusal must say, by file: the reader learns what to do next.
const MUST_SAY = [
  [/^empty\.(txt|docx)$/, /no text/],
  [/^corrupt\.xlsx$/, /not a PDF/],
];

const results = [];
const log = (...a) => console.log(...a);

async function readAnswer(res) {
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  let last = null;
  for (let i = lines.length - 1; i >= 0 && !last; i--) {
    try {
      last = JSON.parse(lines[i]);
    } catch {
      /* not this line */
    }
  }
  return { last, raw: text.slice(-300) };
}

async function add(kind, name, expect, send, mustSay = null) {
  const started = Date.now();
  const r = { kind, name, expect, status: 0, seconds: 0, id: null, error: null, verdict: "", problems: [] };
  try {
    const res = await send(AbortSignal.timeout(ADD_TIMEOUT_MS));
    r.status = res.status;
    const { last, raw } = await readAnswer(res);
    r.id = typeof last?.id === "string" && !last?.error ? last.id : null;
    r.error = typeof last?.error === "string" ? last.error : res.ok && !r.id ? `no id: ${raw.slice(-160)}` : null;
    if (last?.stage === "error" || last?.failed) r.error = r.error ?? JSON.stringify(last).slice(0, 200);
  } catch (err) {
    r.error = err?.name === "TimeoutError" ? `HANG: no answer in ${ADD_TIMEOUT_MS / 1000}s` : `threw: ${String(err?.message ?? err).slice(0, 160)}`;
    r.status = -1;
  }
  r.seconds = Math.round((Date.now() - started) / 100) / 10;
  if (r.status >= 500 || r.status === -1) r.problems.push(r.error ?? `status ${r.status}`);
  else if (expect === "doc" && !r.id) r.problems.push(`expected a document: ${r.status} ${r.error ?? ""}`);
  else if (expect === "refuse" && r.id) r.problems.push("expected a refusal, got a document");
  else if (!r.id && !r.error) r.problems.push(`no document and no words: ${r.status}`);
  else if (!r.id && mustSay && !mustSay.test(r.error ?? "")) r.problems.push(`the refusal does not say ${mustSay}: ${r.error}`);
  r.verdict = r.problems.length ? "PROBLEM" : r.id ? "doc" : "refused";
  results.push(r);
  log(`${r.verdict.padEnd(8)} ${String(r.status).padEnd(4)} ${String(r.seconds).padStart(6)}s ${kind} ${name.slice(0, 80)}${r.id ? "" : ` — ${String(r.error ?? "").slice(0, 110)}`}`);
  return r;
}

// A project of its own, so a run never crowds another.
const nbRes = await fetch(`${BASE}/api/notebooks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Ingest QA ${new Date().toISOString().slice(0, 16)}` }) });
const NB = (await nbRes.json()).id;
if (!NB) throw new Error("no project for the run");
log("project", NB);

const browser = await chromium.launch();

// Two PDFs printed here: an article with headings and a table, and a page
// that is one picture (the handwritten path).
if (!existsSync(path.join(FILES, "article.pdf"))) {
  const p = await browser.newPage();
  const para = "Search defaults decide the first query, and habit decides the rest. The economics of default payments only close for bidders who already monetize queries near the frontier. ";
  await p.setContent(`<html><body style="font-family:Georgia;font-size:12pt;margin:48px"><h1>On defaults and habit</h1><p><i>A. Reader, Institute of Search, 2026</i></p><h2>Abstract</h2><p>${para.repeat(3)}</p><h2>1. Introduction</h2>${Array.from({ length: 8 }, (_, i) => `<p>${i + 1}. ${para.repeat(4)}</p>`).join("")}<h2>2. Data</h2><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Region</th><th>Q1</th><th>Q2</th></tr><tr><td>North</td><td>1200</td><td>1350</td></tr><tr><td>South</td><td>900</td><td>1000</td></tr></table><h2>3. Results</h2>${Array.from({ length: 10 }, (_, i) => `<p>Result ${i + 1}. ${para.repeat(3)}</p>`).join("")}<h2>References</h2><p>[1] Alice, B. (2020). Defaults. Journal of Search 4(2).</p><p>[2] Carol, D. (2021). Habit. Search Letters 9.</p></body></html>`);
  writeFileSync(path.join(FILES, "article.pdf"), await p.pdf({ format: "Letter" }));
  const png = readFileSync(path.join(FILES, "whiteboard.png")).toString("base64");
  await p.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png}" style="width:100%"></body></html>`);
  writeFileSync(path.join(FILES, "scan.pdf"), await p.pdf({ format: "Letter" }));
  await p.close();
}

if (WHAT === "all" || WHAT === "files") {
  for (const name of readdirSync(FILES).sort()) {
    if (FILTER && !name.includes(FILTER)) continue;
    const expect = REFUSED.test(name) ? "refuse" : EITHER.test(name) ? "any" : "doc";
    await add("file", name, expect, (signal) => {
      const form = new FormData();
      form.set("file", new Blob([readFileSync(path.join(FILES, name))]), name);
      form.set("notebookId", NB);
      form.set("filename", name);
      form.set("confirmDuplicate", "1");
      return fetch(`${BASE}/api/documents`, { method: "POST", body: form, signal });
    }, MUST_SAY.find(([file]) => file.test(name))?.[1] ?? null);
  }
}
if (WHAT === "all" || WHAT === "urls") {
  for (const [url, expect, mustSay] of URLS) {
    if (FILTER && !url.includes(FILTER)) continue;
    await add(
      "url",
      url,
      expect,
      (signal) =>
        fetch(`${BASE}/api/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, notebookId: NB, confirmDuplicate: true }), signal }),
      mustSay ?? null,
    );
  }
}

// ── The reader: every new document drawn and pressed on ────────────────────
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
let errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 180)}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/hmr|Failed to load resource|net::ERR|favicon|404|403|blocked|CORS|Content Security|Mixed Content|preload|font/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 180)}`);
});
page.on("response", (r) => {
  if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 90)}`);
});
for (const r of results.filter((x) => x.id)) {
  errors = [];
  const view = { blocks: 0, shape: "", words: 0, toolbar: null, edit: null };
  try {
    await page.goto(`${BASE}/n/${NB}?doc=${r.id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(700);
    if (await page.locator("text=stopped on an error").count()) r.problems.push(`CRASH PAGE: ${(await page.locator("[role=alert]").innerText()).slice(0, 200).replace(/\n/g, " | ")}`);
    Object.assign(
      view,
      await page.evaluate(() => {
        const q = (s) => document.querySelectorAll(s).length;
        const article = document.querySelector("article") ?? document.querySelector("main") ?? document.body;
        const shape = q(".reader-slide") ? "slides" : q(".reader-sheet") ? "sheets" : q(".ProseMirror") ? "page editor" : q("[data-block-id] img[src*='/page/']") ? "pages" : q("video, audio, iframe[src*='youtube']") ? "media" : "blocks";
        return { blocks: q("[data-block-id]"), shape, words: (article.innerText ?? "").trim().split(/\s+/).length };
      }),
    );
    if (view.blocks === 0 && view.shape !== "page editor" && view.words < 30) r.problems.push(`the reader drew nothing (${view.words} words)`);
    // The article scrolls to its end and back.
    await page.mouse.move(600, 500);
    for (const dy of [1500, 3000, 6000, -12000]) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(120);
    }
    // Words selected: the toolbar opens (a document of words).
    const para = page.locator("[data-block-id]").filter({ hasText: /\S{3,}\s+\S{3,}\s+\S{3,}/ }).first();
    if (view.shape === "blocks" && (await para.count())) {
      await para.scrollIntoViewIfNeeded().catch(() => {});
      const b = await para.boundingBox();
      if (b) {
        await page.mouse.move(b.x + 8, b.y + Math.min(12, b.height / 2));
        await page.mouse.down();
        await page.mouse.move(b.x + Math.min(220, b.width - 4), b.y + Math.min(14, b.height / 2), { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(450);
        view.toolbar = (await page.locator('[data-track="explain"], [data-track="comment"]').count()) > 0;
        await page.keyboard.press("Escape");
      }
    }
    // A slide's line or a sheet's cell edited in place.
    if (view.shape === "slides" || view.shape === "sheets") {
      // The first line or cell that holds words and is no formula, wherever
      // it stands in the replica.
      const marked = await page.evaluate(() => {
        for (const el of document.querySelectorAll("p.sp, td, th")) {
          if (el.closest("[data-anchor-skip]") || el.matches('td[title^="="]')) continue;
          if (el.querySelector("p.sp, td, th, img, svg")) continue;
          const text = (el.textContent ?? "").trim();
          if (text.length < 1 || text.length > 60 || !/[A-Za-z]/.test(text)) continue;
          const box = el.getBoundingClientRect();
          if (box.width < 12 || box.height < 8) continue;
          el.setAttribute("data-qa-piece", "1");
          return true;
        }
        return false;
      });
      const piece = page.locator("[data-qa-piece]").first();
      if (marked) {
        const before = (await piece.innerText()).trim();
        await piece.scrollIntoViewIfNeeded().catch(() => {});
        await piece.dblclick();
        await page.waitForTimeout(200);
        if ((await page.locator("[data-replica-editing]").count()) !== 1) view.edit = "did not open";
        else {
          await page.keyboard.press("End");
          await page.keyboard.type(" QA");
          await page.keyboard.press("Enter");
          await page.waitForTimeout(2500);
          const body = await page.locator("article, main").first().innerText();
          view.edit = body.includes(`${before} QA`) ? "saved" : "not shown";
        }
        if (view.edit !== "saved") r.problems.push(`edit in place: ${view.edit}`);
      } else view.edit = "no plain piece";
    }
    if (await page.locator("text=stopped on an error").count()) r.problems.push(`CRASH PAGE after pressing: ${(await page.locator("[role=alert]").innerText()).slice(0, 200).replace(/\n/g, " | ")}`);
  } catch (err) {
    r.problems.push(`reader: ${String(err?.message ?? err).split("\n")[0].slice(0, 160)}`);
  }
  for (const e of errors.slice(0, 4)) r.problems.push(e);
  r.view = view;
  await page.screenshot({ path: path.join(OUT, "shots", `${r.kind}-${r.name.replace(/[^a-z0-9.]+/gi, "-").slice(0, 60)}.png` ) }).catch(() => {});
  if (r.problems.length) r.verdict = "PROBLEM";
  log(`${(r.problems.length ? "PROBLEM" : "ok").padEnd(8)} reader ${view.shape.padEnd(11)} blocks=${String(view.blocks).padStart(4)} words=${String(view.words).padStart(6)}${view.toolbar === null ? "" : ` toolbar=${view.toolbar}`}${view.edit ? ` edit=${view.edit}` : ""} ${r.name.slice(0, 70)}${r.problems.length ? `\n         ${r.problems.join("\n         ")}` : ""}`);
}
await browser.close();
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.problems.length);
log(`\nSUMMARY: ${results.length} adds, ${results.filter((r) => r.id).length} documents, ${results.filter((r) => !r.id && !r.problems.length).length} clean refusals, ${bad.length} with problems`);
for (const r of bad) log(`  PROBLEM ${r.kind} ${r.name.slice(0, 80)}\n     ${r.problems.join("\n     ")}`);
