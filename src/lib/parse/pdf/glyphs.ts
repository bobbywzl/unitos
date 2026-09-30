// Glyphs and fonts: what a text item's string becomes (control characters
// dropped, radicals and spacing accents folded, a TeX math glyph read by its
// code) and what a font's name says (bold, italic, monospace, small caps,
// math, the TeX math family).

import type { Glyph } from "@/lib/parse/pdf/drawing";
import { isBbm, mathGlyph, openTypeGlyphs, sizeFontGlyph } from "@/lib/parse/pdf/math-fonts";
import type { Flags } from "@/lib/parse/pdf/types";

export const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
// Some generators map common CJK glyphs to the Kangxi Radicals and CJK
// Radicals Supplement blocks (⼴州 for 广州): the glyph looks right and a
// search for the word finds nothing. NFKC folds the Kangxi block; the
// supplement has no decompositions, so a table covers its common members.
const RADICAL_RE = /[\u2E80-\u2FDF]/g;
const RADICAL_MAP: Record<string, string> = {
  "⺁": "厂", "⺄": "乙", "⺈": "刀", "⺊": "卜", "⺌": "小", "⺍": "小", "⺕": "彐", "⺗": "心",
  "⺘": "手", "⺙": "攴", "⺛": "无", "⺜": "日", "⺝": "月", "⺟": "母", "⺠": "民", "⺡": "水",
  "⺢": "水", "⺣": "火", "⺤": "爪", "⺥": "爪", "⺦": "爿", "⺧": "牛", "⺨": "犬", "⺩": "玉",
  "⺪": "疋", "⺫": "网", "⺬": "示", "⺭": "示", "⺮": "竹", "⺯": "糸", "⺰": "纟", "⺱": "网",
  "⺲": "网", "⺳": "网", "⺶": "羊", "⺷": "羊", "⺸": "羊", "⺹": "老", "⺺": "耒", "⺻": "聿",
  "⺼": "肉", "⺽": "臼", "⺾": "艸", "⺿": "艸", "⻀": "艸", "⻁": "虎", "⻂": "衣", "⻃": "西",
  "⻄": "西", "⻅": "见", "⻆": "角", "⻇": "角", "⻈": "讠", "⻉": "贝", "⻊": "足", "⻋": "车",
  "⻌": "辶", "⻍": "辶", "⻎": "辶", "⻏": "邑", "⻐": "钅", "⻑": "长", "⻒": "长", "⻓": "长",
  "⻔": "门", "⻕": "阜", "⻖": "阜", "⻗": "雨", "⻘": "青", "⻙": "韦", "⻚": "页", "⻛": "风",
  "⻜": "飞", "⻝": "食", "⻞": "食", "⻟": "饣", "⻠": "饣", "⻡": "首", "⻢": "马", "⻣": "骨",
  "⻤": "鬼", "⻥": "鱼", "⻦": "鸟", "⻧": "卤", "⻨": "麦", "⻩": "黄", "⻪": "黾", "⻫": "斉",
  "⻬": "齐", "⻭": "齿", "⻮": "齿", "⻯": "竜", "⻰": "龙", "⻱": "龟", "⻲": "龟", "⻳": "龟",
};
// What normalizeGlyphs changes; most strings hold none of it.
const NORMALIZED_RE = /[\u2E80-\u2FDF\u2012¨´`ˆ˜ˇ¸˚˝¯˘˙]/;
export function normalizeGlyphs(str: string): string {
  if (!NORMALIZED_RE.test(str)) return str;
  return str
    .replace(RADICAL_RE, (ch) => RADICAL_MAP[ch] ?? ch.normalize("NFKC"))
    .replace(/\u2012/g, "\u2013")
    .replace(/([¨´`ˆ˜ˇ¸˚˝¯˘˙])(\p{L})/gu, (_, accent: string, letter: string) =>
      (letter + SPACING_ACCENTS[accent]).normalize("NFC"),
    );
}
// A spacing accent drawn as its own glyph before the base letter (LaTeX's
// \"u): composed with the letter it overlaps.
export const SPACING_ACCENTS: Record<string, string> = {
  "¨": "\u0308", "´": "\u0301", "`": "\u0300", "ˆ": "\u0302", "^": "\u0302", "˜": "\u0303",
  "~": "\u0303", "ˇ": "\u030C", "¸": "\u0327", "˚": "\u030A", "˝": "\u030B", "¯": "\u0304",
  "˘": "\u0306", "˙": "\u0307",
};

// ── Font flags ──────────────────────────────────────────────────────────────

export type FontFlags = Omit<Flags, "href"> & { math: boolean };

// Adobe's names run weight and shape together after the family, abbreviated:
// "Bd" bold, "Blk" black, "It" italic, "Obl" oblique ("HelveticaNeueLTStd-
// BdIt", "MyriadPro-SemiboldSemiCnIt", "FormataOTFMdIt", "HelveticaLTStd-
// Obl"). The W-9's bold and italic, MMWR's italic, and PLOS's formulas'
// letters read as plain.
const ADOBE_BOLD_RE = /(?:^|[-a-z])(?:Bd|Blk)(?:Cn|SemiCn|It|Obl)*$/;
const ADOBE_ITALIC_RE = /(?:^|[-a-z])(?:It|Obl)$/;

export function fontFlags(name: string | null): FontFlags {
  const n = (name ?? "").replace(/^[A-Z]{6}\+/, ""); // subset prefix "HAAAAA+"
  const family = mathFamily(n);
  return {
    // Computer Modern (CMBX, CMTI, CMTT), Nimbus (-Medi, -ReguItal) and Latin
    // Modern names carry weight and shape in abbreviations, not words, and
    // so do Libertine's and Biolinum's (acmart: LinLibertineTB bold,
    // LinLibertineTI italic; a paper's 986 bold and 254 italic characters
    // read as plain), and Adobe's.
    bold:
      /bold|black|heavy|semi ?bold|demi|medi(?:ital|obli)?$|^CMBX|^CMB\d|^CMSSBX|^CMBSY|^LM(?:Roman|Sans|Mono)\d*-Bold|^Lin(?:Libertine|Biolinum)T[BZ]I?$/i.test(n) ||
      ADOBE_BOLD_RE.test(n),
    italic:
      /italic|oblique|ital$|obli$|^CMTI|^CMSL|^CMBXTI|^CMSSI|^CMITT|^CMSLTT|slanted|^Lin(?:Libertine|Biolinum)T[BZ]?I$/i.test(n) || ADOBE_ITALIC_RE.test(n),
    mono: /mono|courier|consolas|menlo|typewriter|^CMTT|^CMSLTT|^CMITT|cursor/i.test(n),
    // A small-caps font draws lowercase letters as small capitals; the text
    // layer gives them lowercase. Computer Modern's CMCSC, its T1 twins SFCC
    // and SFXC, Latin Modern's LMRomanCaps, and "-SC" or ".sc" names (an
    // amsbook sets its theorem labels in CMCSC10: they read as plain words).
    // "Caps" ends a word in the name: PTSans-Caption is no small caps,
    // and neither is NotoSansSC (Simplified Chinese).
    smallCaps: /^CMCSC|^SFCC|^SFXC|SmallCaps|Caps(?![a-z])|-SC$|\.sc$/i.test(n),
    // Math fonts by name: TeX's math families, the other TeX math fonts, an
    // OpenType math font ("Math" in its name), and Adobe's Symbol. The word
    // "Symbol" alone says nothing: Segoe UI Symbol draws a Word form's
    // checkboxes, and its lines read as equations (census class 12).
    math: (family !== null && family !== "ot1") || /^(stmary|wasy)|Math|^Symbol(MT)?$/i.test(n),
  };
}

