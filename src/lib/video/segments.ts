// Transcript segments (SPEC.md §11): the unit every transcription rung
// returns and every consumer reads. One definition here, so the rungs, the
// browser reader, and the job import it without importing each other.
export type TranscriptSegment = { start: number; end: number; text: string };

// Every rung's segments land here before anything else reads them: trimmed,
// in start order, and with the ranges pulled apart. A segment that runs past
// the next segment's start ends where that one begins instead — YouTube's
// auto-captions overlap by seconds, because they are written for a rolling
// two-line caption rather than for a transcript, and an overlapping range
// makes every consumer read the wrong line for a moment: the read-along
// highlight, the anchor a note lands on, the lines a range question reads. A
// real gap between two segments is left alone — nothing is spoken in it.
export function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const ordered = segments
    .map((s) => ({ start: s.start, end: Math.max(s.end, s.start), text: s.text.trim() }))
    .filter((s) => s.text !== "")
    .sort((a, b) => a.start - b.start);
  return ordered.map((s, i) => {
    const next = ordered[i + 1];
    // Two segments starting at the same moment keep their own ends: clamping
    // one to the other's start would leave it with no range at all.
    if (next === undefined || next.start <= s.start || s.end <= next.start) return s;
    return { ...s, end: next.start };
  });
}

// Group segments into transcript lines: one line reads like a sentence or two.
// A line closes at ~280 characters, at a speech gap over 1.5s, or at 30s.
export function groupSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const lines: TranscriptSegment[] = [];
  let open: TranscriptSegment | null = null;
  for (const segment of segments) {
    if (
      open &&
      (open.text.length + segment.text.length > 280 ||
        segment.start - open.end > 1.5 ||
        segment.end - open.start > 30)
    ) {
      lines.push(open);
      open = null;
    }
    open = open
      ? { start: open.start, end: segment.end, text: `${open.text} ${segment.text}` }
      : { ...segment };
  }
  if (open) lines.push(open);
  return lines;
}
