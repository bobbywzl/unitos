// A PDF's page count, read in the browser from the file's bytes without
// pdf.js (SPEC.md §15: the Pages field says "of 409" once the PDF is read).
// The count is the page tree's root: the /Type /Pages dictionary with no
// /Parent, whose /Count is every page. It stands in the file as it is, or
// inside a compressed object stream (/Type /ObjStm), which the browser's
// own DecompressionStream opens. An encrypted PDF's streams do not open:
// its count is unknown (null), never guessed.

/** The bytes as a string of the same length: one character per byte. */
function byteString(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** The /Count of a page tree root in one object's words, or null. */
function rootCount(object: string): number | null {
  if (!/\/Type\s*\/Pages\b/.test(object) || /\/Parent\b/.test(object)) return null;
  const count = /\/Count\s+(\d+)(?!\s+\d+\s+R)/.exec(object);
  return count ? Number(count[1]) : null;
}

/** The object around a place in the file: from its "obj" to its "endobj". */
function objectAt(text: string, at: number): { start: number; words: string } {
  const open = text.lastIndexOf("obj", at);
  const close = text.indexOf("endobj", at);
  const start = open < 0 ? 0 : open + 3;
  return { start, words: text.slice(start, close < 0 ? text.length : close) };
}

/** The objects an object stream holds, each as words. */
async function streamObjects(bytes: Uint8Array, text: string, at: number): Promise<string[]> {
  const { start, words } = objectAt(text, at);
  const open = words.indexOf("stream");
  if (open < 0) return [];
  const dict = words.slice(0, open);
  if (!/\/Filter\s*\/FlateDecode\b/.test(dict) || /\/DecodeParms\b/.test(dict)) return [];
  let from = open + "stream".length;
  if (words[from] === "\r") from++;
  if (words[from] === "\n") from++;
  const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  let to = words.lastIndexOf("endstream");
  if (to < 0) return [];
  if (length) to = Math.min(to, from + Number(length[1]));
  else while (to > from && (words[to - 1] === "\n" || words[to - 1] === "\r")) to--;
  const data = await inflate(bytes.subarray(start + from, start + to));
  if (!data) return [];
  const inner = byteString(data);
  const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1]);
  if (!Number.isFinite(first)) return [];
  const offsets = inner.slice(0, first).trim().split(/\s+/).map(Number).filter((_, i) => i % 2 === 1);
  return offsets.map((offset, i) => inner.slice(first + offset, i + 1 < offsets.length ? first + offsets[i + 1] : undefined));
}

/** A PDF past the upload's limit is refused: its count is not read. */
const MAX_BYTES = 50 * 1024 * 1024;

/** A PDF's page count, or null when its bytes do not say. The last root in
    the file counts: a PDF saved again adds its new root after the old. */
export async function readPageCount(file: Blob): Promise<number | null> {
  if (file.size > MAX_BYTES) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = byteString(bytes);
    let count: number | null = null;
    for (const match of text.matchAll(/\/Type\s*\/Pages\b/g)) count = rootCount(objectAt(text, match.index).words) ?? count;
    if (count !== null) return count;
    for (const match of text.matchAll(/\/Type\s*\/ObjStm\b/g)) {
      for (const object of await streamObjects(bytes, text, match.index)) count = rootCount(object) ?? count;
    }
    if (count !== null) return count;
    // A linearized PDF names its count at its head (/N), wherever its root is.
    const linearized = /\/Linearized\b[^>]*?\/N\s+(\d+)/.exec(text.slice(0, 2048));
    return linearized ? Number(linearized[1]) : null;
  } catch {
    return null;
  }
}