// ── Symbol fonts ────────────────────────────────────────────────────────────
// A symbol font with no Unicode map: pdf.js reads each code as the letter
// of its number (a slide's Wingdings bullets ➢ and ✓ read "Ø" and "ü", and
// their lists were lost; a paper's ✉ in MarVoSym read "B"; Nature's
// "(v′ = 0)" in Advent's math symbols read "ðv0 = 0Þ") or as a private-use
// character U+F000 past it (a newsletter's end mark ■ in Wingdings, a
// report's α in Symbol). The code names the symbol each font draws.

type SymbolFont = "symbol" | "wingdings" | "dingbats" | "marvosym" | "advent";
const SYMBOL_FONTS: [RegExp, SymbolFont][] = [
  [/^(?:Symbol(?:MT)?|StandardSym(?:L|bolsPS))$/i, "symbol"],
  [/^Wingdings(?:-Regular)?$/i, "wingdings"],
  [/^(?:ITC)?(?:Zapf)?Dingbats$/i, "dingbats"],
  [/^MarVoSym$/i, "marvosym"],
  [/^AdvMacMthSy/i, "advent"],
];

/** The symbol font a font's name (its subset prefix removed) names. */
export function symbolFont(base: string): SymbolFont | null {
  return SYMBOL_FONTS.find(([re]) => re.test(base))?.[1] ?? null;
}

// Adobe's Symbol, codes 0x20–0x7E and 0xA0–0xFE; "\0" is no character.
const SYMBOL_CHARS = Array.from(
  " !∀#∃%&∋()∗+,−./0123456789:;<=>?≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_‾αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼" +
    "€ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…⏐⎯↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓◊⟨®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪\0⟩∫⌠⎮⌡⎞⎟⎠⎤⎥⎦⎫⎬⎭",
);
// Wingdings, codes 0x20–0xFF. Where a common character draws the same
// shape, it stands for the later Unicode twin: ➢ for the arrowhead bullet,
// ✓ for the check, ☐ for the empty box, → for the arrows.
const WINGDINGS_CHARS = Array.from(
  " ✏✂✁👓🔔📖🕯☎✆✉🖃📪📫📬📭📁📂📄🗏🗐🗄⌛🖮🖰🖲🖳🖴🖫🖬✇✍" +
  "🖎✌👌👍👎☜☞☝☟🖐☺😐☹💣☠🏳🏱✈☼💧❄🕆✞🕈✠✡☪☯ॐ☸♈♉" +
  "♊♋♌♍♎♏♐♑♒♓🙰🙵●❍■□◻❑❒⬧⧫◆❖⬥⌧⮹⌘🏵🏶🙶🙷\0" +
  "⓪①②③④⑤⑥⑦⑧⑨⑩⓿❶❷❸❹❺❻❼❽❾❿🙢🙠🙡🙣🙞🙜🙝🙟·•" +
  "▪○◯◯◉◎◯▪☐\0✦★✶✴✹✵⯐⌖⟡⌑⯑✪✰🕐🕑🕒🕓🕔🕕🕖🕗🕘" +
  "🕙🕚🕛⮰⮱⮲⮳⮴⮵⮶⮷🙪🙫🙕🙔🙗🙖🙐🙑🙒🙓⌫⌦⮘➢⮙⮛⮈⮊⮉⮋←" +
  "→↑↓↖↗↙↘⬅➔⬆⬇⬉⬈⬋⬊⇦⇨⇧⇩⬄⇳⬀⬁⬃⬂🢬🢭✗✓☒☑\0",
);
// MarVoSym: \Letter.
const MARVOSYM_CHARS: Record<number, string> = { 0x42: "✉" };
// Advent 3B2's math symbols, the codes seen drawn: the prime, the angle
// brackets, the bar, and the parentheses.
const ADVENT_CHARS: Record<number, string> = { 0x30: "′", 0x68: "⟨", 0x69: "⟩", 0x6a: "|", 0xde: ")", 0xf0: "(" };
// ZapfDingbats: runs of the Dingbats block, and the symbols Unicode had
// coded before it.
const DINGBATS_CHARS: Record<number, string> = {
  0x25: "☎", 0x2a: "☛", 0x2b: "☞", 0x48: "★", 0x6c: "●", 0x6e: "■", 0x73: "▲", 0x74: "▼", 0x75: "◆", 0x77: "◗",
  0xa8: "♣", 0xa9: "♦", 0xaa: "♥", 0xab: "♠", 0xd5: "→", 0xd6: "↔", 0xd7: "↕",
};
function dingbat(code: number): string | undefined {
  const at = (first: number, start: number) => String.fromCodePoint(start + code - first);
  if (DINGBATS_CHARS[code]) return DINGBATS_CHARS[code];
  if (code >= 0x21 && code <= 0x7e) return at(0x20, 0x2700);
  if (code >= 0xa1 && code <= 0xa7) return at(0xa0, 0x2760);
  if (code >= 0xac && code <= 0xb5) return at(0xac, 0x2460);
  if (code >= 0xb6 && code <= 0xd4) return at(0xb6, 0x2776);
  if (code >= 0xd8 && code <= 0xef) return at(0xd8, 0x2798);
  if (code >= 0xf1 && code <= 0xfe) return at(0xf1, 0x27b1);
  return undefined;
}

function symbolChar(font: SymbolFont, code: number): string | undefined {
  let ch: string | undefined;
  if (font === "symbol") ch = code >= 0x20 && code <= 0x7e ? SYMBOL_CHARS[code - 0x20] : code >= 0xa0 ? SYMBOL_CHARS[code - 0xa0 + 95] : undefined;
  else if (font === "wingdings") ch = code >= 0x20 ? WINGDINGS_CHARS[code - 0x20] : undefined;
  else if (font === "dingbats") ch = dingbat(code);
  else if (font === "advent") ch = ADVENT_CHARS[code];
  else ch = MARVOSYM_CHARS[code];
  return ch && ch !== "\0" ? ch : undefined;
}

// Windows' letters at codes 0x80–0x9F, as pdf.js reads them.
const WIN_ANSI_HIGH = Array.from("€\0‚ƒ„…†‡ˆ‰Š‹Œ\0Ž\0\0‘’“”•–—˜™š›œ\0žŸ");
// A glyph pdf.js read as its code's letter or a private-use character.
const readAsCode = (g: Glyph) =>
  g.unicode === String.fromCharCode(g.code) ||
  g.unicode === String.fromCharCode(0xf000 + g.code) ||
  (g.code >= 0x80 && g.code < 0xa0 && g.unicode === WIN_ANSI_HIGH[g.code - 0x80]);

