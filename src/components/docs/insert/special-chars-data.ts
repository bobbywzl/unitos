import type { TKey } from "@/lib/i18n/dictionaries";

// The special characters (SPEC.md §29), in Google Docs' two menus: a
// category and, under it, its groups, each a run of Unicode blocks. The
// search finds a character by its name (the names below, the group's
// name) or by its code point ("2192", "U+2192").

export type CharGroup = { id: string; name: TKey; ranges: [number, number][]; words: string };
export type CharCategory = { id: string; label: TKey; groups: CharGroup[] };

export const CHAR_CATEGORIES: CharCategory[] = [
  {
    id: "symbol",
    label: "docsInsert.charSymbol",
    groups: [
      { id: "arrows", name: "docsInsert.charArrows", words: "arrow", ranges: [[0x2190, 0x21ff], [0x27f0, 0x27ff], [0x2b05, 0x2b0d]] },
      { id: "currency", name: "docsInsert.charCurrency", words: "currency money", ranges: [[0x24, 0x24], [0xa2, 0xa5], [0x20a0, 0x20c0]] },
      { id: "math", name: "docsInsert.charMath", words: "math", ranges: [[0x2200, 0x22ff]] },
      { id: "geometric", name: "docsInsert.charGeometric", words: "shape geometric square circle triangle", ranges: [[0x25a0, 0x25ff]] },
      { id: "stars", name: "docsInsert.charStars", words: "star asterisk", ranges: [[0x2605, 0x2606], [0x2721, 0x274b]] },
      { id: "technical", name: "docsInsert.charTechnical", words: "technical keyboard", ranges: [[0x2300, 0x23ff]] },
      { id: "weather", name: "docsInsert.charWeather", words: "weather zodiac planet", ranges: [[0x2600, 0x2604], [0x2607, 0x2613], [0x2614, 0x2615], [0x263f, 0x2653]] },
      { id: "games", name: "docsInsert.charGames", words: "chess card dice game", ranges: [[0x2654, 0x2667], [0x2680, 0x2685]] },
      { id: "musical", name: "docsInsert.charMusical", words: "music note", ranges: [[0x2669, 0x266f]] },
      { id: "dingbats", name: "docsInsert.charDingbats", words: "dingbat check cross", ranges: [[0x2700, 0x2720], [0x274c, 0x27bf]] },
      { id: "misc", name: "docsInsert.charMisc", words: "symbol", ranges: [[0x2616, 0x263e], [0x2670, 0x267f], [0x2686, 0x26ff]] },
      { id: "letterlike", name: "docsInsert.charLetterlike", words: "letterlike", ranges: [[0x2100, 0x214f]] },
      { id: "enclosed", name: "docsInsert.charEnclosed", words: "circled enclosed", ranges: [[0x2460, 0x24ff]] },
      { id: "box", name: "docsInsert.charBox", words: "box line", ranges: [[0x2500, 0x259f]] },
      { id: "superscript", name: "docsInsert.charSuperscript", words: "superscript", ranges: [[0xb9, 0xb9], [0xb2, 0xb3], [0x2070, 0x207f]] },
      { id: "subscript", name: "docsInsert.charSubscript", words: "subscript", ranges: [[0x2080, 0x209c]] },
      { id: "latin1", name: "docsInsert.charLatin1", words: "latin", ranges: [[0xa1, 0xbf], [0xd7, 0xd7], [0xf7, 0xf7]] },
      { id: "braille", name: "docsInsert.charBraille", words: "braille", ranges: [[0x2800, 0x28ff]] },
    ],
  },
  {
    id: "punctuation",
    label: "docsInsert.charPunctuation",
    groups: [
      { id: "general", name: "docsInsert.charGeneralPunct", words: "punctuation dash quote", ranges: [[0x2010, 0x2027], [0x2030, 0x205e]] },
      { id: "cjk", name: "docsInsert.charCjkPunct", words: "chinese japanese punctuation", ranges: [[0x3001, 0x303f]] },
      { id: "latin", name: "docsInsert.charLatinPunct", words: "punctuation", ranges: [[0x21, 0x2f], [0x3a, 0x40], [0x5b, 0x60], [0x7b, 0x7e], [0xa1, 0xa1], [0xab, 0xab], [0xb7, 0xb7], [0xbb, 0xbb], [0xbf, 0xbf]] },
    ],
  },
  {
    id: "number",
    label: "docsInsert.charNumber",
    groups: [
      { id: "fractions", name: "docsInsert.charFractions", words: "fraction", ranges: [[0xbc, 0xbe], [0x2150, 0x215f], [0x2189, 0x2189]] },
      { id: "roman", name: "docsInsert.charRoman", words: "roman numeral", ranges: [[0x2160, 0x2188]] },
      { id: "circled", name: "docsInsert.charCircled", words: "circled number", ranges: [[0x2460, 0x2473], [0x24ea, 0x24ff], [0x2776, 0x2793]] },
      { id: "fullwidth", name: "docsInsert.charFullwidth", words: "fullwidth digit", ranges: [[0xff10, 0xff19]] },
    ],
  },
  {
    id: "latin",
    label: "docsInsert.charLatin",
    groups: [
      { id: "accented", name: "docsInsert.charAccented", words: "accent letter", ranges: [[0xc0, 0xd6], [0xd8, 0xf6], [0xf8, 0xff]] },
      { id: "extendedA", name: "docsInsert.charExtendedA", words: "accent letter", ranges: [[0x100, 0x17f]] },
      { id: "extendedB", name: "docsInsert.charExtendedB", words: "letter", ranges: [[0x180, 0x24f]] },
      { id: "ipa", name: "docsInsert.charIpa", words: "phonetic ipa", ranges: [[0x250, 0x2af]] },
    ],
  },
  {
    id: "scripts",
    label: "docsInsert.charScripts",
    groups: [
      { id: "greek", name: "docsInsert.charGreek", words: "greek", ranges: [[0x391, 0x3a1], [0x3a3, 0x3a9], [0x3b1, 0x3c9], [0x3d0, 0x3d6]] },
      { id: "cyrillic", name: "docsInsert.charCyrillic", words: "cyrillic russian", ranges: [[0x400, 0x45f]] },
      { id: "armenian", name: "docsInsert.charArmenian", words: "armenian", ranges: [[0x531, 0x556], [0x561, 0x587]] },
      { id: "hebrew", name: "docsInsert.charHebrew", words: "hebrew", ranges: [[0x5d0, 0x5ea]] },
      { id: "arabic", name: "docsInsert.charArabic", words: "arabic", ranges: [[0x621, 0x64a], [0x660, 0x669]] },
      { id: "hiragana", name: "docsInsert.charHiragana", words: "japanese hiragana", ranges: [[0x3041, 0x3096]] },
      { id: "katakana", name: "docsInsert.charKatakana", words: "japanese katakana", ranges: [[0x30a1, 0x30fa]] },
      { id: "hangul", name: "docsInsert.charHangul", words: "korean hangul", ranges: [[0x3131, 0x318e]] },
    ],
  },
];

