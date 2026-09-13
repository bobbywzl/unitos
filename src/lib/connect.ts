import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import { CONNECT_EFFORT, CONNECT_MODEL } from "@/lib/derive/config";
import { loadProfile, renderBlockLines } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { Lang } from "@/lib/i18n/config";
import { currentLang } from "@/lib/i18n/server";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { connectPrompt, connectVerifyPrompt } from "@/lib/prompts/connect";

// Recommended links (SPEC.md §13): when a document joins a corpus, scan it
// against the corpus's other documents and store the connections as DocLink
// rows with recommended: true. Two passes, both reading whole documents: the
// scan reads the new document whole against every other document whole, with
// the reader's notes and background as project context, and proposes links;
// the check then reads each pair of documents whole and keeps only the links
// that hold. The model reads the content only — block text, transcript
// included — never a document title, so a link rests on what the documents
// say, not on what they are called. Nothing paints in the text until the
// reader accepts a link — the user approves everything (SPEC.md §1).
// Best-effort like the glossary: a failure never breaks ingest.

const MAX_LINKS = 6;
const MAX_CANDIDATES = 8;
const DOCUMENT_BUDGET = 200_000; // chars of a document sent, the new one or another
const OTHERS_BUDGET = 480_000; // chars across all other documents
const NOTES_BUDGET = 30_000; // chars of the reader's notes across the project

const outputSchema = z.object({
  links: z
    .array(
      z.object({
        fromBlockId: z.string().min(1),
        fromQuote: z.string().min(8).max(300),
        toDocumentId: z.string().min(1),
        toBlockId: z.string().min(1),
        toQuote: z.string().min(8).max(300),
        reason: z.string().min(1).max(200),
      }),
    )
    .max(12),
});

const verifySchema = z.object({
  links: z
    .array(
      z.object({
        index: z.number().int().min(0),
        keep: z.boolean(),
        reason: z.string().min(1).max(200),
      }),
    )
    .max(12),
});

type BlockRow = { id: string; type: string; text: string };
type WholeBlock = Parameters<typeof renderBlockLines>[0][number];

// A document rendered whole up to the budget: whole blocks only, and a
// declared cut past it, so the model knows what it did not read.
function renderWhole(blocks: WholeBlock[], budget: number): string {
  const kept: WholeBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    const size = block.text.length + block.id.length + 24;
    if (used + size > budget) break;
    used += size;
    kept.push(block);
  }
  const cut = blocks.length - kept.length;
  const lines = renderBlockLines(kept);
  return cut > 0 ? `${lines}\n\n[cut: ${cut} more block${cut === 1 ? "" : "s"} of this document not shown]` : lines;
}

function resolveQuote(block: BlockRow | undefined, quote: string) {
  if (!block) return null;
  const at = block.text.indexOf(quote);
  const hit =
    at !== -1
      ? { start: at, end: at + quote.length }
      : matchInText(block.text, { quotedText: quote, prefix: "", suffix: "" });
  if (!hit) return null;
  return {
    blockId: block.id,
    startOffset: hit.start,
    endOffset: hit.end,
    quotedText: block.text.slice(hit.start, hit.end),
    prefix: block.text.slice(Math.max(0, hit.start - 32), hit.start),
    suffix: block.text.slice(hit.end, hit.end + 32),
  };
}

/** Scan one document against its corpus. Returns how many recommended links
    were stored. lang steers the link reasons; when the caller runs in after()
    where the request is gone, pass the language captured at request time. */
