// A TTML caption file (SPEC.md §11): Netflix's and Amazon's DFXP, IMSC,
// EBU-TT-D, and the TTML other tools export. A cue is the words of one <p>
// that start to show at one time: a <p> is one cue, and a <p> whose spans
// carry their own times is one cue per time its words appear. Read by the
// standard's rules, as the IMSC reference implementation (ttconv) reads them:
//   Timing: every element's begin, end, and dur count from the element
//   around it. In a par container (the default) children start together; in
//   a seq container each child starts when the one before it ends, and text
//   directly in a seq container never shows. An element with no end or dur
//   ends with its children (par: the last to end; seq: the last), and text
//   in a par container runs until the container ends. An element shows only
//   while every element around it does, and while its region does.
//   Showing: an element whose display is none shows no words, and a word
//   whose visibility is hidden shows nothing; both are read from the
//   element's own tts: attributes, its style references, its region's
//   style, and <set> elements that change them for a time. A word that
//   shows only after a <set> starts at that time.
//   Content: <metadata> and elements of any other namespace are not words;
//   <br/> is a space.
//   Time expressions: "00:00:01.375", "00:00:01:12" (frames), "0.76s",
//   "500ms", "1.5m", "30f", "100t" (ticks), and a bare "19.764" as seconds.

const TAG =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Whether the text is a TTML document: its root element is <tt>. */
export function isTtml(text: string): boolean {
  return /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?tt[\s>]/.test(text);
}

type Rates = { frame: number; subFrame: number; tick: number };

// The TTML namespace: the Recommendation's and the drafts' DFXP. The root
// <tt>'s own namespace counts too, and an element whose prefix no xmlns
// declares is read as TTML, as the older parser read every element.
const TTML_NS = /^http:\/\/www\.w3\.org\/(?:ns\/ttml|20\d\d\/\d\d\/ttaf1)$/;

type Element = {
  name: string; // local name; "" for an element that is not words (foreign, metadata)
  attrs: Map<string, string>; // by local name; xml:id keeps its prefix
  children: Node[];
};
type Node = Element | string;

