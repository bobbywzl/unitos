// A PDF font's face as the page editor names it (SPEC.md §29 The page's
// faces; decision 2 of the parse loop's round 2): the face itself where the
// font menu lists it (TimesNewRomanPSMT → Times New Roman, Lora-Bold →
// Lora), the face a metric twin or a producer's name stands for
// (LiberationSerif → Times New Roman, Helvetica → Arial, Carlito →
// Calibri), Computer Modern for TeX's text fonts (the page draws KaTeX's
// copy of them), and else a face of the same shape: Times New Roman for a
// serif, Arial for a sans, Courier New for a monospace. Every import drew in
// the page editor's sans-serif before, a book set in Times or Computer
// Modern too.

import { DOCS_FONTS } from "@/components/docs/fonts";

export type Shape = "serif" | "sans" | "mono";

const BY_SHAPE: Record<Shape, string> = { serif: "Times New Roman", sans: "Arial", mono: "Courier New" };

// Faces by another name: metric twins, a producer's name for a face, and
// TeX's text fonts (Computer Modern, its Type 1 and Latin Modern twins, and
// KaTeX's copy). The first match wins.
const ALIASES: [RegExp, string][] = [
  [/^(?:Times|Tinos|LiberationSerif|NimbusRom|TeXGyreTermes|FreeSerif|STIX)/i, "Times New Roman"],
  [/^(?:Arial|Helvetica|Arimo|LiberationSans|NimbusSan|TeXGyreHeros|FreeSans)/i, "Arial"],
  [/^(?:Courier|Cousine|LiberationMono|NimbusMon|TeXGyreCursor|FreeMono)/i, "Courier New"],
  [/^(?:Calibri|Carlito)/i, "Calibri"],
  [/^(?:Cambria(?!Math)|Caladea)/i, "Cambria"],
  [/^(?:AGaramond|AdobeGaramond|Garamond)/i, "EB Garamond"],
  [/^DejaVuSans(?!Mono)/i, "Verdana"],
  [/^(?:CM(?:R|BX|TI|SL|CSC|B|U|BXTI|BXSL)\d|SF(?:RM|BX|TI|SL|CC|XC|BI)\d|LMRoman|KaTeX_Main|CMUSerif|mw[ab]_cm(?:r|bx|ti|sl)\d)/i, "Computer Modern"],
];

// What may follow a face's name in a font's: a foundry's suffix ("PSMT",
// "MT", "Std"), then a weight, a slant, or nothing. Anything else names
// another face (MerriweatherSans is no Merriweather).
const STYLE_TAIL = /^(?:PS|MT|Std|Pro|LT)*(?:$|[-,_ ]|Regular|Bold|Italic|Oblique|Light|Medium|Semi|Demi|Black|Heavy|Thin|Book|Roman)/i;

const letters = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
// The menu's faces, the longest name first (Roboto Mono before Roboto).
const MENU = DOCS_FONTS.map((f) => ({ name: f.name, key: letters(f.name) })).sort((a, b) => b.key.length - a.key.length);

// A CJK face sets every character at one width: MS Gothic read as monospace.
const CJK_SANS = /Gothic|SimHei|YaHei|ZenHei|HeiTi|DengXian|UDShinGo|Meiryo|Malgun|Dotum|Gulim|SansCJK|SourceHanSans/i;
const CJK_SERIF = /Mincho|SimSun|STSong|SongTi|宋|KaiTi|FangSong|MingLiU|Batang|Gungsuh|SerifCJK|SourceHanSerif/i;
const MONO = /Mono|Courier|Consol|Typewriter|^CMTT/i;
const SERIF = /Serif|Times|Garamond|Georgia|Palatino|Century|Schoolbook|Baskerville|Caslon|Bodoni|Didot|Minion|Utopia|Charter|Libertin|Cambria|Bookman/i;

/** A font's shape by its name, else by pdf.js's reading of its flags (its
    fallback name: "serif", "sans-serif", or "monospace"). */
export function fontShape(name: string, fallback?: string | null): Shape {
  if (CJK_SANS.test(name)) return "sans";
  if (CJK_SERIF.test(name)) return "serif";
  if (MONO.test(name) || fallback === "monospace") return "mono";
  if (fallback === "serif") return "serif";
  if (fallback === "sans-serif") return "sans";
  return SERIF.test(name) ? "serif" : "sans";
}

const cache = new Map<string, string>();

/** The page editor's face for a PDF font: its name without the subset
    prefix ("TimesNewRomanPS-BoldMT") and pdf.js's fallback name. */
export function faceOf(name: string, fallback?: string | null): string {
  const key = `${name}|${fallback ?? ""}`;
  let face = cache.get(key);
  if (face === undefined) {
    face = menuFace(name) ?? ALIASES.find(([re]) => re.test(name))?.[1] ?? BY_SHAPE[fontShape(name, fallback)];
    cache.set(key, face);
  }
  return face;
}

// The menu's face a font's name spells, followed by no other word.
function menuFace(name: string): string | null {
  const squeezed = letters(name);
  for (const face of MENU) {
    if (!squeezed.startsWith(face.key)) continue;
    // Past the face's letters in the name as written ("PlayfairDisplay-Bold").
    let seen = 0;
    let at = 0;
    while (at < name.length && seen < face.key.length) {
      if (/[\p{L}\p{N}]/u.test(name[at])) seen++;
      at++;
    }
    if (STYLE_TAIL.test(name.slice(at))) return face.name;
  }
  return null;
}
