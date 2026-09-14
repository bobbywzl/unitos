import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import { STITCH_EFFORT, STITCH_MAX_OUTPUT_TOKENS, STITCH_MODEL } from "@/lib/derive/config";
import { loadProfile, renderBlockLines } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { Lang } from "@/lib/i18n/config";
import { kimi, kimiOptions } from "@/lib/kimi";
import { attachDocument } from "@/lib/parse/attach";
import { parseMarkdown } from "@/lib/parse/markdown";
import { PARSER_VERSION, type ParsedBlock } from "@/lib/parse/types";
import { stitchPrompt } from "@/lib/prompts/stitch";
import type { StitchMember, StitchResult } from "@/lib/types";
import { transcriptIsStale } from "@/lib/video/types";

// Stitch (SPEC.md §22): one command over the members of a multi upload. The
// members ride as one cacheable system message — every member rendered
// `[document <id>] "title"` then block lines, a long member cut at a block
// boundary, later members left out whole with a declared marker past the
// budget — and the model answers with links, a generated document, or both.
// A video or audio member reads as its transcript lines and a handwritten
// member as its converted text; a member with nothing to read is declared
// as such to the model, with the reason. The result says what was read of
// every member (StitchMember), so the reader sees which members the answer
// rests on and why one was not read. With fewer than two members read the
// command does not run. Every quote resolves against the real block
// text before anything is stored; a quote that does not resolve drops.
// Links land as recommended links — the reader approves everything (SPEC.md
// §1). A generated document is a real document of the project
// (Document.generatedFromId), every quote part a verbatim passage of a
// member, every part linked back to the block it came from.

const PER_MEMBER_BUDGET = 150_000; // chars per member
const MEMBERS_BUDGET = 600_000; // chars across every member
const MAX_LINKS = 24;
const MAX_PARTS = 200;
const MAX_HISTORY = 20;

const quote = z.string().min(1).max(2_000);
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

// A quote against its block: exact first, then the whitespace-tolerant
// match. Null = the model did not copy the text.
function resolveQuote(block: MemberBlock | undefined, text: string): Resolved | null {
  if (!block) return null;
  const at = block.text.indexOf(text);
  const hit =
    at !== -1
      ? { start: at, end: at + text.length }
      : matchInText(block.text, { quotedText: text, prefix: "", suffix: "" });
  if (!hit || hit.end <= hit.start) return null;
  return {
    blockId: block.id,
    documentId: block.documentId,
    startOffset: hit.start,
    endOffset: hit.end,
    quotedText: block.text.slice(hit.start, hit.end),
    prefix: block.text.slice(Math.max(0, hit.start - 32), hit.start),
    suffix: block.text.slice(hit.end, hit.end + 32),
  };
}

/** The members of a multi upload with their blocks, in member order, and
    the state of each member's transcript or conversion. */
