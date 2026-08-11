// Deterministic Anthropic mock for the QA autoloop. Sniffs each prompt and
// returns valid, context-aware output: real block ids, real quotes, schema-exact
// JSON — so every AI flow (EXPLAIN, SIMPLIFY, EXTRACT, SALIENCE, assistant ask
// and act) runs end-to-end with zero external calls.
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

  // Notebook tasks: no issues found.
  if (all.includes('"issues"')) return JSON.stringify({ issues: [] });

  // EXPLAIN / SIMPLIFY / ask: plain prose.
  return "Mock response: this passage sets out the core claim in plain terms, with the key figure restated for the reader's purpose.";
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.includes("/messages")) {
    res.writeHead(404).end("not found");
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    const all = [textOf(body.system), ...(body.messages ?? []).map((m) => textOf(m.content))].join("\n");
    const text = buildResponse(all);
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
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
  });
});

server.listen(PORT, () => console.log(`mock anthropic on :${PORT}`));
