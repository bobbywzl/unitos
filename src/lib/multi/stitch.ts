import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import {
  STITCH_EFFORT,
  STITCH_MAX_OUTPUT_TOKENS,
  STITCH_MODEL,
  STITCH_SELECT_EFFORT,
  STITCH_SELECT_MAX_OUTPUT_TOKENS,
} from "@/lib/derive/config";
import { loadProfile, renderBlockLines } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { Lang } from "@/lib/i18n/config";
import { kimi, kimiOptions } from "@/lib/kimi";
import { attachDocument } from "@/lib/parse/attach";
import { parseMarkdown } from "@/lib/parse/markdown";
import { PARSER_VERSION, type ParsedBlock } from "@/lib/parse/types";
import { stitchPrompt, stitchSelectPrompt } from "@/lib/prompts/stitch";
import type { StitchResult } from "@/lib/types";

// Stitch (SPEC.md §22): one command over the members of a multi upload. Two
// passes. The select pass reads every member whole — one cacheable system
// message, byte-identical from turn to turn: every member rendered
// `[document <id>] "title"` then block lines, later members cut whole with a
// declared marker past the budget — and names the blocks the command needs.
// The answer pass reads those blocks, in member order with the gaps
// declared, and answers with links, a generated document, or both. Short
// members skip the select pass: the answer pass reads them whole.
// Every block id and every quote resolves against the real block text
// before anything is stored: a quote the model did not copy verbatim falls
// back to its whole block, and an id that names no block drops. Links land
// as recommended links — the reader approves everything (SPEC.md §1). A
// generated document is a real document of the project
// (Document.generatedFromId), every quote part a verbatim passage of a
// member, every part linked back to the block it came from.

const PER_MEMBER_BUDGET = 150_000; // chars per member, the select pass
const MEMBERS_BUDGET = 600_000; // chars across every member, the select pass
const WHOLE_THRESHOLD = 120_000; // members this short skip the select pass
const SELECTED_BUDGET = 200_000; // chars of selected blocks the answer pass reads
const MAX_SELECTED = 400; // blocks the select pass may name
const MAX_LINKS = 24;
const MAX_PARTS = 200;
const MAX_HISTORY = 20;

const quote = z.string().max(2_000).optional();
const sourceSchema = z.object({ blockId: z.string().min(1), quote });
const partSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), text: z.string().min(1).max(300) }),
  z.object({ kind: z.literal("quote"), blockId: z.string().min(1), quote }),
  z.object({
    kind: z.literal("text"),
    markdown: z.string().min(1).max(20_000),
    sources: z.array(sourceSchema).max(8).default([]),
  }),
]);
const selectSchema = z.object({
  blockIds: z.array(z.string().min(1)).max(MAX_SELECTED * 2).default([]),
});
const outputSchema = z.object({
  reply: z.string().max(4_000).default(""),
  links: z
    .array(
      z.object({
        fromBlockId: z.string().min(1),
        fromQuote: quote,
        toBlockId: z.string().min(1),
        toQuote: quote,
        reason: z.string().min(1).max(600),
      }),
    )
    .max(48)
    .default([]),
  document: z
    .object({ title: z.string().min(1).max(200), parts: z.array(partSchema).max(400) })
    .nullable()
    .default(null),
});

export type StitchTurn = { role: "user" | "assistant"; content: string };

type MemberBlock = { id: string; type: string; text: string; documentId: string };

type Resolved = {
  blockId: string;
  documentId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

function resolvedAt(block: MemberBlock, start: number, end: number): Resolved {
  return {
    blockId: block.id,
    documentId: block.documentId,
    startOffset: start,
    endOffset: end,
    quotedText: block.text.slice(start, end),
    prefix: block.text.slice(Math.max(0, start - 32), start),
    suffix: block.text.slice(end, end + 32),
  };
}

// The quote in this block: exact first, then the whitespace-tolerant match.
function findIn(block: MemberBlock, text: string): Resolved | null {
  const at = block.text.indexOf(text);
  const hit =
    at !== -1
      ? { start: at, end: at + text.length }
      : matchInText(block.text, { quotedText: text, prefix: "", suffix: "" });
  if (!hit || hit.end <= hit.start) return null;
  return resolvedAt(block, hit.start, hit.end);
}

/** A quote against the blocks: in the named block first; then, when the
    model named the wrong block, exact in any block; then the named block
    whole — a quote that was not copied verbatim still points at real text.
    No quote is the named block whole. Null when the id names no block. */
export function resolveQuote(
  blockById: Map<string, MemberBlock>,
  blockId: string,
  text: string | undefined,
): Resolved | null {
  const named = blockById.get(blockId);
  if (!named) return null;
  const wanted = text?.trim() ?? "";
  if (!wanted || !named.text.trim()) return resolvedAt(named, 0, named.text.length);
  const inNamed = findIn(named, wanted);
  if (inNamed) return inNamed;
  if (wanted.length >= 20) {
    for (const block of blockById.values()) {
      const at = block.text.indexOf(wanted);
      if (at !== -1) return resolvedAt(block, at, at + wanted.length);
    }
  }
  return resolvedAt(named, 0, named.text.length);
}

/** The members of a multi upload with their blocks, in member order. */
export async function loadMembers(multiUploadId: string) {
  const rows = await db.multiUploadMember.findMany({
    where: { multiUploadId },
    orderBy: { order: "asc" },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          blocks: {
            orderBy: { order: "asc" },
            select: { id: true, type: true, text: true, startTime: true, endTime: true },
          },
        },
      },
    },
  });
  return rows.map((r) => r.document);
}

