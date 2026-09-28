import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RefDoc } from "./model";

// The benchmark's inputs: the corpus list and the references, each checked
// with zod before a run reads it. A reference lives at
// scripts/parse-bench/refs/<id>.json when its license is open or
// public-domain (committed), else at .bench/refs/<id>.json (never committed).

export const ROOT = join(import.meta.dirname, "..", "..");
export const CORPUS_PATH = join(import.meta.dirname, "corpus.json");
export const REF_DIRS = [join(import.meta.dirname, "refs"), join(ROOT, ".bench", "refs")];

const CATEGORIES = ["math-tex", "paper", "textbook", "legal", "form", "financial", "report", "notes", "book", "newsletter", "cjk", "slides", "word"] as const;
const LICENSES = ["open", "public-domain", "private", "copyrighted"] as const;

const t = z.literal(true).optional();
const spanSchema = z.strictObject({
  text: z.string(),
  latex: z.string().optional(),
  mathml: z.string().optional(),
  bold: t,
  italic: t,
  underline: t,
  code: t,
  smallCaps: t,
  href: z.string().optional(),
});
const spans = z.array(spanSchema);
const level = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);

const blockSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("title"), spans }),
  z.strictObject({ kind: z.literal("heading"), level, spans }),
  z.strictObject({
    kind: z.literal("paragraph"),
    spans,
    align: z.enum(["center", "right"]).optional(),
    indent: z.enum(["first", "hanging", "block"]).optional(),
  }),
  z.strictObject({
    kind: z.literal("list"),
    items: z.array(
      z.strictObject({ depth: z.number().int().min(0), marker: z.string(), spans, checked: z.boolean().optional() }),
    ),
  }),
  z.strictObject({ kind: z.literal("equation"), latex: z.string(), mathml: z.string().optional(), label: z.string().optional() }),
  z.strictObject({
    kind: z.literal("table"),
    caption: spans.optional(),
    rows: z.array(
      z.strictObject({
        cells: z.array(
          z.strictObject({
            spans,
            header: t,
            colspan: z.number().int().min(1).optional(),
            rowspan: z.number().int().min(1).optional(),
          }),
        ),
      }),
    ),
  }),
  z.strictObject({ kind: z.literal("figure"), caption: spans.optional() }),
  z.strictObject({ kind: z.literal("code"), text: z.string() }),
  z.strictObject({ kind: z.literal("quote"), spans }),
  z.strictObject({ kind: z.literal("footnote"), label: z.string(), spans }),
  z.strictObject({ kind: z.literal("separator") }),
]);

export const refDocSchema: z.ZodType<RefDoc> = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(CATEGORIES),
  source: z.strictObject({ pdf: z.string().optional(), docx: z.string().optional(), url: z.string().optional() }),
  pages: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
  blocks: z.array(blockSchema),
  furniture: z.array(z.string()),
  license: z.enum(LICENSES),
  provenance: z.enum(["generated", "latexml", "hand"]),
  notes: z.string().optional(),
});

/** One corpus document: the file the runner parses (a path under .bench/,
    repo-relative), where it came from, and the pages scored (a reference's
    own pages win). Several entries may share one file, each with its pages
    and its reference. Unknown keys are ignored. */
const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(CATEGORIES),
  pdf: z.string().optional(),
  docx: z.string().optional(),
  url: z.string().optional(),
  license: z.enum(LICENSES),
  pages: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
});
export type CorpusEntry = z.infer<typeof entrySchema>;

/** The corpus list: its valid entries, and a line for each entry that is not. */
export function loadCorpus(): { entries: CorpusEntry[]; problems: string[] } {
  const raw: unknown = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  if (!Array.isArray(raw)) return { entries: [], problems: ["corpus.json is not a list"] };
  const entries: CorpusEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) {
      problems.push(`entry ${i}: ${parsed.error.issues.map((e) => `${e.path.join(".")} ${e.message}`).join("; ")}`);
      return;
    }
    if (seen.has(parsed.data.id)) {
      problems.push(`entry ${i}: id ${parsed.data.id} is listed twice`);
      return;
    }
    seen.add(parsed.data.id);
    entries.push(parsed.data);
  });
  return { entries, problems };
}

/** Where the reference of `id` is, or null when none is written yet. */
export function refPath(id: string): string | null {
  for (const dir of REF_DIRS) {
    const path = join(dir, `${id}.json`);
    if (existsSync(path)) return path;
  }
  return null;
}

/** A reference file, checked against the model: the reference, or the problems. */
export function loadRef(path: string): { ref: RefDoc } | { problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { problems: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const parsed = refDocSchema.safeParse(raw);
  if (!parsed.success) {
    return { problems: parsed.error.issues.slice(0, 12).map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`) };
  }
  const ref = parsed.data;
  if (ref.pages && ref.pages[1] < ref.pages[0]) return { problems: [`pages ${ref.pages[0]}–${ref.pages[1]} run backwards`] };
  return { ref };
}
