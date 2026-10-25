// The closing paragraph that says it again (SPEC.md §7). Rule 6 of the
// answer's prompt cuts "a last paragraph that says again what the
// paragraphs before it said"; the model writes one anyway in one answer of
// ten, with a tag it cited already. This pass runs after the model, with
// the figure check: the last paragraph of an answer of three or more goes
// when every block tag in it was cited in a paragraph before it (or it has
// none), it cites no note, it opens with no bold label (a part the rules
// asked for, "Connection to your work"), every figure in it stands in the
// paragraphs before it, and more than half of its content words do too. Anything else stays: a cut that
// takes a new point is worse than a repeat.

import { contentWords } from "@/lib/assistant/document-reading";
import { tokenize } from "@/lib/graph/rank";

const BLOCK_TAG = /\[block ([a-zA-Z0-9-]+)\]/g;
const MIN_PARAGRAPHS = 3;
const OVERLAP = 0.5;

/** `text` without its closing paragraph when that paragraph repeats the
    ones before it (see the file's head); else `text` as it is. */
export function cutRepeatedClosing(text: string): string {
  const paragraphs = text.trimEnd().split(/\n\s*\n/);
  if (paragraphs.length < MIN_PARAGRAPHS) return text;
  const last = paragraphs[paragraphs.length - 1].trim();
  const before = paragraphs.slice(0, -1).join("\n");
  // A list item, a heading, a bold label, a note, a table row: not a closing.
  if (/^(?:[-*]\s|\d+[.)]\s|#|\*\*|\[note |\|)/.test(last) || last.includes("[note ")) return text;
  const tags = [...last.matchAll(BLOCK_TAG)].map((m) => m[1]);
  const earlier = new Set([...before.matchAll(BLOCK_TAG)].map((m) => m[1]));
  if (!tags.every((id) => earlier.has(id))) return text;
  // A figure the paragraphs before it do not hold is new information.
  const figures = last.replace(BLOCK_TAG, "").match(/\d[\d,.]*/g) ?? [];
  const beforePlain = before.replace(BLOCK_TAG, "");
  if (figures.some((f) => !beforePlain.includes(f))) return text;
  const words = new Set(tokenize(contentWords(last.replace(BLOCK_TAG, ""))));
  if (words.size < 5) return text;
  const seen = new Set(tokenize(contentWords(before.replace(BLOCK_TAG, ""))));
  const hit = [...words].filter((w) => seen.has(w)).length;
  if (hit / words.size <= OVERLAP) return text;
  return paragraphs.slice(0, -1).join("\n\n").trimEnd() + "\n";
}
