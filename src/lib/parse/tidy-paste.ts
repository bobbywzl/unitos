import { z } from "zod";
import type { ModelMessage } from "ai";
import { callForJson } from "@/lib/derive/json-call";
import { DEFAULT_PARSE_MODEL, parseCall, parseConfigured } from "@/lib/parse/model";
import type { UsageMeta } from "@/lib/usage";

// A pasted article (SPEC.md §15): the reader copied the article from a site
// that turns Unitos away and pasted the words. One model pass turns the
// paste into the article as Markdown — the title, the byline, the headings,
// the paragraphs, the captions — and drops the page's furniture that came
// along. The pass keeps every sentence of the body as it is; without a
// model, or past the pass's size, the words stand as paragraphs.

export { MAX_PASTE_CHARS } from "@/lib/parse/paste-limits";
// Past this, the paste is too long for one pass: it stands as paragraphs.
const MODEL_PASS_MAX_CHARS = 160_000;

const tidySchema = z.object({ markdown: z.string().min(1) });

function tidyPrompt(text: string, title: string | null): string {
  return [
    "You turn text a reader pasted from a web page into the article as Markdown.",
    "Rules:",
    "1. Keep every sentence of the article's body, in order, word for word. Never add, reword, shorten, summarize, or translate.",
    "2. Drop what is not the article: menus, navigation, cookie notices, sign-in and subscribe prompts, share buttons, related-article lists, comments, ads, footers, newsletter boxes.",
    "3. The first line is the article's title as a level-one heading (# Title). Under it, one line with the byline and the date when the text has them.",
    "4. A section heading becomes a ## heading. A list stays a list. A quote stays a > quote. A picture's caption stays as its own line in italics where the picture stood.",
    "5. Join the lines of one paragraph that the paste broke apart. One blank line between paragraphs.",
    "6. Keep the article's language.",
    ...(title ? [`The page's title: ${title}`] : []),
    "",
    "The paste:",
    "<paste>",
    text,
    "</paste>",
    "",
    'Answer with JSON: {"markdown": "<the article as Markdown>"}.',
  ].join("\n");
}

/** The paste as paragraphs, no model: a line that stands alone is a
    paragraph, the lines a paste broke apart join. */
export function pasteAsParagraphs(text: string, title: string | null): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join(" "))
    .filter(Boolean);
  return [...(title ? [`# ${title}`, ""] : []), ...paragraphs.flatMap((p) => [p, ""])].join("\n").trim() + "\n";
}

/** The pasted article as Markdown: the model's tidy pass, else paragraphs. */
export async function tidyPastedArticle(
  text: string,
  opts: { title?: string | null; signal?: AbortSignal | null; userId?: string | null } = {},
): Promise<{ markdown: string; tidied: boolean }> {
  const title = opts.title?.trim() || null;
  const trimmed = text.trim();
  if (trimmed.length > MODEL_PASS_MAX_CHARS || !(await parseConfigured(DEFAULT_PARSE_MODEL))) {
    return { markdown: pasteAsParagraphs(trimmed, title), tidied: false };
  }
  const messages: ModelMessage[] = [{ role: "user", content: tidyPrompt(trimmed, title) }];
  const { model, providerOptions, modelId } = await parseCall(DEFAULT_PARSE_MODEL);
  const result = await callForJson({
    model,
    messages,
    maxOutputTokens: 32768,
    providerOptions,
    schema: tidySchema,
    label: "INGEST_TIDY_PASTE",
    usage: { userId: opts.userId ?? null, feature: "parse", model: modelId } satisfies UsageMeta,
    abortSignal: opts.signal ?? undefined,
  });
  if (!result.ok) {
    console.warn(`[ingest] tidy pass failed, keeping the paste as paragraphs: ${result.error}`);
    return { markdown: pasteAsParagraphs(trimmed, title), tidied: false };
  }
  const markdown = result.data.markdown.trim();
  // A pass that lost most of the words is no tidy: the paste stands.
  const kept = markdown.replace(/[#>*_`\s]/g, "").length;
  const given = trimmed.replace(/\s/g, "").length;
  if (kept < given * 0.5) {
    console.warn(`[ingest] tidy pass kept ${kept} of ${given} characters, keeping the paste as paragraphs`);
    return { markdown: pasteAsParagraphs(trimmed, title), tidied: false };
  }
  return { markdown: markdown + "\n", tidied: true };
}
