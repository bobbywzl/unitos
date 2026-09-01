import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { callForJson } from "@/lib/derive/json-call";
import type { UsageMeta } from "@/lib/usage";
import type { ParsedBlock } from "@/lib/parse/types";

// AI structure pass for URL ingest: after the mechanical parse, the model tidies
// the block list — drop residual junk, fix a wrong type, merge a split fragment.
// It references blocks by index only and never writes text, so it cannot invent
// content. On any failure the mechanical blocks stand (SPEC.md §2 quality bar).
const INGEST_STRUCTURE_MODEL = "claude-opus-5";
const MAX_LISTED_BLOCKS = 500;

const RETYPABLE = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE"]);

const structureSchema = z.object({
  ops: z
    .array(
      z.object({
        index: z.number().int().min(0),
        action: z.enum(["drop", "retype", "merge_up"]),
        type: z.enum(["PARAGRAPH", "HEADING", "LIST", "CODE"]).optional(),
      }),
    )
    .max(600),
});

const coreSchema = z.object({
  ranges: z
    .array(z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }))
    .max(50),
});

function clip(s: string, n = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// Upload instructions (SPEC.md §14): the reader's instructions for this upload,
// already filtered to what these passes can do. Repeated exact wording in both
// prompts (CLAUDE.md rule 3).
function instructionLines(instructions: string | undefined, scope: string): string[] {
  if (!instructions?.trim()) return [];
  return [
    `The reader gave instructions for this upload. Follow the ones about ${scope}; ignore the rest:`,
    instructions.trim(),
    "",
  ];
}

function structurePrompt(
  title: string | null,
  blocks: ParsedBlock[],
  instructions?: string,
): string {
  const listing = blocks.map((b, i) => `[${i}] ${b.type}: ${clip(b.text)}`).join("\n");
  return [
    `A document${title ? ` titled "${title}"` : ""} was parsed into the numbered blocks below.`,
    "Return ops that clean the structure. Ops reference blocks by index. Never rewrite text.",
    "1. drop: the block is not article content — site chrome, cookie or newsletter fragments,",
    "   share or subscribe fragments, unhydrated widget values (a bare \"0\" or \"0.0M\" and the",
    "   labels around them), stray link lists, footer text.",
    "2. retype: the block has the wrong type. Allowed between PARAGRAPH, HEADING, LIST, CODE",
    "   only. Include \"type\".",
    "3. merge_up: the block is a fragment split mid-sentence from the block above it. Both",
    "   must be PARAGRAPH.",
    "Also drop a leading heading that merely repeats the document title.",
    "Keep every block that is article content. When unsure, keep.",
    ...instructionLines(instructions, "dropping, retyping, or merging blocks"),
    'Return ONLY JSON: {"ops": [{"index": 0, "action": "drop"}, {"index": 4, "action": "retype", "type": "HEADING"}]}',
    "An empty ops array is a valid answer.",
    "",
    "Blocks:",
    listing,
  ].join("\n");
}

function corePrompt(title: string | null, blocks: ParsedBlock[], instructions?: string): string {
  const listing = blocks.map((b, i) => `[${i}] ${b.type}: ${clip(b.text)}`).join("\n");
  return [
    `A web page${title ? ` titled "${title}"` : ""} was parsed into the numbered blocks below.`,
    "Separate the core article from everything else on the page.",
    "Return ranges of block indexes that are the core article — the content a reader",
    "opened this page for: title, byline, abstract, headings, paragraphs, figures,",
    "tables, equations, code, footnotes, references.",
    "Every block outside the ranges is dropped: site navigation, header and footer",
    "link lists, newsletter signup, cookie banners, social links, related-article",
    "promos, comment sections, legal boilerplate.",
    "Ranges are inclusive. Use several ranges when promos interrupt the article.",
    "When unsure about a block, keep it inside a range.",
    ...instructionLines(instructions, "what counts as content to keep or drop"),
    'Return ONLY JSON: {"ranges": [{"start": 2, "end": 41}]}',
    "",
    "Blocks:",
    listing,
  ].join("\n");
}

// Core pass: the model marks which block ranges are the article; everything else
// on the page is dropped. Runs before the structure pass, so the structure pass
// only tidies real content. References blocks by index only — it cannot invent
// content. On any failure, or a selection that keeps almost nothing, the full
// block list stands.
export async function selectCoreBlocks(
  blocks: ParsedBlock[],
  title: string | null,
  instructions?: string,
): Promise<ParsedBlock[]> {
  if (!process.env.ANTHROPIC_API_KEY || blocks.length < 5) return blocks;
  const listed = blocks.slice(0, MAX_LISTED_BLOCKS);

  const messages: ModelMessage[] = [
    { role: "user", content: corePrompt(title, listed, instructions) },
  ];
  const result = await callForJson({
    model: anthropic(INGEST_STRUCTURE_MODEL),
    messages,
    maxOutputTokens: 4096,
    schema: coreSchema,
    label: "INGEST_CORE",
    usage: { userId: null, feature: "parse", model: INGEST_STRUCTURE_MODEL } satisfies UsageMeta,
  });
  if (!result.ok) {
    console.warn(`[ingest] core pass failed, keeping all blocks: ${result.error}`);
    return blocks;
  }

  const keep = new Set<number>();
  for (const range of result.data.ranges) {
    const end = Math.min(listed.length - 1, range.end);
    for (let i = Math.max(0, range.start); i <= end; i++) keep.add(i);
  }
  // Blocks past the listing cap were never judged; keep them.
  for (let i = listed.length; i < blocks.length; i++) keep.add(i);

  const kept = blocks.filter((_, i) => keep.has(i));
  const keptChars = kept.reduce((n, b) => n + b.text.length, 0);
  // Underreach guard: a selection that keeps almost nothing is wrong.
  if (kept.length < 3 || keptChars < 400) {
    console.warn(`[ingest] core pass kept ${kept.length} blocks / ${keptChars} chars, ignored`);
    return blocks;
  }
  console.log(`[ingest] core: kept ${kept.length}/${blocks.length} blocks`);
  return kept;
}

export async function structureBlocks(
  blocks: ParsedBlock[],
  title: string | null,
  instructions?: string,
): Promise<ParsedBlock[]> {
  if (!process.env.ANTHROPIC_API_KEY || blocks.length < 5) return blocks;
  const listed = blocks.slice(0, MAX_LISTED_BLOCKS);

  const messages: ModelMessage[] = [
    { role: "user", content: structurePrompt(title, listed, instructions) },
  ];
  const result = await callForJson({
    model: anthropic(INGEST_STRUCTURE_MODEL),
    messages,
    maxOutputTokens: 8192,
    schema: structureSchema,
    label: "INGEST_STRUCTURE",
    usage: { userId: null, feature: "parse", model: INGEST_STRUCTURE_MODEL } satisfies UsageMeta,
  });
  if (!result.ok) {
    console.warn(`[ingest] structure pass failed, keeping mechanical blocks: ${result.error}`);
    return blocks;
  }

  const drops = new Set<number>();
  const retypes = new Map<number, ParsedBlock["type"]>();
  const merges = new Set<number>();
  for (const op of result.data.ops) {
    if (op.index >= listed.length) continue;
    if (op.action === "drop") drops.add(op.index);
    else if (op.action === "retype" && op.type && RETYPABLE.has(blocks[op.index].type)) {
      retypes.set(op.index, op.type);
    } else if (op.action === "merge_up") merges.add(op.index);
  }
  // Overreach guard: a pass that wants to drop much of the document is wrong.
  // Instructions raise the ceiling — "keep only the appendix" is a big drop the
  // reader asked for — but never remove it entirely.
  const dropCeiling = instructions?.trim() ? 0.9 : 0.4;
  if (drops.size > blocks.length * dropCeiling) {
    console.warn(`[ingest] structure pass wanted ${drops.size}/${blocks.length} drops, ignored`);
    return blocks;
  }

  const out: ParsedBlock[] = [];
  blocks.forEach((block, i) => {
    if (drops.has(i)) return;
    let next = block;
    const retype = retypes.get(i);
    if (retype && retype !== block.type) {
      next = { type: retype, text: block.text, citations: block.citations }; // html belongs to the old type
    }
    const previous = out[out.length - 1];
    if (merges.has(i) && previous?.type === "PARAGRAPH" && next.type === "PARAGRAPH") {
      // Both texts are normalized, so the join is one space: citation offsets
      // in the merged-up block shift by previous.text.length + 1.
      const shift = previous.text.length + 1;
      const citations = [
        ...(previous.citations ?? []),
        ...(next.citations ?? []).map((c) => ({ ...c, start: c.start + shift, end: c.end + shift })),
      ];
      out[out.length - 1] = {
        ...previous,
        text: `${previous.text} ${next.text}`.replace(/\s+/g, " ").trim(),
        ...(citations.length > 0 ? { citations } : {}),
      };
      return;
    }
    out.push(next);
  });
  if (out.length === 0) return blocks;
  console.log(
    `[ingest] structure: ${drops.size} dropped, ${retypes.size} retyped, ${merges.size} merged`,
  );
  return out;
}