// The code a character stands for where it reads the code, not the
// symbol: a private-use character U+F000 past it; a Latin-1 letter in a
// font that draws no letters (a subset's own map wrote a Wingdings
// arrowhead, code 0x21 in the subset, as "Ø", its code in the whole font)
// and a Latin letter in Symbol, which draws Greek ones; any other where a
// glyph shows pdf.js read its code so (read).
function codeOf(ch: string, font: SymbolFont, read: Set<string>): number | null {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0xf020 && cp <= 0xf0ff) return cp - 0xf000;
  if (cp > 0x20 && cp <= 0xff) return font !== "symbol" || /[A-Za-z]/.test(ch) || read.has(ch) ? cp : null;
  const high = WIN_ANSI_HIGH.indexOf(ch);
  return high >= 0 && read.has(ch) ? 0x80 + high : null;
}

/** A symbol font's text as the page draws it: each character that reads
    the font's code becomes the symbol the font draws at that code. A
    character a Unicode map read stays. glyphs: the item's glyphs. */
export function symbolText(font: SymbolFont, str: string, glyphs: Glyph[] | undefined): string {
  const read = new Set((glyphs ?? []).filter(readAsCode).map((g) => g.unicode));
  return Array.from(str, (ch) => {
    const code = codeOf(ch, font, read);
    return (code !== null ? symbolChar(font, code) : undefined) ?? ch;
  }).join("");
}

// ── Math families ───────────────────────────────────────────────────────────
// TeX's math fonts keep one layout of character codes per family, whatever
// the size or the producer: the code names the symbol (math-fonts.ts). The
// family comes from the font's name. OT1 is Computer Modern's text layout,
// which math uses for digits, + = ( ), and upright Greek capitals; the
// typewriter and small-caps fonts change some of its codes, so they are not
// in it, and neither is Latin Modern, whose codes follow the PDF's encoding.

export type MathFamily = "oml" | "oms" | "omx" | "msa" | "msb" | "euf" | "rsfs" | "lasy" | "esint" | "ot1";

const FAMILIES: [RegExp, MathFamily][] = [
  // MathDesign's math italic and symbols, and Belleek's extension font
  // (MathTime's free twin), keep TeX's codes: arXiv 2506.06352's ≻ and ⊂,
  // IEEE Access's braces drawn in pieces.
  [/^(CMMIB?\d|LMMathItalic|MathDesign-.+-MathItalic-)/i, "oml"],
  [/^(CMB?SY\d|LMMathSymbols|MathDesign-.+-Symbol-\d)/i, "oms"],
  [/^(CMEX\d|LMMathExtension|BLEX$)/i, "omx"],
  [/^MSAM\d/i, "msa"],
  [/^MSBM\d/i, "msb"],
  [/^EUF[MB]\d/i, "euf"],
  [/^RSFS\d/i, "rsfs"],
  [/^LASYB?\d/i, "lasy"],
  [/^ESINT\d/i, "esint"],
  [/^CM(R|BX|TI|SS|SSBX|SSI|SL|BXTI)\d/i, "ot1"],
];

// The family of a font by its name, the subset prefix removed ("CMMI10").
export function mathFamily(base: string): MathFamily | null {
  for (const [re, family] of FAMILIES) if (re.test(base)) return family;
  return null;
}

// The alphabet a math glyph is set in where its font's name does not say
// it: \boldsymbol (bold math italic), \mathbf, \mathsf, \mathtt.
export type MathVariant = "bold" | "bf" | "sf" | "tt";

// ── Math fonts set in Unicode ───────────────────────────────────────────────
// KaTeX's fonts (a web page printed from Chromium) and OpenType math fonts
// (Latin Modern Math and STIX Two Math from LuaLaTeX, Cambria Math from
// Word) carry Unicode maps: the text layer reads them right, but their codes
// are glyph ids, so nothing read their glyphs as math (synth-math-html: 60
// of 70 displays crops, its inline formulas words). Each such glyph takes
// the TeX family and code of the same symbol, so the zones, the layout, and
// the check read it as they read TeX's. A glyph of a size font or a size
// variant keeps its own box: KaTeX and OpenType stand a big ∑ on the
// baseline, where TeX's extension font hangs it from its origin.

type UnicodeFont =
  | { kind: "katex"; face: string; style: string }
  | { kind: "opentype"; name: string }
  | { kind: "size"; name: string }
  | { kind: "tex"; italic: boolean; bullets: boolean; unread: boolean; blackboard: boolean }
  | null;

// Math fonts whose text layer reads right but whose codes follow no TeX
// family throughout: STIX's first fonts (OpenStax), newtxmath's and
// Libertine's (acmart), MathTime's (IEEE Access, Springer), MnSymbol and
// Euler (PLOS), and OpenSymbol (LibreOffice Math). Their formulas read as
// words: 23 of arXiv 2609.29669's 30 inline formulas, and all 31 of the
// Math Guide's table of operators. Each glyph reads by its character, as
// an OpenType math font's does; a letter of an italic one is math italic.
// OpenSymbol also draws a list's bullets and dashes: those are no math.
// MathTime's extension font (MTEX) numbers its glyphs anew in each PDF
// (Springer's ∑ at 0x08): each is a big operator, a sized delimiter, or a
// piece, and stays unread. So does each glyph of MathDesign's symbol fonts
// A and B, whose layouts the tables lack, but for font A's capitals at
// their own codes, which are \mathbb's: the text layer reads them as "O"
// and "R" (arXiv 2506.06352's u: 𝕆 → ℝ).
const UNICODE_TEX_RE =
  /^(STIXGeneral|STIXNonUnicode|STIXVariants|LibertineMath|NewTXB?MI|txmia|txsy|MTMI|MTSY|RMTMI|MTEX|MnSymbol|EURM|OpenSymbol|MathDesign-.+-MathDesignSymbol[AB]-)/;
const ITALIC_MATH_RE = /Italic|MI(B|\d)*$|txmia|MathMI|^EURM/;
// STIX's first fonts set a formula's sized delimiters, big operators, and
// the pieces of tall delimiters in five size fonts: each glyph reads by the
// size font tables, its box its own (OpenStax's f(x) with its tall
// parentheses read as a picture).
const STIX_SIZE_RE = /^STIXSize(One|Two|Three|Four|Five)Sym-Regular$/;

// OpenType math fonts by name (Latin Modern's Type 1 math fonts are TeX's
// own families; MathDesign's are 8-bit TeX encodings).
const OPENTYPE_MATH_RE =
  /^(CambriaMath|Cambria-Math|STIX(Two)?Math|XITS-?Math|LatinModernMath|TeXGyre\w*Math|LibertinusMath|FiraMath|NewCMMath|NewComputerModernMath|DejaVuMathTeXGyre|Asana-?Math|GaramondMath|KpMath|Erewhon-?Math|LucidaBrightMath)/i;
