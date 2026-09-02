// Transcript segments (SPEC.md §11): the unit every transcription rung
// returns and every consumer reads. One definition here, so the rungs, the
// browser reader, and the job import it without importing each other.
export type TranscriptSegment = { start: number; end: number; text: string };

export function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((s) => ({ start: s.start, end: Math.max(s.end, s.start), text: s.text.trim() }))
    .filter((s) => s.text !== "")
    .sort((a, b) => a.start - b.start);
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
