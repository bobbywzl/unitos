// The passages to check (SPEC.md §7). Three rounds of the assistant loop
// found the same fault in the answers over a long reading: a passage that
// bears on the question stood in the reading and the answer left it out
// (a table of the historical estimates, the letter the question was about).
// The model reads a long reading once and writes from what it kept. So the
// message names the passages whose words match it, most first, as block
// tags, and the rule says to read each before writing. The ranking is the
// lexical pass's (BM25 over the blocks, lib/graph/rank.ts) on the
// message's content words, so it costs nothing and names the same blocks
// for the same message.

import { contentWords, summaryAsk } from "@/lib/assistant/document-reading";
import type { ReadBlock } from "@/lib/assistant/citations";
import { rank } from "@/lib/graph/rank";

export const HINTS_MAX = 12;
const HINT_MIN_CHARS = 40;

/** The ids of the blocks whose words match the question, most first: up
    to HINTS_MAX, none when the question has no content words or no block
    matches, and none for a message over the whole document. A block under
    HINT_MIN_CHARS (a heading, a label) is skipped. */
export function passageHints(blocks: ReadBlock[], question: string, max = HINTS_MAX): string[] {
  // A message that asks for a summary or the document's structure reads
  // the whole and its sketch; a list of the blocks that match its words
  // pulls the answer into detail.
  if (summaryAsk(question)) return [];
  const query = contentWords(question);
  if (!query.trim()) return [];
  const candidates = blocks.filter((b) => b.text.length >= HINT_MIN_CHARS);
  return rank(candidates, (b) => b.text, query)
    .filter((r) => r.score > 0)
    .slice(0, max)
    .map((r) => r.item.id);
}
