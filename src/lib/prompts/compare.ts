import { languageName, profileLines, type PromptCtx } from "@/lib/prompts/types";

// COMPARE: two documents of a project, read whole (SPEC.md §4). The model
// returns the points where the documents agree, where they disagree, and what
// only one of them covers, each point citing spans in the documents. The
// route resolves every span against the real block text and lands one
// PENDING note with a source per resolved span.
export function comparePrompt(ctx: PromptCtx): string {
  const first = ctx.compare?.first;
  const second = ctx.compare?.second;
  return [
    profileLines(ctx.profile),
    "",
    `Two documents are above, each under its id: the first is [document ${first?.id}] "${first?.title}", the second is [document ${second?.id}] "${second?.title}". Every block is tagged [block <id>]; block ids are unique across both documents.`,
    "",
    "Compare the two documents.",
    "1. agreements: claims, findings, or framings both documents make. Up to 8 points.",
    "2. disagreements: claims where the documents conflict — different numbers, opposite conclusions, incompatible framings. Up to 8 points. Say what each document says.",
    "3. onlyFirst: what the first document covers that the second does not. Up to 6 points.",
    "4. onlySecond: what the second document covers that the first does not. Up to 6 points.",
    `5. point: one or two sentences, in ${languageName(ctx.lang)}, naming the documents as "the first document" and "the second document". Concrete: name the number, the claim, the term. Plain words, no filler.`,
    "6. spans: the passages the point rests on, as block id + character offsets into that block's text. An agreement or disagreement cites one span from each document; an onlyFirst point cites the first document, an onlySecond point cites the second. Every span must be real text of the named block. Up to 2 spans per point.",
    "7. Only report real points. An empty list is a valid answer for any of the four.",
    'Return ONLY JSON: {"agreements": [{"point": "…", "spans": [{"blockId": "<id>", "start": 0, "end": 120}]}], "disagreements": […], "onlyFirst": […], "onlySecond": […]}',
  ].join("\n");
}