export async function buildConnections(
  notebookId: string,
  documentId: string,
  userId: string | null,
  lang?: Lang,
  // The on-demand scan passes the request signal, so Stop aborts the model call.
  signal?: AbortSignal,
): Promise<number> {
  if (!kimiConfigured()) return 0;
  const reasonLang = lang ?? (await currentLang());

  const [document, attachments] = await Promise.all([
    db.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } },
      },
    }),
    db.notebookDocument.findMany({
      where: { notebookId, NOT: { documentId } },
      select: {
        document: {
          select: {
            id: true,
            blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } },
          },
        },
      },
    }),
  ]);
  if (!document || document.blocks.length === 0 || attachments.length === 0) return 0;

  const [profile, noteRows] = await Promise.all([
    loadProfile(notebookId),
    // The reader's notes across the project: what they are working on. The
    // hidden Annotations section stays out — annotations quote the documents,
    // which the model already reads whole.
    db.note.findMany({
      where: { section: { notebookId, hidden: false }, status: "ACCEPTED" },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, content: true, section: { select: { title: true } } },
    }),
  ]);
  let notesUsed = 0;
  const noteLines: string[] = [];
  for (const n of noteRows) {
    const line = `[note ${n.id}] (section: ${n.section.title})\n${n.content.slice(0, 2000)}`;
    if (notesUsed + line.length > NOTES_BUDGET) break;
    notesUsed += line.length;
    noteLines.push(line);
  }
  const notes = noteLines.join("\n\n");

  const otherById = new Map(attachments.map((a) => [a.document.id, a.document]));
  const otherSections: string[] = [];
  let othersUsed = 0;
  let othersLeftOut = 0;
  for (const { document: other } of attachments) {
    if (other.blocks.every((b) => !b.text.trim())) continue;
    const rendered = `[document ${other.id}]\n${renderWhole(other.blocks, DOCUMENT_BUDGET)}`;
    if (othersUsed + rendered.length > OTHERS_BUDGET) {
      othersLeftOut++;
      continue;
    }
    othersUsed += rendered.length;
    otherSections.push(rendered);
  }
  if (otherSections.length === 0) return 0;
  if (othersLeftOut > 0) {
    otherSections.push(
      `[cut: ${othersLeftOut} more document${othersLeftOut === 1 ? "" : "s"} of the project not shown]`,
    );
  }

  const documentBlocks = renderWhole(document.blocks, DOCUMENT_BUDGET);
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: connectPrompt({
        lang: reasonLang,
        profile,
        documentBlocks,
        others: otherSections.join("\n\n"),
        notes,
      }),
    },
  ];
  const result = await callForJson({
    model: await kimi(CONNECT_MODEL),
    messages,
    maxOutputTokens: 24576,
    providerOptions: kimiOptions(CONNECT_EFFORT),
    schema: outputSchema,
    label: "CONNECT",
    usage: { userId, feature: "connect", model: CONNECT_MODEL },
    abortSignal: signal,
  });
  if (!result.ok) {
    console.warn("[connect] scan failed:", result.error);
    return 0;
  }

  // Resolve every quote against the real block text; drop what does not
  // resolve; drop repeats of links that already exist between the same spans.
  const blockById = new Map(document.blocks.map((b) => [b.id, b]));
  const existing = await db.docLink.findMany({
    where: { fromDocumentId: documentId },
    select: { fromBlockId: true, quotedText: true, toDocumentId: true },
  });
  const seen = new Set(existing.map((l) => `${l.fromBlockId}|${l.quotedText}|${l.toDocumentId}`));

  type Candidate = {
    index: number;
    toDocumentId: string;
    reason: string;
    from: NonNullable<ReturnType<typeof resolveQuote>>;
    to: NonNullable<ReturnType<typeof resolveQuote>>;
  };
  const candidates: Candidate[] = [];
  for (const link of result.data.links) {
    if (candidates.length >= MAX_CANDIDATES) break;
    const other = otherById.get(link.toDocumentId);
    if (!other) continue;
    const from = resolveQuote(blockById.get(link.fromBlockId), link.fromQuote);
    const toBlock = other.blocks.find((b) => b.id === link.toBlockId);
    const to = resolveQuote(toBlock, link.toQuote);
    if (!from || !to) continue;
    const key = `${from.blockId}|${from.quotedText}|${link.toDocumentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ index: candidates.length, toDocumentId: link.toDocumentId, reason: link.reason, from, to });
  }

  // The check: one call per other document the candidates point at, both
  // documents whole. A link the check drops is not stored; a check that
  // fails to answer keeps its candidates as the scan proposed them — a
  // failed call is no evidence against a link.
  const kept: Candidate[] = [];
  const byOther = new Map<string, Candidate[]>();
  for (const c of candidates) byOther.set(c.toDocumentId, [...(byOther.get(c.toDocumentId) ?? []), c]);
  for (const [otherId, group] of byOther) {
    if (signal?.aborted) break;
    const other = otherById.get(otherId);
    if (!other) continue;
    const verify = await callForJson({
      model: await kimi(CONNECT_MODEL),
      messages: [
        {
          role: "user",
          content: connectVerifyPrompt({
            lang: reasonLang,
            profile,
            documentBlocks,
            otherId,
            otherBlocks: renderWhole(other.blocks, DOCUMENT_BUDGET),
            notes,
            candidates: group.map((c) => ({
              index: c.index,
              fromQuote: c.from.quotedText,
              toQuote: c.to.quotedText,
              reason: c.reason,
            })),
          }),
        },
      ],
      maxOutputTokens: 16384,
      providerOptions: kimiOptions(CONNECT_EFFORT),
      schema: verifySchema,
      label: "CONNECT:check",
      usage: { userId, feature: "connect", model: CONNECT_MODEL },
      abortSignal: signal,
    });
    if (!verify.ok) {
      console.warn("[connect] check failed:", verify.error);
      kept.push(...group);
      continue;
    }
    const verdicts = new Map(verify.data.links.map((v) => [v.index, v]));
    for (const c of group) {
      const verdict = verdicts.get(c.index);
      if (!verdict) continue; // not answered: not confirmed, not stored
      if (!verdict.keep) continue;
      kept.push({ ...c, reason: verdict.reason });
    }
  }
  kept.sort((a, b) => a.index - b.index);

  let created = 0;
  for (const link of kept) {
    if (created >= MAX_LINKS) break;
    const { from, to } = link;
    await db.docLink.create({
      data: {
        recommended: true,
        reason: link.reason,
        createdById: userId,
        fromDocumentId: documentId,
        fromBlockId: from.blockId,
        startOffset: from.startOffset,
        endOffset: from.endOffset,
        quotedText: from.quotedText,
        prefix: from.prefix,
        suffix: from.suffix,
        toDocumentId: link.toDocumentId,
        toBlockId: to.blockId,
        toStartOffset: to.startOffset,
        toEndOffset: to.endOffset,
        toQuotedText: to.quotedText,
        toPrefix: to.prefix,
        toSuffix: to.suffix,
      },
    });
    created++;
  }
  if (created > 0) await bumpNotebook(notebookId);
  console.log(`[connect] ${document.title}: ${candidates.length} candidate(s), ${created} recommended link(s)`);
  return created;
}
