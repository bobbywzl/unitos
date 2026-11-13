// Stand-ins for the outside services the new AI tools call, for the QA loop
// (zero external calls): DeepL translation, Groq Whisper transcription, and
// xAI's Grok Voice Transcribe, one server on :3398. Point the app at it with
//   DEEPL_API_KEY=mock:fx DEEPL_API_URL=http://localhost:3398
//   GROQ_API_KEY=mock GROQ_API_URL=http://localhost:3398/openai/v1/audio/transcriptions
//   XAI_API_KEY=mock XAI_API_URL=http://localhost:3398/v1/stt
import http from "node:http";

const PORT = Number(process.env.MOCK_SERVICES_PORT ?? 3398);

// Grok Voice Transcribe (POST /v1/stt): what each call sent, for the checks
// (GET /v1/stt/log; DELETE clears it and the phrase count).
const sttLog = [];
let sttCount = 0;

/** The fields of a multipart body, in order: [name, value | "(file)"]. */
function multipartFields(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? "");
  if (!boundary) return [];
  const text = body.toString("latin1");
  const fields = [];
  for (const part of text.split(`--${boundary[1] ?? boundary[2]}`)) {
    const name = /name="([^"]+)"/.exec(part);
    if (!name) continue;
    const at = part.indexOf("\r\n\r\n");
    const file = /filename="/.test(part.slice(0, at));
    fields.push([name[1], file ? "(file)" : part.slice(at + 4).replace(/\r\n$/, "")]);
  }
  return fields;
}

/** A transcript in xAI's shape: the words with their times, and the voices
    when asked for. */
function sttAnswer(sentences, diarize) {
  const words = [];
  let at = 0.2;
  sentences.forEach(([speaker, sentence], i) => {
    if (i > 0) at += 1.2; // a pause between sentences
    for (const text of sentence.split(" ")) {
      words.push({ text, start: Number(at.toFixed(2)), end: Number((at + 0.3).toFixed(2)), ...(diarize ? { speaker } : {}) });
      at += 0.35;
    }
  });
  return { text: sentences.map(([, s]) => s).join(" "), language: "en", duration: Number((at + 0.2).toFixed(2)), words };
}

const server = http.createServer((req, res) => {
  let raw = [];
  req.on("data", (c) => raw.push(c));
  req.on("end", () => {
    const body = Buffer.concat(raw);
    // DeepL: every text comes back tagged with its target language, so the
    // UI test can tell a translation from the original.
    if (req.url?.startsWith("/v2/translate")) {
      let json;
      try {
        json = JSON.parse(body.toString("utf8"));
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      const target = String(json.target_lang ?? "EN-US").slice(0, 2);
      const translations = (json.text ?? []).map((text) => ({
        detected_source_language: /[一-鿿]/.test(text) ? "ZH" : "EN",
        text: `[${target}] ${text}`,
      }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ translations }));
      return;
    }
    // Grok Voice Transcribe: the fields are checked as xAI's endpoint reads
    // them (the file last), and every recording transcribes to one numbered
    // phrase, so a check can tell the order the phrases were said in. Odd
    // phrases answer late: words must still be handed on in order.
    if (req.url?.startsWith("/v1/stt/log")) {
      if (req.method === "DELETE") {
        sttLog.length = 0;
        sttCount = 0;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(sttLog));
      return;
    }
    if (req.url?.startsWith("/v1/stt")) {
      const fields = multipartFields(body, req.headers["content-type"]);
      const names = fields.map(([name]) => name);
      const get = (name) => fields.find(([n]) => n === name)?.[1];
      const refuse = (status, error) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error }));
      };
      if (req.headers.authorization !== "Bearer mock") return refuse(401, "Invalid or missing API key");
      if (!names.includes("file")) return refuse(400, "file or url is required");
      if (names[names.length - 1] !== "file") return refuse(400, "file must be the last field");
      if (get("format") === "true" && !get("language")) return refuse(400, "format requires language");
      const diarize = get("diarize") === "true";
      sttLog.push({ fields: Object.fromEntries(fields), bytes: body.length });
      // MOCK_STT=fail: the model is down, so the ladder's next rung answers.
      if (process.env.MOCK_STT === "fail") return refuse(503, "Service unavailable");
      // A recording of almost nothing has no speech in it.
      if (body.length < 1500) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text: "", language: "en", duration: 0.4 }));
        return;
      }
      const n = ++sttCount;
      const answer = diarize
        ? sttAnswer([[0, `Mock phrase ${n}, the first voice.`], [1, "And the second voice answers."]], true)
        : sttAnswer([[0, `Mock phrase ${n}.`]], false);
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answer));
      }, n % 2 === 1 ? 3500 : 100);
      return;
    }
    // Groq Whisper: any recording transcribes to two timed segments.
    if (req.url?.includes("/audio/transcriptions")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          text: "Mock voice note, um, the first point. And the second point.",
          segments: [
            { start: 0, end: 2.5, text: "Mock voice note, um, the first point." },
            { start: 2.6, end: 5, text: "And the second point." },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end("not found");
  });
});

server.listen(PORT, () => console.log(`mock services on :${PORT}`));
