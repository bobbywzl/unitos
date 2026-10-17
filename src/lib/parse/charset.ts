// The bytes of a fetched page, decoded as a browser decodes them: the byte
// order mark first, then the Content-Type header's charset, then the charset
// the page declares in its head (<meta charset>, <meta http-equiv="Content-Type">,
// an XML prolog's encoding); UTF-8 when nothing says. Before this, every page
// decoded as UTF-8, and a page in a legacy charset (iso-8859-1, windows-1252,
// windows-1250, gb2312, shift_jis) read with every accented letter, umlaut,
// or ideograph as the replacement character. Held-out web set finding: 27 of
// 990 pages are not valid UTF-8, 18 of them declaring the charset they are in.
//
// A declared charset whose decoder rejects the bytes is not the page's: an
// archive's utf-8 meta ahead of a gb2312 page's own meta. Each declared
// charset is tried in order with a strict decoder, and the first that reads
// every byte wins; when none does, the first declared one reads the page
// with replacement characters, as a browser would.

const PROLOG_MAX_BYTES = 64 * 1024;
const META_CHARSET_RX = /<meta\s[^>]*?charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/gi;
const XML_ENCODING_RX = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([a-z0-9_.:-]+)/i;
const HEADER_CHARSET_RX = /charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i;

function bomCharset(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return null;
}

/** The charsets the page declares in its head, in document order. */
function declaredCharsets(bytes: Uint8Array): string[] {
  const prolog = new TextDecoder("latin1").decode(bytes.subarray(0, PROLOG_MAX_BYTES));
  const bodyAt = prolog.search(/<body[\s>]/i);
  const head = bodyAt >= 0 ? prolog.slice(0, bodyAt) : prolog;
  const out: string[] = [];
  const xml = XML_ENCODING_RX.exec(head);
  if (xml) out.push(xml[1]);
  for (const m of head.matchAll(META_CHARSET_RX)) out.push(m[1]);
  return out;
}

function decoderFor(label: string, fatal: boolean): TextDecoder | null {
  try {
    return new TextDecoder(label, { fatal });
  } catch {
    return null;
  }
}

/** The charset the page reads in, as a browser would pick it: the BOM, the
    header, the page's own declaration, or UTF-8. */
export function pageCharsets(bytes: Uint8Array, contentType?: string | null): string[] {
  const labels: string[] = [];
  const bom = bomCharset(bytes);
  if (bom) labels.push(bom);
  const header = contentType ? HEADER_CHARSET_RX.exec(contentType) : null;
  if (header) labels.push(header[1]);
  labels.push(...declaredCharsets(bytes), "utf-8");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const decoder = decoderFor(label, false);
    if (!decoder || seen.has(decoder.encoding)) continue;
    seen.add(decoder.encoding);
    out.push(decoder.encoding);
  }
  return out;
}

// Windows-1252's characters at 0x80–0x9F (a hole reads as its C1 code point,
// as the WHATWG decoder reads it). Node's TextDecoder("windows-1252") reads
// these bytes as Latin-1's C1 controls (Node 22): a curly apostrophe, a
// dash, an euro sign read as nothing. A page that declares iso-8859-1 or
// windows-1252 decodes through it too: before, its dashes and curly quotes
// read as controls (web benchmark finding: 9 of 1,217 pages, "Ich bin Du –
// und Du schaust zu" read "Ich bin Du  und Du schaust zu").
const WINDOWS_1252_HIGH =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";

function decodeIn(label: string, bytes: Uint8Array, fatal = false): string {
  const text = new TextDecoder(label, { fatal }).decode(bytes);
  if (label !== "windows-1252") return text;
  return text.replace(/[\u0080-\u009f]/g, (c) => WINDOWS_1252_HIGH[c.charCodeAt(0) - 0x80]);
}

/** The page's text from its bytes. */
export function decodePage(bytes: Uint8Array, contentType?: string | null): string {
  const charsets = pageCharsets(bytes, contentType);
  for (const charset of charsets) {
    try {
      return decodeIn(charset, bytes, true);
    } catch {
      // The bytes are not in this charset: the next declared one may read them.
    }
  }
  return decodeIn(charsets[0], bytes);
}

