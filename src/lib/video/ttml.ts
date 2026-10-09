// A TTML caption file (SPEC.md §11): Netflix's and Amazon's DFXP, IMSC, and
// the TTML other tools export. Each <p> in the body is one cue: its text
// (spans' words; white space and <br/> line breaks collapse to one space),
// its begin, and its end. Times nest: a begin or end on a <p> counts from the begin of the
// <div> or <body> around it, as the standard says.
//   Time expressions: "00:00:01.375", "00:00:01:12" (frames), "0.76s",
//   "500ms", "1.5m", "30f", "100t" (ticks), and a bare "19.764" as seconds.

const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Whether the text is a TTML document: its root element is <tt>. */
export function isTtml(text: string): boolean {
  return /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?tt[\s>]/.test(text);
}

type Rates = { frame: number; subFrame: number; tick: number };
type Scope = { name: string; begin: number; end: number | null };

function attributes(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of raw.matchAll(ATTRIBUTE)) {
    // Namespaced attributes by their local name: ttp:frameRate is frameRate.
    const name = m[1].includes(":") && !m[1].startsWith("xml:") ? m[1].slice(m[1].indexOf(":") + 1) : m[1];
    out.set(name, m[2] ?? m[3] ?? "");
  }
  return out;
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

function xmlText(raw: string): string {
  return raw.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (match, dec, hex, name) => {
    if (name) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name as "amp"];
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Seconds of a TTML time expression, or null when it does not read. */
export function ttmlTime(raw: string, rates: Rates): number | null {
  const value = raw.trim();
  const clock = /^(\d+):(\d{2}):(\d{2})(?:(\.\d+)|:(\d+)(?:\.(\d+))?)?$/.exec(value);
  if (clock) {
    const [, h, m, s, fraction, frames, subFrames] = clock;
    let seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
    if (fraction) seconds += Number(fraction);
    if (frames) seconds += (Number(frames) + (subFrames ? Number(subFrames) / rates.subFrame : 0)) / rates.frame;
    return seconds;
  }
  // Two parts, "3:58.640": minutes and seconds, as some exporters write.
  const short = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (short) return Number(short[1]) * 60 + Number(short[2]);
  const offset = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)?$/.exec(value);
  if (!offset) return null;
  const n = Number(offset[1]);
  switch (offset[2]) {
    case "h":
      return n * 3600;
    case "m":
      return n * 60;
    case "ms":
      return n / 1000;
    case "f":
      return n / rates.frame;
    case "t":
      return n / rates.tick;
    default:
      return n;
  }
}

/** The cues of a TTML document, in document order. A cue whose end no
    element gives has a null end. */
export function ttmlCues(text: string): { start: number; end: number | null; text: string }[] {
  const rates: Rates = { frame: 30, subFrame: 1, tick: 1 };
  const scopes: Scope[] = [{ name: "", begin: 0, end: null }];
  const cues: { start: number; end: number | null; text: string }[] = [];
  let inBody = false;
  let cue: { begin: number; end: number | null; text: string; depth: number } | null = null;
  let at = 0;
  const addText = (raw: string) => {
    if (cue) cue.text += raw;
  };
  for (const m of text.matchAll(TAG)) {
    addText(xmlText(text.slice(at, m.index)));
    at = m.index + m[0].length;
    if (m[1] !== undefined) {
      addText(m[1]);
      continue;
    }
    if (m[3] === undefined) continue; // a comment, a declaration
    const closing = m[2] === "/";
    const selfClosing = m[5] === "/";
    const name = localName(m[3]);
    if (closing) {
      if (cue && scopes.length === cue.depth && name === "p") {
        const words = cue.text.replace(/[ \t\r\n]+/g, " ").trim();
        if (words !== "") cues.push({ start: cue.begin, end: cue.end !== null && cue.end > cue.begin ? cue.end : null, text: words });
        cue = null;
      }
      if (name === "body") inBody = false;
      if (scopes.length > 1 && scopes[scopes.length - 1].name === name) scopes.pop();
      continue;
    }
    const attrs = attributes(m[4]);
    if (name === "tt") {
      const frame = Number(attrs.get("frameRate"));
      if (frame > 0) rates.frame = frame;
      const [num, den] = (attrs.get("frameRateMultiplier") ?? "1 1").split(/\s+/).map(Number);
      if (num > 0 && den > 0) rates.frame *= num / den;
      const subFrame = Number(attrs.get("subFrameRate"));
      if (subFrame > 0) rates.subFrame = subFrame;
      const tick = Number(attrs.get("tickRate"));
      rates.tick = tick > 0 ? tick : frame > 0 ? rates.frame * rates.subFrame : 1;
    }
    if (name === "br") {
      addText("\n");
      continue;
    }
    if (name === "body") inBody = true;
    if (selfClosing) continue;
    const parent = scopes[scopes.length - 1];
    const begin = attrs.has("begin") ? ttmlTime(attrs.get("begin")!, rates) : null;
    const end = attrs.has("end") ? ttmlTime(attrs.get("end")!, rates) : null;
    const dur = attrs.has("dur") ? ttmlTime(attrs.get("dur")!, rates) : null;
    const from = parent.begin + (begin ?? 0);
    const to = end !== null ? parent.begin + end : dur !== null ? from + dur : parent.end;
    scopes.push({ name, begin: from, end: to });
    if (inBody && name === "p" && !cue) cue = { begin: from, end: to, text: "", depth: scopes.length };
  }
  return cues;
}
