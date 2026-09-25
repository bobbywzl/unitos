// Deterministic model mock for the QA autoloop: Moonshot's OpenAI-compatible
// chat completions on /v1/chat/completions, plus the Formula API endpoints the
// web-search tool uses, and Anthropic's Messages API on /v1/messages for the
// import's model (lib/claude.ts). Sniffs each prompt and returns valid,
// context-aware output: real block ids, real quotes, schema-exact JSON — so
// every AI flow (SIMPLIFY, SALIENCE, DISTILL, assistant ask and act with matches,
// the assistant's suggestions, the import's passes) runs end-to-end with zero
// external calls. Point the app
// at it with
//   MOONSHOT_API_KEY=mock MOONSHOT_BASE_URL=http://localhost:3399/v1
//   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:3399/v1
import http from "node:http";

const PORT = 3399;

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => c.text ?? "").join("\n");
  return "";
}

function parseBlocks(all) {
  // [block <id>] (TYPE)\n<text until blank line before next [block or end>
  const blocks = [];
  // A timed block's tag carries its seconds: (TRANSCRIPT 0.0s–14.0s).
  const re = /\[block ([^\]]+)\] \(([A-Z]+)[^)]*\)\n([\s\S]*?)(?=\n\n\[block |\n\nDocument title:|$)/g;
  let m;
  while ((m = re.exec(all))) blocks.push({ id: m[1], type: m[2], text: m[3] });
  return blocks;
}

// The assistant's suggestions (SPEC.md §29): ops on the scope's real blocks.
// Over blocks: the first paragraph's first three words replaced, the second
// paragraph rewritten with one word changed, a heading and a paragraph after
// the first heading, the last paragraph (of three or more) set to h2, and a
// first draft in a document with no words. On selected words: their first
// three words replaced. Every answer ends with one misquoted change, which
// the server skips.
function suggestOps(all) {
  const at = all.indexOf("Suggest edits to the document above.");
  const ask = all.slice(at);
  const styled = ask.match(/^Paragraph styles in the scope: (.*)$/m)?.[1] ?? "";
  const scope = new Set([...styled.matchAll(/\[block ([^\]]+)\]/g)].map((m) => m[1]));
  const blocks = parseBlocks(all.slice(0, at))
    .map((b) => ({ ...b, text: b.text.trim() }))
    .filter((b) => scope.has(b.id));
  const firstWords = (text) => text.split(/\s+/).slice(0, 3).join(" ");
  const ops = [];
  const selected = ask.match(/^Scope: the selected words\.\n\[block ([^\]]+)\] "([^\n]*)"$/m);
  if (selected) {
    ops.push({ op: "replace_words", blockId: selected[1], find: firstWords(selected[2]), text: "Mock words", why: "Mock: the first words, reworded." });
  } else {
    const paragraphs = blocks.filter((b) => b.type === "PARAGRAPH" && b.text.split(/\s+/).length >= 3);
    const heading = blocks.find((b) => b.type === "HEADING");
    const [first, second] = paragraphs;
    if (first) ops.push({ op: "replace_words", blockId: first.id, find: firstWords(first.text), text: "Mock opening", why: "Mock: the opening words, reworded." });
    if (second) {
      const words = second.text.split(" ");
      words[1] = "mock";
      ops.push({ op: "rewrite_block", blockId: second.id, text: words.join(" "), why: "Mock: one word changed." });
    }
    if (heading) ops.push({ op: "insert_blocks", afterBlockId: heading.id, markdown: "## Mock heading\n\nMock paragraph.", why: "Mock: a heading and a paragraph added." });
    if (paragraphs.length >= 3) ops.push({ op: "set_style", blockId: paragraphs[paragraphs.length - 1].id, style: "h2", why: "Mock: the last paragraph made a heading." });
    if (!first && ask.includes("Scope: the whole document.")) {
      ops.push({ op: "insert_blocks", afterBlockId: null, markdown: "# Mock draft\n\nMock paragraph.", why: "Mock: a first draft." });
    }
  }
  const misquoted = selected?.[1] ?? blocks.find((b) => b.type === "PARAGRAPH")?.id;
  if (misquoted) ops.push({ op: "replace_words", blockId: misquoted, find: "words the document never had", text: "anything", why: "Mock: a misquoted change." });
  console.log("[mock suggest]", ops.length, "ops");
  return JSON.stringify({ summary: `Mock: ${ops.length} changes suggested.`, ops });
}