export async function loadMembers(multiUploadId: string) {
  const rows = await db.multiUploadMember.findMany({
    where: { multiUploadId },
    orderBy: { order: "asc" },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          handwritten: true,
          conversionStatus: true,
          conversionError: true,
          video: {
            select: {
              mimeType: true,
              transcriptStatus: true,
              transcriptError: true,
              transcriptStartedAt: true,
            },
          },
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

// The blocks of a member the model can read: blocks with text. The VIDEO
// block holds the title and a PAGE block its page number — neither is
// content — so a video or audio member reads as its transcript lines and a
// handwritten member as its converted text.
function readableBlocks(member: Member): Member["blocks"] {
  return member.blocks.filter(
    (b) => b.type !== "VIDEO" && b.type !== "PAGE" && b.text.trim().length > 0,
  );
}

function memberKind(member: Member): StitchMember["kind"] {
  if (member.video) return member.video.mimeType?.startsWith("audio/") ? "audio" : "video";
  return member.handwritten ? "handwritten" : "text";
}

// Why a member has nothing to read: its transcript or its conversion has
// not landed, or the document holds no text. detail is the stored error.
function emptyReason(member: Member): Pick<StitchMember, "reason" | "detail"> {
  if (member.video) {
    switch (member.video.transcriptStatus) {
      case "PENDING":
        return {
          reason: transcriptIsStale("PENDING", member.video.transcriptStartedAt)
            ? "transcriptStale"
            : "transcriptPending",
          detail: null,
        };
      case "FAILED":
        return { reason: "transcriptFailed", detail: member.video.transcriptError };
      case "NONE":
        return { reason: "transcriptNone", detail: null };
      case "READY":
        return { reason: "noText", detail: null };
    }
  }
  if (member.handwritten) {
    switch (member.conversionStatus) {
      case "PENDING":
        return { reason: "conversionPending", detail: null };
      case "FAILED":
        return { reason: "conversionFailed", detail: member.conversionError };
      case "READY":
        return { reason: "noText", detail: null };
      case "NONE":
      case "OFF":
        return { reason: "conversionNone", detail: null };
    }
  }
  return { reason: "noText", detail: null };
}

// The reason as the model reads it, in the system message and the prompt.
const EMPTY_NOTE: Record<NonNullable<StitchMember["reason"]>, string> = {
  transcriptPending: "its transcript is still being written",
  transcriptStale: "its last transcription run did not finish",
  transcriptFailed: "its transcription failed",
  transcriptNone: "it has no transcript yet",
  conversionPending: "its conversion to text is still running",
  conversionFailed: "its conversion to text failed",
  conversionNone: "it is handwritten and not converted to text yet",
  noText: "it holds no text",
};

const UNIT: Record<StitchMember["kind"], string> = {
  text: "blocks",
  video: "transcript lines",
  audio: "transcript lines",
  handwritten: "converted blocks",
};

/** One member's coverage as the prompt states it beside the member's title. */
export function coverageNote(m: StitchMember): string {
  switch (m.status) {
    case "read":
      return `${m.kind}, ${m.blocks} ${UNIT[m.kind]} read`;
    case "cut":
      return `${m.kind}, the first ${m.blocks} of ${m.total} ${UNIT[m.kind]} read, the rest cut for length`;
    case "leftOut":
      return `${m.kind}, not read: left out for length`;
    case "empty":
      return `${m.kind}, not read: ${EMPTY_NOTE[m.reason ?? "noText"]}`;
  }
}

// The members as one system message, byte-identical from turn to turn so
// the prefix caches (SPEC.md §2), and what went into it of every member. A
// long member cuts at a block boundary, so the blocks the model saw are
// known exactly. A member with nothing to read is declared with its reason,
// so the model knows the member exists and never guesses at its text.
function membersSystem(members: Member[]): { system: string; coverage: StitchMember[] } {
  const rendered: string[] = [];
  const coverage: StitchMember[] = [];
  let used = 0;
  let leftOut = 0;
  for (const member of members) {
    const kind = memberKind(member);
    const blocks = readableBlocks(member);
    const base = { id: member.id, title: member.title, kind, total: blocks.length };
    if (blocks.length === 0) {
      const empty = emptyReason(member);
      coverage.push({ ...base, status: "empty", blocks: 0, ...empty });
      const section = `[document ${member.id}] "${member.title}"\n(nothing to read: ${EMPTY_NOTE[empty.reason ?? "noText"]})`;
      used += section.length;
      rendered.push(section);
      continue;
    }
    // Blocks in order until the member's budget is spent.
    let kept = 0;
    let length = 0;
    for (const block of blocks) {
      const lineLength = block.text.length + block.id.length + 40;
      if (kept > 0 && length + lineLength > PER_MEMBER_BUDGET) break;
      length += lineLength;
      kept++;
    }
    const lines = renderBlockLines(blocks.slice(0, kept));
    const body = kept < blocks.length ? `${lines}\n\n(document cut for length)` : lines;
    const section = `[document ${member.id}] "${member.title}"\n${body}`;
    if (used + section.length > MEMBERS_BUDGET) {
      leftOut++;
      coverage.push({ ...base, status: "leftOut", blocks: 0, reason: null, detail: null });
      continue;
    }
    used += section.length;
    rendered.push(section);
    coverage.push({
      ...base,
      status: kept < blocks.length ? "cut" : "read",
      blocks: kept,
      reason: null,
      detail: null,
    });
  }
  const system = [
    "You assist a reader working across the members of a multi upload. Every member follows.",
    "Each document starts with its id as [document <id>]; each block starts with its id as [block <id>]. Block ids are unique across all members. Reference block ids exactly as given.",
    "A video or audio member is its transcript: every line is a TRANSCRIPT block tagged with its seconds. A member marked (nothing to read: …) has no text here: never cite it and never guess what it says.",
    "",
    rendered.join("\n\n"),
    ...(leftOut > 0 ? ["", `(${leftOut} more member(s) left out for length)`] : []),
  ].join("\n");
  return { system, coverage };
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
  const { system, coverage } = membersSystem(members);
  // Fewer than two members read: no links can be drawn and no page can rest
  // on the members, so nothing runs and nothing is stored. The result says
  // what was read of every member and why the rest were not.
  const read = coverage.filter((m) => m.status === "read" || m.status === "cut");
  if (read.length < 2) return { reply: "", linkCount: 0, document: null, members: coverage };

  const blockById = new Map<string, MemberBlock>();
  for (const member of members) {
    for (const b of readableBlocks(member)) {
      blockById.set(b.id, { id: b.id, type: b.type, text: b.text, documentId: member.id });
    }
  }
  const profile = await loadProfile(input.notebookId);
  const messages: ModelMessage[] = [
    { role: "system", content: system },
    ...input.history.slice(-MAX_HISTORY).map((turn) => ({ role: turn.role, content: turn.content })),
    {
      role: "user",
      content: stitchPrompt({
        profile,
        lang: input.lang,
        members: coverage.map((m) => ({
          id: m.id,
          title: m.title,
          note: coverageNote(m),
          read: m.status === "read" || m.status === "cut",
        })),
        command: input.command,
      }),
    },
  ];
  const result = await callForJson({
    model: await kimi(STITCH_MODEL),
    messages,
    maxOutputTokens: STITCH_MAX_OUTPUT_TOKENS,
    providerOptions: kimiOptions(STITCH_EFFORT),
    schema: outputSchema,
    label: "STITCH",
    usage: { userId: input.userId, feature: "stitch", model: STITCH_MODEL },
    abortSignal: input.signal,
  });
  if (!result.ok) throw input.onFailure(result.error);

  // ── Links: quote to quote across members, stored recommended ─────────────
  const existing = await db.docLink.findMany({
    where: { fromDocumentId: { in: members.map((m) => m.id) } },
    select: { fromBlockId: true, quotedText: true, toDocumentId: true, toBlockId: true },
  });
  const seen = new Set(existing.map((l) => `${l.fromBlockId}|${l.quotedText}|${l.toBlockId ?? l.toDocumentId}`));
  let linkCount = 0;
  for (const link of result.data.links) {
    if (linkCount >= MAX_LINKS) break;
    const from = resolveQuote(blockById.get(link.fromBlockId), link.fromQuote);
    const to = resolveQuote(blockById.get(link.toBlockId), link.toQuote);
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
  return { reply: result.data.reply.trim(), linkCount, document, members: coverage };
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
  for (const part of input.parts) {
    if (part.kind === "heading") {
      const text = part.text.trim().replace(/^#+\s*/, "");
      if (text) chunks.push({ markdown: `## ${text}`, sources: [] });
    } else if (part.kind === "quote") {
      const resolved = resolveQuote(input.blockById.get(part.blockId), part.quote);
      if (!resolved) continue;
      chunks.push({ markdown: resolved.quotedText, sources: [resolved] });
    } else {
      const markdown = part.markdown.trim();
      if (!markdown) continue;
      const sources = part.sources
        .map((s) => resolveQuote(input.blockById.get(s.blockId), s.quote))
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
