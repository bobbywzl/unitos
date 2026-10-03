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