// ── A text file's charset ───────────────────────────────────────────────────
// A Markdown or text file declares no charset: the bytes say it. The byte
// order mark first (UTF-8, UTF-16); then UTF-16 with no mark (a NUL beside
// every ASCII character); then UTF-8 when every byte reads as UTF-8 (a file
// that does reads exactly as before). Else the file is in a legacy charset
// (Windows' and the old Unix ones: Latin-1, Central European, Cyrillic,
// Greek, Shift_JIS, EUC-JP, GBK, Big5, EUC-KR), and each is tried on the
// file's start and scored by how its text reads: the letters past ASCII
// are mostly small letters in a word of one script, an ideograph or a
// Hangul syllable among the most used ones, a kana; a replacement
// character, a control, a capital inside a small-letter word, or a symbol
// inside a word reads as wrong. Before, every file read as UTF-8, and a
// file saved in another charset read with every letter past ASCII as the
// replacement character, and a UTF-16 file as noise. Markdown benchmark
// finding: the Vim tutor in eleven legacy charsets, Python's CJK codec
// samples, and Windows' UTF-16 and Windows-1252 files lost 10 to 99% of
// their words.

const TEXT_SAMPLE_BYTES = 64 * 1024;

// The charsets a text file not wholly UTF-8 is tried in, the most common
// first: a tie keeps the earlier. UTF-8 is one: a UTF-8 file with a stray
// byte reads as UTF-8 with one replacement character, as before.
const LEGACY_TEXT_CHARSETS = [
  "utf-8",
  "windows-1252",
  "shift_jis",
  "euc-jp",
  "gb18030",
  "big5",
  "euc-kr",
  "iso-8859-2",
  "windows-1250",
  "windows-1251",
  "koi8-r",
  "iso-8859-7",
];

// The most used ideographs and Hangul syllables: in a text read in its own
// charset they are a large share of its ideographs; in a text read in the
// wrong one, the ideographs fall anywhere in the table.
const COMMON_HAN = new Set(
  "的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区" +
    "這個們來說為會時對裡後麼過學發開見經頭動兩長樣現將與實點種聲話兒問機給幾業間電門東關軍產萬體別處總場師書員華報馬張難數車應條變聯權領傳紅決達辦運強區無從認論義術結視專還讓計記邊戰許覺題統請愛輸鍵標刪除移單語檔" +
    "気本語行末削挿押戻消練習課読編集画面確実注意場合使用終了次示表移単語文字入力変更保存始操作" ,
);
const COMMON_HANGUL = new Set(
  "이다는의에가고하을를한지로서도기나사인리어수게자해대일만으적요시것그라들보정부있없면니아주우제상과전와되말성데동문국무오장내소연화생경여구비신위중진계저습할까거히공원회관개실마드모때년분했었람같안알음법터처및래려났봐줄함각업명발입력커삭제및키행단어줄파일명령",
);

function isSmallLetter(c: string): boolean {
  return c !== c.toUpperCase() && c === c.toLowerCase();
}
function isCapital(c: string): boolean {
  return c !== c.toLowerCase() && c === c.toUpperCase();
}
const LETTER_RX = /\p{L}/u;
const SCRIPT_OF: [RegExp, string][] = [
  [/\p{sc=Latin}/u, "latin"],
  [/\p{sc=Cyrillic}/u, "cyrillic"],
  [/\p{sc=Greek}/u, "greek"],
];
function scriptOf(c: string): string | null {
  for (const [rx, name] of SCRIPT_OF) if (rx.test(c)) return name;
  return null;
}

type CharKind = { letter: boolean; script: string | null; small: boolean; capital: boolean };
const CHAR_KINDS = new Map<string, CharKind>();
function kindOf(c: string): CharKind {
  let kind = CHAR_KINDS.get(c);
  if (!kind) {
    const letter = LETTER_RX.test(c);
    kind = { letter, script: letter ? scriptOf(c) : null, small: isSmallLetter(c), capital: isCapital(c) };
    CHAR_KINDS.set(c, kind);
  }
  return kind;
}

// The Latin-1 signs a Western text uses: they read as right where they stand
// (a short Windows-1252 file with one ©, °, or ¿ otherwise reads better as
// Central European, or as GBK with the sign and the next letter one
// ideograph).
const LATIN1_SIGNS = new Set("\u00A0¡¢£¤¥§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷€‚„…†‡‰‹›‘’“”•–—™");