function xmlText(raw: string): string {
  return raw.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (match, dec, hex, name) => {
    if (name) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name as "amp"];
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** The document as a tree. Namespaces resolve by the xmlns declarations in
    scope; an element of another namespace keeps its place with no name, so
    its words are dropped with it. */
function parseTree(text: string): Element {
  const root: Element = { name: "#document", attrs: new Map(), children: [] };
  const stack: { el: Element; qname: string; ns: Map<string, string> }[] = [{ el: root, qname: "", ns: new Map() }];
  let rootNs: string | undefined;
  let at = 0;
  const top = () => stack[stack.length - 1];
  for (const m of text.matchAll(TAG)) {
    if (m.index > at) top().el.children.push(xmlText(text.slice(at, m.index)));
    at = m.index + m[0].length;
    if (m[1] !== undefined) {
      top().el.children.push(m[1]);
      continue;
    }
    if (m[3] === undefined) continue; // a comment, a declaration
    if (m[2] === "/") {
      // Close the nearest open element of that name; unclosed ones inside it close too.
      const i = stack.map((s) => s.qname).lastIndexOf(m[3]);
      if (i > 0) stack.length = i;
      continue;
    }
    const ns = new Map(top().ns);
    const attrs = new Map<string, string>();
    for (const a of m[4].matchAll(ATTRIBUTE)) {
      const value = a[2] ?? a[3] ?? "";
      if (a[1] === "xmlns") ns.set("", value);
      else if (a[1].startsWith("xmlns:")) ns.set(a[1].slice(6), value);
      else attrs.set(a[1].includes(":") && !a[1].startsWith("xml:") ? a[1].slice(a[1].indexOf(":") + 1) : a[1], value);
    }
    const colon = m[3].indexOf(":");
    const local = m[3].slice(colon + 1);
    const uri = ns.get(colon === -1 ? "" : m[3].slice(0, colon));
    if (stack.length === 1 && local === "tt") rootNs = uri;
    const ttml = uri === undefined || uri === rootNs || TTML_NS.test(uri);
    const el: Element = {
      name: ttml && local !== "metadata" ? local : "",
      attrs,
      children: [],
    };
    top().el.children.push(el);
    if (m[5] !== "/") stack.push({ el, qname: m[3], ns });
  }
  if (at < text.length) top().el.children.push(xmlText(text.slice(at)));
  return root;
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

const find = (el: Element, name: string): Element | undefined =>
  el.children.find((c): c is Element => typeof c !== "string" && c.name === name);
const elements = (el: Element): Element[] => el.children.filter((c): c is Element => typeof c !== "string");
const isWords = (node: Node): boolean => typeof node === "string" && node.trim() !== "";

// ── Timing ──────────────────────────────────────────────────────────────────

// An interval; end null runs to the end of the media.
type Interval = { begin: number; end: number | null };

// How times count: by the standard, an element's times count from the
// element around it; with `media`, every time is on the media's clock, as
// Apple's lyrics TTML writes them.
type Clock = { rates: Rates; media: boolean };

/** Begin and end of an element on the media's clock (ttconv's reading of
    TTML timing): `implicitBegin` is where the parent's container places it
    (the parent's begin in par, the previous sibling's end in seq). Every
    element under it is timed into `out` too. */
function timeOf(
  el: Element,
  implicitBegin: number,
  parentSeq: boolean,
  clock: Clock,
  out: Map<Element, Interval>,
): Interval {
  const read = (name: string) => (el.attrs.has(name) ? ttmlTime(el.attrs.get(name)!, clock.rates) : null);
  const origin = clock.media ? 0 : implicitBegin;
  const offset = read("begin");
  const begin = offset === null ? implicitBegin : origin + offset;
  const seq = el.attrs.get("timeContainer") === "seq";
  // The element's own end from its children. A region holds no words, so
  // it is active until its end or dur says.
  let implicit: number | null =
    (el.name === "br" || el.name === "set" || el.name === "region") && !parentSeq ? null : begin;
  let next = begin;
  for (const child of el.children) {
    if (typeof child === "string") {
      if (!seq && isWords(child)) implicit = null;
      continue;
    }
    if (child.name === "") continue;
    const t = timeOf(child, seq ? next : begin, seq, clock, out);
    if (seq) {
      implicit = t.end;
      next = t.end ?? Number.POSITIVE_INFINITY;
    } else if (implicit !== null) {
      implicit = t.end === null ? null : Math.max(implicit, t.end);
    }
  }
  const end = read("end");
  const dur = read("dur");
  let to: number | null;
  if (end !== null && dur !== null) to = Math.min(begin + dur, origin + end);
  else if (dur !== null) to = begin + dur;
  else if (end !== null) to = origin + end;
  else to = implicit;
  const timed = { begin, end: to };
  out.set(el, timed);
  return timed;
}

// ── Showing ─────────────────────────────────────────────────────────────────

type Style = { display?: string; visibility?: string };

/** An element's own style: referential styles first (each style's own
    references before it), then its tts: attributes. */
function ownStyle(el: Element, styles: Map<string, Element>, seen = new Set<string>()): Style {
  const style: Style = {};
  for (const id of (el.attrs.get("style") ?? "").split(/\s+/).filter(Boolean)) {
    const ref = styles.get(id);
    if (!ref || seen.has(id)) continue;
    seen.add(id);
    Object.assign(style, ownStyle(ref, styles, seen));
  }
  for (const name of ["display", "visibility"] as const) {
    const value = el.attrs.get(name);
    if (value !== undefined) style[name] = value.trim();
  }
  return style;
}

// A <set> child: a style that holds for a time, on the media's clock.
type Change = Interval & Style;

// One element around a word: its style and the <set> changes on it.
type Frame = { style: Style; changes: Change[] };

/** Whether words under these elements (outermost first) show at time t. */
function showsAt(frames: Frame[], t: number): boolean {
  let visible = true;
  for (const frame of frames) {
    let { display, visibility } = frame.style;
    for (const c of frame.changes) {
      if (t < c.begin || (c.end !== null && t >= c.end)) continue;
      display = c.display ?? display;
      visibility = c.visibility ?? visibility;
    }
    if (display === "none") return false;
    if (visibility !== undefined) visible = visibility !== "hidden";
  }
  return visible;
}

// ── Cues ────────────────────────────────────────────────────────────────────

// Words of one <p> under one innermost element: the time that element is
// active, every element around the words, and the region they show in.
type Piece = Interval & { text: string; frames: Frame[]; region?: string };

type Cue = { start: number; end: number | null; text: string };

/** The cues of a TTML document, in time order. A cue whose end no element
    gives has a null end. */
export function ttmlCues(text: string): Cue[] {
  const tt = elements(parseTree(text)).find((e) => e.name === "tt");
  if (!tt) return [];
  const rates: Rates = { frame: 30, subFrame: 1, tick: 1 };
  const frame = Number(tt.attrs.get("frameRate"));
  if (frame > 0) rates.frame = frame;
  const [num, den] = (tt.attrs.get("frameRateMultiplier") ?? "1 1").split(/[\s:]+/).map(Number);
  if (num > 0 && den > 0) rates.frame *= num / den;
  const subFrame = Number(tt.attrs.get("subFrameRate"));
  if (subFrame > 0) rates.subFrame = subFrame;
  const tick = Number(tt.attrs.get("tickRate"));
  rates.tick = tick > 0 ? tick : frame > 0 ? rates.frame * rates.subFrame : 1;

  const body = find(tt, "body");
  if (!body) return [];
  const styles = new Map<string, Element>();
  const regions = new Map<string, Element>();
  const collect = (el: Element) => {
    for (const child of elements(el)) {
      const id = child.attrs.get("xml:id");
      if (child.name === "style" && id) styles.set(id, child);
      if (child.name === "region" && id) regions.set(id, child);
      collect(child);
    }
  };
  const head = find(tt, "head");
  if (head) collect(head);

  const cuesBy = (clock: Clock): Cue[] => {
    // An element's <set> children on the clock: a set's time counts from the
    // element's begin, and a set with no end ends with the element.
    const changesOf = (el: Element, at: Interval): Change[] =>
      elements(el)
        .filter((c) => c.name === "set")
        .map((set) => {
          const t = timeOf(set, at.begin, false, clock, new Map());
          const style: Style = {};
          if (set.attrs.has("display")) style.display = set.attrs.get("display")!.trim();
          if (set.attrs.has("visibility")) style.visibility = set.attrs.get("visibility")!.trim();
          return { begin: t.begin, end: t.end ?? at.end, ...style };
        });

    // A region: the time it is active and its frame (its own style, nested
    // <style> children, and its <set> changes).
    const regionOf = new Map<string, { at: Interval; frame: Frame }>();
    for (const [id, region] of regions) {
      const at = timeOf(region, 0, false, clock, new Map());
      const style = ownStyle(region, styles);
      for (const nested of elements(region).filter((c) => c.name === "style"))
        Object.assign(style, ownStyle(nested, styles));
      regionOf.set(id, {
        at,
        frame: { style, changes: changesOf(region, at) },
      });
    }

    const times = new Map<Element, Interval>();
    timeOf(body, 0, false, clock, times);

    const paragraphs: Piece[][] = [];
    const walk = (el: Element, at: Interval, frames: Frame[], region: string | undefined, pieces: Piece[] | null) => {
      const seq = el.attrs.get("timeContainer") === "seq";
      for (const child of el.children) {
        if (typeof child === "string") {
          if (pieces && !seq) pieces.push({ ...at, text: child, frames, region });
          continue;
        }
        if (child.name === "" || child.name === "set") continue;
        if (child.name === "br") {
          if (pieces) pieces.push({ ...at, text: " ", frames, region });
          continue;
        }
        const t = times.get(child);
        if (!t) continue;
        // An element shows only while the element around it does.
        const begin = Math.max(at.begin, t.begin);
        let end = t.end ?? at.end;
        if (at.end !== null && (end === null || end > at.end)) end = at.end;
        if (end !== null && end <= begin) continue;
        const span = { begin, end };
        const childFrames = [...frames, { style: ownStyle(child, styles), changes: changesOf(child, span) }];
        const childRegion = child.attrs.get("region") ?? region;
        if (child.name === "p" && !pieces) {
          const list: Piece[] = [];
          paragraphs.push(list);
          walk(child, span, childFrames, childRegion, list);
        } else {
          walk(child, span, childFrames, childRegion, pieces);
        }
      }
    };
    const bodyAt = times.get(body)!;
    walk(
      body,
      bodyAt,
      [{ style: ownStyle(body, styles), changes: changesOf(body, bodyAt) }],
      body.attrs.get("region"),
      null,
    );

    const cues: Cue[] = [];
    for (const pieces of paragraphs) {
      // Words that start to show at one time are one cue, in document order.
      const byStart = new Map<number, { end: number | null; text: string[] }>();
      for (const piece of pieces) {
        const shown = shownOf(piece, regionOf);
        if (!shown) continue;
        const cue = byStart.get(shown.begin);
        if (!cue) byStart.set(shown.begin, { end: shown.end, text: [piece.text] });
        else {
          cue.text.push(piece.text);
          cue.end = cue.end === null || shown.end === null ? null : Math.max(cue.end, shown.end);
        }
      }
      for (const [start, cue] of byStart) {
        const words = cue.text
          .join("")
          .replace(/[ \t\r\n]+/g, " ")
          .trim();
        if (words !== "") cues.push({ start, end: cue.end, text: words });
      }
    }
    return cues.sort((a, b) => a.start - b.start);
  };
  // A file whose nested times show no words, read as times on the media's
  // clock, shows them (Apple's lyrics TTML); a file that shows words by the
  // standard is read by the standard.
  const nested = cuesBy({ rates, media: false });
  return nested.length > 0 ? nested : cuesBy({ rates, media: true });
}

/** When a piece's words show: from the first time in the piece's interval
    that its region is active and every element around it shows it, to the
    first time after that they stop showing. Null when they never show. */
function shownOf(piece: Piece, regionOf: Map<string, { at: Interval; frame: Frame }>): Interval | null {
  let { begin, end } = piece;
  let frames = piece.frames;
  const region = piece.region !== undefined ? regionOf.get(piece.region) : undefined;
  if (region) {
    begin = Math.max(begin, region.at.begin);
    if (region.at.end !== null && (end === null || end > region.at.end)) end = region.at.end;
    if (end !== null && end <= begin) return null;
    frames = [region.frame, ...frames];
  }
  // Showing changes only where a <set> starts or ends.
  const edges = new Set<number>([begin]);
  for (const frame of frames) {
    for (const c of frame.changes) {
      for (const t of [c.begin, c.end]) if (t !== null && t > begin && (end === null || t < end)) edges.add(t);
    }
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const first = sorted.findIndex((t) => showsAt(frames, t));
  if (first === -1) return null;
  const stop = sorted.slice(first + 1).find((t) => !showsAt(frames, t));
  return { begin: sorted[first], end: stop ?? end };
}
