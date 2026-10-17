import type { Lang } from "@/lib/i18n/config";
import { languageName } from "@/lib/prompts/types";

// GRAMMAR: the grammar check of the page editor and the note editor (SPEC.md
// §29, typing). Each English paragraph the reader writes is checked on its
// own; the answer is JSON keyed by paragraph id, and every issue names the
// exact wrong words, the words that replace them, and why. The app drops an
// issue whose wrong words are not in the paragraph exactly
// (lib/grammar.ts). Not a derivation — nothing lands in a note — so it is
// not in promptTemplates. The reason is in the reader's language: the card
// shows it beside the app's own words.
export type GrammarCtx = { lang: Lang; paragraphs: { id: string; text: string }[] };

export function grammarPrompt(ctx: GrammarCtx): string {
  const listed = ctx.paragraphs.map((p) => `[paragraph ${p.id}]\n${p.text}`).join("\n\n");
  return [
    "Check each paragraph below for grammar and wording problems. Each paragraph is listed under its id. Check each paragraph on its own.",
    "",
    listed,
    "",
    "Rules:",
    "1. Report only real mistakes: wrong grammar, a wrong word, a missing or extra word, wrong agreement, a wrong verb form, a wrong article, wrong punctuation, a repeated word, clumsy wording that a careful editor would change.",
    "2. Do not report spelling of a single word. Do not report style preferences, tone, or a sentence that is correct as written.",
    "3. Leave names, quotes, code, addresses, numbers, and non-English text as they are.",
    '4. "wrong" is the wrong words copied exactly from the paragraph: the same letters, case, spaces, and punctuation. Keep it short: the wrong words and at most two words around them.',
    '5. When the same words appear more than once in the paragraph, add neighboring words to "wrong" and "replacement" until "wrong" appears only once.',
    '6. "replacement" is the words that take the place of "wrong". Change only what is wrong. "" removes the words.',
    '7. "reason" says why in plain words, at most 8 words: "Use \\"an\\" before a vowel sound", "Repeated word".',
    `8. Write the reason in ${languageName(ctx.lang)}. Never translate "wrong" or "replacement".`,
    "9. A paragraph with no mistake gets an empty list. Use the ids exactly as listed.",
    "",
    'Return ONLY JSON: {"paragraphs": [{"id": "<paragraph id>", "issues": [{"wrong": "<exact words>", "replacement": "<words>", "reason": "<why>"}]}]}',
  ].join("\n");
}
