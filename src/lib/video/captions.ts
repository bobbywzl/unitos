import { z } from "zod";
import { outboundFetch } from "@/lib/outbound-fetch";
import {
  captionTracksOf,
  defaultCaptionIndexOf,
  playerResponses,
  type CaptionTrack,
  type PlayerResponse,
} from "@/lib/video/innertube";
import { normalizeSegments, type TranscriptSegment } from "@/lib/video/segments";

// YouTube caption tracks (SPEC.md §11): the transcript YouTube itself shows.
// Tracks come from the player API — every client that answers, in ladder
// order — then from the watch page. One track is picked the way YouTube picks
// the panel's default; its cues fetch as json3 first and srv3 XML second,
// because a track URL can carry its own fmt and a format can come back empty.

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type TrackList = { tracks: CaptionTrack[]; defaultIndex: number | null };

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The caption tracks a player response carries, or null when it has none. */
export function trackListOf(data: PlayerResponse): TrackList | null {
  const tracks = captionTracksOf(data.captions?.playerCaptionsTracklistRenderer?.captionTracks);
  if (tracks.length === 0) return null;
  return { tracks, defaultIndex: defaultCaptionIndexOf(data) };
}

// Which track to read:
// 1. YouTube's own default, when the response names one — the panel's track.
// 2. A human track in the spoken language (the asr track's language names it).
// 3. The asr track: the spoken words, machine-made.
// 4. The first human track (a translation), then whatever is first.
export function pickTrack(list: TrackList): CaptionTrack {
  const { tracks, defaultIndex } = list;
  if (defaultIndex !== null && tracks[defaultIndex]) return tracks[defaultIndex];
  const asr = tracks.find((t) => t.kind === "asr");
  const spoken = asr?.languageCode?.split("-")[0];
  const human = tracks.filter((t) => t.kind !== "asr");
  return (
    (spoken ? human.find((t) => t.languageCode?.split("-")[0] === spoken) : undefined) ??
    asr ??
    human[0] ??
    tracks[0]
  );
}

// ── Cue formats ─────────────────────────────────────────────────────────────

type Json3 = {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
};

/** json3 cues: {"events": [{"tStartMs", "dDurationMs", "segs": [{"utf8"}]}]}. */
export function parseJson3(body: string): TranscriptSegment[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as Json3).events)) return null;
  const segments: TranscriptSegment[] = [];
  for (const event of (raw as Json3).events ?? []) {
    if (typeof event !== "object" || event === null) continue;
    const start = typeof event.tStartMs === "number" ? event.tStartMs : 0;
    const duration = typeof event.dDurationMs === "number" ? event.dDurationMs : 2000;
    const text = (Array.isArray(event.segs) ? event.segs : [])
      .map((s) => (typeof s?.utf8 === "string" ? s.utf8 : ""))
      .join("")
      .replace(/\n/g, " ")
      .trim();
    if (text === "") continue;
    segments.push({ start: start / 1000, end: (start + duration) / 1000, text });
  }
  return segments.length > 0 ? normalizeSegments(segments) : null;
}

/** srv3 cues: <p t="33" d="1433">text</p>, sometimes with <s> word children.
    The legacy format too: <text start="1.2" dur="3.4">text</text>. */
export function parseXml(body: string): TranscriptSegment[] | null {
  const markup = body.trimStart();
  if (!markup.startsWith("<")) return null;
  // An empty cue is self-closing; dropped so it cannot swallow the next one.
  const cues = markup.replace(/<(?:p|text)\b[^>]*\/>/g, "");
  const segments: TranscriptSegment[] = [];
  for (const m of cues.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const start = attrNumber(m[1], "t");
    const text = plainText(m[2]);
    if (start === null || text === "") continue;
    segments.push({ start: start / 1000, end: (start + (attrNumber(m[1], "d") ?? 2000)) / 1000, text });
  }
  if (segments.length === 0) {
    for (const m of cues.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const start = attrNumber(m[1], "start");
      const text = plainText(m[2]);
      if (start === null || text === "") continue;
      segments.push({ start, end: start + (attrNumber(m[1], "dur") ?? 2), text });
    }
  }
  return segments.length > 0 ? normalizeSegments(segments) : null;
}

function attrNumber(attrs: string, name: string): number | null {
  const m = new RegExp(`\\b${name}="([\\d.]+)"`).exec(attrs);
  return m ? Number(m[1]) : null;
}

