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
import type { StitchMember, StitchResult } from "@/lib/types";
import { transcriptIsStale } from "@/lib/video/types";
import { resolveModelId } from "@/lib/models";

// Stitch (SPEC.md §22): one command over the members of a multi upload. Two
// passes. The select pass reads every member whole, one call per member, all
// at once: each call's system message is that member alone — byte-identical
// from turn to turn and from command to command, so the prefix caches — and
// the call names the blocks the command needs from that member. Reading the
// members side by side instead of one after the other takes the time of the
// longest member, not the sum, and each read is over one member, so a pick
// never favours the first member. The answer pass reads the picks, in member
// order with the gaps declared, and answers with links, a generated
// document, or both. Short members skip the select pass: the answer pass
// reads them whole.
// The model reads and writes short block aliases, never the stored ids: the
// member's letter and the block's number in it (A1, B12), so a pick of 400
// blocks is a few hundred tokens rather than thousands, a range (B10-B15)
// names consecutive blocks at once, and an alias is copied right far more
// often than a 25-character id. Every alias resolves to the stored block
// here, and the reply's [block …] tags are rewritten to the stored ids
// before the reply leaves.
// A video or audio member reads as its transcript lines and a handwritten
// member as its converted text; a member with nothing to read is declared
// as such to the model, with the reason. The result says what was read of
// every member (StitchMember), so the reader sees which members the answer
// rests on and why one was not read. With fewer than two members read the
// command does not run.
// Every block alias and every quote resolves against the real block text
// before anything is stored: a quote the model did not copy verbatim falls
// back to its whole block, and an alias that names no block drops. Links land
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

/** One readable block of a member: its stored id, and the alias the model
    reads it under (the member's letter and the block's number, B12). */
type MemberBlock = { id: string; alias: string; type: string; text: string; documentId: string };

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
    No quote is the named block whole. Null when the alias names no block.
    blockByRef: every block under its alias (lib/multi/stitch.ts memberLetter)
    and under its stored id, so either form the model writes resolves. */