// A message that asks for a change (the selection chat's command, the
// panel's question) on a document with rich text becomes one suggest action.
const CHANGE_RX = /\b(make|rewrite|rephrase|shorten|shorter|fix|change|edit|turn|formal|casual|add|remove|delete)\b/i;

function buildResponse(all) {
  if (all.includes("Suggest edits to the document above.")) return suggestOps(all);
  // The panel at This page scope: the answer, then the actions fence.
  if (all.includes("Rules for actions:") && all.includes("- suggest {") && CHANGE_RX.test(all.match(/^Question: (.*)$/m)?.[1] ?? "")) {
    const action = { type: "suggest", instruction: "Make the whole document formal.", description: "Make the document formal" };
    return `Mock answer: the suggestions make the document formal.\n\n\`\`\`actions\n${JSON.stringify([action])}\n\`\`\``;
  }
  // The selection chat: no reply, one suggest action.
  if (all.includes('"actions"') && all.includes("- suggest {") && CHANGE_RX.test(all.match(/^Command: (.*)$/m)?.[1] ?? "")) {
    return JSON.stringify({ reply: null, actions: [{ type: "suggest", instruction: "Shorten it", description: "Shorten" }], matches: [] });
  }

  const blocks = parseBlocks(all);
  const paragraphs = blocks.filter((b) => b.type === "PARAGRAPH" && b.text.length > 40);

  // Import PDF classification: article or handwritten, by the yield the prompt
  // reports — the mock cannot see the page images.
  if (all.includes('"kind"') && all.includes("handwritten")) {
    const pages = Number(all.match(/\((\d+) pages\)/)?.[1] ?? 1);
    const chars = Number(all.match(/yielded (\d+) characters/)?.[1] ?? 0);
    return JSON.stringify({ kind: chars / Math.max(1, pages) < 100 ? "handwritten" : "article" });
  }

  // Conversion: handwritten pages → text blocks imitating the notes' formatting.
  if (all.includes('"blocks"') && all.includes("Transcribe them into text blocks")) {
    const first = Number(all.match(/pages? (\d+)/i)?.[1] ?? 1);
    return JSON.stringify({
      blocks: [
        { type: "HEADING", level: 1, page: first, text: "Mock heading from the notes" },
        {
          type: "PARAGRAPH",
          page: first,
          text: "Mock transcription of the handwritten page, kept word for word.",
        },
        { type: "LIST", page: first, text: "- first point\n- second point" },
        { type: "TABLE", page: first, text: "Item\tCount\nPages\t2" },
        { type: "EQUATION", page: first, text: "E = mc^2" },
      ],
    });
  }

  // DISTILL (document and corpus): quotes with captions from real blocks. The
  // corpus prompt carries [document <id>] "title" headers; pull one quote from
  // each of the first two documents so the answer spans the corpus.
  if (all.includes('"caption"') && all.includes('"quotes"')) {
    const headers = [...all.matchAll(/\[document ([^\]]+)\] "/g)];
    const pick = (list) => list.filter((b) => b.type === "PARAGRAPH" && b.text.length > 80)[0];
    const quoteOf = (b, caption) => ({
      blockId: b.id,
      start: 0,
      end: Math.min(120, b.text.length),
      caption,
    });
    if (headers.length >= 2) {
      const one = pick(parseBlocks(all.slice(headers[0].index, headers[1].index)));
      const end = headers.length > 2 ? headers[2].index : all.length;
      const two = pick(parseBlocks(all.slice(headers[1].index, end)));
      const quotes = [];
      if (one) quotes.push(quoteOf(one, "The defaults memo grounds the market-power argument in the payment economics."));
      if (two) quotes.push(quoteOf(two, "The second document extends the same market-power argument to platform revenue."));
      return JSON.stringify({ quotes });
    }
    const p1 = pick(blocks);
    return JSON.stringify({ quotes: p1 ? [quoteOf(p1, "The passage answers the question directly in the document's own terms.")] : [] });
  }

  // Stitch (SPEC.md §22), the select pass: the first three lines of every
  // document's skeleton, aliases only.
  if (all.includes('"blockIds"') && all.includes("A second read will do what the command asks")) {
    const blockIds = [];
    for (const section of all.split(/\n(?=\[document [A-Z]+\] ")/)) {
      [...section.matchAll(/\[block ([A-Z]+\d+)\]/g)].slice(0, 3).forEach((m) => blockIds.push(m[1]));
    }
    console.log("[mock stitch select]", blockIds.length, "blocks");
    return JSON.stringify({ blockIds });
  }

  // Stitch, the answer pass: one link between the first two documents (one
  // end a verbatim quote, one end the whole block), a page of one whole-block
  // quote part per document and one text part with sources, and a reply.
  if (all.includes('"reply"') && all.includes('"parts"') && /\[document [^\]]+\] "/.test(all)) {
    const headers = [...all.matchAll(/\[document ([^\]]+)\] "/g)];
    const firstParagraph = headers.map((h, i) => {
      const end = i + 1 < headers.length ? headers[i + 1].index : all.length;
      return parseBlocks(all.slice(h.index, end)).find((b) => b.type === "PARAGRAPH" && b.text.length > 40);
    });
    const [one, two] = firstParagraph;
    const links =
      one && two
        ? [{ fromBlockId: one.id, fromQuote: one.text.slice(0, 60), toBlockId: two.id, reason: "Mock: both passages make the same claim." }]
        : [];
    const parts = [];
    firstParagraph.forEach((b, i) => {
      if (!b) return;
      parts.push({ kind: "heading", text: `Document ${i + 1}` });
      parts.push({ kind: "quote", blockId: b.id });
    });
    if (one) {
      parts.push({
        kind: "text",
        markdown: "**Mock summary.** The documents agree on the point above.",
        sources: [{ blockId: one.id, quote: one.text.slice(0, 40) }],
      });
    }
    console.log("[mock stitch]", links.length, "links,", parts.length, "parts");
    return JSON.stringify({
      reply: `Mock: ${links.length} link proposed and a page of ${parts.length} parts written.`,
      links,
      document: parts.length > 0 ? { title: "Mock stitched page", parts } : null,
    });
  }

  // Recommended links (connect scan): one valid link from the new document to
  // the first other document, quotes copied verbatim from real blocks.
  if (all.includes('"fromQuote"') && /\[document [^\]]+\] "/.test(all)) {
    // The real document headers carry a quoted title — the instruction line's
    // literal [document <id>] does not.
    const header = all.match(/\[document ([^\]]+)\] "/);
    const docAt = header.index;
    const newPart = all.slice(0, docAt);
    const otherId = header[1];
    const newBlocks = parseBlocks(newPart).filter((b) => b.type === "PARAGRAPH" && b.text.length > 60);
    const otherBlocks = parseBlocks(all.slice(docAt)).filter(
      (b) => b.type === "PARAGRAPH" && b.text.length > 60,
    );
    const from = newBlocks[0];
    const to = otherBlocks[0];
    if (!from || !to || !otherId) {
      console.log("[mock connect] no blocks", { from: !!from, to: !!to, otherId });
      return JSON.stringify({ links: [] });
    }
    console.log("[mock connect]", from.id, "->", otherId, to.id);
    return JSON.stringify({
      links: [
        {
          fromBlockId: from.id,
          fromQuote: from.text.slice(0, 80),
          toDocumentId: otherId,
          toBlockId: to.id,
          toQuote: to.text.slice(0, 80),
          reason: "Both passages discuss the same market-power concept.",
        },
      ],
    });
  }

  // VISUALIZE (SPEC.md §20): certain, one picture — a plain SVG the server
  // reduces and stores — so Visualize and Visualize+ run end-to-end.
  if (all.includes('"judgment"') && all.includes('"svg"')) {
    return JSON.stringify({
      judgment: { structure: "one loop", certain: true, reason: "Mock: the passage is a loop, a picture shows it." },
      visual: {
        kind: "picture",
        caption: "Mock picture of the passage",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect x="10" y="10" width="300" height="100" rx="12" fill="#f3e8dd" stroke="#8a5a3c"/><text x="160" y="66" text-anchor="middle" font-size="16" fill="#3b2a1e">mock picture</text></svg>',
      },
    });
  }

  // Assistant act: plan JSON with real quotes.
  if (all.includes('"actions"') && (all.includes("format_block") || all.includes("- suggest {"))) {
    const p = paragraphs[0];
    if (!p) return JSON.stringify({ reply: "No paragraphs found.", actions: [] });
    const quote = p.text.slice(0, Math.min(48, p.text.length)).trim();
    // The matches (SPEC.md §7): with a selection, two verbatim passages from
    // paragraphs after the first, each with a why; none without a selection.
    const matches = all.includes("The reader has selected")
      ? paragraphs.slice(1, 4).map((b, i) => ({
          blockId: b.id,
          quote: b.text.slice(0, Math.min(70, b.text.length)).trim(),
          why: `Mock match ${i + 1}: this passage states the topic's claim.`,
        }))
      : [];
    return JSON.stringify({
      reply: `Mock plan: one highlight and one note. The opening claim is in [block ${p.id}].`,
      matches,
      actions: [
        {
          type: "highlight",
          blockId: p.id,
          quote,
          color: "sage",
          description: "Highlight the opening claim",
        },
        {
          type: "add_note",
          content: "QA note filed by the mock assistant.",
          sectionTitle: "Assistant QA",
          blockId: p.id,
          quote,
          description: "File a note citing the passage",
        },
      ],
    });
  }

  // Salience: spans over the first paragraphs.
  // EXTRACT (current contract): {"spans": [...]} revealing the highlighted
  // passage's topic — spans from other paragraphs, skipping the highlight.
  if (all.includes('"spans"') && all.includes("highlighted passage")) {
    const spans = paragraphs.slice(0, 3).map((b) => ({
      blockId: b.id,
      start: 0,
      end: Math.min(80, b.text.length),
    }));
    return JSON.stringify({
      spans: spans.length > 0 ? spans : [{ blockId: blocks[0]?.id ?? "x", start: 0, end: 10 }],
    });
  }

  // FIND (SPEC.md §11): the first two transcript blocks as one match.
  if (all.includes('"blockIds"') && all.includes("Their search:")) {
    const timed = blocks.filter((b) => b.type === "TRANSCRIPT").slice(0, 2);
    return JSON.stringify({
      matches: timed.length > 0 ? [{ blockIds: timed.map((b) => b.id), explanation: "Mock match: the speaker says it here." }] : [],
    });
  }

  if (all.includes('"spans"') && all.includes("salient")) {
    const spans = paragraphs.slice(0, 5).map((b) => ({
      blockId: b.id,
      start: 0,
      end: Math.min(60, b.text.length),
    }));
    return JSON.stringify({ spans: spans.length > 0 ? spans : [{ blockId: blocks[0]?.id ?? "x", start: 0, end: 10 }] });
  }

  // Extract: note into the first listed section, quoting the selection.
  if (all.includes('"quotedSpans"')) {
    const sectionMatch = all.match(/Notebook sections:\n- ([^:]+):/);
    const selMatch = all.match(/Selected passage:\n([\s\S]*?)\n\nContext after/);
    const selected = (selMatch?.[1] ?? "").trim();
    const host = blocks.find((b) => selected && b.text.includes(selected.slice(0, 40)));
    const start = host ? host.text.indexOf(selected.slice(0, 40)) : 0;
    return JSON.stringify({
      sectionId: sectionMatch?.[1] ?? "unknown",
      content: `Mock extract: ${selected.slice(0, 120) || "the selected passage"}.`,
      quotedSpans: [
        {
          blockId: host?.id ?? blocks[0]?.id ?? "x",
          start: Math.max(0, start),
          end: Math.max(1, start + Math.min(40, selected.length || 10)),
        },
      ],
    });
  }

  // COMPARE: one agreement citing a span in each document, one point only
  // the first covers.
  if (all.includes('"agreements"') && all.includes('"onlyFirst"')) {
    const headers = [...all.matchAll(/\[document ([^\]]+)\] "/g)];
    const pick = (list) => list.filter((b) => b.type === "PARAGRAPH" && b.text.length > 60)[0];
    const one = headers[0] ? pick(parseBlocks(all.slice(headers[0].index, headers[1]?.index ?? all.length))) : null;
    const two = headers[1] ? pick(parseBlocks(all.slice(headers[1].index))) : null;
    const span = (b) => ({ blockId: b.id, start: 0, end: Math.min(90, b.text.length) });
    return JSON.stringify({
      agreements: one && two ? [{ point: "Both documents treat monetization as the deciding force.", spans: [span(one), span(two)] }] : [],
      disagreements: [],
      onlyFirst: one ? [{ point: "The first document quantifies the default payments.", spans: [span(one)] }] : [],
      onlySecond: [],
    });
  }

  // ANALYZE: the three sections, in order, with one printed value and one
  // estimate, linking to a real block.
  if (all.includes("Write exactly three sections")) {
    const table = all.includes("The table's markup:");
    const cited = blocks[0] ? `[block ${blocks[0].id}]` : "the opening claim";
    return [
      "**Insights**",
      table ? "Mock table analysis: two counts, and notes outnumber pages." : "Mock chart analysis: one series rising over time.",
      table ? "- Notes outnumber pages twenty to one." : "- The share climbs every year and peaks at the end.",
      "",
      "**Quantitative**",
      table ? "- Pages: 2; Notes: 42" : "- Share at the end: ≈ 80%",
      "- Peak: ≈ 80",
      "",
      "**Linking to context**",
      `No contradiction with the document; it supports ${cited}.`,
    ].join("\n");
  }

  // Notebook tasks: no issues found.
  // Gists: the first five words of each listed note.
  // The skeleton (SPEC.md §22): every block's first eight words as its
  // line, every listed part's title as its summary, the title as the gist.
  if (all.includes('"lines"') && all.includes("Write the document's skeleton")) {
    const blocks = parseBlocks(all);
    const lines = blocks.map((b) => ({ blockId: b.id, text: b.text.split(/\s+/).slice(0, 8).join(" ") }));
    const parts = [...all.matchAll(/\[part ([^\]]+)\] "([^"]*)"/g)].map((m) => ({ blockId: m[1], summary: `About ${m[2]}.` }));
    console.log("[mock skeleton]", lines.length, "lines,", parts.length, "parts");
    return JSON.stringify({ gist: "Mock gist of the document.", parts, lines });
  }

  // Stitch, the route pass: every part named.
  if (all.includes('"parts"') && all.includes("name the parts") ) {
    const parts = [...all.matchAll(/\[part at ([A-Z]+\d+)\]/g)].map((m) => m[1]);
    console.log("[mock stitch route]", parts.length, "parts");
    return JSON.stringify({ parts });
  }

  // Contents (SPEC.md §26): every HEADING block past the first as a part,
  // and the first paragraph of a document with no headings.
  if (all.includes('"parts"') && all.includes("Write the contents of this document")) {
    const blocks = parseBlocks(all);
    const headings = blocks.filter((b, i) => b.type === "HEADING" && i > 0);
    const parts =
      headings.length > 0
        ? headings.map((b) => ({ title: b.text, blockId: b.id, level: 1 }))
        : blocks.filter((b) => b.type === "PARAGRAPH").slice(0, 1).map((b) => ({ title: "Opening", blockId: b.id, level: 1 }));
    console.log("[mock contents]", parts.length, "parts");
    return JSON.stringify({ parts });
  }

  if (all.includes('"gists"')) {
    const gists = [...all.matchAll(/\[note ([^\]]+)\]\n([^\n]*)/g)].map((m) => ({
      id: m[1],
      gist: m[2].split(/\s+/).slice(0, 5).join(" ").slice(0, 30),
    }));
    return JSON.stringify({ gists });
  }

  // Merge with AI: the listed notes as one note, each note's text a paragraph,
  // the target's first — what the real merge returns, minus the rewriting.
  if (all.includes('"note"') && all.includes("the one note that takes their place")) {
    const parts = [...all.matchAll(/\[note [^\]]+\]\n([\s\S]*?)(?=\n\n\[note |\n\nWrite the one note)/g)];
    return JSON.stringify({ note: parts.map((m) => m[1].trim()).filter(Boolean).join("\n\n") });
  }

  if (all.includes('"issues"')) return JSON.stringify({ issues: [] });

  // Ingest core pass: keep ranges around everything that does not look like page
  // chrome — bracketed chrome, footer link words, copyright lines. Exercises the
  // range apply path end-to-end.
  if (all.includes('"ranges"')) {
    const junkRe =
      /^(\[ .{0,40} \]|Discover:?|About:?|Social:?|Home|Company|Careers|News|Contact|Research|YouTube|LinkedIn|Twitter|Instagram|Policy|Terms.*|Privacy.*|©.*|Our research straight to your inbox\.?)$/;
    const keep = [];
    const lineRe = /^\[(\d+)\] (\w+): (.*)$/gm;
    let m;
    while ((m = lineRe.exec(all))) {
      if (!junkRe.test(m[3].trim())) keep.push(Number(m[1]));
    }
    const ranges = [];
    for (const i of keep) {
      const last = ranges[ranges.length - 1];
      if (last && i === last.end + 1) last.end = i;
      else ranges.push({ start: i, end: i });
    }
    return JSON.stringify({ ranges });
  }

  // Ingest structure pass: drop placeholder junk the way the real model would —
  // blocks that are nothing but a bare number, an unhydrated counter value, or
  // bracketed chrome. Exercises the ops apply path end-to-end.
  if (all.includes('"ops"')) {
    const ops = [];
    const lineRe = /^\[(\d+)\] (\w+): (.*)$/gm;
    let m;
    while ((m = lineRe.exec(all))) {
      const text = m[3].trim();
      if (
        /^(0|0\.0M|[\d,.]+\+?)$/.test(text) ||
        /^\[ .{0,40} \]$/.test(text) ||
        /^Category:/.test(text)
      ) {
        ops.push({ index: Number(m[1]), action: "drop" });
      }
    }
    return JSON.stringify({ ops });
  }

  // Simplify with source markers: one plain sentence per numbered original.
  if (all.includes("source marker")) {
    const nums = [...all.matchAll(/^\[(\d+)\] /gm)].map((x) => Number(x[1]));
    const count = nums.length > 0 ? Math.max(...nums) : 1;
    const parts = [];
    for (let i = 1; i <= count; i++) parts.push(`Mock plain sentence ${i}. [[${i}]]`);
    return parts.join(" ");
  }

  // EXPLAIN / SIMPLIFY / ask: plain prose, citing a real block tag.
  const cited = blocks[0] ? ` See [block ${blocks[0].id}] for the setup.` : "";
  return `Mock response: this passage sets out the core claim in plain terms, with the key figure restated for the reader's purpose.${cited}`;
}

const WEB_SOURCE = { url: "https://example.com/mock-source", title: "Mock web source" };

// The Formula API's declaration of the official web-search tool, and its run.
const WEB_SEARCH_TOOLS = {
  object: "list",
  tools: [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for information",
        parameters: {
          type: "object",
          properties: { query: { description: "What to search for", type: "string" } },
          required: ["query"],
        },
      },
    },
  ],
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("bad json"));
      }
    });
  });
}

