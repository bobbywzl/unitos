import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// Stitch (SPEC.md §22): the assistant over the members of a multi upload. The
// members are above, each under its id, and each member's note says what
// of it is above — its blocks or its transcript lines, cut for length, or
// nothing and why. One command comes back as links between the members, a
// generated document built from them, or both. The route resolves every
// quote against the real block text before anything is stored: a quote the
// model did not copy verbatim drops (SPEC.md §4).

export type StitchCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  /** note: what was read of the member (lib/multi/stitch.ts coverageNote);
      read: false when nothing of it is above. */
  members: { id: string; title: string; note: string; read: boolean }[];
  command: string;
};

export function stitchPrompt(ctx: StitchCtx): string {
  const name = languageName(ctx.lang);
  const members = ctx.members.map((m) => `[document ${m.id}] "${m.title}" (${m.note})`).join("; ");
  const unread = ctx.members.filter((m) => !m.read);
  return [
    profileLines(ctx.profile),
    "",
    `The documents above are the members of a multi upload, each under its id, with what of it is above: ${members}. Every block is tagged [block <id>]; block ids are unique across all members. A video or audio member is its transcript lines.`,
    ...(unread.length > 0
      ? [
          `Not read: ${unread.map((m) => `"${m.title}"`).join(", ")}. These members have no text above. Never cite them, never guess what they say, and name them in reply as not read, with the reason given.`,
        ]
      : []),
    "",
    "The reader's command:",
    ctx.command,
    "",
    "Do what the command asks with these three outputs. Use only the outputs the command needs; leave the others empty.",
    `1. links: connections between passages of different members — passages that answer the same question, make the same claim, contradict each other, or use the same term. One link is one quote in one member and one quote in another member. fromBlockId and toBlockId are the blocks the quotes sit in; they must be in different members. fromQuote and toQuote are copied verbatim from the block text, 8 to 300 characters each, never paraphrased. reason: one plain sentence saying how the two passages relate, in ${name}. For a contradiction, say what each side claims. Up to 24 links. An empty list is a valid answer.`,
    `2. document: a new page built from the members, when the command asks for one — a page of every passage on a topic, the answers to a question gathered, the contradictions laid out, a synthesis. title: short, in ${name}. parts, in reading order:`,
    '   - {"kind": "heading", "text": "…"}: a section heading. Use a member\'s title as a heading when the page groups passages by member.',
    '   - {"kind": "quote", "blockId": "<id>", "quote": "…"}: one passage copied verbatim from that block — a whole paragraph, or the part of it that matters. Never rewrite it. Use quote parts for everything the command asks to gather, collect, or list from the members.',
    `   - {"kind": "text", "markdown": "…", "sources": [{"blockId": "<id>", "quote": "…"}]}: your own writing, in ${name}, in markdown (paragraphs, lists, bold). sources: the blocks the writing rests on, each with a verbatim quote of 8 to 300 characters. Every text part needs at least one source. Write nothing the members do not support.`,
    "   Up to 200 parts. null when the command asks for no page.",
    `3. reply: one to three plain sentences on what you did, in ${name} — what the page holds, how many links, or why the command could not be done with these members. A member not read, or read only in part, gets one sentence saying so. Never restate the page.`,
    "Rules: every quote is real text of the named block, copied exactly. Never invent a block id. When the command cannot be done with these members, say so in reply and return empty links and a null document.",
    'Return ONLY JSON: {"reply": "…", "links": [{"fromBlockId": "<id>", "fromQuote": "…", "toBlockId": "<id>", "toQuote": "…", "reason": "…"}], "document": {"title": "…", "parts": [{"kind": "heading", "text": "…"}, {"kind": "quote", "blockId": "<id>", "quote": "…"}, {"kind": "text", "markdown": "…", "sources": [{"blockId": "<id>", "quote": "…"}]}]}}',
  ].join("\n");
}