const GREEK_NAMES = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu",
  "nu", "xi", "omicron", "pi", "rho", "final sigma", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
];

/** Names for the characters people look for most. */
const NAMES: Record<string, string> = {
  "°": "degree",
  "©": "copyright",
  "®": "registered",
  "™": "trademark",
  "€": "euro",
  "£": "pound sterling",
  "¥": "yen yuan",
  "¢": "cent",
  "$": "dollar",
  "₹": "indian rupee",
  "₽": "ruble",
  "₩": "won",
  "₿": "bitcoin",
  "₫": "dong",
  "§": "section",
  "¶": "pilcrow paragraph",
  "•": "bullet",
  "…": "horizontal ellipsis",
  "†": "dagger",
  "‡": "double dagger",
  "—": "em dash",
  "–": "en dash",
  "‰": "per mille",
  "±": "plus minus",
  "×": "multiplication times",
  "÷": "division",
  "≠": "not equal",
  "≤": "less than or equal",
  "≥": "greater than or equal",
  "≈": "almost equal approximately",
  "∞": "infinity",
  "√": "square root",
  "∑": "summation sum",
  "∏": "product",
  "∫": "integral",
  "∂": "partial differential",
  "∆": "increment",
  "∇": "nabla",
  "∈": "element of",
  "∉": "not an element of",
  "⊂": "subset of",
  "⊃": "superset of",
  "∪": "union",
  "∩": "intersection",
  "∀": "for all",
  "∃": "there exists",
  "∅": "empty set",
  "¬": "not sign",
  "∧": "logical and",
  "∨": "logical or",
  "→": "rightwards arrow right",
  "←": "leftwards arrow left",
  "↑": "upwards arrow up",
  "↓": "downwards arrow down",
  "↔": "left right arrow",
  "⇒": "rightwards double arrow implies",
  "⇐": "leftwards double arrow",
  "⇔": "left right double arrow if and only if",
  "★": "black star",
  "☆": "white star",
  "✓": "check mark",
  "✔": "heavy check mark",
  "✗": "ballot x",
  "✘": "heavy ballot x",
  "☐": "ballot box",
  "☑": "ballot box with check",
  "☒": "ballot box with x",
  "♠": "spade suit",
  "♥": "heart suit",
  "♦": "diamond suit",
  "♣": "club suit",
  "♪": "eighth note",
  "♫": "beamed eighth notes",
  "☀": "sun",
  "☁": "cloud",
  "☂": "umbrella",
  "☃": "snowman",
  "☎": "telephone",
  "☕": "hot beverage coffee",
  "☺": "smiling face",
  "☹": "frowning face",
  "♀": "female sign",
  "♂": "male sign",
  "⚠": "warning sign",
  "⌘": "place of interest command",
  "⌥": "option key",
  "⇧": "shift",
  "⌫": "erase to the left backspace",
  "⏎": "return symbol enter",
  "½": "one half fraction",
  "¼": "one quarter fraction",
  "¾": "three quarters fraction",
  "⅓": "one third fraction",
  "⅔": "two thirds fraction",
  "¹": "superscript one",
  "²": "superscript two squared",
  "³": "superscript three cubed",
  "µ": "micro",
  "Ω": "ohm",
  "℃": "degree celsius",
  "℉": "degree fahrenheit",
  "№": "numero number sign",
  "ℓ": "script small l liter",
  "«": "left guillemet quotation",
  "»": "right guillemet quotation",
  "“": "left double quotation mark",
  "”": "right double quotation mark",
  "‘": "left single quotation mark",
  "’": "right single quotation mark apostrophe",
  "¿": "inverted question mark",
  "¡": "inverted exclamation mark",
  "·": "middle dot",
  "■": "black square",
  "□": "white square",
  "▲": "black up triangle",
  "▼": "black down triangle",
  "●": "black circle",
  "○": "white circle",
  "◆": "black diamond",
  "◇": "white diamond",
};

