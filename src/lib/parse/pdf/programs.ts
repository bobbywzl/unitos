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

const programs = new WeakMap<Uint8Array, { text: string; names: Map<string, (string | undefined)[] | null>; inks: Map<string, number | null> }>();

/** The glyph names of the TrueType program the PDF embeds for the font
    named name (its BaseFont, subset prefix and all), by glyph id; a name
    the post table takes from the standard Macintosh set is undefined.
    Null where the PDF keeps the font's dictionaries in an object stream,
    its CIDs are no glyph ids (a CIDToGIDMap other than /Identity), the
    program is no TrueType, or its post table names no glyph. */
export function embeddedGlyphNames(data: Uint8Array, name: string): (string | undefined)[] | null {
  let doc = programs.get(data);
  if (!doc) {
    doc = { text: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1"), names: new Map(), inks: new Map() };
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

// ── A font's weight from its glyphs ──────────────────────────────────────────
//
// A font whose name says no weight and whose descriptor says none (Advent
// 3B2's hashed names, StemV 0: Nature's and Elsevier's bold faces) still
// draws its weight: a bold glyph fills more of its box. The ink ratio of a
// font is the mean, over its lowercase letters a e n o r s u x, of each
// glyph's outline area over its bounding box (a Times regular 0.39, a
// Times bold 0.53, Helvetica 0.46, Helvetica-Bold 0.63), read from the
// CFF program (FontFile3, Type1C) the PDF embeds. Null for another
// program, a CID-keyed CFF, a font kept in an object stream, or a font
// with none of those letters.

/** The ink ratio of the CFF program the PDF embeds for the font named
    name (its BaseFont, subset prefix and all), or null. */
export function embeddedInk(data: Uint8Array, name: string): number | null {
  let doc = programs.get(data);
  if (!doc) {
    doc = { text: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1"), names: new Map(), inks: new Map() };
    programs.set(data, doc);
  }
  if (doc.inks.has(name)) return doc.inks.get(name) ?? null;
  let ink: number | null = null;
  try {
    ink = readInk(doc.text, name);
  } catch {
    ink = null;
  }
  doc.inks.set(name, ink);
  return ink;
}

function readInk(text: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const descriptor = new RegExp(`/FontName\\s*/${escaped}(?![\\w+-])`).exec(text);
  if (!descriptor) return null;
  const end = text.indexOf("endobj", descriptor.index);
  const dict = text.slice(Math.max(0, text.lastIndexOf("obj", descriptor.index)), end < 0 ? descriptor.index + 800 : end);
  const ref = /\/FontFile3\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (!ref) return null;
  const program = streamOf(text, Number(ref[1]), Number(ref[2]));
  return program ? cffInk(program) : null;
}

// A CFF INDEX: its items, and where it ends.
function cffIndex(b: Uint8Array, at: number): { items: Uint8Array[]; end: number } {
  const count = (b[at] << 8) | b[at + 1];
  if (count === 0) return { items: [], end: at + 2 };
  const offSize = b[at + 2];
  let p = at + 3;
  const offsets: number[] = [];
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = (v << 8) | b[p + i * offSize + k];
    offsets.push(v);
  }
  p += (count + 1) * offSize - 1;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) items.push(b.subarray(p + offsets[i], p + offsets[i + 1]));
  return { items, end: p + offsets[count] };
}

// A CFF DICT: each operator's operands (an escaped operator is 1200 + its
// second byte).
function cffDict(b: Uint8Array): Map<number, number[]> {
  const ops = new Map<number, number[]>();
  let stack: number[] = [];
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    if (c <= 21) {
      let op = c;
      i++;
      if (c === 12) op = 1200 + b[i++];
      ops.set(op, stack);
      stack = [];
    } else if (c === 28) {
      stack.push((((b[i + 1] << 8) | b[i + 2]) << 16) >> 16);
      i += 3;
    } else if (c === 29) {
      stack.push((b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]);
      i += 5;
    } else if (c === 30) {
      let s = "";
      i++;
      let done = false;
      while (i < b.length && !done) {
        const v = b[i++];
        for (const nib of [v >> 4, v & 15]) {
          if (nib <= 9) s += String(nib);
          else if (nib === 10) s += ".";
          else if (nib === 11) s += "E";
          else if (nib === 12) s += "E-";
          else if (nib === 14) s += "-";
          else if (nib === 15) {
            done = true;
            break;
          }
        }
      }
      stack.push(Number(s) || 0);
    } else if (c <= 246) {
      stack.push(c - 139);
      i++;
    } else if (c <= 250) {
      stack.push((c - 247) * 256 + b[i + 1] + 108);
      i += 2;
    } else if (c <= 254) {
      stack.push(-(c - 251) * 256 - b[i + 1] - 108);
      i += 2;
    } else i++;
  }
  return ops;
}

const subrBias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

type Path = { x: number; y: number; contours: number[][][]; contour: number[][]; stems: number; width: boolean; ended: boolean };

// The outline a Type 2 charstring draws, each curve flattened to four
// lines; the stack's width argument dropped as the first stack-clearing
// operator takes it.
function runCharstring(cs: Uint8Array, gsubrs: Uint8Array[], lsubrs: Uint8Array[], path: Path, stack: number[], depth = 0): void {
  if (depth > 10) return;
  const flush = () => {
    if (path.contour.length > 0) path.contours.push(path.contour);
    path.contour = [];
  };
  const moveTo = (x: number, y: number) => {
    flush();
    path.x = x;
    path.y = y;
    path.contour = [[x, y]];
  };
  const lineTo = (x: number, y: number) => {
    path.x = x;
    path.y = y;
    path.contour.push([x, y]);
  };
  const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const [x0, y0] = [path.x, path.y];
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      const u = 1 - t;
      path.contour.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
    path.x = x3;
    path.y = y3;
  };
  const takeWidth = (even: number) => {
    if (!path.width && stack.length % 2 === 1 && even === 0) stack.shift();
    else if (!path.width && even > 0 && stack.length > even) stack.shift();
    path.width = true;
  };
  let i = 0;
  while (i < cs.length) {
    const c = cs[i];
    if (c >= 32 || c === 28) {
      if (c === 28) {
        stack.push((((cs[i + 1] << 8) | cs[i + 2]) << 16) >> 16);
        i += 3;
      } else if (c <= 246) {
        stack.push(c - 139);
        i++;
      } else if (c <= 250) {
        stack.push((c - 247) * 256 + cs[i + 1] + 108);
        i += 2;
      } else if (c <= 254) {
        stack.push(-(c - 251) * 256 - cs[i + 1] - 108);
        i += 2;
      } else {
        stack.push(((cs[i + 1] << 24) | (cs[i + 2] << 16) | (cs[i + 3] << 8) | cs[i + 4]) / 65536);
        i += 5;
      }
      continue;
    }
    i++;
    switch (c) {
      case 1:
      case 3:
      case 18:
      case 23:
        takeWidth(0);
        path.stems += stack.length >> 1;
        stack.length = 0;
        break;
      case 19:
      case 20:
        takeWidth(0);
        path.stems += stack.length >> 1;
        stack.length = 0;
        i += (path.stems + 7) >> 3;
        break;
      case 21:
        takeWidth(2);
        moveTo(path.x + (stack[0] ?? 0), path.y + (stack[1] ?? 0));
        stack.length = 0;
        break;
      case 22:
        takeWidth(1);
        moveTo(path.x + (stack[0] ?? 0), path.y);
        stack.length = 0;
        break;
      case 4:
        takeWidth(1);
        moveTo(path.x, path.y + (stack[0] ?? 0));
        stack.length = 0;
        break;
      case 5:
        for (let k = 0; k + 1 < stack.length; k += 2) lineTo(path.x + stack[k], path.y + stack[k + 1]);
        stack.length = 0;
        break;
      case 6:
      case 7: {
        let horizontal = c === 6;
        for (const v of stack) {
          if (horizontal) lineTo(path.x + v, path.y);
          else lineTo(path.x, path.y + v);
          horizontal = !horizontal;
        }
        stack.length = 0;
        break;
      }
      case 8:
        for (let k = 0; k + 5 < stack.length; k += 6) {
          const x1 = path.x + stack[k];
          const y1 = path.y + stack[k + 1];
          const x2 = x1 + stack[k + 2];
          const y2 = y1 + stack[k + 3];
          curveTo(x1, y1, x2, y2, x2 + stack[k + 4], y2 + stack[k + 5]);
        }
        stack.length = 0;
        break;
      case 24: {
        let k = 0;
        for (; stack.length - k >= 8; k += 6) {
          const x1 = path.x + stack[k];
          const y1 = path.y + stack[k + 1];
          const x2 = x1 + stack[k + 2];
          const y2 = y1 + stack[k + 3];
          curveTo(x1, y1, x2, y2, x2 + stack[k + 4], y2 + stack[k + 5]);
        }
        if (k + 1 < stack.length) lineTo(path.x + stack[k], path.y + stack[k + 1]);
        stack.length = 0;
        break;
      }
      case 25: {
        let k = 0;
        for (; stack.length - k >= 8; k += 2) lineTo(path.x + stack[k], path.y + stack[k + 1]);
        if (k + 5 < stack.length) {
          const x1 = path.x + stack[k];
          const y1 = path.y + stack[k + 1];
          const x2 = x1 + stack[k + 2];
          const y2 = y1 + stack[k + 3];
          curveTo(x1, y1, x2, y2, x2 + stack[k + 4], y2 + stack[k + 5]);
        }
        stack.length = 0;
        break;
      }
      case 26:
      case 27: {
        let k = 0;
        let d1 = 0;
        if (stack.length % 4 === 1) {
          d1 = stack[0];
          k = 1;
        }
        for (; stack.length - k >= 4; k += 4) {
          if (c === 26) {
            const x1 = path.x + d1;
            const y1 = path.y + stack[k];
            const x2 = x1 + stack[k + 1];
            const y2 = y1 + stack[k + 2];
            curveTo(x1, y1, x2, y2, x2, y2 + stack[k + 3]);
          } else {
            const x1 = path.x + stack[k];
            const y1 = path.y + d1;
            const x2 = x1 + stack[k + 1];
            const y2 = y1 + stack[k + 2];
            curveTo(x1, y1, x2, y2, x2 + stack[k + 3], y2);
          }
          d1 = 0;
        }
        stack.length = 0;
        break;
      }
      case 30:
      case 31: {
        let horizontal = c === 31;
        for (let k = 0; stack.length - k >= 4; k += 4) {
          const last = stack.length - k === 5;
          if (horizontal) {
            const x1 = path.x + stack[k];
            const y1 = path.y;
            const x2 = x1 + stack[k + 1];
            const y2 = y1 + stack[k + 2];
            curveTo(x1, y1, x2, y2, x2 + (last ? stack[k + 4] : 0), y2 + stack[k + 3]);
          } else {
            const x1 = path.x;
            const y1 = path.y + stack[k];
            const x2 = x1 + stack[k + 1];
            const y2 = y1 + stack[k + 2];
            curveTo(x1, y1, x2, y2, x2 + stack[k + 3], y2 + (last ? stack[k + 4] : 0));
          }
          horizontal = !horizontal;
        }
        stack.length = 0;
        break;
      }
      case 10: {
        const n = (stack.pop() ?? 0) + subrBias(lsubrs.length);
        if (lsubrs[n]) runCharstring(lsubrs[n], gsubrs, lsubrs, path, stack, depth + 1);
        if (path.ended) return;
        break;
      }
      case 29: {
        const n = (stack.pop() ?? 0) + subrBias(gsubrs.length);
        if (gsubrs[n]) runCharstring(gsubrs[n], gsubrs, lsubrs, path, stack, depth + 1);
        if (path.ended) return;
        break;
      }
      case 11:
        return;
      case 14:
        flush();
        path.ended = true;
        return;
      case 12:
        i++;
        stack.length = 0;
        break;
      default:
        stack.length = 0;
    }
  }
  flush();
}

