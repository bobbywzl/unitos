import type { ModelMessage } from "ai";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { bumpNotebook } from "@/lib/collab";
import { db } from "@/lib/db";
import { CONNECT_MODEL } from "@/lib/derive/config";
import { renderBlockLines } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { Lang } from "@/lib/i18n/config";
import { currentLang } from "@/lib/i18n/server";
import { kimi, kimiConfigured } from "@/lib/kimi";
import { connectPrompt } from "@/lib/prompts/connect";

// Recommended links (SPEC.md §13): when a document joins a corpus, scan it
// against the corpus's other documents and store the connections as DocLink
// rows with recommended: true. The model reads the content only — block text,
// transcript included — never a document title, so a link rests on what the
// documents say, not on what they are called. Nothing paints in the text until
// the reader accepts a link — the user approves everything (SPEC.md §1).
// Best-effort like the glossary: a failure never breaks ingest.

const MAX_LINKS = 8;
const NEW_DOCUMENT_BUDGET = 50_000; // chars of the new document sent
const PER_DOCUMENT_BUDGET = 15_000; // chars per other document
const OTHERS_BUDGET = 130_000; // chars across all other documents

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

type BlockRow = { id: string; type: string; text: string };

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

  const cap = (text: string, budget: number) =>
    text.length > budget ? text.slice(0, budget) : text;

  const otherById = new Map(attachments.map((a) => [a.document.id, a.document]));
  const otherSections: string[] = [];
  let othersUsed = 0;
  for (const { document: other } of attachments) {
    if (other.blocks.every((b) => !b.text.trim())) continue;
    const rendered = `[document ${other.id}]\n${cap(renderBlockLines(other.blocks), PER_DOCUMENT_BUDGET)}`;
    if (othersUsed + rendered.length > OTHERS_BUDGET) break;
    othersUsed += rendered.length;
    otherSections.push(rendered);
  }
  if (otherSections.length === 0) return 0;

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: connectPrompt({
        lang: reasonLang,
        documentBlocks: cap(renderBlockLines(document.blocks), NEW_DOCUMENT_BUDGET),
        others: otherSections.join("\n\n"),
      }),
    },
  ];
  const result = await callForJson({
    model: kimi(CONNECT_MODEL),
    messages,
    maxOutputTokens: 24576,
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

  let created = 0;
  for (const link of result.data.links) {
    if (created >= MAX_LINKS) break;
    const other = otherById.get(link.toDocumentId);
    if (!other) continue;
    const from = resolveQuote(blockById.get(link.fromBlockId), link.fromQuote);
    const toBlock = other.blocks.find((b) => b.id === link.toBlockId);
    const to = resolveQuote(toBlock, link.toQuote);
    if (!from || !to) continue;
    const key = `${from.blockId}|${from.quotedText}|${link.toDocumentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
  console.log(`[connect] ${document.title}: ${created} recommended link(s)`);
  return created;
}
