// The words of a caption cue (SPEC.md §11): the cue's markup removed, its
// character references decoded.
//   WebVTT, by the standard's cue text rules: every "<...>" is a tag (a
//   class, a voice, a language, a ruby, or a timestamp) and is not a word;
//   "&amp;" and the other references are the characters they name. A voice
//   tag keeps its name as the line's first words, "Name: ", since a pasted
//   transcript has no other place for it.
//   SRT: the tags players draw (<i>, <b>, <u>, <s>, <font>) and the {\...}
//   override blocks some files carry are not words.

/** The text of a WebVTT cue, its lines joined by spaces. */
export function webVttCueText(raw: string): string {
  let out = "";
  let at = 0;
  while (at < raw.length) {
    const lt = raw.indexOf("<", at);
    out += raw.slice(at, lt === -1 ? raw.length : lt);
    if (lt === -1) break;
    const gt = raw.indexOf(">", lt + 1);
    const tag = raw.slice(lt + 1, gt === -1 ? raw.length : gt);
    const voice = /^v(?:\.\S*)?[ \t\n\f]+([\s\S]*)$/.exec(tag);
    if (voice && voice[1].trim() !== "") out += ` ${voice[1].trim()}: `;
    at = gt === -1 ? raw.length : gt + 1;
  }
  // A NUL character is U+FFFD, as the standard reads it.
  return decodeCharacterReferences(out.replaceAll("\0", "\ufffd")).replace(/\s+/g, " ").trim();
}

const SRT_TAG = /<\/?(?:i|b|u|s|font)\b[^>]*>|\{\\[^}]*\}/gi;

/** One line of an SRT cue. */
export function srtCueLine(line: string): string {
  return line.replace(SRT_TAG, "").replace(/\s+/g, " ").trim();
}

// HTML's named references that caption files use: the XML five, the marks
// and spaces, typography, and the Latin-1 range (U+00A0-U+00FF) in order.
// The Latin-1 names and the XML five may also stand without their ";".
const LATIN_1 = [
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr",
  "deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest",
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml",
  "ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig",
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml",
  "eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml",
]
  .join(" ")
  .split(" ");
const LEGACY: Record<string, string> = {
  amp: "&",
  AMP: "&",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  quot: '"',
  QUOT: '"',
  COPY: "\u00a9",
  REG: "\u00ae",
  ...Object.fromEntries(LATIN_1.map((name, i) => [name, String.fromCodePoint(0xa0 + i)])),
};
const NAMED: Record<string, string> = {
  ...LEGACY,
  apos: "'",
  lrm: "\u200e",
  rlm: "\u200f",
  zwj: "\u200d",
  zwnj: "\u200c",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201a",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bdquo: "\u201e",
  bull: "\u2022",
  hellip: "\u2026",
  prime: "\u2032",
  Prime: "\u2033",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  euro: "\u20ac",
  trade: "\u2122",
  larr: "\u2190",
  rarr: "\u2192",
  hearts: "\u2665",
  sung: "\u266a",
};

/** "&amp;", "&#233;", "&#xe9;" and the names above as their characters. A
    name not known stays as it is written. */
export function decodeCharacterReferences(text: string): string {
  return text.replace(
    /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g,
    (match, dec: string | undefined, hex: string | undefined, name: string | undefined, semi: string) => {
      if (dec !== undefined || hex !== undefined) {
        const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex!, 16);
        const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
        return valid ? String.fromCodePoint(code) : "\ufffd";
      }
      if (semi && Object.hasOwn(NAMED, name!)) return NAMED[name!];
      // Without its ";", the longest legacy name the text starts with:
      // "&copy2024" is the copyright sign, then 2024. A name with its ";" not in the
      // table stays as it is: HTML may know it, and a guess would be wrong.
      if (semi) return match;
      for (let n = name!.length; n >= 2; n--) {
        const head = name!.slice(0, n);
        if (Object.hasOwn(LEGACY, head)) return LEGACY[head] + name!.slice(n);
      }
      return match;
    },
  );
}