const fontKinds = new Map<string, UnicodeFont>();
function unicodeFont(base: string): UnicodeFont {
  let kind = fontKinds.get(base);
  if (kind === undefined) {
    const katex = /^KaTeX_(\w+)-(\w+)$/.exec(base);
    kind = katex
      ? { kind: "katex", face: katex[1], style: katex[2] }
      : OPENTYPE_MATH_RE.test(base)
        ? { kind: "opentype", name: base }
        : STIX_SIZE_RE.test(base)
          ? { kind: "size", name: base }
          : UNICODE_TEX_RE.test(base)
            ? {
                kind: "tex",
                italic: ITALIC_MATH_RE.test(base),
                bullets: /^OpenSymbol/.test(base),
                unread: /^MTEX|MathDesignSymbol/.test(base),
                blackboard: /MathDesignSymbolA/.test(base),
              }
            : null;
    fontKinds.set(base, kind);
  }
  return kind;
}

/** A font that sets nothing but formulas: KaTeX's, an OpenType math font. */
export function isUnicodeMathFont(base: string): boolean {
  return unicodeFont(base) !== null;
}

/** One of KaTeX's fonts: KaTeX sets a formula a fifth larger than the
    prose around it (an OpenType math font sets it at the prose's size). */
export function isKatexFont(base: string): boolean {
  return unicodeFont(base)?.kind === "katex";
}

// Every TeX glyph by its character, the families in the order a character
// several families draw is read by (upright text first: "(" is the text
// font's, not a sized delimiter's; \mathcal before \mathscr).
const FAMILY_ORDER: MathFamily[] = ["ot1", "oml", "oms", "msa", "msb", "lasy", "omx", "esint", "euf", "rsfs"];
let byChar: Map<string, [MathFamily, number][]> | null = null;
function texGlyphsOf(char: string): [MathFamily, number][] {
  if (!byChar) {
    byChar = new Map();
    for (const family of FAMILY_ORDER) {
      for (let code = 0; code < 0x200; code++) {
        const entry = mathGlyph(family, code);
        if (!entry || !entry.unicode || entry.cls === "piece") continue;
        const list = byChar.get(entry.unicode) ?? [];
        list.push([family, code]);
        byChar.set(entry.unicode, list);
      }
    }
  }
  return byChar.get(char) ?? [];
}

// Characters these fonts draw that TeX's tables spell otherwise: a spacing
// accent for TeX's accent, KaTeX's \not (a private-use glyph), the math
// slash, and the operators Unicode names apart from their look-alikes.
const SAME: Record<string, [MathFamily, number]> = {
  "^": ["ot1", 0x5e], "ˆ": ["ot1", 0x5e], "ˉ": ["ot1", 0x16], "¯": ["ot1", 0x16], "~": ["ot1", 0x7e], "˜": ["ot1", 0x7e],
  "˙": ["ot1", 0x5f], "¨": ["ot1", 0x7f], "´": ["ot1", 0x13], "ˊ": ["ot1", 0x13], "`": ["ot1", 0x12], "ˋ": ["ot1", 0x12],
  "˘": ["ot1", 0x15], "ˇ": ["ot1", 0x14], "˚": ["ot1", 0x17], "": ["oms", 0x36], "/": ["oml", 0x3d],
  "⋅": ["oms", 0x01], "∘": ["oms", 0x0e], "∙": ["oms", 0x0f], "∣": ["oms", 0x6a], "∖": ["oms", 0x6e],
};

// Unicode's mathematical alphanumerics (U+1D400…): the first code of each
// alphabet of Latin letters (A–Z, a–z), of Greek (Α–Ω, α–ω, and symbols),
// and of digits, and how TeX sets it. The letters Unicode had coded before
// (ℎ ℝ ℭ ℬ) are the holes the tables and NFKC cover.
type Style = { family: MathFamily; variant?: MathVariant };
const ITALIC: Style = { family: "oml" };
const BOLD_ITALIC: Style = { family: "oml", variant: "bold" };
const ALPHABETS: [number, number, Style][] = [
  [0x1d400, 52, { family: "ot1", variant: "bf" }],
  [0x1d434, 52, ITALIC],
  [0x1d468, 52, BOLD_ITALIC],
  [0x1d5a0, 52, { family: "ot1", variant: "sf" }],
  [0x1d5d4, 52, { family: "ot1", variant: "sf" }],
  [0x1d608, 52, { family: "ot1", variant: "sf" }],
  [0x1d63c, 52, { family: "ot1", variant: "sf" }],
  [0x1d670, 52, { family: "ot1", variant: "tt" }],
  [0x1d6a8, 58, { family: "ot1", variant: "bf" }],
  [0x1d6e2, 58, ITALIC],
  [0x1d71c, 58, BOLD_ITALIC],
  [0x1d756, 58, BOLD_ITALIC],
  [0x1d790, 58, BOLD_ITALIC],
  [0x1d7ce, 10, { family: "ot1", variant: "bf" }],
  [0x1d7e2, 10, { family: "ot1", variant: "sf" }],
  [0x1d7ec, 10, { family: "ot1", variant: "sf" }],
  [0x1d7f6, 10, { family: "ot1", variant: "tt" }],
];

type Tex = { family: MathFamily; code: number; box?: [number, number]; variant?: MathVariant };

/** A character as TeX sets it: the first of families that draws it. */
function texOf(char: string, families: readonly MathFamily[], variant?: MathVariant): Tex | null {
  const same = SAME[char];
  if (same && families.includes(same[0])) return { family: same[0], code: same[1], variant };
  for (const family of families) {
    const hit = texGlyphsOf(char).find(([f]) => f === family);
    if (hit) return { family, code: hit[1], variant };
  }
  return null;
}

/** A character of an OpenType math font: a mathematical alphanumeric by
    its alphabet, anything else as TeX's tables name it. */
function openTypeChar(char: string): Tex | null {
  const cp = char.codePointAt(0) ?? 0;
  const alphabet = ALPHABETS.find(([start, count]) => cp >= start && cp < start + count);
  const letter = char.normalize("NFKC");
  if (alphabet) {
    const { family, variant } = alphabet[2];
    // Upright bold Greek has no TeX font: its small letters are \boldsymbol's.
    if (family === "ot1" && !/[A-Za-z0-9]/.test(letter) && !texOf(letter, ["ot1"])) return texOf(letter, ["oml"], "bold");
    return texOf(letter, [family], variant);
  }
  if (cp === 0x210e) return texOf("h", ["oml"]); // ℎ, the italic h
  return texOf(char, FAMILY_ORDER);
}

/** A character of a math font of TeX's world read by its character
    (UNICODE_TEX_RE). Its big operators, sized delimiters, and pieces stay
    unread: their boxes are the font's own, which no table holds, and a
    limit placed by a wrong box reads as a script (the formula fails). An
    en dash in a math font is a minus (OpenStax's "x – μ"); OpenSymbol's
    bullet and dash are a list's. */
function texWorldChar(char: string, italic: boolean, bullets: boolean): Tex | null {
  if (bullets && /^[•–—…‰·]$/.test(char)) return null;
  if (char === "–") return { family: "oms", code: 0x00 };
  // The micro sign is μ.
  const c = char.normalize("NFKC");
  const letter = /^([A-Za-z]|\p{Script=Greek})$/u.test(c);
  const tex = (italic && letter ? texOf(c, ["oml"]) : null) ?? openTypeChar(c);
  return tex?.family === "omx" ? null : tex;
}

