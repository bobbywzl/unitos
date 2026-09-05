// Stand-ins for the outside services the new AI tools call, for the QA loop
// (zero external calls): DeepL translation and Groq Whisper transcription,
// one server on :3398. Point the app at it with
//   DEEPL_API_KEY=mock:fx DEEPL_API_URL=http://localhost:3398
//   GROQ_API_KEY=mock GROQ_API_URL=http://localhost:3398/openai/v1/audio/transcriptions
import http from "node:http";

const PORT = 3398;

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
