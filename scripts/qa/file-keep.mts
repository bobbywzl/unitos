// A Markdown or text file keeps every word it holds (CLAUDE.md rule zero).
// The file is the author's own words, with no site chrome: the URL walk it
// passes through (lib/parse/markdown-document.ts → lib/parse/url.ts) must
// drop none of its paragraphs, headings, list items, table cells, or quotes,
// even when one reads like a web page's furniture ("Follow us on Mastodon",
// "© 2024 …", a list of three links) or repeats an earlier paragraph.
//
// Each probe is parsed the way the add parses it (parseMarkdownDocument),
// and every leaf block of the file's Markdown tree is counted in the parse's
// title and blocks: a block said twice in the file is said twice in the
// parse. Every scripts/eval/fixtures/*.md is held to the same check. An
// inline formula ($x^2$, \(a_i\)) is kept as its readable characters (x²)
// with its TeX as an inline formula of the block (ParsedBlock.math), which
// an import draws as an inline equation; a dollar amount and an escaped \$
// stay words. Nothing is stored.
// Run: npx tsx --tsconfig tsconfig.json scripts/qa/file-keep.mts
import "../eval/env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { deriveBlocks } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";
import { richTextFromImport } from "@/lib/docs/import";
import { mathAsWords, mathAsWritten, parseMarkdownDocument, setAsideMath } from "@/lib/parse/markdown-document";
import { parseHtmlContent } from "@/lib/parse/url";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const norm = (s: string) => s.replace(/[☐☑]/g, " ").replace(/\s+/g, " ").trim();

// The file's leaf blocks, as plain text: what the parse must keep. Math is
// set aside first, as the parse sets it aside, and each formula counts as
// its words: an inline formula's readable characters, display math's TeX.
function leafTexts(markdown: string): string[] {
  const { text: body, spans } = setAsideMath(markdown.replace(/^---\n[\s\S]*?\n---\n?/, ""));
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as Root;
  const out: string[] = [];
  const text = (node: RootContent): string => {
    if (node.type === "text") return mathAsWords(node.value, spans);
    if (node.type === "inlineCode") return node.value;
    if (node.type === "image") return "";
    if (node.type === "break") return " ";
    if ("children" in node) return (node.children as RootContent[]).map(text).join("");
    return "";
  };
  const walk = (node: RootContent) => {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") {
      const t = norm(text(node));
      if (t) out.push(t);
      return;
    }
    if (node.type === "code") {
      for (const line of mathAsWritten(node.value, spans).split("\n")) if (line.trim()) out.push(norm(line));
      return;
    }
    if (node.type === "html") {
      const t = norm(mathAsWords(node.value, spans).replace(/<[^>]+>/g, " "));
      if (t) out.push(t);
      return;
    }
    if ("children" in node) for (const child of node.children as RootContent[]) walk(child);
  };
  for (const child of tree.children) walk(child);
  return out;
}

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

// Every leaf block of the file is in the parse, as many times as the file
// says it. Returns the leaf blocks the parse lost (with how many copies).
async function lostLeaves(markdown: string, filename: string): Promise<string[]> {
  const parsed = await parseMarkdownDocument(markdown, filename);
  // A title the file's words give holds those words; a file name holds none.
  const title = parsed.titleFromFile ? "" : (parsed.title ?? "");
  const kept = `\n${[title, ...parsed.blocks.map((b) => b.text)].map(norm).join("\n")}\n`;
  const wanted = new Map<string, number>();
  for (const leaf of leafTexts(markdown)) wanted.set(leaf, (wanted.get(leaf) ?? 0) + 1);
  const lost: string[] = [];
  // A leaf that is part of a longer leaf (a heading inside a paragraph) is
  // counted once per occurrence of its own, at least.
  for (const [leaf, n] of wanted) {
    const longer = [...wanted.keys()].filter((other) => other !== leaf && other.includes(leaf));
    const need = n + longer.reduce((sum, other) => sum + occurrences(other, leaf) * (wanted.get(other) ?? 0), 0);
    const have = occurrences(kept, leaf);
    if (have < need) lost.push(`${have}/${need} "${leaf.slice(0, 60)}"`);
  }
  return lost;
}

const FILLER =
  "Caching keeps a copy of data close to where it is read, so the second read costs less than the first one did.";
