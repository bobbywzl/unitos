// Deterministic Kimi mock for the QA autoloop: Moonshot's OpenAI-compatible
// chat completions on /v1/chat/completions, plus the Formula API endpoints the
// web-search tool uses. Sniffs each prompt and returns valid, context-aware
// output: real block ids, real quotes, schema-exact JSON — so every AI flow
// (EXPLAIN, SIMPLIFY, EXTRACT, SALIENCE, assistant ask and act) runs
// end-to-end with zero external calls. Point the app at it with
//   KIMI_API_KEY=mock KIMI_BASE_URL=http://localhost:3399/v1
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
  const re = /\[block ([^\]]+)\] \(([A-Z]+)\)\n([\s\S]*?)(?=\n\n\[block |\n\nDocument title:|$)/g;
  let m;
  while ((m = re.exec(all))) blocks.push({ id: m[1], type: m[2], text: m[3] });
  return blocks;
}

function buildResponse(all) {
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

  // Assistant act: plan JSON with real quotes.
  if (all.includes('"actions"') && all.includes("format_block")) {
    const p = paragraphs[0];
    if (!p) return JSON.stringify({ reply: "No paragraphs found.", actions: [] });
    const quote = p.text.slice(0, Math.min(48, p.text.length)).trim();
    return JSON.stringify({
      reply: "Mock plan: one highlight and one note.",
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

  // ANALYZE: a figure or table read as data.
  if (all.includes('"readings"') && all.includes('"cautions"')) {
    const table = all.includes("The table's markup:");
    return JSON.stringify({
      kind: table ? "table" : "chart",
      summary: table ? "Mock table analysis: two rows of counts." : "Mock chart analysis: one series over time.",
      structure: table ? "Columns: item and count." : "X axis: year. Y axis: share (%).",
      readings: [
        { label: "Row one", value: "42", certainty: "read" },
        { label: "Peak", value: "80", certainty: "estimated" },
      ],
      data: table ? { columns: ["Item", "Count"], rows: [["Pages", "2"], ["Notes", "42"]] } : null,
      takeaway: "The mock takeaway.",
      cautions: ["Mock caution: the legend was not read."],
    });
  }

  // Notebook tasks: no issues found.
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

function chatCompletion(body, res) {
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
  const finish = toolCall ? "tool_calls" : "stop";

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
    if (toolCall) {
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
          message: toolCall
            ? { role: "assistant", content: null, tool_calls: [toolCall] }
            : { role: "assistant", content: text },
          finish_reason: finish,
        },
      ],
      usage: usage(),
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
    chatCompletion(body, res);
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`mock kimi on :${PORT}`));
