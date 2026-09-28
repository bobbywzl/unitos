// Glyphs and fonts: what a text item's string becomes (control characters
// dropped, radicals and spacing accents folded, the math extension font's
// codes mapped) and what a font's name says (bold, italic, monospace, math).

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
export function normalizeGlyphs(str: string): string {
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

export type FontFlags = Omit<Flags, "href"> & { math: boolean; cmex: boolean };

export function fontFlags(name: string | null): FontFlags {
  const n = (name ?? "").replace(/^[A-Z]{6}\+/, ""); // subset prefix "HAAAAA+"
  return {
    // Computer Modern (CMBX, CMTI, CMTT), Nimbus (-Medi, -ReguItal) and Latin
    // Modern names carry weight and shape in abbreviations, not words.
    bold: /bold|black|heavy|semi ?bold|demi|medi(?:ital|obli)?$|^CMBX|^CMB\d|^CMSSBX|^CMBSY|^LM(?:Roman|Sans|Mono)\d*-Bold/i.test(n),
    italic: /italic|oblique|ital$|obli$|^CMTI|^CMSL|^CMBXTI|^CMSSI|^CMITT|^CMSLTT|slanted/i.test(n),
    mono: /mono|courier|consolas|menlo|typewriter|^CMTT|^CMSLTT|^CMITT|cursor/i.test(n),
    math: /^(CMMI|CMSY|CMEX|CMMIB|CMBSY|MSAM|MSBM|rsfs|eufm|eufb|stmary|wasy|LMMathItalic|LMMathSymbols|LMMathExtension)|Math|Symbol/i.test(n),
    cmex: /^(CMEX|LMMathExtension)/i.test(n),
  };
}

// Computer Modern's math extension font carries no Unicode map: the text layer
// gives each glyph its own code — "Z" for a display integral, "P" for a sum,
// control codes for the big delimiters (import compare loop finding: "Z t"
// and "Q" in equation text; big parentheses lost, so crops cut them off).
const CMEX_DELIMITERS = "()[]⌊⌋⌈⌉{}⟨⟩|‖/\\";
const CMEX_OPERATORS: Record<string, string> = {
  P: "∑", Q: "∏", R: "∫", S: "⋃", T: "⋂", U: "⊎", V: "⋀", W: "⋁",
  X: "∑", Y: "∏", Z: "∫", "[": "⋃", "\\": "⋂", "]": "⊎", "^": "⋀", _: "⋁",
  p: "√", q: "√", r: "√", s: "√", t: "√", u: "√", v: "√",
};
export const OPERATOR_GLYPH_RE = /^[∫∑∏⋃⋂⊎⋀⋁√]$/;
export function mapCmexGlyphs(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code < 0x20) out += CMEX_DELIMITERS[code % 16];
    else if (CMEX_OPERATORS[ch] !== undefined) out += CMEX_OPERATORS[ch];
    else if (/[z{|}]/.test(ch)) continue; // brace and bracket pieces
    else out += ch;
  }
  return out;
}

export function sameFlags(a: Flags, b: Flags): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.mono === b.mono && a.href === b.href;
}
