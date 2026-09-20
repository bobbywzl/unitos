import { JEV_MODEL, jevEnabled, systemOne } from "@/lib/jev";
import type { ParsedBlock } from "@/lib/parse/types";

// The page kind (SPEC.md §15): what a fetched page is, judged by Jev from
// its title and text before any model pass reads it. A wall — a consent
// page, a sign-in page, a subscription teaser, an error page — is not the
// article, and the import stops there with a plain reason instead of
// parsing the wall's words as a document. The rule around Jev is in code:
// only a short page can be a wall. A real article that happens to mention
// signing in is long, and its length alone says it is the article.

export type PageKind =
  | "paper"
  | "news"
  | "blog"
  | "docs"
  | "forum"
  | "consent_wall"
  | "login_wall"
  | "paywall"
  | "error_page";

export const WALL_KINDS: ReadonlySet<PageKind> = new Set<PageKind>(["consent_wall", "login_wall", "paywall", "error_page"]);

const WALL_MIN_CONFIDENCE = 0.7;
const WALL_MAX_CHARS = 4_000; // a page with more text than this is never a wall
const HEAD_CHARS = 3_000;
const TAIL_CHARS = 1_500;

const CRITERIA: Record<PageKind, string> = {
  paper: "A research paper or preprint: abstract, sections, references, authors with affiliations.",
  news: "A news report: dated, by a reporter or an agency, on an event.",
  blog: "A post by a person or a company: an essay, an opinion, a tutorial, an announcement.",
  docs: "Documentation or a manual: reference pages, API descriptions, how-to steps.",
  forum: "A discussion: a question and answers, a thread of posts, comments under each other.",
  consent_wall: "A consent or cookie page with no article text behind it: only the consent choices.",
  login_wall: "A sign-in page with no article text behind it: only the sign-in or sign-up form.",
  paywall: "A subscription teaser with no article text behind it: only the offer to subscribe, or a headline and one paragraph then the offer.",
  error_page: "An error page: not found, gone, forbidden, an outage, a redirect notice.",
};

/** The page's kind and Jev's confidence, or null without Jev or on failure. */
export async function classifyPage(title: string, blocks: ParsedBlock[]): Promise<{ kind: PageKind; confidence: number } | null> {
  if (!jevEnabled()) return null;
  const text = blocks.map((b) => b.text.trim()).filter(Boolean).join("\n");
  const sample = text.length > HEAD_CHARS + TAIL_CHARS ? `${text.slice(0, HEAD_CHARS)}\n…\n${text.slice(-TAIL_CHARS)}` : text;
  const result = await systemOne({
    state: { title, text: sample, chars: text.length },
    questions: {
      kind: {
        type: "choice",
        instructions: "What this page is.",
        criteria: CRITERIA,
      },
    },
    usage: { userId: null, feature: "page-kind", model: JEV_MODEL },
    label: "PAGE_KIND",
  });
  if (!result.ok) {
    console.warn("[page-kind] jev failed:", result.error);
    return null;
  }
  const answer = result.answers.kind;
  if (answer.type !== "choice" || !(answer.choice in CRITERIA)) return null;
  return { kind: answer.choice as PageKind, confidence: answer.confidence };
}

/** The wall this page is, or null when it is the article: a short page Jev
    is confident is a consent, sign-in, subscription, or error page. */
export async function wallOf(title: string, blocks: ParsedBlock[]): Promise<PageKind | null> {
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (chars > WALL_MAX_CHARS) return null;
  const page = await classifyPage(title, blocks);
  if (!page) return null;
  console.log(`[page-kind] ${page.kind} (${page.confidence.toFixed(2)}) for "${title.slice(0, 60)}"`);
  return WALL_KINDS.has(page.kind) && page.confidence >= WALL_MIN_CONFIDENCE ? page.kind : null;
}
