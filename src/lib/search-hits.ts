// A search in the notes lights up the words it found (SPEC.md §6). One
// splitter for every surface that paints a hit — the title row, the rendered
// body, the collapsed line — so they all light up the same runs.

export type TextRun = { text: string; hit: boolean };

/** The text cut into runs: the runs that match the needle, case-insensitive,
    and the runs between them. An empty needle is one run that is no hit. */
export function splitHits(text: string, needle: string): TextRun[] {
  const wanted = needle.trim().toLowerCase();
  if (!wanted || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const runs: TextRun[] = [];
  let at = 0;
  for (let i = lower.indexOf(wanted, at); i !== -1; i = lower.indexOf(wanted, at)) {
    if (i > at) runs.push({ text: text.slice(at, i), hit: false });
    runs.push({ text: text.slice(i, i + wanted.length), hit: true });
    at = i + wanted.length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), hit: false });
  return runs.length > 0 ? runs : [{ text, hit: false }];
}

/** The text the search lights up: the query as typed, unless it looks for a
    note id ("#k3x9pq"), which lights nothing. */
export function searchHit(query: string | undefined): string {
  const needle = query?.trim() ?? "";
  return needle && !needle.startsWith("#") ? needle : "";
}