const SECOND =
  "A smaller key space shrinks the cache and makes each entry more likely to be hit again before it expires.";
const THIRD = "Shorter lifetimes shrink it too, at the cost of more misses when the data changes slowly.";

// One probe per drop rule of the walk and of cleanBlocks a file's words
// could meet. Each holds the line a web page's chrome would hold, set
// among the author's own paragraphs.
const PROBES: { name: string; file: string; md: string }[] = [
  {
    name: "repeated paragraphs in the head",
    file: "caching.md",
    md: `# Notes on caching\n\n${FILLER}\n\n## What shrinks it\n\n${FILLER}\n\n${SECOND}\n\n${THIRD}\n\n## Measuring the effect\n\n${SECOND}\n\n${THIRD}\n\nCount hits and misses for a week before you change anything.\n`,
  },
  {
    name: "a long line said twice in a row",
    file: "twice.md",
    md: `# Twice\n\n${FILLER}\n\n${SECOND}\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "credit lines",
    file: "credits.md",
    md: `# Field notes\n\n${FILLER}\n\nPhoto: Jane Doe\n\nImage credit: the city archive\n\nIllustration by Sam Lee\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "share rows",
    file: "share.md",
    md: `# Sharing\n\n${FILLER}\n\nShare this with a friend!\n\nShare on Twitter Facebook LinkedIn Email\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "date-label lines and bylines",
    file: "dates.md",
    md: `# Meeting notes\n\nBy Jane Doe\n\nUpdated: March 3, 2024\n\nPublished 3 March 2024\n\n5 min read\n\n${FILLER}\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "copyright, follow, newsletter, and related lines",
    file: "footer.md",
    md: `# Reading list\n\n${FILLER}\n\n${SECOND}\n\n${THIRD}\n\nFollow us on Mastodon\n\nSubscribe to our newsletter for weekly notes.\n\nRelated: How caches fail\n\n© 2024 Mia Chen. All rights reserved.\n\nPrivacy Policy\n\nContact us\n`,
  },
  {
    name: "pager rows and back-to-top lines",
    file: "pager.md",
    md: `# Chapter two\n\n${FILLER}\n\n${SECOND}\n\n« Previous | Next »\n\nOlder posts · Newer posts\n\nBack to top\n\n${THIRD}\n`,
  },
  {
    name: "tag rows and shortcodes",
    file: "tags.md",
    md: `# Tagged\n\n${FILLER}\n\nTags: caching, memory, latency\n\n[caption id="attachment_12" align="alignnone" width="300"]A cache line[/caption]\n\n{{< figure src="cache.png" >}}\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "a list of three links and a link rail",
    file: "links.md",
    md: `# Links\n\n${FILLER}\n\n- [How caches fail](https://example.com/a)\n- [Why caches grow](https://example.com/b)\n- [When to drop a cache](https://example.com/c)\n\n${SECOND}\n\n[Home](https://example.com/) [About](https://example.com/about) [Blog](https://example.com/blog) [Notes](https://example.com/notes) [Contact](https://example.com/contact) [Archive](https://example.com/archive)\n\n${THIRD}\n`,
  },
  {
    name: "headline list",
    file: "headlines.md",
    md: `# Headlines\n\n${FILLER}\n\n## More stories\n\n- [The city adds four bike lanes this spring](https://example.com/1)\n- [A new library opens on the east side](https://example.com/2)\n- [School board votes on the late bus](https://example.com/3)\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "a line that repeats the title",
    file: "title-row.md",
    md: `# Notes on caching\n\nNotes on caching\n\n${FILLER}\n\n${SECOND}\n\nNotes on caching\n\n${THIRD}\n`,
  },
  {
    name: "comment headings and what follows them",
    file: "comments.md",
    md: `# Review\n\n${FILLER}\n\n${SECOND}\n\n## Comments\n\nThe second test run gave the same numbers as the first.\n\n## Leave a reply\n\n${THIRD}\n\n## 3 thoughts on "Review"\n\nWe should repeat the run on the larger machine next week.\n`,
  },
  {
    name: "raw HTML with chrome classes",
    file: "raw.md",
    md: `# Raw\n\n${FILLER}\n\n<div class="share-buttons">Share these notes with the team before Friday.</div>\n\n<div class="newsletter">The newsletter section of the plan is still open.</div>\n\n<aside class="sidebar">A side note the author wrote in an aside.</aside>\n\n<nav>The plan has three parts.</nav>\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "author box, about the author, breadcrumbs, click-here lines, and pitches",
    file: "author.md",
    md: `# Notes\n\nHome > Notes > Caching\n\n${FILLER}\n\n${SECOND}\n\nClick here to read the full report.\n\nSign up for free today.\n\nRead more\n\n## About the author\n\nMia Chen writes about caches and the people who tune them.\n\n${THIRD}\n`,
  },
  {
    name: "a short file",
    file: "short.md",
    md: `# Short\n\nOne line.\n\nTwo lines.\n`,
  },
  {
    name: "a short file of furniture lines",
    file: "furniture.md",
    md: `Share\n\nFollow us\n\nNext\n\n© 2024\n`,
  },
  {
    name: "a plain text file with repeats",
    file: "notes.txt",
    md: `Imports audit 5\n\n${FILLER}\n\nTHE REPLAY WINDOW\n\n${SECOND}\n\n${THIRD}\n\n${SECOND}\n\n${THIRD}\n\nFollow us on Mastodon\n\n© 2024 Mia Chen\n`,
  },
  {
    name: "a first heading that says the file's name",
    file: "Intro.md",
    md: `## Intro\n\n${FILLER}\n\n${SECOND}\n\n${THIRD}\n`,
  },
  {
    name: "inline math, display math, and dollar amounts",
    file: "math.md",
    md: `# Energy $E=mc^2$\n\n${FILLER}\n\nThe square $x^2$ grows, and $\\alpha + \\beta$ is a sum, and \\(a_i\\) is an item.\n\nIt costs $5 and $10, and an escaped \\$ stays a dollar.\n\n- A list item with $e^{i\\pi} = -1$ inside.\n\n| Term | Value |\n| --- | --- |\n| $\\sigma$ | costs $3 |\n\n$$\\int_0^1 f(x)\\,dx$$\n\n    an indented code line with $x$\n\n${SECOND}\n`,
  },
  {
    name: "label and value rows",
    file: "fields.md",
    md: `# Fields\n\n${FILLER}\n\nAuthor: Mia Chen\n\nSource: field notebook\n\nFiled under: caching\n\n${SECOND}\n\n${THIRD}\n\nWords: 120\n\nCategory: notes\n`,
  },
];

