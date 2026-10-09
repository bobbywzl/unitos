// The assistant loop's rubrics (SPEC.md §7, §25): what a valuable turn of
// the sidebar assistant is, per family, as questions a reader would ask of
// the answer and the plan. The judge scores each 1 to 5; the mechanical
// checks (run.ts) count what counts.
import type { Family } from "./cases";

export type Criterion = { key: string; ask: string };

export const FAMILY_RUBRIC: Record<Family, { what: string; criteria: Criterion[] }> = {
  answer: {
    what: "An answer to the reader's question from the document: the answer first, every claim on a cited block the reader can open, what the document does not answer said plainly, nothing the reader did not ask for.",
    criteria: [
      { key: "answer_first", ask: "Is the answer in the first one or two sentences, before the evidence?" },
      { key: "evidence", ask: "Does every claim rest on a cited [block <id>] that actually says it, with the exact words where the wording carries the point?" },
      { key: "complete", ask: "Does it gather every passage that bears on the question, including one that disagrees, rather than the first it found?" },
      { key: "honest", ask: "Does it say what the document does not answer, without filling the gap from general knowledge?" },
      { key: "fit", ask: "Is it written for the reader context and, in a conversation, does it add to the earlier answers rather than repeat them?" },
      { key: "no_actions", ask: "Does it propose no change the reader did not ask for (no actions block, no offer to edit)?" },
    ],
  },
  scope: {
    what: "A message that asks for a change where none can run here: the answer says in one sentence where the change runs or why it cannot, proposes no action for it, and still answers what it can.",
    criteria: [
      { key: "says_where", ask: "Does it say in one sentence where the change runs (This page scope with the document open) or why the document cannot be changed?" },
      { key: "no_actions", ask: "Does it propose no action for the change?" },
      { key: "helpful", ask: "Does it still give what it can (what it found, what it could do instead) without doing anything unasked?" },
    ],
  },
  edit: {
    what: "A change to the article's blocks that does exactly what the message asks: the right action on the right block, the new words correct and complete, no block the message did not name touched, and an answer that says what changes in one or two sentences.",
    criteria: [
      { key: "right_action", ask: "Is each action the right type on the right block (an edit for words, a format for a kind, a move for a place, a revise for many blocks), and are there no stray actions?" },
      { key: "exact", ask: "Are the new words exactly what the message asked, with every figure, name, and quotation kept as printed, and nothing else changed inside the block?" },
      { key: "minimal", ask: "Does the plan touch only the blocks the message names, and use the smallest set of actions?" },
      { key: "answer", ask: "Does the answer say what the actions change and why in one or two sentences, without pasting the new text, without preamble?" },
      { key: "descriptions", ask: "Is each action's description one plain sentence a reader can approve from, naming the block or the words it changes?" },
    ],
  },
  suggest: {
    what: "A change to a document with rich text: one suggest action whose blockIds name exactly the part the message concerns (none for the whole document), reorder set only when the message moves blocks, an instruction that says every change to make in plain words without the changed text, and a one-sentence answer.",
    criteria: [
      { key: "one_action", ask: "Is there exactly one suggest action (or none when the message asks for no change)?" },
      { key: "scope", ask: "Do its blockIds name exactly the part the message concerns, and are they absent when the message concerns the whole document?" },
      { key: "instruction", ask: "Does the instruction say every change to make and where, in plain words, under 150 words, without copying the changed text?" },
      { key: "reorder", ask: "Is reorder true exactly when the message moves blocks (group, organize, put in order)?" },
      { key: "answer", ask: "Is the answer one sentence on what will change, with no rewritten text in it?" },
    ],
  },
  section: {
    what: "Notes, sections, and documents made from the material: each note states a point in the reader's own study voice with the document's exact words as its source, each lands in the section asked, a new document is a document and not a note, and nothing is invented.",
    criteria: [
      { key: "right_shape", ask: "Is the thing made the thing asked (a section with notes, a note, a new document), one per item the message names, and nothing else?" },
      { key: "sourced", ask: "Does each note or part quote the document's exact words as its source, on the passage that supports it?" },
      { key: "content", ask: "Does each note or part state the point with its numbers and names as printed, complete and nothing invented?" },
      { key: "placement", ask: "Does each land where the message says (the named section, a new section when asked, a new document when asked)?" },
      { key: "answer", ask: "Does the answer say what was made in one or two sentences?" },
    ],
  },
  annotate: {
    what: "Marks on the passages: every highlight and comment anchored on the exact words that carry what the message asks, every passage that qualifies marked, none that does not, and a comment that says something the passage does not already say.",
    criteria: [
      { key: "anchored", ask: "Is every mark on exact words of the right block, cut to the sentence or clause that carries the point?" },
      { key: "complete", ask: "Is every passage that qualifies marked?" },
      { key: "precise", ask: "Is no passage marked that does not qualify (a number of another kind, a sentence that merely mentions the topic)?" },
      { key: "comment", ask: "Does each comment add what the message asked (the fact, the link to another passage), in one or two plain sentences?" },
      { key: "answer", ask: "Does the answer say what was marked in one or two sentences?" },
    ],
  },
  transcript: {
    what: "A change to a recording's lines that keeps the recording's shape: the right line, the words changed exactly, times and voices kept, a join or a split at the right words, nothing added or moved.",
    criteria: [
      { key: "right_line", ask: "Is the action on the right line, found by its words and its speaker?" },
      { key: "exact", ask: "Are the words changed exactly as asked, the rest of the line kept, and a split placed at the exact words the second line starts with?" },
      { key: "shape", ask: "Does the plan keep the recording's shape: no line added, no line moved, no join across voices?" },
      { key: "answer", ask: "Does the answer say what changes in one sentence?" },
    ],
  },
  confirm: {
    what: "A change carried through the conversation: a confirmation yields the proposed actions in full, a narrowing yields only the part kept, a reversal drops the earlier change and does the new one, with one sentence of answer.",
    criteria: [
      { key: "reads_turn", ask: "Does the plan read the message in the conversation's context: a confirmation as the proposed change, a narrowing as its part, a reversal as a drop?" },
      { key: "complete", ask: "Are the actions written in full, so the plan runs without the earlier turn?" },
      { key: "nothing_more", ask: "Does the plan carry nothing the latest message did not keep?" },
      { key: "answer", ask: "Is the answer one sentence, and never words alone in place of the actions?" },
    ],
  },
};

/** The criteria every family shares. */
export const SHARED: Criterion[] = [
  { key: "style", ask: "Is the answer direct and first, in short sentences and plain words, with no preamble, no filler, and no closing summary?" },
  { key: "language", ask: "Is the answer, and every action description, in the reader's language?" },
];
