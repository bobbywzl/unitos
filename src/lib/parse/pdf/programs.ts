// The glyph names an embedded TrueType program keeps in its post table, read
// from the PDF's own bytes: pdf.js rebuilds every font and drops the names.
//
// A coding font's ligatures (JetBrains Mono, Fira Code) draw "--" or "->" as
// a spacer glyph and one glyph over both cells. The PDF's Unicode map has one
// entry per glyph, so the spacer, shared by every ligature, reads as the
// character of the first ligature the producer mapped it for, and the
// ligature's glyph as one character. PDF parse loop finding: an Arabic book
// set in Typst read "rm -rf --" as "rm -rf /-", ";;" as "/;", "||" as "/|",
// and "${HOME:?…}" as "${HOME/?…}": its spacer "SPC" maps to "/" (a URL's
// "//" came first). The glyph names say what each glyph is:
// "hyphen_hyphen.liga", "colon_question.liga", "SPC".

import { inflateSync } from "node:zlib";

// The characters of the plain names a ligature's name joins.
const ASCII_NAMES: Record<string, string> = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'",
  parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", period: ".", slash: "/",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[",
  backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|",
  braceright: "}", asciitilde: "~",
};

/** The characters a ligature's glyph name joins ("hyphen_greater.liga" →
    ["-", ">"]), or null for a name that is no ligature of named
    characters. */
export function ligatureOfName(name: string): string[] | null {
  const m = /^([a-z]+(?:_[a-z]+)+)\.liga$/i.exec(name);
  if (!m) return null;
  const parts = m[1].split("_").map((part) => ASCII_NAMES[part] ?? (/^[A-Za-z]$/.test(part) ? part : undefined));
  return parts.every((c) => c !== undefined) ? (parts as string[]) : null;
}

/** Whether a glyph name is a ligature's spacer: a name of no character and
    of no ligature ("SPC" in JetBrains Mono, "LIG" in Fira Code). */
export function isSpacerName(name: string): boolean {
  return /^(?:SPC|LIG)$/.test(name);
}

const programs = new WeakMap<Uint8Array, { text: string; names: Map<string, (string | undefined)[] | null> }>();

/** The glyph names of the TrueType program the PDF embeds for the font
    named name (its BaseFont, subset prefix and all), by glyph id; a name
    the post table takes from the standard Macintosh set is undefined.
    Null where the PDF keeps the font's dictionaries in an object stream,
    its CIDs are no glyph ids (a CIDToGIDMap other than /Identity), the
    program is no TrueType, or its post table names no glyph. */
export function embeddedGlyphNames(data: Uint8Array, name: string): (string | undefined)[] | null {
  let doc = programs.get(data);
  if (!doc) {
    doc = { text: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1"), names: new Map() };
    programs.set(data, doc);
  }
  if (doc.names.has(name)) return doc.names.get(name) ?? null;
  let names: (string | undefined)[] | null = null;
  try {
    names = readNames(doc.text, name);
  } catch {
    names = null;
  }
  doc.names.set(name, names);
  return names;
}

function readNames(text: string, name: string): (string | undefined)[] | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The object around a key: from its "obj" to its "endobj".
  const objectAt = (at: number) => {
    const end = text.indexOf("endobj", at);
    return text.slice(Math.max(0, text.lastIndexOf("obj", at)), end < 0 ? at + 800 : end);
  };
  // A code is a glyph id only where the CID font maps CIDs to glyph ids one
  // to one (CIDToGIDMap /Identity).
  const fonts = [...text.matchAll(new RegExp(`/BaseFont\\s*/${escaped}(?![\\w+-])`, "g"))].map((m) => objectAt(m.index));
  const cid = fonts.find((dict) => /\/CIDFontType2\b/.test(dict));
  if (!cid || !/\/CIDToGIDMap\s*\/Identity\b/.test(cid)) return null;
  const descriptor = new RegExp(`/FontName\\s*/${escaped}(?![\\w+-])`).exec(text);
  if (!descriptor) return null;
  const dict = objectAt(descriptor.index);
  const ref = /\/FontFile2\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (!ref) return null;
  const program = streamOf(text, Number(ref[1]), Number(ref[2]));
  return program ? postNames(program) : null;
}

// An object's stream, its Flate filter undone; null for another filter.
function streamOf(text: string, num: number, gen: number): Uint8Array | null {
  const re = new RegExp(`(?:^|[^0-9])${num}\\s+${gen}\\s+obj\\b`, "g");
  let start = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) start = m.index + m[0].length;
  if (start < 0) return null;
  const open = text.indexOf("stream", start);
  if (open < 0) return null;
  const dict = text.slice(start, open);
  const filters = [...dict.matchAll(/\/(\w+Decode)\b/g)].map((m) => m[1]);
  if (filters.some((f) => f !== "FlateDecode")) return null;
  let from = open + "stream".length;
  if (text[from] === "\r") from++;
  if (text[from] === "\n") from++;
  const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  const end = direct ? from + Number(direct[1]) : text.indexOf("endstream", from);
  if (end < from) return null;
  const raw = Buffer.from(text.slice(from, end), "latin1");
  return filters.length > 0 ? new Uint8Array(inflateSync(raw)) : new Uint8Array(raw);
}

// The post table's names (version 2), by glyph id.
function postNames(font: Uint8Array): (string | undefined)[] | null {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = view.getUint16(4);
  for (let t = 0; t < tables; t++) {
    const record = 12 + t * 16;
    const tag = String.fromCharCode(font[record], font[record + 1], font[record + 2], font[record + 3]);
    if (tag !== "post") continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (view.getUint32(offset) !== 0x00020000) return null;
    const count = view.getUint16(offset + 32);
    const indexes: number[] = [];
    for (let g = 0; g < count; g++) indexes.push(view.getUint16(offset + 34 + g * 2));
    const custom: string[] = [];
    let pos = offset + 34 + count * 2;
    while (pos < offset + length) {
      const len = font[pos];
      custom.push(String.fromCharCode(...font.subarray(pos + 1, pos + 1 + len)));
      pos += 1 + len;
    }
    const names = indexes.map((k) => (k >= 258 ? custom[k - 258] : undefined));
    return names.some((n) => n !== undefined) ? names : null;
  }
  return null;
}