for (const probe of PROBES) {
  const lost = await lostLeaves(probe.md, probe.file);
  check(`file keeps every block: ${probe.name}`, lost.length === 0, lost.join("; "));
}

const FIXTURES = join(process.cwd(), "scripts", "eval", "fixtures");
for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith(".md")).sort()) {
  const lost = await lostLeaves(readFileSync(join(FIXTURES, name), "utf8"), name);
  check(`file keeps every block: fixture ${name}`, lost.length === 0, lost.join("; "));
}

// Inline math (EDGE11-12 of the reader audit): $…$ and \(…\) read as
// math. A block keeps the formula's readable characters and carries its TeX
// as an inline formula (ParsedBlock.math), as a PDF's block does; the import
// draws each as an inline equation, and the paragraph index reads it as its
// TeX between dollar signs. A dollar amount, an escaped \$, a code span, and
// TeX KaTeX cannot draw stay words.
{
  type Rich = RichNode & { content?: Rich[] };
  const read = async (md: string) => {
    const parsed = await parseMarkdownDocument(md, "math.md");
    const rich = richTextFromImport({ kind: "markdown", title: parsed.title, titleFromOriginal: !parsed.titleFromFile, blocks: parsed.blocks }).richText as Rich;
    const equations: string[] = [];
    const visit = (node: Rich) => {
      if (node.type === "inlineMath") equations.push(String(node.attrs?.latex));
      for (const child of node.content ?? []) visit(child);
    };
    visit(rich);
    return { parsed, equations, rows: deriveBlocks(rich).map((b) => b.text) };
  };
  const formulas = (b: { text: string; math?: { start: number; end: number; latex: string }[] } | undefined) =>
    (b?.math ?? []).map((m) => `${b?.text.slice(m.start, m.end)}=${m.latex}`).join(" | ");

  const prose = await read(`# Notes\n\nThe square $x^2$ grows, and $\\alpha + \\beta$ is a sum, and \\(a_i\\) is an item.\n`);
  const p = prose.parsed.blocks.find((b) => b.type === "PARAGRAPH");
  check("inline math: a block keeps the readable characters", p?.text === "The square x² grows, and α + β is a sum, and aᵢ is an item.", p?.text);
  check("inline math: a block carries each formula's TeX", formulas(p) === "x²=x^2 | α + β=\\alpha + \\beta | aᵢ=a_i", formulas(p));
  check("inline math: the import draws inline equations", prose.equations.join(" | ") === "x^2 | \\alpha + \\beta | a_i", prose.equations.join(" | "));
  check(
    "inline math: the paragraph index reads each formula as its TeX",
    prose.rows.includes("The square $x^2$ grows, and $\\alpha + \\beta$ is a sum, and $a_i$ is an item."),
    prose.rows.join(" / "),
  );

  const words = [
    ["dollar amounts", "It costs $5 and $10 today.", "It costs $5 and $10 today."],
    ["a range of dollar amounts", "It rose from $5 to $6 a share.", "It rose from $5 to $6 a share."],
    ["escaped dollars", "Prices: \\$5 and \\$10, and an escaped pair \\$x\\$ stays.", "Prices: $5 and $10, and an escaped pair $x$ stays."],
    ["an escaped dollar that opens", "A note \\$x$ here.", "A note $x$ here."],
    ["dollars after letters", "US$5 and US$6 in a row.", "US$5 and US$6 in a row."],
    ["a code span", "Code `$x^2$` stays code.", "Code $x^2$ stays code."],
    ["TeX KaTeX cannot draw", "Bad TeX $\\frac{a$ stays.", "Bad TeX $\\frac{a$ stays."],
  ] as const;
  for (const [name, line, want] of words) {
    const { parsed, equations } = await read(`# Notes\n\n${line}\n`);
    const b = parsed.blocks.find((x) => x.type === "PARAGRAPH");
    check(`inline math: no formula in ${name}`, b?.text === want && !b?.math && equations.length === 0, `${b?.text} ${formulas(b)}`);
  }
  const mixed = await read(`# Notes\n\nPay $5, then $x$ is the rest.\n`);
  const m = mixed.parsed.blocks.find((b) => b.type === "PARAGRAPH");
  check("inline math: a dollar amount beside a formula", m?.text === "Pay $5, then x is the rest." && formulas(m) === "x=x", `${m?.text} ${formulas(m)}`);

  const shapes = await read(
    `# Energy $E=mc^2$\n\n- A list item with $e^{i\\pi} = -1$ inside.\n\n## Part $n$\n\n> A quote with $q^2$.\n\n| Term | Value |\n| --- | --- |\n| $\\sigma$ | costs $3 |\n\n![The curve $y=x^2$](https://example.com/a.png "Plot of $y$")\n`,
  );
  const blocks = shapes.parsed.blocks;
  check("inline math: a title reads its formula", shapes.parsed.title === "Energy E = mc²" && !blocks.some((b) => b.type === "HEADING" && b.text === "Energy E = mc²"), `title ${shapes.parsed.title}`);
  check("inline math: a list item", formulas(blocks.find((b) => b.type === "LIST")) === "e^(iπ) = −1=e^{i\\pi} = -1", formulas(blocks.find((b) => b.type === "LIST")));
  check("inline math: a heading", formulas(blocks.find((b) => b.type === "HEADING")) === "n=n", formulas(blocks.find((b) => b.type === "HEADING")));
  check("inline math: a quote", formulas(blocks.find((b) => b.text.startsWith("A quote"))) === "q²=q^2", formulas(blocks.find((b) => b.text.startsWith("A quote"))));
  const table = blocks.find((b) => b.type === "TABLE");
  check(
    "inline math: a table cell keeps its TeX, and a dollar amount stays words",
    table?.text === "Term\tValue\nσ\tcosts $3" && (table?.html ?? "").includes('data-latex="\\sigma"'),
    `${table?.text} ${table?.html}`,
  );
  check("inline math: the import draws a table cell's inline equation", shapes.equations.includes("\\sigma"), shapes.equations.join(" | "));
  const figure = blocks.find((b) => b.type === "FIGURE");
  check(
    "inline math: an image's alt and caption read their formulas",
    (figure?.html ?? "").includes('alt="The curve y = x²"') && figure?.text === "Plot of y",
    `${figure?.text} ${figure?.html}`,
  );
}

