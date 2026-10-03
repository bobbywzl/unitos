import { languageName } from "@/lib/prompts/types";
import type { Lang } from "@/lib/i18n/config";

// The check of the assistant's edits (SPEC.md §29, lib/derive/suggest.ts):
// a second reading of one window's ops against the reader's command, before
// any op reaches the page or the plan card. The edits were written by a
// model that may change more than it was asked, drop what it was told to
// keep, or state what the document does not say; the check names those ops,
// and they are skipped with its why. The whole document is the cached system
// prefix; this is the user message. Not in promptTemplates: it is no
// DerivationType.

export type CheckedOp = {
  i: number;
  // What the op does, in a few words: "rewrite", "replace words", "remove blocks".
  kind: string;
  blockIds: string[];
  // The words it changes or removes ("" for new blocks), and the words it writes ("" for a removal).
  before: string;
  after: string;
  why: string;
};

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export function suggestCheckPrompt(ctx: {
  lang: Lang;
  command: string;
  instruction: string | null;
  ops: CheckedOp[];
}): string {
  return [
    "Check the edits below against the reader's command and the document above. Another model wrote them; it may change more than it was asked, change or remove what the command says to keep, or write what the document does not say.",
    "",
    `The reader's command: ${ctx.command}`,
    ...(ctx.instruction ? [`The assistant's instruction: ${ctx.instruction}`] : []),
    "",
    "Edits:",
    ...ctx.ops.flatMap((op) => [
      `#${op.i} ${op.kind} ${op.blockIds.map((id) => `[block ${id}]`).join(" ")}`,
      `  before: ${op.before ? JSON.stringify(clip(op.before, 1500)) : "(nothing)"}`,
      `  after: ${op.after ? JSON.stringify(clip(op.after, 1500)) : "(nothing)"}`,
      `  why: ${op.why}`,
    ]),
    "",
    "Rules:",
    "1. Drop an edit that changes or removes words the command says to keep, or words of a kind it says to keep (quotes, names, numbers, citations, a part it names).",
    "2. Drop an edit that changes or removes what the command did not ask to change. An edit of the kind the command asks for, on a block the command covers, stays.",
    "3. Drop an edit whose new words state a fact, a number, a name, or a claim the document does not state, or change what a passage means beyond what the command asks.",
    "4. Drop an edit that removes a block the command does not call for removing: read the block in the document, not only the edit.",
    "5. Keep every other edit. Never drop an edit for its style or its wording alone.",
    `6. why: one sentence on the rule the edit breaks, in ${languageName(ctx.lang)}.`,
    "",
    'Return ONLY JSON: {"drop": [{"i": <edit number>, "why": "…"}]}. An empty list when every edit stays.',
  ].join("\n");
}
