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

// Faces by another name: metric twins, a producer's name for a face, a math
// face for its text face (Cambria Math for Cambria), and TeX's fonts
// (Computer Modern, its Type 1 and Latin Modern twins, KaTeX's copy, and the
// math and symbol fonts set with them). A formula's glyphs in another face
// than its words' split the letter-spaced runs a line joins, and "F(x)"
// read "F (x)". The first match wins.
const ALIASES: [RegExp, string][] = [
  [/^(?:Times|Tinos|LiberationSerif|NimbusRom|TeXGyreTermes|FreeSerif|STIX)/i, "Times New Roman"],
  [/^(?:Arial|Helvetica|Arimo|LiberationSans|NimbusSan|TeXGyreHeros|FreeSans)/i, "Arial"],
  [/^(?:Courier|Cousine|LiberationMono|NimbusMon|TeXGyreCursor|FreeMono)/i, "Courier New"],
  [/^(?:Calibri|Carlito)/i, "Calibri"],
  [/^(?:Cambria|Caladea)/i, "Cambria"],
  [/^(?:AGaramond|AdobeGaramond|Garamond)/i, "EB Garamond"],
  [/^DejaVuSans(?!Mono)/i, "Verdana"],
  [/^(?:CM(?:R|BX|TI|SL|CSC|B|U|BXTI|BXSL|MI|MIB|SY|BSY|EX)\d|SF(?:RM|BX|TI|SL|CC|XC|BI)\d|LMRoman|LMMath|LatinModern|KaTeX_|CMUSerif|mw[ab]_cm|MSAM\d|MSBM\d|EU[FS][MB]\d|RSFS\d|LASYB?\d|ESINT\d)/i, "Computer Modern"],
];

// What may follow a face's name in a font's: a foundry's suffix ("PSMT",
// "MT", "Std"), then a weight, a slant, or nothing. Anything else names
// another face (MerriweatherSans is no Merriweather).
const STYLE_TAIL = /^(?:PS|MT|Std|Pro|LT)*(?:$|[-,_ ]|Regular|Bold|Italic|Oblique|Light|Medium|Semi|Demi|Black|Heavy|Thin|Book|Roman)/i;

const letters = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
// The menu's faces, the longest name first (Roboto Mono before Roboto).
const MENU = DOCS_FONTS.map((f) => ({ name: f.name, key: letters(f.name) })).sort((a, b) => b.key.length - a.key.length);

// A CJK face sets every character at one width, and pdf.js names its shape
// monospace: MS Gothic, and a Japanese journal's Ryumin body, read as
// Courier New. Gothic, Hei, and Dotum faces are sans; Mincho, Song, Ming,
// Kai, and Batang faces serif.
const CJK_SANS =
  /Gothic|ShinGo|MidashiGo|FutoGo|KakuGo|KozGo|HiraKaku|HiraMaru|Jun\d|SimHei|YaHei|ZenHei|Heiti|STHei|DengXian|Meiryo|Malgun|Dotum|Gulim|SansCJK|SourceHanSans/i;
const CJK_SERIF =
  /Mincho|Ryumin|MidashiMin|FutoMin|HeiseiMin|KozMin|HiraMin|SimSun|STSong|SongTi|宋|MSung|KaiTi|FangSong|Ming(?:LiU|Std)|Batang|Gungsuh|Myeongjo|Myungjo|SerifCJK|SourceHanSerif/i;
const MONO = /Mono|Courier|Consol|Typewriter|^CMTT/i;
const SERIF = /Serif|Times|Garamond|Georgia|Palatino|Century|Schoolbook|Baskerville|Caslon|Bodoni|Didot|Minion|Utopia|Charter|Libertin|Cambria|Bookman/i;

/** A font's shape by its name, else by pdf.js's reading of its flags (its
    fallback name: "serif", "sans-serif", or "monospace"). cjk: the font
    sets CJK characters, and its one width says no monospace. */
export function fontShape(name: string, fallback?: string | null, cjk = false): Shape {
  if (CJK_SANS.test(name)) return "sans";
  if (CJK_SERIF.test(name)) return "serif";
  if (MONO.test(name) || (fallback === "monospace" && !cjk)) return "mono";
  if (fallback === "serif") return "serif";
  if (fallback === "sans-serif") return "sans";
  return SERIF.test(name) ? "serif" : "sans";
}

const cache = new Map<string, string>();

/** The page editor's face for a PDF font: its name without the subset
    prefix ("TimesNewRomanPS-BoldMT"), pdf.js's fallback name, and whether
    it sets CJK characters. */
export function faceOf(name: string, fallback?: string | null, cjk = false): string {
  const key = `${name}|${fallback ?? ""}|${cjk ? "cjk" : ""}`;
  let face = cache.get(key);
  if (face === undefined) {
    face = menuFace(name) ?? ALIASES.find(([re]) => re.test(name))?.[1] ?? BY_SHAPE[fontShape(name, fallback, cjk)];
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
