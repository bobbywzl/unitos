// Live check of the YouTube transcript ladder (SPEC.md §11): the pure helpers
// against known cue formats, then the real ladder against YouTube from the
// network this runs on — the answer says which rungs work from here. No
// database, no server; keyed rungs report why they were skipped.
//   npx tsx scripts/qa/youtube-transcript.mts [videoId ...]
//   npx tsx scripts/qa/youtube-transcript.mts --pure     (no network)
import { parseJson3, parseXml, pickTrack, trackUrl } from "@/lib/video/captions";
import { parsePastedTranscript } from "@/lib/video/paste";
import { transcribe } from "@/lib/video/transcribe";
import { pickAudioFormat } from "@/lib/video/youtube-audio";

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

// ── Cue formats ──────────────────────────────────────────────────────────────
const json3 = JSON.stringify({
  events: [
    { tStartMs: 33, dDurationMs: 1433, segs: [{ utf8: "真的有轮回吗" }] },
    { tStartMs: 1533, dDurationMs: 3800, segs: [{ utf8: "hello" }, { utf8: " world\n" }] },
    { tStartMs: 5000, aAppend: 1, segs: [{ utf8: "\n" }] },
  ],
});
const fromJson3 = parseJson3(json3);
check(
  "json3 parses",
  fromJson3?.length === 2 && fromJson3[0].start === 0.033 && fromJson3[1].text === "hello world",
  JSON.stringify(fromJson3),
);
const srv3 =
  '<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0" d="1000"/><p t="33" d="1433">真的有轮回吗</p><p t="1533" d="3800" w="1"><s ac="255">hello</s><s t="500"> world &amp; more</s></p></body></timedtext>';
const fromSrv3 = parseXml(srv3);
check(
  "srv3 parses",
  fromSrv3?.length === 2 && fromSrv3[1].text === "hello world & more" && fromSrv3[1].end === 5.333,
  JSON.stringify(fromSrv3),
);
const legacy =
  '<transcript><text start="1.2" dur="3.4">first &#39;line&#39;</text><text start="4.6">second</text></transcript>';
const fromLegacy = parseXml(legacy);
check(
  "legacy xml parses",
  fromLegacy?.length === 2 && fromLegacy[0].text === "first 'line'" && fromLegacy[0].end === 4.6,
  JSON.stringify(fromLegacy),
);
check("json3 rejects xml", parseJson3(srv3) === null);
check("xml rejects json", parseXml(json3) === null);
check(
  "fmt is replaced, never appended",
  trackUrl("https://www.youtube.com/api/timedtext?v=x&fmt=srv3&lang=en", "json3") ===
    "https://www.youtube.com/api/timedtext?v=x&fmt=json3&lang=en",
);

// ── Track choice ─────────────────────────────────────────────────────────────
const en = { baseUrl: "u", languageCode: "en", kind: undefined };
const zhHuman = { baseUrl: "u", languageCode: "zh-Hans", kind: undefined };
const zhAsr = { baseUrl: "u", languageCode: "zh", kind: "asr" };
const jaAsr = { baseUrl: "u", languageCode: "ja", kind: "asr" };
check("pickTrack honors YouTube's default", pickTrack({ tracks: [en, zhHuman], defaultIndex: 1 }) === zhHuman);
check(
  "pickTrack prefers the human track in the spoken language",
  pickTrack({ tracks: [en, zhAsr, zhHuman], defaultIndex: null }) === zhHuman,
);
check("pickTrack takes asr over a translation", pickTrack({ tracks: [en, jaAsr], defaultIndex: null }) === jaAsr);
check("pickTrack falls back to the first human track", pickTrack({ tracks: [en, zhHuman], defaultIndex: null }) === en);

// ── Audio stream choice ──────────────────────────────────────────────────────
const formats = [
  { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 135504, contentLength: "89484044", url: "u" },
  { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 55044, contentLength: "33716659", url: "u" },
  { itag: 599, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 37136, contentLength: "21276136", url: "u" },
  { itag: 137, mimeType: "video/mp4", bitrate: 9999999, contentLength: "1", url: "u" },
  { itag: 251, mimeType: "audio/webm", bitrate: 134065, contentLength: "85171742" },
];
check("pickAudioFormat takes the best stream under the cap", pickAudioFormat(formats, 25 * 1024 * 1024)?.itag === 599);
check("pickAudioFormat is null when nothing fits", pickAudioFormat(formats, 1024) === null);

// ── Pasted transcripts ───────────────────────────────────────────────────────
const panelCopy = "0:33\n真的有轮回吗\n0:35\n怎么去认定转世活佛呢\n\n1:02:05\nlast line";
const fromPanel = parsePastedTranscript(panelCopy);
check(
  "panel copy parses",
  fromPanel.length === 3 && fromPanel[0].start === 33 && fromPanel[0].end === 35 && fromPanel[2].start === 3725 && fromPanel[2].end === 3729,
  JSON.stringify(fromPanel),
);
const inline = "[0:33] first line\n(0:35) second line\n0:40 - third line";
const fromInline = parsePastedTranscript(inline);
check(
  "inline times parse",
  fromInline.length === 3 && fromInline[1].text === "second line" && fromInline[2].text === "third line",
  JSON.stringify(fromInline),
);
const srt = "1\n00:00:33,000 --> 00:00:34,433\nfirst\nstill first\n\n2\n00:00:35,500 --> 00:00:39,000\nsecond\n";
const fromSrt = parsePastedTranscript(srt);
check(
  "srt parses",
  fromSrt.length === 2 && fromSrt[0].text === "first still first" && fromSrt[0].end === 34.433 && fromSrt[1].start === 35.5,
  JSON.stringify(fromSrt),
);
const vtt = "WEBVTT\n\n00:33.000 --> 00:34.433\nfirst\n\n00:35.000 --> 00:39.000\nsecond";
const fromVtt = parsePastedTranscript(vtt);
check("webvtt parses", fromVtt.length === 2 && fromVtt[1].text === "second", JSON.stringify(fromVtt));
let noTimes = "";
try {
  parsePastedTranscript("just some words\nand more words");
} catch (err) {
  noTimes = err instanceof Error ? err.message : String(err);
}
check("plain prose is refused", noTimes === "the pasted text has no times", noTimes);

// ── The live ladder ──────────────────────────────────────────────────────────
const pure = process.argv.includes("--pure");
const ids = process.argv.slice(2).filter((arg) => arg !== "--pure");
if (ids.length === 0 && !pure) ids.push("AM2FCeM1PKg", "jNQXAC9IVRw");
for (const id of ids) {
  const started = Date.now();
  try {
    const { segments, provider } = await transcribe(
      { kind: "youtube", youtubeId: id },
      { deadline: Date.now() + 240_000 },
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    check(`${id} transcribes`, segments.length > 0, `${provider}, ${segments.length} segments in ${seconds}s`);
    for (const s of segments.slice(0, 3)) console.log(`   ${s.start.toFixed(2)}–${s.end.toFixed(2)} ${s.text}`);
    const last = segments.at(-1);
    if (last) console.log(`   … ${last.start.toFixed(2)}–${last.end.toFixed(2)} ${last.text}`);
  } catch (err) {
    check(`${id} transcribes`, false, err instanceof Error ? err.message : String(err));
  }
}
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
