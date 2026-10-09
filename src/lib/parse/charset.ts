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

/** The page's text from its bytes. */
export function decodePage(bytes: Uint8Array, contentType?: string | null): string {
  const charsets = pageCharsets(bytes, contentType);
  for (const charset of charsets) {
    try {
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch {
      // The bytes are not in this charset: the next declared one may read them.
    }
  }
  return new TextDecoder(charsets[0]).decode(bytes);
}

// ── A text file's bytes (a .csv or .tsv, SPEC.md §27) ─────────────────────────
// A text file declares no charset: the bytes are all there is. Spreadsheet
// programs save CSV in the computer's own code page — windows-1252 in Western
// Europe, Shift-JIS in Japan, GBK in China, Big5 in Taiwan — or as UTF-16
// ("Unicode Text") or UTF-8. Before this, every .csv decoded as UTF-8, and
// such a file read with every accented letter and every ideograph as the
// replacement character, and a UTF-16 file as letters with nulls between
// them. Sheets benchmark finding: 11 of 39 delimited files are not UTF-8.
//
// The order: a byte order mark; UTF-16 without one (nulls on every other
// byte); UTF-8 when every byte reads as UTF-8; else a legacy code page. A
// legacy file whose high bytes stand alone between ASCII letters ("Cérémonie")
// is windows-1252; one whose high bytes come in pairs is CJK, and the CJK code
// page is the one that reads every byte and puts the most characters in its
// common block (kana and level-1 kanji for Shift-JIS, GB2312 for GB18030, the
// frequent hanzi for Big5).

const TEXT_SAMPLE_BYTES = 256 * 1024;

function utf16WithoutBom(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  const pairs = n / 2;
  if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.05) return "utf-16le";
  if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.05) return "utf-16be";
  return null;
}

/** Do the bytes read in this charset. A sample may end mid-character: the
    decoder streams, so an unfinished last character is not an error. */
function decodes(bytes: Uint8Array, label: string): boolean {
  try {
    new TextDecoder(label, { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** The share of a legacy file's high bytes that stand alone between ASCII
    bytes: near 1 for Latin text, near 0 for CJK text. */
function isolatedHighShare(bytes: Uint8Array): number {
  let high = 0;
  let isolated = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x80) continue;
    high++;
    if ((i === 0 || bytes[i - 1] < 0x80) && (i + 1 >= bytes.length || bytes[i + 1] < 0x80)) isolated++;
  }
  return high === 0 ? 1 : isolated / high;
}

type CjkCode = { label: string; width: (b: Uint8Array, i: number) => number; common: (lead: number, trail: number) => boolean };

const CJK_CODES: CjkCode[] = [
  {
    // GB18030 (a superset of GBK and GB2312): the GB2312 block is the common one.
    label: "gb18030",
    width: (b, i) => (b[i] < 0x81 ? 1 : b[i + 1] >= 0x30 && b[i + 1] <= 0x39 ? 4 : 2),
    common: (lead, trail) => trail >= 0xa1 && ((lead >= 0xa1 && lead <= 0xa9) || (lead >= 0xb0 && lead <= 0xf7)),
  },
  {
    // Shift-JIS: punctuation, kana, and level-1 kanji; a half-width katakana
    // byte (0xA1-0xDF) is one character and not common.
    label: "shift_jis",
    width: (b, i) => (b[i] < 0x81 || (b[i] >= 0xa1 && b[i] <= 0xdf) ? 1 : 2),
    common: (lead) => (lead >= 0x81 && lead <= 0x84) || (lead >= 0x88 && lead <= 0x98),
  },
  {
    // Big5: symbols and the frequent hanzi.
    label: "big5",
    width: (b, i) => (b[i] < 0x81 ? 1 : 2),
    common: (lead) => lead >= 0xa1 && lead <= 0xc6,
  },
];

/** The share of a code page's characters past ASCII that fall in its common block. */
function commonShare(bytes: Uint8Array, code: CjkCode): number {
  let chars = 0;
  let common = 0;
  for (let i = 0; i < bytes.length; ) {
    const width = code.width(bytes, i);
    if (bytes[i] >= 0x80) {
      chars++;
      if (width === 2 && code.common(bytes[i], bytes[i + 1] ?? 0)) common++;
    }
    i += width;
  }
  return chars === 0 ? 0 : common / chars;
}

/** The charset a text file's bytes are in. */
export function textCharset(bytes: Uint8Array): string {
  const bom = bomCharset(bytes);
  if (bom) return bom;
  const utf16 = utf16WithoutBom(bytes);
  if (utf16) return utf16;
  const sample = bytes.length > TEXT_SAMPLE_BYTES ? bytes.subarray(0, TEXT_SAMPLE_BYTES) : bytes;
  if (decodes(bytes, "utf-8")) return "utf-8";
  if (isolatedHighShare(sample) >= 0.5) return "windows-1252";
  let best = "windows-1252";
  let bestShare = 0.5;
  for (const code of CJK_CODES) {
    if (!decodes(sample, code.label)) continue;
    const share = commonShare(sample, code);
    if (share > bestShare) {
      best = code.label;
      bestShare = share;
    }
  }
  return best;
}

/** A text file's words from its bytes, in the charset they are in. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder(textCharset(bytes)).decode(bytes);
}