type Member = Awaited<ReturnType<typeof loadMembers>>[number];

const CONTEXT_HEAD = [
  "You assist a reader working across the members of a multi upload.",
  "Each document starts with its id as [document <id>]; each block starts with its id as [block <id>]. Block ids are unique across all members. Reference block ids exactly as given.",
  "",
];

// Every member whole, as one system message — byte-identical from turn to
// turn so the prefix caches (SPEC.md §2). Cut at the budgets, the cut declared.
function wholeSystem(members: Member[]): { text: string; length: number } {
  const rendered: string[] = [];
  let used = 0;
  let cut = 0;
  for (const member of members) {
    const lines = renderBlockLines(member.blocks);
    const body =
      lines.length > PER_MEMBER_BUDGET
        ? `${lines.slice(0, PER_MEMBER_BUDGET)}\n\n(document cut for length)`
        : lines;
    const section = `[document ${member.id}] "${member.title}"\n${body}`;
    if (used + section.length > MEMBERS_BUDGET) {
      cut++;
      continue;
    }
    used += section.length;
    rendered.push(section);
  }
  const text = [
    ...CONTEXT_HEAD,
    "Every member follows.",
    "",
    rendered.join("\n\n"),
    ...(cut > 0 ? ["", `(${cut} more member(s) left out for length)`] : []),
  ].join("\n");
  return { text, length: used };
}

/** The selected blocks as one system message: every member in order, its
    header saying how many of its blocks are shown, the blocks in reading
    order, a gap between two shown blocks declared. */
export function selectedSystem(members: Member[], selectedIds: Set<string>): string {
  const rendered: string[] = [];
  for (const member of members) {
    const shown = member.blocks.filter((b) => selectedIds.has(b.id));
    const header = `[document ${member.id}] "${member.title}" (${shown.length} of ${member.blocks.length} blocks shown)`;
    if (shown.length === 0) {
      rendered.push(header);
      continue;
    }
    const lines: string[] = [];
    let last = -1;
    for (const block of shown) {
      const at = member.blocks.indexOf(block);
      if (last !== -1 && at - last > 1) lines.push(`(${at - last - 1} blocks not shown)`);
      lines.push(renderBlockLines([block]));
      last = at;
    }
    rendered.push(`${header}\n${lines.join("\n\n")}`);
  }
  return [...CONTEXT_HEAD, "The blocks a first read picked for the command follow.", "", rendered.join("\n\n")].join("\n");
}

/** The select pass's pick cut to the budget: known ids, once each, in the
    model's order (most relevant first) until the chars run out. */
export function cutSelection(ids: string[], blockById: Map<string, MemberBlock>): Set<string> {
  const picked = new Set<string>();
  let used = 0;
  for (const id of ids) {
    const block = blockById.get(id);
    if (!block || picked.has(id)) continue;
    if (picked.size >= MAX_SELECTED) break;
    const cost = block.text.length + 40;
    if (used + cost > SELECTED_BUDGET) continue;
    used += cost;
    picked.add(id);
  }
  return picked;
}

// Every member's opening, cut to an equal share of the budget: what the
// answer pass reads when the select pass picked nothing or did not answer.
function openings(members: Member[]): Set<string> {
  const share = Math.floor(SELECTED_BUDGET / Math.max(1, members.length));
  const picked = new Set<string>();
  for (const member of members) {
    let used = 0;
    for (const block of member.blocks) {
      const cost = block.text.length + 40;
      if (used + cost > share) break;
      used += cost;
      picked.add(block.id);
    }
  }
  return picked;
}