/** A glyph of an OpenType math font whose character has sizes (a
    delimiter, a big operator, a radical): LuaLaTeX's code is the glyph id;
    another producer's glyph tells itself by its advance. */
function openTypeSized(g: Glyph, font: string): Tex | null | undefined {
  const rows = openTypeGlyphs(font, g.unicode);
  if (!rows || rows.length === 0) return undefined;
  const advance = g.w / g.size;
  const row =
    rows.find((r) => r.gid === g.code) ??
    rows.filter((r) => Math.abs(r.advance - advance) < 0.01).sort((a, b) => Math.abs(a.advance - advance) - Math.abs(b.advance - advance))[0];
  return row ? { family: row.family, code: row.code, box: row.box } : null;
}

// KaTeX's faces: the families their characters are read in, and the
// alphabet a face sets (KaTeX_Main-Bold is \mathbf, KaTeX_Math-BoldItalic
// \boldsymbol). A letter of the AMS face is blackboard bold, of the
// Caligraphic, Fraktur, and Script faces their alphabets, at its own code.
function katexChar(char: string, face: string, style: string): Tex | null {
  const bold = /Bold/.test(style);
  const ascii = /^[A-Za-z0-9]$/.test(char) ? char.charCodeAt(0) : null;
  switch (face) {
    case "Main":
      return texOf(char, /Italic/.test(style) && ascii !== null ? ["oml"] : ["ot1", "oms", "oml", "lasy"], bold ? "bf" : undefined);
    case "Math":
      return texOf(char, ["oml"], bold ? "bold" : undefined);
    case "AMS":
      return ascii !== null && /[A-Z]/.test(char) ? { family: "msb", code: ascii } : texOf(char, ["msa", "msb", "oms", "ot1"]);
    case "Caligraphic":
      return ascii !== null && /[A-Z]/.test(char) ? { family: "oms", code: ascii, variant: bold ? "bold" : undefined } : null;
    case "Fraktur":
      return ascii !== null && /[A-Za-z]/.test(char) ? { family: "euf", code: ascii, variant: bold ? "bold" : undefined } : null;
    case "Script":
      return ascii !== null && /[A-Z]/.test(char) ? { family: "rsfs", code: ascii } : null;
    case "SansSerif":
    case "Typewriter":
      return ascii !== null ? { family: "ot1", code: ascii, variant: face === "Typewriter" ? "tt" : "sf" } : texOf(char, ["ot1"]);
    default: {
      const sized = /^Size\d$/.test(face) ? sizeFontGlyph(`${face}-${style}`, char) : null;
      return sized ? { family: sized.family, code: sized.code, box: sized.box } : null;
    }
  }
}

// TeX's text fonts under other names — Latin Modern (lmodern), cm-super
// (Computer Modern in T1), MathDesign's OT1 fonts — draw a formula's digits,
// + = ( ), and upright letters as CMR does, their codes in TeX's text layout
// (OT1, or T1, which shares OT1's letters, digits, and signs). A glyph whose
// code draws the same character in OT1 reads as CMR's. Read as any other
// text font, Latin Modern's "=" and digits ended every formula they stood
// in: arXiv 2506.06752's "k − 1" read "k −", and the "=" of each ⟹ failed 9
// of its 16 displays. A font a browser embeds under such a name numbers its
// glyphs otherwise (synth-notes-html's LMRoman10-Bold sets "P" at 0x53): it
// takes no family unless most of its glyphs agree.
const TEX_TEXT_RE = /^(LMRoman(?!Caps)|LMSans|SF(?:RM|BX|BI|TI|SL|SS|SX|SI)\d|MathDesign-.+-OT1-)/;
function texTextFonts(glyphs: Glyph[]) {
  const fonts = new Map<string, { agree: Glyph[]; count: number }>();
  for (const g of glyphs) {
    if (g.family !== null || g.unicode.trim() === "" || !TEX_TEXT_RE.test(g.base)) continue;
    let font = fonts.get(g.font);
    if (!font) fonts.set(g.font, (font = { agree: [], count: 0 }));
    font.count++;
    if (texOf(g.unicode, ["ot1"])?.code === g.code) font.agree.push(g);
  }
  for (const { agree, count } of fonts.values()) {
    if (agree.length < count * 0.8) continue;
    for (const g of agree) {
      g.family = "ot1";
      // The alphabet the name says, as CMSS and CMBX say it (layout.ts). A
      // leaning sans letter is a math letter: Beamer sets math in LMSans
      // Oblique ("w = 256", synth-slides-tex).
      if (/^(LMSans|SFS[SXI])/.test(g.base)) {
        if (!isItalicFont(g.base)) g.variant = "sf";
      } else if (/Bold|Demi|^SFB[XI]/.test(g.base)) g.variant = "bf";
    }
  }
}

/** A Type 3 font with no name: pdfTeX embeds a Metafont font so, as a
    bitmap. */
export const isUnnamedFont = (base: string) => /^Type3/i.test(base);

// bbm (\mathbbm) is a Metafont font of blackboard letters, and the text
// layer reads its letters as plain ones: arXiv 2410.04586's 𝕜 and ℕ read
// \mathrm{k} and \mathrm{N} in 24 formulas, a wrong formula the glyph check
// cannot see. A font with no name whose capitals and k have bbm's advances
// at one of its design sizes sets \mathbb (msbm's codes; its k is \Bbbk).
// Any other glyph of a font with no name is no text atom (layout.ts), so a
// formula that holds one fails.
function bbmLetters(glyphs: Glyph[]) {
  const fonts = new Map<string, Glyph[]>();
  for (const g of glyphs) {
    if (g.family !== null || !isUnnamedFont(g.base) || g.size <= 0 || !((g.code >= 0x41 && g.code <= 0x5a) || g.code === 0x6b)) continue;
    const list = fonts.get(g.font);
    if (list) list.push(g);
    else fonts.set(g.font, [g]);
  }
  for (const letters of fonts.values()) {
    if (!isBbm(letters.map((g) => ({ char: String.fromCharCode(g.code), advance: g.w / g.size })))) continue;
    for (const g of letters) {
      g.family = "msb";
      if (g.code === 0x6b) g.code = 0x7c;
    }
  }
}

/** A font's lean and weight by its name (fontFlags), read once a font: a
    formula's letter in an italic one is a math letter, not \mathrm, and in
    a bold one \mathbf (layout.ts). */
const looks = new Map<string, { italic: boolean; bold: boolean }>();
function fontLook(base: string): { italic: boolean; bold: boolean } {
  let look = looks.get(base);
  if (look === undefined) {
    const { italic, bold } = fontFlags(base);
    looks.set(base, (look = { italic, bold }));
  }
  return look;
}
export const isItalicFont = (base: string) => fontLook(base).italic;
export const isBoldFont = (base: string) => fontLook(base).bold;

/** The page's glyphs with each glyph of a math font set in Unicode given
    the TeX family and code of the same symbol (its own box where its font
    draws it otherwise, and its alphabet), and each glyph of a TeX text font
    under another name the family of CMR's (texTextFonts). A glyph no table
    knows keeps no family: a formula it is in fails the check. */