function plainText(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The track URL asking for one cue format. A track URL can carry its own
    fmt; appending a second one leaves YouTube answering the first. */
export function trackUrl(baseUrl: string, fmt: "json3" | "srv3"): string {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", fmt);
  return url.toString();
}

// ── Fetching ────────────────────────────────────────────────────────────────

async function fetchCues(track: CaptionTrack, userAgent: string): Promise<TranscriptSegment[]> {
  // A track URL comes out of a parsed response; only YouTube's own host is fetched.
  if (!/(^|\.)youtube\.com$/.test(new URL(track.baseUrl).hostname)) {
    throw new Error("caption track is not on youtube.com");
  }
  const failures: string[] = [];
  for (const fmt of ["json3", "srv3"] as const) {
    const res = await outboundFetch(trackUrl(track.baseUrl, fmt), {
      headers: { "User-Agent": userAgent },
    });
    if (!res.ok) {
      failures.push(`${fmt} ${res.status}`);
      continue;
    }
    const body = await res.text();
    if (body.trim() === "") {
      failures.push(`${fmt} empty`);
      continue;
    }
    const segments = parseJson3(body) ?? parseXml(body);
    if (segments) return segments;
    failures.push(`${fmt} unreadable`);
  }
  throw new Error(`cues did not load (${failures.join(", ")})`);
}

// The picked track first, then up to two more from the same list: a track can
// answer empty where its sibling answers.
async function readTracks(list: TrackList, userAgent: string): Promise<TranscriptSegment[]> {
  const first = pickTrack(list);
  const order = [first, ...list.tracks.filter((t) => t !== first)].slice(0, 3);
  const failures: string[] = [];
  for (const track of order) {
    try {
      return await fetchCues(track, userAgent);
    } catch (err) {
      const label = `${track.languageCode ?? "?"}${track.kind === "asr" ? " auto" : ""}`;
      failures.push(`${label}: ${reason(err)}`);
    }
  }
  throw new Error(failures.join(", "));
}

// The value of `"<key>": [...]` or `"<key>": {...}` in a script blob, by
// bracket matching — the value nests objects and strings that a regex cannot
// bound.
export function extractJsonValue(source: string, key: string, brackets: "[]" | "{}"): unknown | null {
  const [open, close] = brackets;
  const at = source.indexOf(`"${key}":`);
  if (at === -1) return null;
  const start = source.indexOf(open, at);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const playabilitySchema = z.object({ status: z.string(), reason: z.string().optional() });

// The watch page's own player response. Datacenter IPs get a captcha here;
// networks YouTube trusts get the tracks. Null when the page has no tracks.
async function watchPageTracks(youtubeId: string): Promise<TrackList | null> {
  const res = await outboundFetch(`https://www.youtube.com/watch?v=${youtubeId}&hl=en`, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "en",
      Cookie: "CONSENT=YES+cb; SOCS=CAI",
    },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429 ? "YouTube asked for a captcha" : `watch page fetch failed (${res.status})`,
    );
  }
  const html = await res.text();
  const tracks = captionTracksOf(extractJsonValue(html, "captionTracks", "[]"));
  if (tracks.length > 0) return { tracks, defaultIndex: null };
  // No tracks on the page: a bot-checked IP gets a 200 page whose player
  // response says so instead of a captcha; its reason is the answer.
  const playability = playabilitySchema.safeParse(extractJsonValue(html, "playabilityStatus", "{}"));
  if (playability.success && playability.data.status !== "OK") {
    throw new Error(playability.data.reason ?? playability.data.status);
  }
  return null;
}

/** The transcript YouTube shows for a video, as timed segments. Throws with
    every source's reason when no source yields cues. */
export async function youtubeCaptions(youtubeId: string): Promise<TranscriptSegment[]> {
  const failures: string[] = [];
  let answered = 0;
  let tracksSeen = false;
  for await (const { label, userAgent, data } of playerResponses(youtubeId, failures)) {
    answered += 1;
    const list = trackListOf(data);
    if (!list) {
      failures.push(`${label}: no caption tracks`);
      continue;
    }
    tracksSeen = true;
    try {
      return await readTracks(list, userAgent);
    } catch (err) {
      failures.push(`${label}: ${reason(err)}`);
    }
  }
  try {
    const list = await watchPageTracks(youtubeId);
    answered += 1;
    if (list) {
      tracksSeen = true;
      return await readTracks(list, BROWSER_UA);
    }
    failures.push("watch page: no caption tracks");
  } catch (err) {
    failures.push(`watch page: ${reason(err)}`);
  }
  if (answered > 0 && !tracksSeen) throw new Error("this video has no caption tracks");
  throw new Error(failures.join("; "));
}
