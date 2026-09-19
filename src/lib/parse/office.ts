import { unzipSync } from "fflate";
import { JSDOM } from "jsdom";

// Office Open XML files (SPEC.md §27): the zip and XML reading the slides
// parser (lib/parse/slides.ts) and the sheets parser (lib/parse/sheets.ts)
// share. A .pptx and a .xlsx are zips of XML parts plus media; the parts
// point at each other through relationship files (_rels/*.rels).

export type OfficeKind = "pptx" | "xlsx";

/** A zip's entries by path, every entry decompressed. */
export type OfficeZip = Map<string, Uint8Array>;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** Do the bytes start a zip file. */
export function isZipBytes(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/** Which Office file the bytes are, read from the zip's entry names, never
    from the file name: a presentation carries ppt/presentation.xml, a
    workbook xl/workbook.xml. Null for anything else, a broken zip included. */
export function sniffOfficeFile(bytes: Uint8Array): OfficeKind | null {
  if (!isZipBytes(bytes)) return null;
  const names = new Set<string>();
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.add(file.name);
        return false;
      },
    });
  } catch {
    return null;
  }
  if (names.has("ppt/presentation.xml")) return "pptx";
  if (names.has("xl/workbook.xml")) return "xlsx";
  return null;
}

/** Every entry of the zip, decompressed. Throws on a broken zip. */
export function unzipOffice(bytes: Uint8Array): OfficeZip {
  const entries = unzipSync(bytes);
  const zip: OfficeZip = new Map();
  for (const [name, data] of Object.entries(entries)) {
    // Directory entries carry no bytes.
    if (name.endsWith("/")) continue;
    zip.set(name, data);
  }
  return zip;
}

const decoder = new TextDecoder("utf-8");

/** An XML part's text, or null when the zip has no such part. */
export function partText(zip: OfficeZip, path: string): string | null {
  const bytes = zip.get(path);
  return bytes ? decoder.decode(bytes) : null;
}

// One DOM parser for every part: a JSDOM window per part would be the slow
// part of a 200-slide parse.
let parser: DOMParser | null = null;
function domParser(): DOMParser {
  if (!parser) parser = new new JSDOM("").window.DOMParser();
  return parser;
}

/** An XML part parsed to a DOM, or null when the part is missing or does
    not parse. Namespaces are kept: match elements by localName. */
export function parseXmlPart(zip: OfficeZip, path: string): XMLDocument | null {
  const text = partText(zip, path);
  if (text === null) return null;
  return parseXml(text);
}

export function parseXml(text: string): XMLDocument | null {
  try {
    const doc = domParser().parseFromString(text, "application/xml");
    // jsdom reports a parse failure as a parsererror document.
    if (doc.getElementsByTagName("parsererror").length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

/** The direct children with this local name, in order. */
export function children(el: Element | null | undefined, localName: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const child of el.children) if (child.localName === localName) out.push(child);
  return out;
}

/** The first direct child with this local name. */
export function child(el: Element | null | undefined, ...path: string[]): Element | null {
  let at: Element | null = el ?? null;
  for (const name of path) {
    if (!at) return null;
    let next: Element | null = null;
    for (const c of at.children) {
      if (c.localName === name) {
        next = c;
        break;
      }
    }
    at = next;
  }
  return at;
}

/** Every descendant with this local name, in document order. */
export function descendants(el: Element | Document | null | undefined, localName: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS("*", localName));
}

export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const value = el.getAttribute(name);
  if (value !== null) return value;
  // A namespaced attribute (r:id, r:embed) may carry its prefix in the
  // attribute name jsdom reports; match on the local part.
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
}