export function unicodeMath(glyphs: Glyph[]): Glyph[] {
  texTextFonts(glyphs);
  bbmLetters(glyphs);
  for (const g of glyphs) {
    if (g.family !== null) continue;
    const font = unicodeFont(g.base);
    if (!font || g.unicode.trim() === "" || g.size <= 0) continue;
    // Word maps some of Cambria Math's glyphs to their letter twice ("𝑝𝑝",
    // pdftotext too): one glyph is one letter. Read as two, it took no
    // family, and the NPS thesis's p_{00} read as a word before {}_{00}.
    const [first, second, ...more] = g.unicode;
    if (first === second && more.length === 0 && /\p{L}/u.test(first)) g.unicode = first;
    let tex: Tex | null | undefined;
    if (font.kind === "katex") tex = katexChar(g.unicode, font.face, font.style);
    else if (font.kind === "size") tex = sizeFontGlyph(font.name, g.unicode);
    else if (font.kind === "tex") {
      tex = font.blackboard && g.code >= 0x41 && g.code <= 0x5a ? { family: "msb", code: g.code } : font.unread ? null : texWorldChar(g.unicode, font.italic, font.bullets);
    }
    else {
      tex = openTypeSized(g, font.name);
      if (tex === undefined) tex = openTypeChar(g.unicode);
    }
    if (!tex) continue;
    g.family = tex.family;
    g.code = tex.code;
    if (tex.box) g.box = tex.box;
    if (tex.variant) g.variant = tex.variant;
  }
  // On a page whose math fonts set no Latin letter, a formula takes its
  // letters from the text's italic: MathDesign's from Utopia's (arXiv
  // 2506.06352's \mathcal{L}(t)), MathTime's from Times', LibreOffice's
  // from Liberation Serif's (the Math Guide's A∖B); and on one whose math
  // fonts set no digit, its digits from the text's font. Such a glyph may
  // join the math beside it (math/zones.ts). Where a math font sets them,
  // the text's are prose: a theorem's italic words, and a table's "53.4"
  // before its gain set in math (arXiv 2411.19946). A page with no glyph of
  // a math font has no formula to take them: its italic letters and its
  // digits are prose.
  if (!glyphs.some((g) => (g.family !== null && g.family !== "ot1") || isUnreadMath(g))) return glyphs;
  const latin = glyphs.some((g) => g.family === "oml" && /^[A-Za-z]$/.test(mathGlyph("oml", g.code)?.unicode ?? ""));
  const digits = glyphs.some((g) => g.family !== null && /^[0-9]$/.test(g.unicode));
  for (const g of glyphs) {
    if (g.family !== null) continue;
    if ((!latin && /^[A-Za-z]$/.test(g.unicode) && isItalicFont(g.base)) || (!digits && /^[0-9]$/.test(g.unicode))) textMath.add(g);
  }
  return glyphs;
}

/** A glyph of a math font read by its character that no table reads (a
    big operator, a sized delimiter, a piece of one: texWorldChar), or a
    glyph of a size font the tables lack: it is math, and the formula it
    stands in fails the check. Read as text, it
    cut its formula in two, and each half passed (Springer's matrices read
    "−1 1 0" as −11 0). OpenSymbol's bullets are no math. */
export function isUnreadMath(g: Glyph): boolean {
  const font = unicodeFont(g.base);
  if (font?.kind === "size") return g.unicode.trim() !== "";
  return font?.kind === "tex" && g.unicode.trim() !== "" && !(font.bullets && /^[•–—…‰·]$/.test(g.unicode));
}

const textMath = new WeakSet<Glyph>();
/** A text font's italic letter or digit on a page whose math fonts set
    none (unicodeMath): a formula's own where it stands against math. */
export const isTextMath = (g: Glyph) => textMath.has(g);

// A big operator or a radical: its glyph hangs from its origin, so a line
// places it by its center (lines.ts). The integrals after ∐ are esint's.
export const OPERATOR_GLYPH_RE = /^[∫∑∏⋃⋂⊎⋀⋁√⨄⨆⨀⨁⨂∮∐∬∭⨌∯⨖∳∲⨏]$/;

// The characters of a text, spaces aside, each counted once: a math letter
// past the Basic Multilingual Plane (𝒜, 𝔼) is two UTF-16 units, and counted
// by units it doubled a line's math share (a proof's last line read as an
// equation).
const SPACE_OR_PAIR_RE = /[\s\uD800-\uDBFF]/; // a text with neither counts its units
export function charCount(text: string): number {
  if (!SPACE_OR_PAIR_RE.test(text)) return text.length;
  const units = text.replace(/\s/g, "");
  return units.length - (units.match(/[\uD800-\uDBFF]/g)?.length ?? 0);
}

// ── Math glyphs by code ─────────────────────────────────────────────────────
// A TeX math glyph reads as its code names it, whatever the text layer says
// (P0-F memo §1.2: in a TeX PDF with no Unicode map ϵ is lost, ℓ reads as a
// backtick, ↦ as "7→", ≠ as "6=", and the big brackets as ⋃ and ⊎).
// TeX builds some symbols from two glyphs: they fuse into one character on
// the glyph that starts the symbol (memo §1.5, Appendix B), and a math
// accent joins the letter under it.

// A tall delimiter or radical is drawn in pieces: one of them reads as the
// delimiter, the others as nothing.
const PIECE_TEXT: Record<string, string> = {
  "lparen-top": "(",
  "rparen-top": ")",
  "lbrack-top": "[",
  "rbrack-top": "]",
  "lbrace-top": "{",
  "rbrace-top": "}",
  "radical-bot": "√",
};
type Code = [MathFamily, number];
const is = (g: Glyph, [family, code]: Code) => g.family === family && g.code === code;
// b on a's baseline (a twentieth of a's size), and at a's x too (an eighth).
const level = (a: Glyph, b: Glyph) => Math.abs(b.y - a.y) < a.size * 0.05;
const at = (a: Glyph, b: Glyph) => level(a, b) && Math.abs(b.x - a.x) < a.size * 0.12;
// Two glyphs TeX joins with a small overlap (\joinrel, 3mu) that are no
// arrow: \models, \bowtie.
const JOINED: [Code, Code, string][] = [
  [["oms", 0x6a], ["ot1", 0x3d], "⊨"],
  [["oml", 0x2e], ["oml", 0x2f], "⋈"],
];
// The pieces of a long arrow: a shaft (a minus, an equals sign — from a text
// font where Latin Modern sets it) and the heads and hooks. TeX overlaps
// them 3mu (\longrightarrow, \implies) or 7mu (\xleftarrow's fill).
type ArrowPiece = "shaft" | "left" | "right" | "Left" | "Right" | "lhook" | "rhook";
function arrowPiece(g: Glyph): ArrowPiece | null {
  if (is(g, ["oms", 0x00]) || is(g, ["ot1", 0x3d]) || (g.family === null && g.unicode === "=")) return "shaft";
  if (is(g, ["oms", 0x20])) return "left";
  if (is(g, ["oms", 0x21])) return "right";
  if (is(g, ["oms", 0x28])) return "Left";
  if (is(g, ["oms", 0x29])) return "Right";
  if (is(g, ["oml", 0x2c])) return "lhook";
  if (is(g, ["oml", 0x2d])) return "rhook";
  return null;
}
// The arrow a run of pieces draws, by its heads; null when it has none.
function arrowOf(pieces: ArrowPiece[]): string | null {
  const has = (p: ArrowPiece) => pieces.includes(p);
  if (has("lhook") && has("right")) return "↪";
  if (has("rhook") && has("left")) return "↩";
  if (has("Left") || has("Right")) return has("Left") && has("Right") ? "⟺" : has("Left") ? "⟸" : "⟹";
  if (has("left") || has("right")) return has("left") && has("right") ? "⟷" : has("left") ? "⟵" : "⟶";
  return null;
}

