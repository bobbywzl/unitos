import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Dispatcher } from "undici";

// Free voice engine: Microsoft Edge's read-aloud service — the neural voices
// the Edge browser ships, over its public websocket, no key. Protocol matches
// edge-tts 7.2.8 (the reference implementation): one speech.config message,
// one ssml message per ≤4096-byte chunk, binary audio frames back until
// turn.end. undici's WebSocket carries the custom headers; EnvHttpProxyAgent
// routes through HTTPS_PROXY when set (same policy as outbound-fetch).

export const EDGE_TTS_MODEL = "edge-tts";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// The service rejects ssml messages whose escaped text exceeds 4096 bytes.
const MAX_MESSAGE_BYTES = 4096;

// One voice per language, both neural: Chinese characters → Xiaoxiao,
// everything else → Ava multilingual (reads stray non-English words too).
// Long form because that is what the Edge browser sends.
export function edgeVoiceFor(text: string): string {
  return /[一-鿿]/.test(text)
    ? "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)"
    : "Microsoft Server Speech Text to Speech Voice (en-US, AvaMultilingualNeural)";
}

// Sec-MS-GEC: SHA-256 of the Windows file time (100ns ticks, floored to the
// 5-minute window) concatenated with the trusted client token, uppercase hex.
// BigInt keeps the tick count exact — it is above Number.MAX_SAFE_INTEGER.
export function secMsGec(nowMs = Date.now()): string {
  let seconds = BigInt(Math.floor(nowMs / 1000)) + BigInt(11644473600);
  seconds -= seconds % BigInt(300);
  const ticks = seconds * BigInt(10_000_000);
  return createHash("sha256")
    .update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, "ascii")
    .digest("hex")
    .toUpperCase();
}

// "Mon Sep 01 2025 12:34:56 GMT+0000 (Coordinated Universal Time)" — the
// timestamp format the service expects in message headers.
export function messageTimestamp(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

export function speechConfigMessage(ts: string): string {
  return (
    `X-Timestamp:${ts}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
    `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`
  );
}

// The stray Z after the timestamp is the service's own quirk — keep it.
export function ssmlMessage(requestId: string, ts: string, voice: string, escapedText: string): string {
  return (
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${ts}Z\r\n` +
    "Path:ssml\r\n\r\n" +
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapedText}</prosody></voice></speak>`
  );
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&apos;",
  '"': "&quot;",
};

// The service errors on most C0 control characters (vertical tabs from OCRed
// PDFs above all) — replace them with spaces before escaping.
export function sanitizeForEdge(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}

// Split sanitized text into XML-escaped chunks of at most MAX_MESSAGE_BYTES
// UTF-8 bytes each, breaking after whitespace or CJK punctuation where
// possible. Escaping per character first means a chunk never splits an
// entity or a multi-byte character.
export function splitForEdge(text: string): string[] {
  const breakAfter = /[\s.。．！？!?；;：:，,、]/;
  const chunks: string[] = [];
  let escaped = "";
  let bytes = 0;
  let breakAt = 0; // length of `escaped` at the last break opportunity
  for (const ch of sanitizeForEdge(text)) {
    const unit = XML_ESCAPES[ch] ?? ch;
    const unitBytes = Buffer.byteLength(unit);
    if (bytes + unitBytes > MAX_MESSAGE_BYTES) {
      const cut = breakAt > 0 ? breakAt : escaped.length;
      chunks.push(escaped.slice(0, cut));
      escaped = escaped.slice(cut);
      bytes = Buffer.byteLength(escaped);
      breakAt = 0;
    }
    escaped += unit;
    bytes += unitBytes;
    if (breakAfter.test(ch)) breakAt = escaped.length;
  }
  chunks.push(escaped);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

function wssUrl(): string {
  return (
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${randomUUID().replaceAll("-", "")}` +
    `&Sec-MS-GEC=${secMsGec()}` +
    `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`
  );
}

// Sec-WebSocket-Version is undici's to add — setting it here would duplicate it.
function wssHeaders(): Record<string, string> {
  return {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
  };
}

// One connection, one ssml message, audio frames until turn.end. Binary frame:
// two big-endian header-length bytes, header text, then the audio payload.
async function synthesizeChunk(escapedText: string, voice: string, deadline: number): Promise<Buffer[]> {
  const { WebSocket: EdgeSocket, EnvHttpProxyAgent } = await import("undici");
  const options: { headers: Record<string, string>; dispatcher?: Dispatcher } = {
    headers: wssHeaders(),
  };
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    options.dispatcher = new EnvHttpProxyAgent();
  }
  return await new Promise<Buffer[]>((resolve, reject) => {
    const audio: Buffer[] = [];
    const ws = new EdgeSocket(wssUrl(), options);
    ws.binaryType = "arraybuffer";
    let settled = false;
    const settle = () => {
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settle();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const timer = setTimeout(() => fail(new Error("edge-tts timed out")), Math.max(1, deadline - Date.now()));
    ws.onopen = () => {
      ws.send(speechConfigMessage(messageTimestamp()));
      ws.send(ssmlMessage(randomUUID().replaceAll("-", ""), messageTimestamp(), voice, escapedText));
    };
    ws.onerror = (e) => {
      const detail = (e as { error?: unknown; message?: string }).error;
      fail(detail ?? new Error((e as { message?: string }).message ?? "edge-tts websocket error"));
    };
    ws.onclose = (e) => fail(new Error(`edge-tts closed before turn.end (${e.code})`));
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        if (!settled && e.data.includes("Path:turn.end")) {
          settle();
          resolve(audio);
        }
        return;
      }
      if (!(e.data instanceof ArrayBuffer)) return;
      const frame = Buffer.from(e.data);
      if (frame.length < 2) return;
      const headerLength = frame.readUInt16BE(0);
      if (2 + headerLength > frame.length) return;
      const header = frame.subarray(2, 2 + headerLength).toString("utf8");
      if (!header.includes("Path:audio")) return;
      const payload = frame.subarray(2 + headerLength);
      if (payload.length > 0) audio.push(payload);
    };
  });
}

/** The full text as one MP3 buffer. Chunks synthesize concurrently, one
    connection each, and concatenate in order. Throws on any failure — the
    caller decides the fallback. */
export async function edgeSpeech(text: string, timeoutMs = 40_000): Promise<Buffer> {
  const voice = edgeVoiceFor(text);
  const deadline = Date.now() + timeoutMs;
  const parts = await Promise.all(
    splitForEdge(text).map((chunk) => synthesizeChunk(chunk, voice, deadline)),
  );
  const audio = Buffer.concat(parts.flat());
  if (audio.length === 0) throw new Error("edge-tts returned no audio");
  return audio;
}