export function intAttr(el: Element | null | undefined, name: string): number | null {
  const value = attr(el, name);
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A boolean attribute the way OOXML writes it: "1", "true", "0", "false",
    absent = the default. */
export function boolAttr(el: Element | null | undefined, name: string, fallback = false): boolean {
  const value = attr(el, name);
  if (value === null) return fallback;
  return value === "1" || value === "true" || value === "on";
}

// ── Relationships ────────────────────────────────────────────────────────────

export type Relationship = { id: string; type: string; target: string; external: boolean };

/** The relationships of a part: the .rels file beside it, keyed by id.
    Targets are resolved to zip paths (an external target stays a URL). */
export function partRels(zip: OfficeZip, partPath: string): Map<string, Relationship> {
  const slash = partPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : partPath.slice(0, slash + 1);
  const name = partPath.slice(slash + 1);
  const relsPath = `${dir}_rels/${name}.rels`;
  const rels = new Map<string, Relationship>();
  const doc = parseXmlPart(zip, relsPath);
  if (!doc) return rels;
  for (const rel of descendants(doc, "Relationship")) {
    const id = attr(rel, "Id");
    const type = attr(rel, "Type") ?? "";
    const target = attr(rel, "Target") ?? "";
    if (!id || !target) continue;
    const external = attr(rel, "TargetMode") === "External";
    rels.set(id, {
      id,
      type: type.slice(type.lastIndexOf("/") + 1),
      target: external ? target : resolvePartPath(dir, target),
      external,
    });
  }
  return rels;
}

/** A relationship target as a zip path: relative to the part's folder, or
    absolute from the zip root when it starts with a slash. */
export function resolvePartPath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${dir}${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** The relationships of a type, in the order the rels file lists them. */
export function relsOfType(rels: Map<string, Relationship>, type: string): Relationship[] {
  return [...rels.values()].filter((r) => r.type === type);
}

// ── Text and markup ──────────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
}

/** A CSS value inside a style attribute: no quotes, no semicolons, no
    braces, so a font name or a color from the file cannot break out. */
export function cssValue(value: string): string {
  return value.replace(/[;{}"'<>\\]/g, "").trim();
}

/** The invisible separator that keeps a block's DOM text equal to its
    stored text (globals.css .cell-gap): a tab between cells, a newline
    between rows or paragraphs (SPEC.md §5). */
export function textGap(sep: "\t" | "\n"): string {
  return `<span class="cell-gap">${sep}</span>`;
}

/** Text as XML carries it: whitespace kept, control characters other than
    tab and newline dropped (they would break the DOM text equality). */
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

// ── Colors ───────────────────────────────────────────────────────────────────

export type Rgb = { r: number; g: number; b: number };

export function parseHexColor(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").trim();
  const m = /^(?:[0-9a-f]{2})?([0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export function rgbCss(rgb: Rgb, alpha = 1): string {
  const { r, g, b } = rgb;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return alpha >= 1
    ? `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`
    : `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 };
}

/** The Office color modifiers on a color: lumMod and lumOff scale and
    shift the luminance, tint and shade move toward white and black, and a
    theme tint (Excel's cell colors) does both from one signed number. */
export function modifyColor(
  rgb: Rgb,
  mods: { lumMod?: number; lumOff?: number; tint?: number; shade?: number; themeTint?: number },
): Rgb {
  const { h, s } = rgbToHsl(rgb);
  let { l } = rgbToHsl(rgb);
  if (mods.lumMod !== undefined) l = l * mods.lumMod;
  if (mods.lumOff !== undefined) l = l + mods.lumOff;
  if (mods.themeTint !== undefined) {
    const t = mods.themeTint;
    l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  }
  l = Math.max(0, Math.min(1, l));
  let out = hslToRgb(h, s, l);
  if (mods.tint !== undefined) {
    const t = mods.tint;
    out = { r: 255 - (255 - out.r) * t, g: 255 - (255 - out.g) * t, b: 255 - (255 - out.b) * t };
  }
  if (mods.shade !== undefined) {
    const sh = mods.shade;
    out = { r: out.r * sh, g: out.g * sh, b: out.b * sh };
  }
  return out;
}

// ── Theme ────────────────────────────────────────────────────────────────────

export type ThemeColors = Record<string, Rgb>;

/** A theme part's color scheme by name (dk1, lt1, dk2, lt2, accent1…6,
    hlink, folHlink) and its major and minor Latin fonts. */
export function parseTheme(zip: OfficeZip, path: string): { colors: ThemeColors; major: string; minor: string } {
  const colors: ThemeColors = {};
  let major = "";
  let minor = "";
  const doc = parseXmlPart(zip, path);
  if (doc) {
    const scheme = descendants(doc, "clrScheme")[0];
    if (scheme) {
      for (const entry of Array.from(scheme.children)) {
        const rgb = schemeEntryColor(entry);
        if (rgb) colors[entry.localName] = rgb;
      }
    }
    const fonts = descendants(doc, "fontScheme")[0];
    major = attr(child(fonts, "majorFont", "latin"), "typeface") ?? "";
    minor = attr(child(fonts, "minorFont", "latin"), "typeface") ?? "";
  }
  return { colors, major, minor };
}

function schemeEntryColor(entry: Element): Rgb | null {
  const srgb = child(entry, "srgbClr");
  if (srgb) return parseHexColor(attr(srgb, "val"));
  const sys = child(entry, "sysClr");
  if (sys) return parseHexColor(attr(sys, "lastClr")) ?? (attr(sys, "val") === "windowText" ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 });
  return null;
}

// ── Units ────────────────────────────────────────────────────────────────────

/** English Metric Units per point: 12700. */
export const EMU_PER_PT = 12700;
export const EMU_PER_INCH = 914400;

/** A number as CSS prints it: at most three decimals, no trailing zeros. */
export function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

// ── Fonts ────────────────────────────────────────────────────────────────────

const SERIF_RX = /times|georgia|garamond|cambria|palatino|book antiqua|baskerville|didot|bodoni|playfair|merriweather|lora|serif|century|minion|constantia|charter|caslon|spectral|libre|crimson|noto serif|pt serif|source serif|cormorant|domine|vollkorn|bitter/i;
const MONO_RX = /courier|consolas|mono|menlo|monaco|code|inconsolata|fira code|lucida console|jetbrains/i;

/** A font family declaration for a file's typeface: the name first, then a
    generic family read from the name. */
export function fontFamilyCss(typeface: string): string {
  const name = cssValue(typeface);
  if (!name) return "";
  const generic = MONO_RX.test(name) ? "ui-monospace, monospace" : SERIF_RX.test(name) ? "serif" : "sans-serif";
  // Single quotes: the declaration sits inside a double-quoted style
  // attribute, and cssValue has stripped every quote from the name.
  return `'${name}', ${generic}`;
}
