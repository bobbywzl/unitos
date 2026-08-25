import { z } from "zod";

// Tolerant extraction, strict validation. On failure the caller retries once with the
// error appended, then surfaces failure (SPEC.md §4). Malformed output never reaches the DB.
export function extractJson(text: string): unknown | null {
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s.trim());
    } catch {
      return null;
    }
  };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    const r = tryParse(fence[1]);
    if (r !== null) return r;
  }
  const whole = tryParse(text);
  if (whole !== null) return whole;
  const o1 = text.indexOf("{");
  const o2 = text.lastIndexOf("}");
  if (o1 !== -1 && o2 > o1) {
    const r = tryParse(text.slice(o1, o2 + 1));
    if (r !== null) return r;
  }
  return null;
}

export const spanSchema = z.object({
  blockId: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});

export const salienceOutputSchema = z.object({
  spans: z.array(spanSchema).min(1).max(200),
});

// DISTILL (SPEC.md §4): the quotes that answer the reader's question, each with
// a caption. Spans use the same block-id + offset contract as SALIENCE; the
// route resolves every span against the real block text before anything persists.
export const distillOutputSchema = z.object({
  quotes: z
    .array(spanSchema.extend({ caption: z.string().min(1).max(1_000) }))
    .min(1)
    .max(20),
});

// FIND (SPEC.md §11): matches reference transcript blocks by id; the route
// resolves them to time ranges. An empty list is a correct answer.
export const findOutputSchema = z.object({
  matches: z
    .array(
      z.object({
        blockIds: z.array(z.string().min(1)).min(1).max(40),
        explanation: z.string().min(1).max(2_000),
      }),
    )
    .max(10),
});

export type Span = z.infer<typeof spanSchema>;

// Clamp a span to its block text; drop it when it does not resolve to non-empty text.
export function resolveSpan(
  span: Span,
  blockById: Map<string, { id: string; text: string }>,
): (Span & { quotedText: string; prefix: string; suffix: string }) | null {
  const block = blockById.get(span.blockId);
  if (!block) return null;
  const start = Math.max(0, Math.min(span.start, block.text.length));
  const end = Math.max(start, Math.min(span.end, block.text.length));
  const quotedText = block.text.slice(start, end);
  if (!quotedText.trim()) return null;
  return {
    blockId: span.blockId,
    start,
    end,
    quotedText,
    prefix: block.text.slice(Math.max(0, start - 32), start),
    suffix: block.text.slice(end, end + 32),
  };
}