// Where a composite (↦, ⟹, ≠) a glyph reads as ends: its last part's end.
// ↦'s bar is 0 wide, and a line ending in ↦ ended 10 pt short of its
// column's edge. The glyphs keep their own boxes: the layout reads the
// parts by their overlap.
const compositeEnd = new WeakMap<Glyph, number>();

// The text of the page's glyphs where it is not the text layer's: every glyph
// of a math family, and the glyphs of a composite or an accented letter. A
// glyph that reads as nothing (a composite's second glyph, a placed accent)
// maps to "".
export function glyphTexts(glyphs: Glyph[]): Map<Glyph, string> {
  const texts = new Map<Glyph, string>();
  for (const g of glyphs) {
    if (g.family === null || g.family === "ot1") continue;
    const entry = mathGlyph(g.family, g.code);
    // A font read by its character reads as its text layer does: the
    // Math Guide's ∖ is no backslash, though TeX's code for both is one.
    // A blackboard capital the text layer reads as a plain one is \mathbb's.
    const font = unicodeFont(g.base);
    if (!entry || (font?.kind === "tex" && !font.blackboard)) texts.set(g, g.unicode.replace(CONTROL_CHARS_RE, ""));
    else texts.set(g, entry.cls === "piece" ? (PIECE_TEXT[entry.piece ?? ""] ?? "") : entry.unicode);
  }
  const textOf = (g: Glyph) => texts.get(g) ?? g.unicode;
  const entryOf = (g: Glyph) => (g.family === null ? null : mathGlyph(g.family, g.code));
  // Glyphs by baseline, 4 pt a bucket: a composite's glyphs sit within an em.
  // Built at the first question: most pages of prose never ask one.
  let buckets: Map<number, Glyph[]> | null = null;
  const around = (g: Glyph): Glyph[] => {
    if (!buckets) {
      buckets = new Map();
      for (const other of glyphs) {
        const key = Math.floor(other.y / 4);
        const list = buckets.get(key);
        if (list) list.push(other);
        else buckets.set(key, [other]);
      }
    }
    const out: Glyph[] = [];
    const reach = g.size * 1.3;
    for (let key = Math.floor((g.y - reach) / 4); key <= Math.floor((g.y + reach) / 4); key++) {
      for (const other of buckets.get(key) ?? []) if (other !== g) out.push(other);
    }
    return out;
  };
  const consumed = new Set<Glyph>();
  const inArrow = new Set<Glyph>();
  const fuse = (first: Glyph, text: string, rest: Glyph[]) => {
    texts.set(first, text);
    compositeEnd.set(first, Math.max(first.x + first.w, ...rest.map((g) => g.x + g.w)));
    for (const g of rest) {
      texts.set(g, "");
      consumed.add(g);
    }
  };
  const overlap = (a: Glyph, b: Glyph) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const center = (g: Glyph) => g.x + g.w / 2;
  // A tall bar (\Big|, \left\|) is one piece repeated down a column: the
  // lowest piece reads as the bar, the ones above it as nothing.
  for (const a of glyphs) {
    if (entryOf(a)?.piece !== "vrep") continue;
    const below = around(a).some(
      (b) => b.family === a.family && b.code === a.code && Math.abs(b.x - a.x) < a.size * 0.05 && a.y - b.y > 0 && a.y - b.y < a.size * 0.65,
    );
    if (below) texts.set(a, "");
  }
  for (const a of glyphs) {
    // A glyph of no math family takes part only as an arrow's shaft ("=").
    if (a.family === null && a.unicode !== "=") continue;
    const em = a.size;
    const entry = entryOf(a);
    if (entry?.piece === "not") {
      // \not: the slash over the relation at its x (≠ ∉ ≢ ⊄).
      const rel = around(a).find((b) => at(a, b) && entryOf(b)?.cls === "rel" && !consumed.has(b));
      if (rel) fuse(rel, (textOf(rel) + "\u0338").normalize("NFC"), [a]);
    } else if (is(a, ["oml", 0x3d])) {
      // \notin: the math slash drawn through ∈.
      const element = around(a).find((b) => level(a, b) && is(b, ["oms", 0x32]) && center(a) > b.x && center(a) < b.x + b.w);
      if (element) fuse(element, "∉", [a]);
    } else if (entry?.piece === "mapstochar") {
      // \mapsto: the bar at the arrow's x; \longmapsto: the bar, a minus,
      // and the arrow joined to it.
      const near = around(a);
      const arrow = near.find((b) => at(a, b) && is(b, ["oms", 0x21]));
      const minus = near.find((b) => at(a, b) && is(b, ["oms", 0x00]));
      const long = minus && near.find((b) => level(a, b) && is(b, ["oms", 0x21]) && b.x > minus.x && overlap(minus, b) > em * 0.05);
      if (arrow) fuse(a, "↦", [arrow]);
      else if (minus && long) fuse(a, "⟼", [minus, long]);
    } else if (is(a, ["msa", 0x4b]) || is(a, ["msa", 0x4c])) {
      // \dashrightarrow and \dashleftarrow: dash pieces abutting an arrowhead.
      const right = is(a, ["msa", 0x4b]);
      const dashes: Glyph[] = [];
      let edge = right ? a.x : a.x + a.w;
      for (;;) {
        const dash = around(a).find(
          (b) => level(a, b) && is(b, ["msa", 0x39]) && !dashes.includes(b) && Math.abs((right ? b.x + b.w : b.x) - edge) < em * 0.05,
        );
        if (!dash) break;
        dashes.push(dash);
        edge = right ? dash.x : dash.x + dash.w;
      }
      if (dashes.length > 0) fuse(right ? dashes[dashes.length - 1] : a, right ? "⇢" : "⇠", right ? [...dashes.slice(0, -1), a] : dashes);
    } else if (is(a, ["oms", 0x18]) || is(a, ["oml", 0x3a])) {
      // \cong: ∼ over =; \doteq: a dot over =.
      const cong = is(a, ["oms", 0x18]);
      const equals = around(a).find((b) => {
        const rise = (a.y - b.y) / em;
        return (
          is(b, ["ot1", 0x3d]) &&
          a.size >= b.size * 0.85 &&
          (cong ? Math.abs(b.x - a.x) < em * 0.12 && rise > 0.15 && rise < 0.45 : center(a) > b.x && center(a) < b.x + b.w && rise > 0.4 && rise < 0.75)
        );
      });
      if (equals) fuse(equals, cong ? "≅" : "≐", [a]);
    }
    for (const [left, right, text] of JOINED) {
      if (!is(a, left) || consumed.has(a)) continue;
      const b = around(a).find(
        (g) => level(a, g) && is(g, right) && !consumed.has(g) && g.x > a.x && overlap(a, g) > em * 0.08 && overlap(a, g) < em * 0.3,
      );
      if (b) fuse(a, text, [b]);
    }
    // A long arrow: pieces on one baseline that overlap, one after another —
    // \implies overlaps "=" and "⇒" by 3mu, \xrightarrow draws its minus
    // under the arrow (arXiv 2506.06752: 14 \implies read "=⇒"; 2410.04586's
    // \xleftarrow "←−−−−−−−−"). The arrow sits on the run's leftmost piece.
    if (arrowPiece(a) && !consumed.has(a) && !inArrow.has(a)) {
      const run = [a];
      for (let k = 0; k < run.length; k++) {
        const p = run[k];
        for (const q of around(p)) {
          if (run.includes(q) || consumed.has(q) || !arrowPiece(q) || Math.abs(q.y - a.y) >= em * 0.05) continue;
          if (overlap(p, q) > em * 0.05) run.push(q);
        }
      }
      for (const g of run) inArrow.add(g);
      const arrow = run.length > 1 ? arrowOf(run.map((g) => arrowPiece(g)!)) : null;
      if (arrow) {
        const first = run.reduce((l, g) => (g.x < l.x - 0.01 ? g : l));
        fuse(first, arrow, run.filter((g) => g !== first));
      }
    }
  }
  // A math accent (\vec, \widehat, \widetilde) joins the glyph under its
  // center: the nearest one at or below its baseline (the census found a
  // wide hat over Ω on the last letter of the word before it). A text font's
  // accent (\hat from OT1) does the same over a math letter; over a text
  // letter it is the text layer's (lines.ts composeAccents).
  for (const a of glyphs) {
    const entry = entryOf(a);
    if (entry?.cls !== "accent" || !/\p{M}/u.test(entry.unicode)) continue;
    let base: Glyph | null = null;
    for (const b of around(a)) {
      const rise = a.y - b.y;
      if (rise < -a.size * 0.1 || center(a) < b.x || center(a) > b.x + b.w) continue;
      if (a.family === "ot1" && rise > a.size * 0.6) continue;
      if (textOf(b) === "" || entryOf(b)?.cls === "accent" || /^\s*$/.test(textOf(b))) continue;
      if (!base || rise < a.y - base.y) base = b;
    }
    if (a.family === "ot1" && (base === null || base.family === null || base.family === "ot1")) continue;
    if (base) texts.set(base, (textOf(base) + entry.unicode).normalize("NFC"));
    texts.set(a, "");
  }
  return texts;
}

