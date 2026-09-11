import { z } from "zod";

// Tolerant extraction, strict validation. On failure the caller retries once with the
// error appended, then surfaces failure (SPEC.md §4). Malformed output never reaches the DB.
export function extractJson(text: string): unknown | null {
  for (const candidate of jsonCandidates(text)) return candidate;
  return null;
}

/** The first reading of the output that the schema accepts, or null. Output cut
    off mid-write — the model spent its budget before the JSON ended — is read
    back one cut at a time, longest first, so a derivation that returns a list
    keeps the items that arrived instead of failing whole. */
export function parseJson<S extends z.ZodType>(schema: S, text: string): z.infer<S> | null {
  for (const candidate of jsonCandidates(text)) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function tryParse(s: string): unknown | null {
  try {
    return JSON.parse(s.trim());
  } catch {
    return null;
  }
}

// Every reading of the output, best first: the fenced block, the whole text,
// the text from its first brace to its last, then the truncation cuts.
function* jsonCandidates(text: string): Generator<unknown> {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    const r = tryParse(fence[1]);
    if (r !== null) yield r;
  }
  const whole = tryParse(text);
  if (whole !== null) yield whole;
  const o1 = text.indexOf("{");
  const o2 = text.lastIndexOf("}");
  if (o1 !== -1 && o2 > o1) {
    const r = tryParse(text.slice(o1, o2 + 1));
    if (r !== null) yield r;
  }
  yield* truncatedReadings(text);
}

// The output closed back into valid JSON at each place it could have ended:
// everything up to that point, with the brackets still open closed in order.
// Longest first — the most of the answer that parses wins — and a cut that
// leaves a half-written object behind is one the caller's schema rejects, so
// the next cut is tried.
function* truncatedReadings(text: string): Generator<unknown> {
  const start = text.indexOf("{");
  if (start === -1) return;
  const body = text.slice(start);
  // Cut points, in order: right after a value closed, and right before a
  // comma. Cutting at one of these never leaves half a value behind.
  const cuts: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        inString = false;
        cuts.push(i + 1);
      }
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "}" || c === "]") cuts.push(i + 1);
    else if (c === ",") cuts.push(i);
  }
  for (const cut of cuts.slice(-400).reverse()) {
    const closed = closeBrackets(body.slice(0, cut));
    if (closed === null) continue;
    const parsed = tryParse(closed);
    if (parsed !== null) yield parsed;
  }
}

/** The prefix with every bracket it left open closed, or null when it ends
    inside a string. */
function closeBrackets(prefix: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const c of prefix) {
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inString || stack.length === 0) return null;
  return prefix + stack.reverse().join("");
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

// KEYPOINTS — the reader's Distill (SPEC.md §4): the article's most important
// points as bullets, each anchored to the span it comes from. The route
// resolves every span before anything persists.
export const keypointsOutputSchema = z.object({
  points: z
    .array(spanSchema.extend({ text: z.string().min(1).max(1_000) }))
    .min(1)
    .max(30),
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