// The letters measured, by their standard string id ("a" is 66).
const INK_LETTERS = new Map([...["a", "e", "n", "o", "r", "s", "u", "x"].map((l) => [66 + l.charCodeAt(0) - 97, l] as const)]);

// The mean ink ratio of the program's lowercase letters: each glyph's
// outline area (the contours' signed areas summed, so a counter takes its
// hole out) over its bounding box.
function cffInk(cff: Uint8Array): number | null {
  const header = cff[2];
  const names = cffIndex(cff, header);
  const tops = cffIndex(cff, names.end);
  const strings = cffIndex(cff, tops.end);
  const gsubrs = cffIndex(cff, strings.end).items;
  if (tops.items.length === 0) return null;
  const top = cffDict(tops.items[0]);
  // A CID-keyed font keeps its subroutines per font dict: not read.
  if (top.has(1230)) return null;
  const charStringsAt = top.get(17)?.[0];
  if (charStringsAt === undefined) return null;
  const charStrings = cffIndex(cff, charStringsAt).items;
  let lsubrs: Uint8Array[] = [];
  const priv = top.get(18);
  if (priv && priv.length === 2) {
    const [size, offset] = priv;
    const subrs = cffDict(cff.subarray(offset, offset + size)).get(19)?.[0];
    if (subrs !== undefined) lsubrs = cffIndex(cff, offset + subrs).items;
  }
  // The charset: each glyph's string id (ISOAdobe's order where the font
  // names none).
  const sids: number[] = [0];
  const charsetAt = top.get(15)?.[0] ?? 0;
  if (charsetAt > 2) {
    let q = charsetAt;
    const format = cff[q++];
    while (sids.length < charStrings.length && q < cff.length) {
      if (format === 0) {
        sids.push((cff[q] << 8) | cff[q + 1]);
        q += 2;
      } else {
        const first = (cff[q] << 8) | cff[q + 1];
        const left = format === 1 ? cff[q + 2] : (cff[q + 2] << 8) | cff[q + 3];
        q += format === 1 ? 3 : 4;
        for (let k = 0; k <= left && sids.length < charStrings.length; k++) sids.push(first + k);
      }
    }
  } else for (let g = 1; g < charStrings.length; g++) sids.push(g);
  const ratios: number[] = [];
  sids.forEach((sid, g) => {
    if (!INK_LETTERS.has(sid) || g >= charStrings.length) return;
    const path: Path = { x: 0, y: 0, contours: [], contour: [], stems: 0, width: false, ended: false };
    runCharstring(charStrings[g], gsubrs, lsubrs, path, []);
    let area = 0;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const contour of path.contours) {
      for (let k = 0; k < contour.length; k++) {
        const [ax, ay] = contour[k];
        const [bx, by] = contour[(k + 1) % contour.length];
        area += ax * by - bx * ay;
        x1 = Math.min(x1, ax);
        y1 = Math.min(y1, ay);
        x2 = Math.max(x2, ax);
        y2 = Math.max(y2, ay);
      }
    }
    const box = (x2 - x1) * (y2 - y1);
    if (box > 0) ratios.push(Math.abs(area) / 2 / box);
  });
  if (ratios.length === 0) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

/** The ink ratio of a face: the first measured among the programs the PDF
    embeds under the face's name, with any subset prefix and any cut's
    suffix ("AdvOTcb88df00+fb" is AdvOTcb88df00's ligatures, with no
    letter of its own to measure). Null where none measures. */
export function embeddedInkOfFace(data: Uint8Array, face: string): number | null {
  let doc = programs.get(data);
  if (!doc) {
    doc = { text: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1"), names: new Map(), inks: new Map() };
    programs.set(data, doc);
  }
  const key = `face:${face}`;
  if (doc.inks.has(key)) return doc.inks.get(key) ?? null;
  const escaped = face.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new Set([...doc.text.matchAll(new RegExp(`/FontName\\s*/((?:[A-Z]{6}\\+)?${escaped}(?:\\+[0-9a-f]{2})?)(?![\\w+-])`, "gi"))].map((m) => m[1]));
  let ink: number | null = null;
  for (const name of names) {
    ink = embeddedInk(data, name);
    if (ink !== null) break;
  }
  doc.inks.set(key, ink);
  return ink;
}
