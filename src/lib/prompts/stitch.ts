import type { Lang } from "@/lib/i18n/config";
import { languageName, profileLines, type ReaderProfileCtx } from "@/lib/prompts/types";

// Stitch (SPEC.md §22): the assistant over the members of a multi upload.
// Two passes, two prompts. The select pass reads one member whole, one call
// per member, and names the blocks of that member the command needs. The
// answer pass reads those blocks and answers the command as links between
// the members, a generated document built from them, or both. Each member's
// note says what of it is above — its blocks or its transcript lines, cut
// for length, or nothing and why. The model reads and writes block aliases
// (the member's letter and the block's number: A1, B12), never the stored
// ids; the route resolves every alias and every quote against the real
// block text before anything is stored: a quote the model did not copy
// verbatim falls back to its whole block, and an alias that names no block
// drops (SPEC.md §4).

/** tag: the member's letter, its [document <tag>] in the system message;
    note: what was read of the member (lib/multi/stitch.ts coverageNote);
    read: false when nothing of it is above. */
export type StitchMemberCtx = { tag: string; title: string; note: string; read: boolean };

export type StitchSelectCtx = {
  profile: ReaderProfileCtx;
  members: StitchMemberCtx[];
  // The tag of the one member above.
  member: string;
  command: string;
  maxBlocks: number;
};

export type StitchCtx = {
  profile: ReaderProfileCtx;
  lang: Lang;
  members: StitchMemberCtx[];
  command: string;
  // True when the blocks above are the select pass's pick, not every member whole.
  selected: boolean;
};

function memberLines(members: StitchMemberCtx[]): string[] {
  const listed = members.map((m) => `[document ${m.tag}] "${m.title}" (${m.note})`).join("; ");
  const unread = members.filter((m) => !m.read);
  return [
    `The members of the multi upload, each under its letter, with what of it was read: ${listed}. Every block is tagged [block <alias>]: the member's letter and the block's number in it (A1, B12); aliases are unique across all members. A video or audio member is its transcript lines.`,
    ...(unread.length > 0
      ? [
          `Not read: ${unread.map((m) => `"${m.title}"`).join(", ")}. These members have no text above. Never cite them, never guess what they say, and name them in reply as not read, with the reason given.`,
        ]
      : []),
  ];
}

export function stitchSelectPrompt(ctx: StitchSelectCtx): string {
  const member = ctx.members.find((m) => m.tag === ctx.member);
  return [
    profileLines(ctx.profile),
    "",
    ...memberLines(ctx.members),
    `Above is one member only: [document ${ctx.member}]${member ? ` "${member.title}"` : ""}. The other members are read in calls of their own.`,
    "",
    "The reader's command:",
    ctx.command,
    "",
    "A second read will do what the command asks over every member, reading only the blocks picked here and in the other members' reads. Pick every block of this member that bears on the command: a block that mentions the command's topic, answers its question, makes a claim the command asks to compare with the other members, or holds a passage the command asks to gather.",
    "For a command over the members as a whole — the contradictions between them, a synthesis with no topic named — pick the blocks that carry claims, findings, numbers, definitions, and conclusions.",
    "Leave out references, acknowledgements, navigation, and boilerplate. When in doubt, pick the block: a block left out here is never read again.",
    `blockIds: the aliases, most relevant first, up to ${ctx.maxBlocks}. Copy each alias exactly as tagged. Consecutive blocks go as one range, first-last (${ctx.member}10-${ctx.member}15). An empty list means nothing in this member bears on the command.`,
    "Do not think longer than the reading takes: this is a reading, not a problem to solve.",
    `Return ONLY JSON: {"blockIds": ["${ctx.member}3", "${ctx.member}10-${ctx.member}15"]}`,
  ].join("\n");
}

export function stitchPrompt(ctx: StitchCtx): string {
  const name = languageName(ctx.lang);
  return [
    profileLines(ctx.profile),
    "",
    ...memberLines(ctx.members),
    ...(ctx.selected
      ? [
          "A first read picked the blocks above for this command out of every member; each member's header says how many of its blocks are shown. Answer from the blocks shown.",
        ]
      : []),
    "",
    "The reader's command:",
    ctx.command,
    "",
    "Read every member shown before answering: a passage in the last member counts as much as one in the first. Answer the command with these three outputs. Use only the outputs the command needs; leave the others empty.",
    `1. links: connections between passages of different members — passages that answer the same question, make the same claim, contradict each other, or use the same term. One link is one block in one member and one block in another member: fromBlockId and toBlockId, the aliases as tagged, in different members. fromQuote and toQuote: the passage copied verbatim from the block text, 8 to 300 characters, never paraphrased; leave a quote out to link the whole block. reason: one plain sentence saying how the two passages relate, in ${name}. For a contradiction, say what each side claims. Up to 24 links. An empty list is a valid answer.`,
    `2. document: a new page built from the members, when the command asks for one — a page of every passage on a topic, the answers to a question gathered, the contradictions laid out, a synthesis. title: short, in ${name}. parts, in reading order:`,
    '   - {"kind": "heading", "text": "…"}: a section heading. Use a member\'s title as a heading when the page groups passages by member.',
    '   - {"kind": "quote", "blockId": "<alias>"}: one whole block of a member, copied as it is. Add "quote": "…" with a verbatim part of the block to keep that part alone. Use quote parts for everything the command asks to gather, collect, or list from the members; a quote part never rewrites.',
    `   - {"kind": "text", "markdown": "…", "sources": [{"blockId": "<alias>", "quote": "…"}]}: your own writing, in ${name}, in markdown (paragraphs, lists, bold). sources: the blocks the writing rests on, each with a verbatim quote of 8 to 300 characters. Every text part needs at least one source. Write nothing the members do not support.`,
    "   Up to 200 parts. A command that asks to gather and to summarise gets both: the quote parts, then a text part with the summary. null when the command asks for no page.",
    `3. reply: the answer to the command in plain sentences, in ${name}. A question gets its answer here — concise, concrete, every claim with the member it comes from named — and a page only when the command asks for one. A command to gather, link, or write gets one to three sentences on what the page holds, how many links, or why the command could not be done with these members. A member not read, or read only in part, gets one sentence saying so. Never restate the page.`,
    "Rules: every blockId is an alias tagged above, copied exactly; never invent one. In reply, cite a block as [block <alias>]. Every quote is real text of the named block, copied exactly. When the command cannot be done with these members, say so in reply and return empty links and a null document.",
    'Return ONLY JSON: {"reply": "…", "links": [{"fromBlockId": "A3", "fromQuote": "…", "toBlockId": "B12", "toQuote": "…", "reason": "…"}], "document": {"title": "…", "parts": [{"kind": "heading", "text": "…"}, {"kind": "quote", "blockId": "A4"}, {"kind": "quote", "blockId": "B7", "quote": "…"}, {"kind": "text", "markdown": "…", "sources": [{"blockId": "A4", "quote": "…"}]}]}}',
  ].join("\n");
}