const usage = () => ({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cached_tokens: 0 });

// QA failure modes, by env. MOCK_KIMI_FAIL=401 answers every chat call with
// Moonshot's invalid-key error. MOCK_KIMI_FAIL=length streams reasoning alone
// and ends with finish_reason length: the output budget spent before the
// answer. MOCK_KIMI_DELAY_MS holds the first content delta that long: Kimi
// K3's silent reasoning, the text stream heartbeat's case; a JSON call's
// whole answer that long, the deadline's case.
const FAIL = process.env.MOCK_KIMI_FAIL ?? "";
const DELAY_MS = Number(process.env.MOCK_KIMI_DELAY_MS ?? 0);
const REASONING = "The mock reasons until the output budget is spent.";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function chatCompletion(body, res) {
  if (FAIL === "401") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: "Invalid Authentication", type: "invalid_authentication_error" },
      }),
    );
    return;
  }
  const all = (body.messages ?? []).map((m) => textOf(m.content)).join("\n");
  // Web access (SPEC.md §7): with the web_search tool declared, the first
  // answer is one tool call; once its result is in the messages, the answer
  // cites the source the way the prompt asks — a link in the text and a Web
  // sources list at the end.
  const webSearch = (body.tools ?? []).some((t) => t.function?.name === "web_search");
  const searched = (body.messages ?? []).some((m) => m.role === "tool");
  const toolCall =
    webSearch && !searched
      ? { id: "web_search:0", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "mock verification" }) } }
      : null;
  const text = toolCall
    ? ""
    : searched
      ? `${buildResponse(all)} The web agrees ([${WEB_SOURCE.title}](${WEB_SOURCE.url})).\n\n**Web sources**\n- [${WEB_SOURCE.title}](${WEB_SOURCE.url})`
      : buildResponse(all);
  const finish = FAIL === "length" ? "length" : toolCall ? "tool_calls" : "stop";

  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (delta, finish_reason = null, extra = {}) =>
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta, finish_reason }],
          ...extra,
        })}\n\n`,
      );
    chunk({ role: "assistant", content: "" });
    if (DELAY_MS) await sleep(DELAY_MS);
    if (FAIL === "length") {
      chunk({ reasoning_content: REASONING });
    } else if (toolCall) {
      chunk({ tool_calls: [{ index: 0, ...toolCall }] });
    } else {
      for (let i = 0; i < text.length; i += 40) chunk({ content: text.slice(i, i + 40) });
    }
    chunk({}, finish);
    if (body.stream_options?.include_usage) {
      res.write(
        `data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", created: 1, model: body.model, choices: [], usage: usage() })}\n\n`,
      );
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  if (DELAY_MS) await sleep(DELAY_MS);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: 1,
      model: body.model,
      choices: [
        {
          index: 0,
          message:
            FAIL === "length"
              ? { role: "assistant", content: "", reasoning_content: REASONING }
              : toolCall
                ? { role: "assistant", content: null, tool_calls: [toolCall] }
                : { role: "assistant", content: text },
          finish_reason: finish,
        },
      ],
      usage: usage(),
    }),
  );
}

