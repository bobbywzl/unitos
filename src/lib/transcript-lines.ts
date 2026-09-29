// A video's or an audio's transcript lines (SPEC.md §11): TRANSCRIPT blocks,
// each one voice's words over a time range, in time order, no range over
// another's. Two lines next to each other join into one, from the first's
// start to the second's end; one line splits into two, its time divided
// where its words divide (by characters: the transcript keeps no word
// timings). Every span on the words (a style, a link, a citation) and every
// anchor (a note's or an annotation's words, a link between documents)
// follows its words; an anchor a split would cut stops the split. The
// route (app/api/blocks/lines) writes these and takes them back.

const CONTEXT = 32; // an anchor's prefix and suffix, as sources capture them

/** A transcript line as the joins and splits read it. */
export type Line = {
  id: string;
  text: string;
  startTime: number | null;
  endTime: number | null;
  speaker: string | null;
  styles: unknown;
  links: unknown;
  citations: unknown;
};

/** What the refusals read of a block: its kind, times, and voice. */
type LineShape = { id: string; type: string; startTime?: number | null; endTime?: number | null; speaker?: string | null };

/** A span on a block's words: Block.styles, links, and citations. */
type Span = { start: number; end: number; quotedText?: string } & Record<string, unknown>;

const spansOf = (value: unknown): Span[] =>
  Array.isArray(value) ? (value as Span[]).filter((s) => s && typeof s.start === "number" && typeof s.end === "number") : [];

/** Spans as the block stores them: the list; none left of a list, an
    empty list; a block that had none keeps what it had. */
const listOr = (spans: Span[], was: unknown): unknown => (spans.length > 0 ? spans : spansOf(was).length > 0 ? [] : (was ?? null));

/** Why two lines do not join, or null: the second must follow the first
    (no line between them, so the joined time covers no other line's), say
    the same voice (a line is one voice), and start no chapter (the
    contents point at it). */
export function joinRefusal(
  first: LineShape,
  second: LineShape,
  next: boolean,
  chapterStarts: ReadonlySet<string>,
): "api.lineJoinLines" | "api.lineJoinNext" | "api.lineJoinVoice" | "api.lineJoinChapter" | null {
  if (first.type !== "TRANSCRIPT" || second.type !== "TRANSCRIPT") return "api.lineJoinLines";
  if (!next || first.startTime == null || second.endTime == null || second.endTime < first.startTime) return "api.lineJoinNext";
  if ((first.speaker ?? null) !== (second.speaker ?? null)) return "api.lineJoinVoice";
  if (chapterStarts.has(second.id)) return "api.lineJoinChapter";
  return null;
}

/** Two lines as one: the second's words after a space, its spans with them. */
export function joined(first: Line, second: Line) {
  const shift = first.text.length + 1;
  const move = (value: unknown) => spansOf(value).map((s) => withQuote({ ...s, start: s.start + shift, end: s.end + shift }, `${first.text} ${second.text}`));
  const text = `${first.text} ${second.text}`;
  return {
    text,
    startTime: first.startTime,
    endTime: second.endTime,
    styles: listOr([...spansOf(first.styles), ...move(second.styles)], first.styles),
    links: listOr([...spansOf(first.links), ...move(second.links)], first.links),
    citations: listOr([...spansOf(first.citations), ...move(second.citations)], first.citations),
    shift,
  };
}

const withQuote = (span: Span, text: string): Span => ("quotedText" in span ? { ...span, quotedText: text.slice(span.start, span.end) } : span);

// Letters or digits on both sides of a place, in a script that spaces its
// words: the place is inside a word.
const inWord = (before: string, after: string) =>
  /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after) && !/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u.test(before + after);

/** Where a line splits: the words before `offset` and the words from it,
    the spaces between dropped. Null inside a word, or when either side has
    no words. */
export function splitPlace(text: string, offset: number): { headEnd: number; tailStart: number } | null {
  if (offset <= 0 || offset >= text.length || inWord(text[offset - 1], text[offset])) return null;
  const headEnd = text.slice(0, offset).trimEnd().length;
  const tailStart = text.length - text.slice(offset).trimStart().length;
  return headEnd > 0 && tailStart < text.length ? { headEnd, tailStart } : null;
}

/** Why a line does not split at `offset`, or null: a transcript line with
    a time to divide, between words, and no anchor across the place. */
export function splitRefusal(
  line: LineShape & { text: string },
  offset: number,
  anchors: { start: number; end: number }[],
): "api.lineSplitLine" | "api.lineSplitPlace" | "api.lineSplitTime" | "api.lineSplitAnchor" | null {
  if (line.type !== "TRANSCRIPT") return "api.lineSplitLine";
  const place = splitPlace(line.text, offset);
  if (!place) return "api.lineSplitPlace";
  if (line.startTime == null || line.endTime == null || line.endTime <= line.startTime) return "api.lineSplitTime";
  if (anchors.some((a) => a.start < place.tailStart && a.end > place.headEnd)) return "api.lineSplitAnchor";
  return null;
}

/** One line as two, at `offset`: each side's words and spans (a span
    across the place goes on in both), and the time where the words divide. */
export function split(line: Line, offset: number) {
  const place = splitPlace(line.text, offset)!;
  const head = line.text.slice(0, place.headEnd);
  const tail = line.text.slice(place.tailStart);
  const start = line.startTime!;
  const end = line.endTime!;
  // The time the second line starts: the share of the words before it.
  const time = Math.round((start + ((end - start) * place.tailStart) / line.text.length) * 1000) / 1000;
  const sides = (value: unknown) => {
    const first: Span[] = [];
    const second: Span[] = [];
    for (const s of spansOf(value)) {
      if (s.start < place.headEnd) first.push(withQuote({ ...s, end: Math.min(s.end, place.headEnd) }, head));
      if (s.end > place.tailStart) second.push(withQuote({ ...s, start: Math.max(s.start, place.tailStart) - place.tailStart, end: s.end - place.tailStart }, tail));
    }
    return [listOr(first, value), second.length > 0 ? second : null] as const;
  };
  const [styles1, styles2] = sides(line.styles);
  const [links1, links2] = sides(line.links);
  const [citations1, citations2] = sides(line.citations);
  return {
    first: { text: head, endTime: time, styles: styles1, links: links1, citations: citations1 },
    second: { text: tail, startTime: time, endTime: end, speaker: line.speaker, styles: styles2, links: links2, citations: citations2 },
    headEnd: place.headEnd,
    tailStart: place.tailStart,
    time,
  };
}

/** An anchor's context in a text: the words around its range. */
export function context(text: string, start: number, end: number): { prefix: string; suffix: string } {
  return { prefix: text.slice(Math.max(0, start - CONTEXT), start), suffix: text.slice(end, end + CONTEXT) };
}