export function charName(ch: string): string {
  const named = NAMES[ch];
  if (named) return named;
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x391 && cp <= 0x3a9) return `greek capital ${GREEK_NAMES[cp - 0x391] ?? ""}`.trim();
  if (cp >= 0x3b1 && cp <= 0x3c9) return `greek small ${GREEK_NAMES[cp - 0x3b1] ?? ""}`.trim();
  return "";
}

export function codepoint(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The characters of a group, in code point order, printable ones only. */
export function groupChars(group: CharGroup): string[] {
  const out: string[] = [];
  for (const [from, to] of group.ranges) {
    for (let cp = from; cp <= to; cp++) {
      const ch = String.fromCodePoint(cp);
      if (/\p{L}|\p{M}|\p{N}|\p{P}|\p{S}/u.test(ch)) out.push(ch);
    }
  }
  return out;
}

/** The characters a search finds: a code point, or words of names and
    groups (`label` names a group in the reader's language). */
export function searchChars(query: string, label: (group: CharGroup) => string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hex = /^(?:u\+)?([0-9a-f]{2,6})$/i.exec(q);
  const out = new Set<string>();
  if (hex) {
    const cp = parseInt(hex[1], 16);
    if (cp <= 0x10ffff) out.add(String.fromCodePoint(cp));
  }
  const words = q.split(/\s+/);
  for (const category of CHAR_CATEGORIES) {
    for (const group of category.groups) {
      const groupWords = `${label(group)} ${group.words}`.toLowerCase();
      for (const ch of groupChars(group)) {
        const text = `${charName(ch)} ${groupWords}`;
        if (words.every((w) => text.includes(w))) out.add(ch);
        if (out.size >= 400) return [...out];
      }
    }
  }
  return [...out];
}
