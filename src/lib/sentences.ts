// Sentence spans and simplify markers. The simplify prompt numbers the original
// sentences with splitSentences and the reader maps marker indices back with it,
// so both sides MUST split identically — change it only in lockstep.

export type SentenceSpan = { text: string; start: number; end: number };

export function splitSentences(text: string): SentenceSpan[] {
  // A boundary is sentence punctuation (plus closing quotes or brackets), then
  // whitespace, then something that starts a sentence. Decimal points and
  // mid-word periods never match — no whitespace follows them.
  const boundaries: number[] = [];
  const rx = /[.!?]+["'”’)\]]*\s+/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const after = text[m.index + m[0].length];
    if (after && /[A-Z0-9"'“‘([]/.test(after)) boundaries.push(m.index + m[0].length);
  }
  const spans: SentenceSpan[] = [];
  let start = 0;
  for (const boundary of [...boundaries, text.length]) {
    const raw = text.slice(start, boundary);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) spans.push({ text: trimmed, start: start + lead, end: start + lead + trimmed.length });
    start = boundary;
  }
  return spans;
}

export type SimplifiedSentence = { text: string; refs: number[] };

// Parses "plain sentence. [[1,2]]" sequences from the simplify output. Null when
// no markers came back — the caller falls back to plain text. A trailing tail
// without a marker inherits the previous sentence's refs, so every sentence
// keeps at least one source.
export function parseSimplified(raw: string): SimplifiedSentence[] | null {
  if (!/\[\[\d+(?:\s*,\s*\d+)*\]\]/.test(raw)) return null;
  const out: SimplifiedSentence[] = [];
  const rx = /([^]*?)\[\[(\d+(?:\s*,\s*\d+)*)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw))) {
    const refs = m[2]
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => n > 0);
    if (m[1].trim() && refs.length > 0) out.push({ text: m[1], refs });
    last = rx.lastIndex;
  }
  const rest = raw.slice(last);
  if (rest.trim() && out.length > 0) out.push({ text: rest, refs: out[out.length - 1].refs });
  return out.length > 0 ? out : null;
}

export function stripSimplifyMarkers(raw: string): string {
  return raw.replace(/\s*\[\[\d+(?:\s*,\s*\d+)*\]\]/g, "");
}
