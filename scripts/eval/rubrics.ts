// The rubrics of the tool quality loop (SPEC.md §25): what a valuable output
// of each tool is, as criteria the judge scores 1 to 5. The criteria are the
// prompt's own promises (lib/prompts/*), written as questions a reader would
// ask of the output. A criterion the output fails names the change to make.
export type Rubric = { tool: string; what: string; criteria: { key: string; ask: string }[] };

export const RUBRICS: Record<string, Rubric> = {
  simplify: {
    tool: "Simplify",
    what: "A rewrite of the selected passage a reader with no training in the field understands on first read and could explain to someone else.",
    criteria: [
      { key: "first_read", ask: "Would a reader with no training in this field understand the rewrite on the first read, with no term left undefined?" },
      { key: "fidelity", ask: "Does the rewrite keep every claim, number, named entity, and condition of the passage, and add no claim the passage does not make?" },
      { key: "plain", ask: "Are the words everyday words, with each technical term replaced or defined where it first appears, and no filler?" },
      { key: "markers", ask: "Does every rewritten sentence end with one [[n]] marker naming the original sentences it restates, and is every original sentence restated?" },
      { key: "natural", ask: "Does it read as one passage in the passage's own language, saying what happens before why it matters, not as a list of definitions?" },
    ],
  },
  salience: {
    tool: "Salience",
    what: "The spans a reader must not miss: reading only the marked spans, the reader knows what the document claims, found, and rests on.",
    criteria: [
      { key: "coverage", ask: "Do the spans cover the main claim, each finding with its number, the definitions the argument depends on, and the stated limits, across the whole document?" },
      { key: "precision", ask: "Is every span load-bearing, with no framing, background, repetition, or heading marked?" },
      { key: "tightness", ask: "Is each span cut to the clause or sentence that carries the claim or number, never a whole paragraph?" },
      { key: "fit", ask: "Do the spans favor what matters for the reader's stated purpose, when one is set?" },
    ],
  },
  distill: {
    tool: "Extract (DISTILL)",
    what: "The quotes across the document that answer the reader's question, each captioned with the answer it gives.",
    criteria: [
      { key: "answers", ask: "Do the quotes together answer the question as far as the document can, with nothing stretched into an answer it does not give?" },
      { key: "distinct", ask: "Does each quote add something the others do not: a different facet, mechanism, piece of evidence, or side?" },
      { key: "captions", ask: "Does each caption state the answer the quote gives, with its number or named mechanism, and stand on its own without 'the question' or 'this quote'?" },
      { key: "cut", ask: "Is each quote cut to what answers: a phrase, a sentence, or a paragraph that argues as one, never padded or truncated mid-argument?" },
      { key: "honest", ask: "When the document does not answer, or answers only a facet, does the output say so instead of pretending?" },
    ],
  },
  summarize: {
    tool: "Summarize",
    what: "A summary at the asked depth: the reader can say what the document found, with its numbers, and why it matters at that depth; nothing in it could be written without this document.",
    criteria: [
      { key: "findings_first", ask: "Does it lead with what the document found and why it matters, then how, then the limits?" },
      { key: "numbers", ask: "Are the findings carried with their numbers, as printed?" },
      { key: "depth", ask: "Does the wording fit the depth: everyday words and definitions for layman, the document's own terminology for professional?" },
      { key: "specific", ask: "Could every sentence be written only about this document — no sentence that fits any document on the subject?" },
      { key: "grounded", ask: "Does every claim rest on the document, with block tags where the prompt asks for them, and no claim added?" },
    ],
  },
  assistant: {
    tool: "Assistant (panel)",
    what: "An answer to the reader's question from the document: the answer first, every claim on a cited block the reader can open, what the document does not answer said plainly.",
    criteria: [
      { key: "answer_first", ask: "Is the answer in the first one or two sentences, before the evidence?" },
      { key: "evidence", ask: "Does every claim rest on a cited [block <id>] with the exact words quoted, and do the citations point at the passages that actually say it?" },
      { key: "complete", ask: "Does it gather the passages across the document that bear on the question, including one that disagrees, rather than the first it found?" },
      { key: "honest", ask: "Does it say in one sentence what the document does not answer, without filling the gap from general knowledge?" },
      { key: "fit", ask: "Is it written for the reader context: explains what they are least likely to know, skips what they know, connects to their purpose only when real?" },
      { key: "specific", ask: "Could every sentence be written only about this document?" },
    ],
  },
  act: {
    tool: "Selection chat (act)",
    what: "An answer about the selection from the whole document, with the passages across the document that match the selection's topic, each a verbatim quote the reader can jump to.",
    criteria: [
      { key: "answer_first", ask: "Does the reply answer the command in its first sentence, then give the evidence with block tags?" },
      { key: "matches_revealing", ask: "Are the matches the passages that reveal the most about the selection's topic — claims, definitions, evidence, numbers, counterpoints — and not passages that merely mention it?" },
      { key: "matches_complete", ask: "Are the passages a careful reader would find missing from the matches absent? (3 to 8 expected; the selection itself never.)" },
      { key: "why", ask: "Does each why state what the passage says about the topic, with its number or mechanism, not that it is related?" },
      { key: "no_restating", ask: "Is there no sentence that restates the selection in other words and no sentence that fits any document?" },
    ],
  },
  ask: {
    tool: "Ask (video range)",
    what: "An answer to a question about a time range of a recording: from what is said inside the range, quoted with times, nothing invented.",
    criteria: [
      { key: "answer_first", ask: "Is the answer in the first sentence?" },
      { key: "quoted", ask: "Are the speaker's words that carry the answer quoted, each with its time as m:ss?" },
      { key: "inside_range", ask: "Does it answer from inside the range, and when the answer is elsewhere, name that time and say it is outside the range?" },
      { key: "no_invention", ask: "Is there no fact the transcript does not state and no guess at what a speaker meant?" },
    ],
  },
  find: {
    tool: "Find (video)",
    what: "The stretches of a recording where it deals with the search, best first, each explained by what is said there.",
    criteria: [
      { key: "real_matches", ask: "Is every match a stretch where the recording deals with the search, not a passing mention, and is no real stretch missing?" },
      { key: "explanation", ask: "Does each explanation state what is said there, with the speaker's key phrase quoted, not the topic?" },
      { key: "order", ask: "Is the best match first, and are duplicates merged?" },
    ],
  },
};

// The criteria every assistant-voice tool shares, appended to its rubric.
export const SHARED_CRITERIA: { key: string; ask: string }[] = [
  { key: "style", ask: "Is the answer direct and first, in short sentences and plain words, one point per sentence, with no idioms, no complex phrases, no preamble, no filler, and no closing summary?" },
  { key: "language", ask: "Is the output in the language the prompt asked for (the reader's UI language for assistant-voice tools, the passage's language for Simplify)?" },
];