// The import's model (lib/claude.ts) speaks Anthropic's Messages API: the
// same prompt sniffing, in the Messages response shape.
function anthropicMessage(body, res) {
  const all = [textOf(body.system), ...(body.messages ?? []).map((m) => textOf(m.content))].join(
    "\n",
  );
  const text = buildResponse(all);
  const usage = {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("message_start", {
      type: "message_start",
      message: {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    });
    send("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    for (let i = 0; i < text.length; i += 40) {
      send("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: text.slice(i, i + 40) },
      });
    }
    send("content_block_stop", { type: "content_block_stop", index: 0 });
    send("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 50 },
    });
    send("message_stop", { type: "message_stop" });
    res.end();
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage,
    }),
  );
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "";
  if (req.method === "GET" && url.includes("/formulas/") && url.endsWith("/tools")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(WEB_SEARCH_TOOLS));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404).end("not found");
    return;
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }
  if (url.includes("/formulas/") && url.endsWith("/fibers")) {
    // The run of one search: web-search is protected, so its result is
    // encrypted for the model alone.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "fiber-mock",
        object: "fiber",
        status: "succeeded",
        context: {
          input: JSON.stringify(body),
          encrypted_output: "----MOONSHOT ENCRYPTED BEGIN----mock----MOONSHOT ENCRYPTED END----",
        },
        formula: "moonshot/web-search:latest",
      }),
    );
    return;
  }
  if (url.includes("/chat/completions")) {
    await chatCompletion(body, res);
    return;
  }
  if (url.includes("/messages")) {
    anthropicMessage(body, res);
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`mock kimi and claude on :${PORT}`));
