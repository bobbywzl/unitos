// The grounding check on the assistant's edits (SPEC.md §29, §7): new words
// may explain, connect, or restate, but a number or a quotation in them must
// stand in what the model was given — the document, the reader's command,
// the assistant's instruction and answer, the conversation. A number the
// model made up, or a quotation it reworded, is an op skipped with its why,
// never a write. The check reads characters, not meaning: "16" and
// "sixteen" are two things to it, so it errs toward skipping.

/** Text as the check compares it: curly quotes and dashes plain, spaces one. */
function plain(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»「」『』]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// A number: digits with their decimal point and thousands commas (1,200.5),
// read as its digits and point only.
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const numberKey = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");

/** The numbers a text names. */
export function numbersIn(text: string): Set<string> {
  return new Set([...plain(text).matchAll(NUMBER)].map((m) => numberKey(m[0])));
}

// A quotation: words in double quotes (any kind), three words or more.
const QUOTATION = /"([^"\n]{2,600})"/g;

/** The quotations a text holds, as the check compares them. */
export function quotationsIn(text: string): string[] {
  return [...plain(text).matchAll(QUOTATION)].map((m) => m[1].trim()).filter((q) => q.split(" ").length >= 3);
}

/** Markdown's own numbers: a numbered line's marker and a heading's hashes are no facts. */
const withoutMarkers = (text: string) => text.replace(/^\s*\d{1,3}[.)]\s+/gm, "");

export type Grounding = { numbers: Set<string>; text: string };

/** What new words may draw on, read once per command. */
export function groundingOf(sources: string[]): Grounding {
  const text = plain(sources.join("\n"));
  return { numbers: numbersIn(text), text };
}

/** The first fact in the new words that the sources do not hold — a number
    or a quotation — or null when every one stands in them. Words the op
    replaces count as sources too: they stand in the document. */
export function ungrounded(newText: string, grounding: Grounding): string | null {
  const text = withoutMarkers(newText);
  for (const n of numbersIn(text)) if (!grounding.numbers.has(n)) return n;
  for (const q of quotationsIn(text)) if (!grounding.text.includes(q)) return `"${q}"`;
  return null;
}