export function resolveQuote(
  blockByRef: Map<string, MemberBlock>,
  blockId: string,
  text: string | undefined,
): Resolved | null {
  const ref = blockId.trim();
  const named = blockByRef.get(ref) ?? blockByRef.get(ref.toUpperCase());
  if (!named) return null;
  const wanted = text?.trim() ?? "";
  if (!wanted || !named.text.trim()) return resolvedAt(named, 0, named.text.length);
  const inNamed = findIn(named, wanted);
  if (inNamed) return inNamed;
  if (wanted.length >= 20) {
    for (const block of blockByRef.values()) {
      const at = block.text.indexOf(wanted);
      if (at !== -1) return resolvedAt(block, at, at + wanted.length);
    }
  }
  return resolvedAt(named, 0, named.text.length);
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

/** The member's letter, by its place in the multi upload: A to Z, then AA,
    AB, … — the document tag the model reads, and the first part of every
    block alias of the member. */
export function memberLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

// The blocks of a member the model can read: blocks with text. The VIDEO
// block holds the title and a PAGE block its page number — neither is
// content — so a video or audio member reads as its transcript lines and a
// handwritten member as its converted text.
function readableBlocks(member: Member): Member["blocks"] {
  return member.blocks.filter(
    (b) => b.type !== "VIDEO" && b.type !== "PAGE" && b.text.trim().length > 0,
  );
}

/** The member's readable blocks under their aliases, in reading order. */
function memberBlocks(member: Member, letter: string): MemberBlock[] {
  return readableBlocks(member).map((b, i) => ({
    id: b.id,
    alias: `${letter}${i + 1}`,
    type: b.type,
    text: b.text,
    documentId: member.id,
  }));
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

const CONTEXT_HEAD = [
  "You assist a reader working across the members of a multi upload.",
  "Each document starts with its letter as [document <letter>]; each block starts with its alias as [block <alias>]: the document's letter and the block's number in it, in reading order (A1, A2, B1). Aliases are unique across all members. Reference blocks by alias exactly as given.",
  "A video or audio member is its transcript: every line is a TRANSCRIPT block tagged with its seconds. A member marked (nothing to read: …) has no text here: never cite it and never guess what it says.",
  "",
];

function emptySection(letter: string, member: Member, reason: StitchMember["reason"]): string {
  return `[document ${letter}] "${member.title}"\n(nothing to read: ${EMPTY_NOTE[reason ?? "noText"]})`;
}

/** One member's readable blocks as the model reads them: the stored block
    lines under their aliases. */
function aliasedLines(blocks: MemberBlock[], source: Member["blocks"]): string {
  const stored = new Map(source.map((b) => [b.id, b]));
  return renderBlockLines(
    blocks.flatMap((b) => {
      const row = stored.get(b.id);
      return row ? [{ ...row, id: b.alias }] : [];
    }),
  );
}

/** One member in the multi upload: its letter, its blocks under their
    aliases, what went into its rendering (coverage), and the rendering
    itself — the member whole, cut at a block boundary past the member's
    budget, or declared with the reason it has nothing to read. The
    rendering is byte-identical from turn to turn, so the select pass's
    prefix caches per member. */
type Rendered = {
  letter: string;
  member: Member;
  blocks: MemberBlock[];
  coverage: StitchMember;
  section: string;
};

function renderMember(member: Member, index: number): Rendered {
  const letter = memberLetter(index);
  const kind = memberKind(member);
  const blocks = memberBlocks(member, letter);
  const base = { id: member.id, title: member.title, kind, total: blocks.length };
  if (blocks.length === 0) {
    const empty = emptyReason(member);
    return {
      letter,
      member,
      blocks,
      coverage: { ...base, status: "empty", blocks: 0, ...empty },
      section: emptySection(letter, member, empty.reason),
    };
  }
  // Blocks in order until the member's budget is spent.
  let kept = 0;
  let length = 0;
  for (const block of blocks) {
    const lineLength = block.text.length + block.alias.length + 40;
    if (kept > 0 && length + lineLength > PER_MEMBER_BUDGET) break;
    length += lineLength;
    kept++;
  }
  const lines = aliasedLines(blocks.slice(0, kept), member.blocks);
  const body = kept < blocks.length ? `${lines}\n\n(document cut for length)` : lines;
  return {
    letter,
    member,
    blocks: blocks.slice(0, kept),
    coverage: {
      ...base,
      status: kept < blocks.length ? "cut" : "read",
      blocks: kept,
      reason: null,
      detail: null,
    },
    section: `[document ${letter}] "${member.title}"\n${body}`,
  };
}

/** Every member rendered, in order; past the members budget a member is
    left out whole, declared as such. length: the chars of member text sent. */
function renderMembers(members: Member[]): { rendered: Rendered[]; length: number } {
  const rendered: Rendered[] = [];
  let used = 0;
  members.forEach((member, index) => {
    const r = renderMember(member, index);
    if (r.coverage.status !== "empty" && used + r.section.length > MEMBERS_BUDGET) {
      rendered.push({
        ...r,
        blocks: [],
        coverage: { ...r.coverage, status: "leftOut", blocks: 0, reason: null, detail: null },
        section: `[document ${r.letter}] "${member.title}"\n(not read: left out for length)`,
      });
      return;
    }
    used += r.section.length;
    rendered.push(r);
  });
  return { rendered, length: used };
}

/** Every member whole, as one system message: what the answer pass reads
    when the members are short enough to skip the select pass. */
function wholeSystem(rendered: Rendered[]): string {
  return [...CONTEXT_HEAD, "Every member follows.", "", rendered.map((r) => r.section).join("\n\n")].join("\n");
}

/** One member whole, as the select pass's system message: this member and
    nothing else, so the message is the same whatever the command and
    whatever the other members. */
function memberSystem(r: Rendered): string {
  return [...CONTEXT_HEAD, "One member of the multi upload follows.", "", r.section].join("\n");
}

/** The selected blocks as one system message: every member in order, its
    header saying how many of its blocks are shown, the blocks in reading
    order, a gap between two shown blocks declared. A member with nothing
    to read is declared with its reason, as in the whole rendering. */
export function selectedSystem(rendered: Rendered[], selected: Set<string>): string {
  const sections: string[] = [];
  for (const r of rendered) {
    if (r.coverage.status === "empty" || r.coverage.status === "leftOut") {
      sections.push(r.section);
      continue;
    }
    const shown = r.blocks.filter((b) => selected.has(b.alias));
    const header = `[document ${r.letter}] "${r.member.title}" (${shown.length} of ${r.blocks.length} blocks shown)`;
    if (shown.length === 0) {
      sections.push(header);
      continue;
    }
    const lines: string[] = [];
    let last = -1;
    for (const block of shown) {
      const at = r.blocks.indexOf(block);
      if (last !== -1 && at - last > 1) lines.push(`(${at - last - 1} blocks not shown)`);
      lines.push(aliasedLines([block], r.member.blocks));
      last = at;
    }
    sections.push(`${header}\n${lines.join("\n\n")}`);
  }
  return [...CONTEXT_HEAD, "The blocks a first read picked for the command follow.", "", sections.join("\n\n")].join("\n");
}

const PICK_RX = /^([A-Z]+)(\d+)(?:\s*-\s*(?:([A-Z]+))?(\d+))?$/;

/** One pick of the select pass as aliases: an alias as it is (B12), or a
    range of consecutive blocks (B10-B15, B10-15) expanded in order. A pick
    that is not an alias is nothing. */
export function expandPick(pick: string): string[] {
  const m = PICK_RX.exec(pick.trim().toUpperCase());
  if (!m) return [];
  const [, letter, fromText, toLetter, toText] = m;
  if (toText === undefined) return [`${letter}${Number(fromText)}`];
  if (toLetter !== undefined && toLetter !== letter) return [];
  const from = Number(fromText);
  const to = Number(toText);
  if (to < from || to - from >= MAX_SELECTED) return [`${letter}${from}`];
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${letter}${n}`);
  return out;
}

/** The members' picks as one list, most relevant first across members:
    every member's first pick, then every member's second, and so on, so
    the budget below is spent on every member alike rather than on the
    member listed first. */
export function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]);
  return out;
}

/** The select pass's pick cut to the budget: known aliases, once each, in
    the given order (most relevant first) until the chars run out. */
export function cutSelection(aliases: string[], blockByRef: Map<string, MemberBlock>): Set<string> {
  const picked = new Set<string>();
  let used = 0;
  for (const alias of aliases) {
    const block = blockByRef.get(alias);
    if (!block || picked.has(block.alias)) continue;
    if (picked.size >= MAX_SELECTED) break;
    const cost = block.text.length + 40;
    if (used + cost > SELECTED_BUDGET) continue;
    used += cost;
    picked.add(block.alias);
  }
  return picked;
}

// A member's opening, cut to its share of the budget: what the answer pass
// reads of a member whose select call picked nothing or did not answer.
function opening(r: Rendered, share: number): string[] {
  const picked: string[] = [];
  let used = 0;
  for (const block of r.blocks) {
    const cost = block.text.length + 40;
    if (used + cost > share) break;
    used += cost;
    picked.push(block.alias);
  }
  return picked;
}

/** The reply's block tags as the stored ids: the model writes [block B12],
    the reader's chips need [block <id>] (components/markdown.tsx). */
export function replyWithIds(reply: string, blockByRef: Map<string, MemberBlock>): string {
  return reply.replace(/\[block ([A-Za-z]+\d+)\]/g, (tag, alias: string) => {
    const block = blockByRef.get(alias.toUpperCase());
    return block ? `[block ${block.id}]` : tag;
  });
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
  const { rendered, length } = renderMembers(members);
  const coverage = rendered.map((r) => r.coverage);
  // Fewer than two members read: no links can be drawn and no page can rest
  // on the members, so nothing runs and nothing is stored. The result says
  // what was read of every member and why the rest were not.
  const read = rendered.filter((r) => r.coverage.status === "read" || r.coverage.status === "cut");
  if (read.length < 2) return { reply: "", linkCount: 0, document: null, members: coverage };

  // Every block under its alias and under its stored id.
  const blockByRef = new Map<string, MemberBlock>();
  for (const r of rendered) {
    for (const b of r.blocks) {
      blockByRef.set(b.alias, b);
      blockByRef.set(b.id, b);
    }
  }
  const profile = await loadProfile(input.notebookId);
  const memberList = rendered.map((r) => ({
    tag: r.letter,
    title: r.member.title,
    note: coverageNote(r.coverage),
    read: r.coverage.status === "read" || r.coverage.status === "cut",
  }));
  const history: ModelMessage[] = input.history
    .slice(-MAX_HISTORY)
    .filter((turn) => turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
  const model = await kimi(STITCH_MODEL);
  const usage = { userId: input.userId, feature: "stitch" as const, model: await resolveModelId(STITCH_MODEL) };

  // ── The select pass: the blocks the command needs, one call per member ───
  let context = wholeSystem(rendered);
  let selected = false;
  if (length > WHOLE_THRESHOLD) {
    const share = Math.floor(SELECTED_BUDGET / read.length);
    const picks = await Promise.all(
      read.map(async (r): Promise<string[]> => {
        const pick = await callForJson({
          model,
          messages: [
            { role: "system", content: memberSystem(r) },
            ...history,
            {
              role: "user",
              content: stitchSelectPrompt({
                profile,
                members: memberList,
                member: r.letter,
                command: input.command,
                maxBlocks: MAX_SELECTED,
              }),
            },
          ],
          maxOutputTokens: STITCH_SELECT_MAX_OUTPUT_TOKENS,
          providerOptions: kimiOptions(STITCH_SELECT_EFFORT),
          schema: selectSchema,
          label: `STITCH_SELECT ${r.letter}`,
          usage,
          abortSignal: input.signal,
        });
        if (!pick.ok) {
          if (input.signal?.aborted) throw input.onFailure(pick.error);
          console.warn(`[stitch] select of member ${r.letter} failed, reading its opening:`, pick.error);
          return opening(r, share);
        }
        // This member's blocks only: a pick that names another member's
        // block, or none, is nothing.
        const own = pick.data.blockIds.flatMap(expandPick).filter((a) => blockByRef.get(a)?.documentId === r.member.id);
        return own.length > 0 ? own : opening(r, share);
      }),
    );
    if (input.signal?.aborted) throw input.onFailure("aborted");
    context = selectedSystem(rendered, cutSelection(interleave(picks), blockByRef));
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
    usage,
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
    const from = resolveQuote(blockByRef, link.fromBlockId, link.fromQuote);
    const to = resolveQuote(blockByRef, link.toBlockId, link.toQuote);
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
      blockById: blockByRef,
    });
  }

  if (linkCount > 0 || document) await bumpNotebook(input.notebookId);
  return { reply: replyWithIds(result.data.reply.trim(), blockByRef), linkCount, document, members: coverage };
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
