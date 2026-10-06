import { z } from "zod";

// The grammar check (SPEC.md §29, typing): a blue squiggle under the words
// of an English paragraph the model says are wrong, with the words that
// replace them and why. Shared by the route (/api/grammar), the page editor
// (components/docs/typing/proofing.ts), and the note editor
// (components/proofing/note-proofing.tsx).

/** The most paragraphs in one request. */
export const GRAMMAR_MAX_PARAGRAPHS = 6;
/** The longest paragraph checked; a longer one is never sent. */
export const GRAMMAR_MAX_CHARS = 2000;
/** The most text in one request. */
export const GRAMMAR_MAX_REQUEST_CHARS = 6000;
/** The most issues kept for one paragraph. */
export const GRAMMAR_MAX_ISSUES = 12;
/** The pause after typing in a paragraph before it is checked. */
export const GRAMMAR_PAUSE_MS = 2000;

export const grammarIssueSchema = z.object({
  // The wrong words, exactly as the paragraph has them.
  wrong: z.string().min(1).max(300),
  // The words that take their place ("" removes them).
  replacement: z.string().max(300),
  // Why, in a few plain words.
  reason: z.string().min(1).max(200),
});
export type GrammarIssue = z.infer<typeof grammarIssueSchema>;

/** The model's answer: the issues of each paragraph, by the paragraph's id. */
export const grammarAnswerSchema = z.object({
  paragraphs: z
    .array(z.object({ id: z.string().min(1).max(40), issues: z.array(grammarIssueSchema).max(40) }))
    .max(GRAMMAR_MAX_PARAGRAPHS * 2),
});

export const grammarRequestSchema = z.object({
  paragraphs: z
    .array(z.object({ id: z.string().min(1).max(40), text: z.string().min(1).max(GRAMMAR_MAX_CHARS) }))
    .min(1)
    .max(GRAMMAR_MAX_PARAGRAPHS)
    .refine((list) => list.reduce((n, p) => n + p.text.length, 0) <= GRAMMAR_MAX_REQUEST_CHARS),
});

/** The answer the route sends: the kept issues of each paragraph it was sent. */
export type GrammarResponse = { paragraphs: { id: string; issues: GrammarIssue[] }[] };

/** The issues that hold for this text: the wrong words found exactly in it,
    a replacement that changes them, one issue per place, at most
    GRAMMAR_MAX_ISSUES. Any other issue is dropped. */
export function keptIssues(text: string, issues: readonly GrammarIssue[]): GrammarIssue[] {
  const kept: GrammarIssue[] = [];
  const taken: [number, number][] = [];
  for (const issue of issues) {
    if (kept.length >= GRAMMAR_MAX_ISSUES) break;
    if (issue.wrong === issue.replacement || !issue.wrong.trim()) continue;
    const at = text.indexOf(issue.wrong);
    if (at < 0) continue;
    const end = at + issue.wrong.length;
    if (taken.some(([from, to]) => at < to && from < end)) continue;
    taken.push([at, end]);
    kept.push({ wrong: issue.wrong, replacement: issue.replacement, reason: issue.reason.trim() });
  }
  return kept;
}

/** A short, stable key for a paragraph's text (cyrb53). */
export function textKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + text.length.toString(36);
}
