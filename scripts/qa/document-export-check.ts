// A document's download (SPEC.md §15, lib/export/document.ts): what the
// files hold and what they never hold. No database, no browser.
//
//   npx tsx scripts/qa/document-export-check.ts
import { documentHtml, documentMarkdown, documentText, exportBlocks, fileName, hasWords, type ExportRow } from "@/lib/export/document";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const row = (r: Partial<ExportRow> & Pick<ExportRow, "type" | "text">): ExportRow => ({
  id: `b${Math.random()}`,
  html: null,
  styles: null,
  links: null,
  page: null,
  region: null,
  startTime: null,
  speaker: null,
  ...r,
});
const words = { slide: (n: number) => `Slide ${n}`, page: (n: number) => `Page ${n}` };

// An article.
const article = exportBlocks(
  {
    title: "Search ads",
    sourceUrl: "https://example.com/a/b.html",
    speakers: null,
    rows: [
      row({ type: "HEADING", html: "<h1>", text: "Search Ads" }),
      row({ type: "PARAGRAPH", text: "Bold start, a link.", styles: [{ start: 0, end: 4, style: "bold" }], links: [{ start: 14, end: 18, quotedText: "link", href: "https://example.com/x" }] }),
      row({ type: "LIST", text: "- one\n  - nested\n1. first" }),
      row({ type: "TABLE", text: "A\tB\n1\t2" }),
      row({ type: "FIGURE", text: "Figure 1.", html: '<figure><img src="/img/c.png" onerror="alert(1)"><script>alert(2)</script></figure>' }),
      row({ type: "PARAGRAPH", text: "Stars *here* stay words." }),
    ],
  },
  words,
);
const md = documentMarkdown("Search ads", article, "https://example.com/a/b.html");
check("the title stands once", (md.match(/Search ads/gi) ?? []).length === 1, md.split("\n")[0]);
check("Markdown keeps bold and the link", md.includes("**Bold** start") && md.includes("[link](https://example.com/x)"));
check("Markdown nests the list and keeps the count", md.includes("- one\n  - nested\n1. first"));
check("Markdown writes the table", md.includes("| A | B |\n| --- | --- |\n| 1 | 2 |"));
check("Markdown names the figure's picture whole", md.includes("![Figure 1.](https://example.com/img/c.png)"));
check("Markdown reads the document's stars as words", md.includes("Stars \\*here\\* stay words."));
const html = documentHtml("Search ads", article, { pageUrl: "https://example.com/a/b.html", pictures: new Map(), lang: "en" });
check("the web page runs nothing", !/<script|onerror/i.test(html));
check("the web page makes addresses whole", html.includes('src="https://example.com/img/c.png"'));
check("the web page draws the lists", html.includes("<ul><li>one<ul><li>nested</li></ul></li></ul><ol><li>first</li></ol>"));
check("plain text holds the words", documentText("Search ads", article).includes("Bold start, a link."));

// A recording: the transcript, never the player.
const talk = exportBlocks(
  {
    title: "Call",
    sourceUrl: null,
    speakers: [{ id: "s1", name: "Ruth Porat" }],
    rows: [
      row({ type: "VIDEO", text: "call.mp4" }),
      row({ type: "TRANSCRIPT", text: "Revenue rose.", startTime: 65.4, speaker: "s1" }),
      row({ type: "TRANSCRIPT", text: "An hour in.", startTime: 3725 }),
    ],
  },
  words,
);
const talkText = documentText("Call", talk);
check("a recording is its transcript", talkText.includes("[1:05] Ruth Porat: Revenue rose.") && talkText.includes("[1:02:05] An hour in."));
check("the player block stays out", !talkText.includes("call.mp4") && talk.every((b) => b.type === "PARAGRAPH"));

// Slides, sheets, handwritten pages.
const slides = exportBlocks({ title: "Deck", sourceUrl: null, speakers: null, rows: [row({ type: "SLIDE", page: 2, text: "Line one\nLine two", html: "<div>x</div>" })] }, words);
check("a slide is a heading and its lines", slides[0].type === "HEADING" && slides[0].text === "Slide 2" && slides[1].text === "Line one\nLine two");
const sheets = exportBlocks({ title: "Book", sourceUrl: null, speakers: null, rows: [row({ type: "SHEET", page: 1, text: "A\tB\n1\t2", html: "<table></table>" })] }, words);
check("a sheet is a table of its rows", sheets[0].type === "TABLE" && documentMarkdown("Book", sheets, null).includes("| A | B |"));
const pages = exportBlocks({ title: "Notes", sourceUrl: null, speakers: null, rows: [row({ type: "PAGE", page: 1, text: "Page 1" })] }, words);
check("handwritten pages with no converted text hold no words", !hasWords(pages), JSON.stringify(pages));
const converted = exportBlocks(
  { title: "Notes", sourceUrl: null, speakers: null, rows: [row({ type: "PAGE", page: 1, text: "Page 1" }), row({ type: "PARAGRAPH", page: 1, text: "Converted words." })] },
  words,
);
check("converted text stands under its page", converted.map((b) => b.text).join("|") === "Page 1|Converted words.");

check("a file name holds no character a file system refuses", fileName('A/B: "C"?', "md") === "A B C.md", fileName('A/B: "C"?', "md"));

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