/** Run one Stitch command. Throws with the reason on a failed model call. */
export async function stitch(input: {
  multiUploadId: string;
  notebookId: string;
  userId: string | null;
  lang: Lang;
  command: string;
  history: StitchTurn[];
  signal?: AbortSignal;
  onFailure: (reason: string) => Error;
}): Promise<StitchResult> {
  const members = await loadMembers(input.multiUploadId);
  const blockById = new Map<string, MemberBlock>();
  for (const member of members) {
    for (const b of member.blocks) {
      blockById.set(b.id, { id: b.id, type: b.type, text: b.text, documentId: member.id });
    }
  }
  const profile = await loadProfile(input.notebookId);
  const memberList = members.map((m) => ({ id: m.id, title: m.title }));
  const history: ModelMessage[] = input.history
    .slice(-MAX_HISTORY)
    .filter((turn) => turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
  const model = await kimi(STITCH_MODEL);
  const whole = wholeSystem(members);

  // ── The select pass: the blocks the command needs, out of every member ───
  let context = whole.text;
  let selected = false;
  if (whole.length > WHOLE_THRESHOLD) {
    const pick = await callForJson({
      model,
      messages: [
        { role: "system", content: whole.text },
        ...history,
        {
          role: "user",
          content: stitchSelectPrompt({
            profile,
            members: memberList,
            command: input.command,
            maxBlocks: MAX_SELECTED,
          }),
        },
      ],
      maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
      providerOptions: kimiOptions(STITCH_SELECT_EFFORT),
      schema: selectSchema,
      label: "STITCH_SELECT",
      usage: { userId: input.userId, feature: "stitch", model: STITCH_MODEL },
      abortSignal: input.signal,
    });
    if (input.signal?.aborted) throw input.onFailure(pick.ok ? "aborted" : pick.error);
    const ids = pick.ok ? cutSelection(pick.data.blockIds, blockById) : new Set<string>();
    if (!pick.ok) console.warn("[stitch] select pass failed, reading the openings:", pick.error);
    context = selectedSystem(members, ids.size > 0 ? ids : openings(members));
    selected = true;
  }

  // ── The answer pass ──────────────────────────────────────────────────────
  const result = await callForJson({
    model,
    messages: [
      { role: "system", content: context },
      ...history,
      {
        role: "user",
        content: stitchPrompt({
          profile,
          lang: input.lang,
          members: memberList,
          command: input.command,
          selected,
        }),
      },
    ],
    maxOutputTokens: STITCH_MAX_OUTPUT_TOKENS,
    providerOptions: kimiOptions(STITCH_EFFORT),
    schema: outputSchema,
    label: "STITCH",
    usage: { userId: input.userId, feature: "stitch", model: STITCH_MODEL },
    abortSignal: input.signal,
  });
  if (!result.ok) throw input.onFailure(result.error);

  // ── Links: block to block across members, stored recommended ─────────────
  const existing = await db.docLink.findMany({
    where: { fromDocumentId: { in: members.map((m) => m.id) } },
    select: { fromBlockId: true, quotedText: true, toDocumentId: true, toBlockId: true },
  });
  const seen = new Set(existing.map((l) => `${l.fromBlockId}|${l.quotedText}|${l.toBlockId ?? l.toDocumentId}`));
  let linkCount = 0;
  for (const link of result.data.links) {
    if (linkCount >= MAX_LINKS) break;
    const from = resolveQuote(blockById, link.fromBlockId, link.fromQuote);
    const to = resolveQuote(blockById, link.toBlockId, link.toQuote);
    if (!from || !to || from.documentId === to.documentId) continue;
    const key = `${from.blockId}|${from.quotedText}|${to.blockId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.docLink.create({
      data: {
        recommended: true,
        reason: link.reason.trim(),
        createdById: input.userId,
        fromDocumentId: from.documentId,
        fromBlockId: from.blockId,
        startOffset: from.startOffset,
        endOffset: from.endOffset,
        quotedText: from.quotedText,
        prefix: from.prefix,
        suffix: from.suffix,
        toDocumentId: to.documentId,
        toBlockId: to.blockId,
        toStartOffset: to.startOffset,
        toEndOffset: to.endOffset,
        toQuotedText: to.quotedText,
        toPrefix: to.prefix,
        toSuffix: to.suffix,
      },
    });
    linkCount++;
  }

  // ── The generated document ───────────────────────────────────────────────
  let document: StitchResult["document"] = null;
  if (result.data.document) {
    document = await materializeGenerated({
      multiUploadId: input.multiUploadId,
      notebookId: input.notebookId,
      userId: input.userId,
      command: input.command,
      title: result.data.document.title.trim(),
      parts: result.data.document.parts.slice(0, MAX_PARTS),
      blockById,
    });
  }

  if (linkCount > 0 || document) await bumpNotebook(input.notebookId);
  return { reply: result.data.reply.trim(), linkCount, document };
}

type Part = z.infer<typeof partSchema>;

// The generated document: parts become markdown, the markdown becomes blocks
// (lib/parse/markdown.ts), and every part links back to the member block it
// came from — a quote part to the passage it copied, a text part to each of
// its sources. Null when no part resolved: an empty page is not a document.
async function materializeGenerated(input: {
  multiUploadId: string;
  notebookId: string;
  userId: string | null;
  command: string;
  title: string;
  parts: Part[];
  blockById: Map<string, MemberBlock>;
}): Promise<StitchResult["document"]> {
  // One markdown chunk per part, and the sources each chunk carries. A quote
  // part's text is the resolved passage, never the model's copy of it.
  const chunks: { markdown: string; sources: Resolved[] }[] = [];
  const quoted = new Set<string>();
  for (const part of input.parts) {
    if (part.kind === "heading") {
      const text = part.text.trim().replace(/^#+\s*/, "");
      if (text) chunks.push({ markdown: `## ${text}`, sources: [] });
    } else if (part.kind === "quote") {
      const resolved = resolveQuote(input.blockById, part.blockId, part.quote);
      if (!resolved || !resolved.quotedText.trim()) continue;
      // The same passage twice on one page is one passage.
      const key = `${resolved.blockId}|${resolved.startOffset}|${resolved.endOffset}`;
      if (quoted.has(key)) continue;
      quoted.add(key);
      chunks.push({ markdown: resolved.quotedText, sources: [resolved] });
    } else {
      const markdown = part.markdown.trim();
      if (!markdown) continue;
      const sources = part.sources
        .map((s) => resolveQuote(input.blockById, s.blockId, s.quote))
        .filter((s): s is Resolved => s !== null);
      chunks.push({ markdown, sources });
    }
  }
  if (!chunks.some((c) => c.sources.length > 0)) return null;

  // Each chunk parses on its own, so a chunk's blocks are known exactly; the
  // document is the chunks' blocks in order.
  const rows: (Pick<ParsedBlock, "type" | "text" | "html" | "citations" | "styles" | "links"> & {
    order: number;
    sources: Resolved[];
  })[] = [];
  for (const chunk of chunks) {
    const blocks = parseMarkdown(chunk.markdown);
    blocks.forEach((b, i) => {
      rows.push({
        order: rows.length,
        type: b.type,
        text: b.text,
        html: b.html,
        citations: b.citations,
        styles: b.styles,
        links: b.links,
        // The chunk's sources ride on its first block.
        sources: i === 0 ? chunk.sources : [],
      });
    });
  }
  if (rows.length === 0) return null;

  const created = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        title: input.title,
        parserVersion: PARSER_VERSION,
        generatedFromId: input.multiUploadId,
        generatedCommand: input.command.slice(0, 4_000),
      },
    });
    const blocks = await Promise.all(
      rows.map((row) =>
        tx.block.create({
          data: {
            documentId: doc.id,
            order: row.order,
            type: row.type,
            text: row.text,
            html: row.html,
            citations: row.citations,
            styles: row.styles,
            links: row.links,
          },
          select: { id: true, text: true },
        }),
      ),
    );
    // Provenance (SPEC.md §1): every part clicks back to the member block it
    // came from. The whole generated block is the anchor on this side.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const block = blocks[i];
      if (!block.text.trim()) continue;
      for (const source of row.sources) {
        await tx.docLink.create({
          data: {
            recommended: false,
            reason: null,
            createdById: input.userId,
            fromDocumentId: doc.id,
            fromBlockId: block.id,
            startOffset: 0,
            endOffset: block.text.length,
            quotedText: block.text,
            prefix: "",
            suffix: "",
            toDocumentId: source.documentId,
            toBlockId: source.blockId,
            toStartOffset: source.startOffset,
            toEndOffset: source.endOffset,
            toQuotedText: source.quotedText,
            toPrefix: source.prefix,
            toSuffix: source.suffix,
          },
        });
      }
    }
    return doc;
  });
  await attachDocument(input.notebookId, created.id);
  return { id: created.id, title: created.title };
}
