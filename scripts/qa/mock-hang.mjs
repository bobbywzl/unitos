// A model that never answers, for the Stop checks (SPEC.md §6): every POST
// is held open until the caller goes away, and GET /status answers how many
// requests came and how many the caller closed before an answer. Point a
// client at it — ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:3401/v1
// for the Claude calls, DEEPL_API_KEY=mock:fx DEEPL_API_URL=http://localhost:3401
// for DeepL — and a Stop that works shows as a closed request. Used by
// scripts/qa/ui-stop.mjs.
import http from "node:http";

const PORT = Number(process.env.MOCK_HANG_PORT ?? 3401);
let requests = 0;
let closed = 0;

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ requests, closed }));
      return;
    }
    requests += 1;
    req.resume();
    // Held open: the only way out is the caller closing the connection.
    res.on("close", () => {
      if (!res.writableEnded) closed += 1;
    });
  })
  .listen(PORT, () => console.log(`mock-hang on :${PORT}`));
