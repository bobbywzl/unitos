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

// EXTRACT (SPEC.md §4): the passages across the document most revealing about
// the highlighted phrase's topic. Same span contract as SALIENCE; the route
// resolves every span against the real block text before anything persists.
export const extractOutputSchema = z.object({
  spans: z.array(spanSchema).min(1).max(30),
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

// FORMALIZE (SPEC.md §11): the transcript rewritten. format article returns
// the piece whole; format notes returns topics that cite transcript blocks,
// which the route resolves to time ranges for the notes' sources.
export const formalizeArticleSchema = z.object({
  title: z.string().min(1).max(300),
  markdown: z.string().min(1).max(120_000),
});

export const formalizeNotesSchema = z.object({
  topics: z
    .array(
      z.object({
        heading: z.string().min(1).max(200),
        bullets: z.array(z.string().min(1).max(600)).min(1).max(15),
        blockIds: z.array(z.string().min(1)).max(200),
      }),
    )
    .min(1)
    .max(24),
});

// COMPARE (SPEC.md §4): the points where two documents agree, disagree, and
// what only one covers, each citing spans the route resolves against the real
// block text before the note lands.
const comparePointSchema = z.object({
  point: z.string().min(1).max(1_000),
  spans: z.array(spanSchema).max(4),
});
export const compareOutputSchema = z.object({
  agreements: z.array(comparePointSchema).max(12),
  disagreements: z.array(comparePointSchema).max(12),
  onlyFirst: z.array(comparePointSchema).max(10),
  onlySecond: z.array(comparePointSchema).max(10),
});

// ANALYZE (SPEC.md §4): a figure or table read as data. certainty separates a
// value printed on the visual from one estimated off it.
export const analyzeOutputSchema = z.object({
  kind: z.enum(["table", "chart", "diagram", "photo", "map", "other"]),
  summary: z.string().min(1).max(2_000),
  structure: z.string().max(3_000),
  readings: z
    .array(
      z.object({
        label: z.string().min(1).max(300),
        value: z.string().min(1).max(300),
        certainty: z.enum(["read", "estimated"]),
      }),
    )
    .max(60),
  data: z
    .object({
      columns: z.array(z.string().max(300)).max(20),
      rows: z.array(z.array(z.string().max(300)).max(20)).max(80),
    })
    .nullable(),
  takeaway: z.string().max(2_000),
  cautions: z.array(z.string().max(600)).max(20),
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