/** How well a decoded text reads: higher is better. */
function readingScore(text: string): number {
  let score = 0;
  let prev = kindOf(" ");
  let prevHigh = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const code = c.charCodeAt(0);
    const kind = kindOf(c);
    if (code < 0x80) {
      // An ASCII capital right after a small letter past ASCII.
      if (prevHigh && prev.small && kind.capital) score -= 3;
      prev = kind;
      prevHigh = false;
      continue;
    }
    if (c === "�") score -= 10;
    else if (code <= 0x9f) score -= 5;
    else if (LATIN1_SIGNS.has(c)) score += 0;
    else if (code >= 0x3040 && code <= 0x30ff) score += 2;
    else if (code >= 0xac00 && code <= 0xd7a3) score += COMMON_HANGUL.has(c) ? 2 : -0.5;
    else if (code >= 0x4e00 && code <= 0x9fff) score += COMMON_HAN.has(c) ? 2 : -0.5;
    else if ((code >= 0xe000 && code <= 0xf8ff) || (code >= 0x3400 && code <= 0x4dbf)) score -= 3;
    else if (code >= 0xff61 && code <= 0xff9f) score -= 0.5;
    else if (kind.letter) {
      // A letter of another script inside a word, or a capital after a
      // small letter, reads as wrong; so does a capital standing alone.
      const next = kindOf(text[i + 1] ?? " ");
      if (prev.script && kind.script && prev.script !== kind.script) score -= 3;
      if (kind.small) score += 1;
      else if (kind.capital) score += prev.small ? -3 : !prev.letter && !next.letter ? -1 : 0.3;
    } else if (prev.letter && kindOf(text[i + 1] ?? " ").letter) {
      // A symbol inside a word.
      score -= 3;
    } else score -= 0.2;
    prev = kind;
    prevHigh = true;
  }
  return score;
}

/** UTF-16 with no byte order mark: a NUL beside most characters of the
    start, on the even bytes (big-endian) or the odd ones (little-endian). */
function utf16Shape(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 4) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) even++;
    if (bytes[i + 1] === 0) odd++;
  }
  const pairs = n / 2;
  if (odd >= pairs * 0.4 && even <= pairs * 0.05) return "utf-16le";
  if (even >= pairs * 0.4 && odd <= pairs * 0.05) return "utf-16be";
  return null;
}

/** ISO-2022-JP: 7-bit bytes only, and an escape that switches to a JIS
    set (ESC $ B, ESC $ @, ESC ( J, ESC ( I). Every byte of such a file
    reads as UTF-8, so the UTF-8 test alone took it as ASCII with escapes
    (Markdown benchmark finding: the Emacs tutorial in Japanese, the
    charset of Japanese mail, lost 92% of its words). */
function isIso2022Jp(bytes: Uint8Array): boolean {
  let escapes = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x80) return false;
    if (b !== 0x1b) continue;
    const a = bytes[i + 1];
    const c = bytes[i + 2];
    if ((a === 0x24 && (c === 0x42 || c === 0x40)) || (a === 0x28 && (c === 0x4a || c === 0x49))) escapes++;
  }
  return escapes > 0;
}

/** The charset a text file is in (see above). */
export function textFileCharset(bytes: Uint8Array): string {
  const bom = bomCharset(bytes);
  if (bom) return bom;
  const wide = utf16Shape(bytes);
  if (wide) return wide;
  if (isIso2022Jp(bytes)) return "iso-2022-jp";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    // Not UTF-8: a legacy charset.
  }
  // The sample ends at a line end, so no charset reads half a character.
  let end = Math.min(bytes.length, TEXT_SAMPLE_BYTES);
  if (end < bytes.length) {
    const nl = bytes.lastIndexOf(0x0a, end);
    if (nl > 0) end = nl + 1;
  }
  const sample = bytes.subarray(0, end);
  let best = "utf-8";
  let bestScore = -Infinity;
  for (const label of LEGACY_TEXT_CHARSETS) {
    if (!decoderFor(label, false)) continue;
    const score = readingScore(decodeIn(label, sample));
    if (score > bestScore) {
      best = label;
      bestScore = score;
    }
  }
  return best;
}

/** A text file's text from its bytes, in the charset textFileCharset finds.
    The byte order mark is not text. */
export function decodeTextFile(bytes: Uint8Array): string {
  const charset = textFileCharset(bytes);
  const text = decodeIn(charset, bytes);
  return charset === "euc-kr" ? composeFilledHangul(text) : text;
}

// EUC-KR writes a syllable outside its 2,350 as the Hangul filler (0xA4D4)
// and three jamo: initial, medial, final (the filler again when the
// syllable has no final). The WHATWG decoder leaves the four characters
// apart, as "ㅤㅆㅠㅤ"; Python's euc_kr codec and Windows' code page 949
// put the syllable together. A text file reads them together; a web page
// keeps the WHATWG decode, as a browser shows it.
const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JONGSEONG = "\u3164ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
const FILLED_HANGUL_RX = /\u3164([\u3131-\u314e])([\u314f-\u3163])([\u3131-\u314e\u3164])/g;

function composeFilledHangul(text: string): string {
  return text.replace(FILLED_HANGUL_RX, (whole, cho: string, jung: string, jong: string) => {
    const c = CHOSEONG.indexOf(cho);
    const f = JONGSEONG.indexOf(jong);
    if (c < 0 || f < 0) return whole;
    const v = jung.charCodeAt(0) - 0x314f;
    return String.fromCharCode(0xac00 + (c * 21 + v) * 28 + f);
  });
}
