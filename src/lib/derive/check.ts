import { db } from "@/lib/db";
import { JEV_MODEL, jevEnabled, systemOne } from "@/lib/jev";

// The check (SPEC.md §25): a tool's output against its rubric, at once,
// on Jev. The rubric's criteria that are judgements — plain words, the
// answer first, nothing added, each quote adds something — are asked as
// yes/no questions of the input and the output; the criteria that count
// (every number kept, every marker present) stay with the eval's
// mechanical checks, since Jev does not count. An output that fails a
// criterion is flagged: one ToolRating row with rating "flag" and the
// failed criteria as its comment, beside the readers' thumbs, so the tool
// quality loop reads it as a case (scripts/eval/import-ratings.ts). The
// reader's card is not held: a streamed output is on screen before the
// check can answer. Extract, whose output is JSON, runs once more on a
// failed check before it is shown (api/derive).

export type CheckTool = "simplify" | "summarize" | "distill" | "assistant";

const PASS_MIN = 0.5; // a criterion holds at this probability or above
const INPUT_MAX = 6_000;
const OUTPUT_MAX = 6_000;
const RATING_INPUT_MAX = 4_000; // as api/ratings stores them
const RATING_OUTPUT_MAX = 12_000;

type Criterion = { key: string; holds: string; fails: string };

const CRITERIA: Record<CheckTool, Criterion[]> = {
  simplify: [
    { key: "first_read", holds: "A reader with no training in the field understands the output on first read, with no term left undefined.", fails: "A term, a symbol, or a step is left for the reader to work out." },
    { key: "nothing_added", holds: "The output makes no claim the input does not make.", fails: "The output states something the input does not state." },
    { key: "plain", holds: "The output uses everyday words; each technical term is replaced or defined where it first appears.", fails: "The output keeps a technical term without defining it, or pads with filler." },
    { key: "natural", holds: "The output reads as one passage, saying what happens before why it matters.", fails: "The output reads as a list of definitions or restates the input in the same words." },
  ],
  summarize: [
    { key: "findings_first", holds: "The output opens with what the document found and why it matters, before how it was done.", fails: "The output opens with background, method, or a description of the document." },
    { key: "style", holds: "The output answers directly and first, in short sentences and plain words, with no idioms, no preamble, and no closing summary.", fails: "The output has a preamble, a closing summary, an idiom, or long winding sentences." },
  ],
  distill: [
    { key: "answers", holds: "The quotes together answer the question as far as they can, with nothing stretched into an answer they do not give.", fails: "A quote is presented as an answer it does not give." },
    { key: "distinct", holds: "Each quote adds something the others do not: a facet, a mechanism, a piece of evidence, a side.", fails: "Two quotes say the same thing." },
    { key: "captions", holds: "Each caption states the answer its quote gives and stands on its own.", fails: "A caption names the topic, says 'this quote', or repeats the question instead of stating the answer." },
    { key: "honest", holds: "When the quotes do not answer the question, or answer only a facet, the output says so.", fails: "The output pretends the question is answered when the quotes do not answer it." },
  ],
  assistant: [
    { key: "answer_first", holds: "The answer is in the first one or two sentences, before the evidence.", fails: "The output opens with context, method, or a restatement of the question." },
    { key: "honest", holds: "Where the material does not answer, the output says so, and does not fill the gap from general knowledge.", fails: "The output fills a gap in the material from general knowledge without saying so." },
    { key: "style", holds: "The output answers directly and first, in short sentences and plain words, with no idioms, no preamble, and no closing summary.", fails: "The output has a preamble, a closing summary, an idiom, or long winding sentences." },
  ],
};

export type CheckInput = {
  tool: CheckTool;
  input: string;
  output: string;
  lang: string;
  userId: string | null;
  notebookId?: string | null;
  documentId?: string | null;
  noteId?: string | null;
  // false: the caller records the flag itself, once it knows which run it kept.
  record?: boolean;
};

/** The criteria the output fails, or null without Jev or on failure. A
    failed check is recorded as a flag unless `record` is false. */
export async function checkOutput(input: CheckInput): Promise<{ failed: string[] } | null> {
  if (!jevEnabled() || !input.output.trim()) return null;
  const criteria = CRITERIA[input.tool];
  const result = await systemOne({
    state: { input: input.input.slice(0, INPUT_MAX), output: input.output.slice(0, OUTPUT_MAX) },
    questions: Object.fromEntries(
      criteria.map((c) => [c.key, { type: "noul" as const, instructions: c.holds, criteria: { true: c.holds, false: c.fails } }]),
    ),
    usage: { userId: input.userId, feature: "check", model: JEV_MODEL },
    label: `CHECK_${input.tool.toUpperCase()}`,
  });
  if (!result.ok) {
    console.warn(`[check] ${input.tool} jev failed:`, result.error);
    return null;
  }
  const failed = criteria.filter((c) => {
    const a = result.answers[c.key];
    return a?.type === "noul" && a.noul < PASS_MIN;
  }).map((c) => c.key);
  if (failed.length > 0 && input.record !== false) await flagOutput({ ...input, failed });
  return { failed };
}

/** The flag: one ToolRating row, rating "flag", the failed criteria as the
    comment, so the loop imports it like a thumb down. */
export async function flagOutput(input: Omit<CheckInput, "record"> & { failed: string[] }): Promise<void> {
  console.log(`[check] ${input.tool} failed: ${input.failed.join(", ")}`);
  await db.toolRating
    .create({
      data: {
        userId: input.userId,
        notebookId: input.notebookId ?? null,
        documentId: input.documentId ?? null,
        noteId: input.noteId ?? null,
        tool: input.tool,
        rating: "flag",
        lang: input.lang,
        input: input.input.slice(0, RATING_INPUT_MAX),
        output: input.output.slice(0, RATING_OUTPUT_MAX),
        comment: `Jev: ${input.failed.join(", ")}`,
      },
    })
    .catch((err) => console.warn("[check] flag not recorded:", err));
}

/** An extraction as text for the check: each caption over its quote. */
export function quotesAsText(quotes: { caption: string; quotedText: string }[]): string {
  return quotes.map((q) => `${q.caption}\n"${q.quotedText}"`).join("\n\n");
}
