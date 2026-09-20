// Deterministic Jev mock for the QA autoloop (lib/jev.ts): TypeSafe's
// System One endpoint on /v1/systemone. Answers every question in the
// request with its type — a noul from the word overlap between the thing
// the question names and the command or the question's words, a choice by
// the overlap between the state and each option's description, a score at
// the middle level — so Stitch's Jev passes, the lead tool, and the nudges
// run end-to-end with zero external calls. Point the app at it with
//   TYPESAFE_API_KEY=mock TYPESAFE_BASE_URL=http://localhost:3398/v1
import http from "node:http";

const PORT = 3398;

const words = (text) =>
  new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3),
  );

function overlap(a, b) {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

// The text the question is about: the block or part in the state the
// question names (by its key), else the whole state.
function subject(name, state) {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    for (const list of [state.blocks, state.parts]) {
      const hit = Array.isArray(list) ? list.find((x) => x?.alias === name) : null;
      if (hit) return [hit.text, hit.title, hit.summary].filter(Boolean).join(" ");
    }
    if (state.steps && typeof state.steps === "object" && name in state.steps) {
      const actions = Array.isArray(state.reader_actions) ? state.reader_actions.map((a) => a.control).join(" ") : "";
      return `${state.steps[name]} || ${actions}`;
    }
  }
  return JSON.stringify(state);
}

function answer(name, q, state) {
  if (q.type === "noul") {
    const text = subject(name, state);
    let p;
    if (text.includes(" || ")) {
      // A nudge step: done when an action shares a word with what it teaches.
      const [what, actions] = text.split(" || ");
      p = overlap(what.replace(/-/g, " "), actions.replace(/[-:]/g, " ")) > 0 ? 0.9 : 0.1;
    } else {
      const against = state && typeof state === "object" && "command" in state ? state.command : q.instructions;
      p = Math.min(0.95, 0.15 + overlap(text, against) * 2);
    }
    return { type: "noul", noul: Number(p.toFixed(3)) };
  }
  if (q.type === "choice") {
    const keys = Object.keys(q.criteria);
    const text = JSON.stringify(state);
    let best = keys[0];
    let bestScore = -1;
    for (const key of keys) {
      const s = overlap(text, `${key} ${q.criteria[key]}`);
      if (s > bestScore) {
        best = key;
        bestScore = s;
      }
    }
    const rest = keys.length > 1 ? 0.3 / (keys.length - 1) : 0;
    const probabilities = Object.fromEntries(keys.map((k) => [k, k === best ? 0.7 : rest]));
    return { type: "choice", choice: best, confidence: 0.7, probabilities };
  }
  if (q.type === "score") {
    const levels = q.criteria.length;
    const mid = Math.floor((levels - 1) / 2);
    const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === mid ? 0.6 : 0.4 / Math.max(1, levels - 1)]));
    return { type: "score", score: mid, confidence: 0.6, probabilities };
  }
  return null;
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !/\/(?:systemone|decisions)$/.test(req.url)) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "bad json" }));
      return;
    }
    const answers = {};
    for (const [name, q] of Object.entries(parsed.questions ?? {})) {
      const a = answer(name, q, parsed.state);
      if (a) answers[name] = a;
    }
    const inputTokens = Math.ceil(body.length / 4);
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ model: parsed.model ?? "jev-latest", answers, usage: { input_tokens: inputTokens, output_tokens: 0 } }));
  });
});

server.listen(PORT, () => console.log(`mock-jev on http://localhost:${PORT}/v1`));