// An item's text from its glyphs: each glyph's text, and a space where a
// glyph starts a tenth of an em or more after the one before it ends —
// pdf.js's own rule for a space inside an item. Glyphs that read as nothing
// leave the item's box, but for a composite's parts. Null when every glyph
// reads as nothing. Each glyph keeps what it adds (Glyph.text), so a
// formula can end inside the item.
export function itemText(glyphs: Glyph[], texts: Map<Glyph, string>): { str: string; x: number; w: number } | null {
  let str = "";
  let x = 0;
  let end = 0;
  let prevEnd: number | null = null;
  for (const g of glyphs) {
    // pdf.js spells out a ligature (ﬁ → fi) in its text layer.
    const text = (texts.get(g) ?? g.unicode.replace(/[ﬀ-ﬆ]/g, (c) => c.normalize("NFKC"))).replace(
      CONTROL_CHARS_RE,
      "",
    );
    g.text = text;
    if (text !== "") {
      if (str === "") x = g.x;
      else if (prevEnd !== null && g.x - prevEnd >= g.size * 0.102) str += " ";
      str += text;
      end = Math.max(end, compositeEnd.get(g) ?? g.x + g.w);
    }
    prevEnd = g.x + g.w;
  }
  return str === "" ? null : { str, x, w: end - x };
}

// Math glyphs the text layer never read — pdf.js drops a code it reads as a
// space: ⊖ ⊘ ⊙ in a CMSY font with no Unicode map, and in the extension
// font \big⟨ (code 10, a line feed), \Bigg( (code 32), and the pieces of a
// tall bar — in runs of one font on one baseline, each run an item of its
// own. A glyph that hangs from its origin (the extension font's, esint's)
// counts only when the text layer read its code as a space: no item holds
// it.
export function unreadRuns(glyphs: Glyph[], read: Set<Glyph>, texts: Map<Glyph, string>): Glyph[][] {
  const runs: Glyph[][] = [];
  let run: Glyph[] = [];
  for (const g of glyphs) {
    const unread =
      g.family !== null &&
      g.family !== "ot1" &&
      ((g.family !== "omx" && g.family !== "esint") || g.unicode.trim() === "") &&
      !read.has(g) &&
      (texts.get(g) ?? "") !== "";
    const last = run[run.length - 1];
    if (unread && last && g.font === last.font && Math.abs(g.y - last.y) < 0.01 && g.x >= last.x && g.x - (last.x + last.w) < g.size * 0.6) {
      run.push(g);
      continue;
    }
    if (run.length > 0) {
      runs.push(run);
      run = [];
    }
    if (unread) run = [g];
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

// The baseline a sized delimiter of the extension font stands on (\big( to
// \Bigg(, a tall bar). TeX centers a delimiter on the math axis, a quarter
// em over the baseline, and the glyph hangs from its origin: placed by its
// origin, a \big⟨ made a line of its own and broke its equation (arXiv
// 2502.02648). A tall bar is one piece repeated up a column from its lowest
// piece, centered as a whole. Any other glyph keeps its origin: lines.ts
// places a big operator or a radical by its center.
const AXIS_HEIGHT = 0.25;
export function standingBaseline(g: Glyph, glyphs: Glyph[]): number {
  const entry = g.family === "omx" ? mathGlyph("omx", g.code) : null;
  if (!entry || (entry.size === undefined && entry.piece !== "vrep") || entry.cls === "radical") return g.y;
  let top = g;
  while (entry.piece === "vrep") {
    const under = top;
    const above = glyphs.find(
      (b) => b.family === g.family && b.code === g.code && Math.abs(b.x - g.x) < g.size * 0.05 && b.y - under.y > 0 && b.y - under.y < g.size * 0.65,
    );
    if (!above) break;
    top = above;
  }
  const high = top.y + (top.box ?? entry.box)[0] * g.size;
  const low = g.y - (g.box ?? entry.box)[1] * g.size;
  return (high + low) / 2 - AXIS_HEIGHT * g.size;
}

export function sameFlags(a: Flags, b: Flags): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.mono === b.mono &&
    a.smallCaps === b.smallCaps &&
    a.href === b.href &&
    Boolean(a.sup) === Boolean(b.sup) &&
    Boolean(a.sub) === Boolean(b.sub) &&
    a.zone === b.zone &&
    // A formula's glyphs are one run whatever their look: its face and size
    // are the equation's (a heading's bold lead lost its formula when an
    // upright Ω and a math ℱ read as two runs).
    (a.zone !== undefined || a.look === b.look)
  );
}