// A text file's outline (markdownToHtml): a short first line standing alone
// is the Title, and a short line in capitals standing alone is a heading. A
// line that ends a sentence is neither, and a file with a heading of its
// own keeps its Markdown as written.
{
  const shape = async (md: string, file = "notes.txt") => {
    const parsed = await parseMarkdownDocument(md, file);
    return {
      title: parsed.titleFromFile ? null : parsed.title,
      headings: parsed.blocks.filter((b) => b.type === "HEADING").map((b) => norm(b.text)),
    };
  };
  const audit = await shape(`Imports audit 5\n\n${FILLER}\n\nTHE REPLAY WINDOW\n\n${SECOND}\n\nWHAT WE MEASURED\n\n${THIRD}\n`);
  check("text file: a short first line is the Title", audit.title === "Imports audit 5", `title ${audit.title}`);
  check(
    "text file: a short line in capitals is a heading",
    audit.headings.join(" | ") === "THE REPLAY WINDOW | WHAT WE MEASURED",
    audit.headings.join(" | "),
  );
  const sentences = await shape(`This file opens with a sentence.\n\n${FILLER}\n\nTHE RUN STOPPED HERE.\n\n${SECOND}\n\nNOTE:\n\n${THIRD}\n`);
  check("text file: a first line that ends a sentence is no Title", sentences.title === null, `title ${sentences.title}`);
  check("text file: a capitals line that ends a sentence is no heading", sentences.headings.length === 0, sentences.headings.join(" | "));
  const joined = await shape(`Notes\nfrom the second run of the cache test\n\n${FILLER}\nTHE REPLAY WINDOW\n${SECOND}\n\nA LINE IN CAPITALS THAT RUNS ON FAR TOO LONG TO BE ANY HEADING\n\n${THIRD}\n`);
  check("text file: a line with no blank line under it is no Title", joined.title === null, `title ${joined.title}`);
  check("text file: a capitals line inside a paragraph, or a long one, is no heading", joined.headings.length === 0, joined.headings.join(" | "));
  const long = await shape(`A first line that runs on well past twelve words is the opening of the text\n\n${FILLER}\n`);
  check("text file: a long first line is no Title", long.title === null, `title ${long.title}`);
  const markdown = await shape(`# Cache notes\n\n${FILLER}\n\nTHE REPLAY WINDOW\n\n${SECOND}\n`, "notes.md");
  check(
    "Markdown with a heading of its own keeps its Markdown",
    markdown.title === "Cache notes" && markdown.headings.length === 0,
    `title ${markdown.title}; headings ${markdown.headings.join(" | ")}`,
  );
}

