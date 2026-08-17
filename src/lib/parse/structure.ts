import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { callForJson } from "@/lib/derive/json-call";
import type { ParsedBlock } from "@/lib/parse/types";

// AI structure pass for URL ingest: after the mechanical parse, the model tidies
// the block list — drop residual junk, fix a wrong type, merge a split fragment.
// It references blocks by index only and never writes text, so it cannot invent
// content. On any failure the mechanical blocks stand (SPEC.md §2 quality bar).
const INGEST_STRUCTURE_MODEL = "claude-sonnet-4-6";
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

function clip(s: string, n = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function structurePrompt(title: string | null, blocks: ParsedBlock[]): string {
  const listing = blocks.map((b, i) => `[${i}] ${b.type}: ${clip(b.text)}`).join("\n");
  return [
    `A web page${title ? ` titled "${title}"` : ""} was parsed into the numbered blocks below.`,
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
    'Return ONLY JSON: {"ops": [{"index": 0, "action": "drop"}, {"index": 4, "action": "retype", "type": "HEADING"}]}',
    "An empty ops array is a valid answer.",
    "",
    "Blocks:",
    listing,
  ].join("\n");
}

export async function structureBlocks(
  blocks: ParsedBlock[],
  title: string | null,
): Promise<ParsedBlock[]> {
  if (!process.env.ANTHROPIC_API_KEY || blocks.length < 5) return blocks;
  const listed = blocks.slice(0, MAX_LISTED_BLOCKS);

  const messages: ModelMessage[] = [{ role: "user", content: structurePrompt(title, listed) }];
  const result = await callForJson({
    model: anthropic(INGEST_STRUCTURE_MODEL),
    messages,
    maxOutputTokens: 8192,
    schema: structureSchema,
    label: "INGEST_STRUCTURE",
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
  if (drops.size > blocks.length * 0.4) {
    console.warn(`[ingest] structure pass wanted ${drops.size}/${blocks.length} drops, ignored`);
    return blocks;
  }

  const out: ParsedBlock[] = [];
  blocks.forEach((block, i) => {
    if (drops.has(i)) return;
    let next = block;
    const retype = retypes.get(i);
    if (retype && retype !== block.type) {
      next = { type: retype, text: block.text }; // html belongs to the old type
    }
    const previous = out[out.length - 1];
    if (merges.has(i) && previous?.type === "PARAGRAPH" && next.type === "PARAGRAPH") {
      out[out.length - 1] = {
        ...previous,
        text: `${previous.text} ${next.text}`.replace(/\s+/g, " ").trim(),
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