// A web page: the head-duplicate rule drops a copy of the title, or of a
// block whose first copy sits in the page's header, and never a body
// paragraph said twice (more than three blocks apart: a line said again
// within three blocks is the long-line rule's, a gallery's caption drawn
// twice).
{
  const page = (head: string, body: string) =>
    `<!doctype html><html><head><title>Notes on caching</title></head><body>${head}<article><h1>Notes on caching</h1>${body}</article></body></html>`;
  const count = (blocks: { text: string }[], text: string) => blocks.filter((b) => norm(b.text) === text).length;
  const twice = await parseHtmlContent(
    page("", `<p>${FILLER}</p><h2>What shrinks it</h2><p>${SECOND}</p><p>${THIRD}</p><p>Count hits and misses for a week before you change anything.</p><h2>Measuring the effect</h2><p>${SECOND}</p><p>${THIRD}</p>`),
    "https://example.com/caching",
  );
  check("page keeps a body paragraph said twice in the head", count(twice.blocks, SECOND) === 2 && count(twice.blocks, THIRD) === 2,
    `${count(twice.blocks, SECOND)} and ${count(twice.blocks, THIRD)} copies`);
  const header = await parseHtmlContent(
    `<!doctype html><html><head><title>Notes on caching</title></head><body><article><header><h1>Notes on caching</h1><p>A short note on why caches grow.</p></header><p>A short note on why caches grow.</p><p>${FILLER}</p><p>${SECOND}</p><p>${THIRD}</p></article></body></html>`,
    "https://example.com/caching",
  );
  check("page drops a copy of a header line in the head", count(header.blocks, "A short note on why caches grow.") === 1,
    `${count(header.blocks, "A short note on why caches grow.")} copies`);
}

console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
