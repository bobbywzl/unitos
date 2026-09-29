import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RefDoc } from "./model";

// The benchmark's inputs: the corpus list and the references, each checked
// with zod before a run reads it. A reference lives at
// scripts/parse-bench/refs/<id>.json when its license is open or
// public-domain (committed), else at .bench/refs/<id>.json (never committed).
// The corpus list is corpus.json and, for the owner's files (license
// private), .bench/corpus-private.json (never committed): the repository is
// public, so it names none of them.

export const ROOT = join(import.meta.dirname, "..", "..");
export const CORPUS_PATH = join(import.meta.dirname, "corpus.json");
export const PRIVATE_CORPUS_PATH = join(ROOT, ".bench", "corpus-private.json");
export const REF_DIRS = [join(import.meta.dirname, "refs"), join(ROOT, ".bench", "refs")];

const CATEGORIES = ["math-tex", "paper", "textbook", "legal", "form", "financial", "report", "notes", "book", "newsletter", "cjk", "slides", "word"] as const;
const LICENSES = ["open", "public-domain", "private", "copyrighted"] as const;

const t = z.literal(true).optional();
const color = z.string().regex(/^#[0-9a-f]{6}$/);
const spanSchema = z.strictObject({
  text: z.string(),
  latex: z.string().optional(),
  mathml: z.string().optional(),
  bold: t,
  italic: t,
  underline: t,
  strike: t,
  code: t,
  smallCaps: t,
  sub: t,
  sup: t,
  href: z.string().optional(),
  color: color.optional(),
  highlight: color.optional(),
});
const spans = z.array(spanSchema);
const level = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const align = z.enum(["center", "right", "justify"]).optional();
const fontSchema = z.strictObject({ shape: z.enum(["serif", "sans", "mono"]), size: z.number().positive(), bold: t, color: color.optional() });
const font = fontSchema.optional();
const points = z.number().min(0).optional();

const blockSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("title"), spans, align, font }),
  z.strictObject({ kind: z.literal("heading"), level, spans, align, font }),
  z.strictObject({
    kind: z.literal("paragraph"),
    spans,
    align,
    indent: z.enum(["first", "hanging", "block"]).optional(),
    indentPt: z.strictObject({ left: z.number().min(0), first: z.number() }).optional(),
    spaceAfter: points,
    font,
  }),
  z.strictObject({
    kind: z.literal("list"),
    items: z.array(
      z.strictObject({ depth: z.number().int().min(0), marker: z.string(), spans, checked: z.boolean().optional() }),
    ),
    align,
    itemSpace: points,
    spaceAfter: points,
    font,
  }),
  z.strictObject({ kind: z.literal("equation"), latex: z.string(), mathml: z.string().optional(), label: z.string().optional(), labelSide: z.enum(["left", "right"]).optional() }),
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
    font,
  }),
  z.strictObject({ kind: z.literal("figure"), caption: spans.optional(), font }),
  z.strictObject({ kind: z.literal("code"), text: z.string() }),
  z.strictObject({ kind: z.literal("quote"), spans }),
  z.strictObject({ kind: z.literal("footnote"), label: z.string(), spans, font }),
  z.strictObject({ kind: z.literal("separator") }),
]);

const fontsSchema = z.strictObject({
  body: fontSchema,
  title: font,
  h1: font,
  h2: font,
  h3: font,
  h4: font,
  h5: font,
  h6: font,
  caption: font,
  footnote: font,
});

export const refDocSchema: z.ZodType<RefDoc> = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(CATEGORIES),
  source: z.strictObject({ pdf: z.string().optional(), docx: z.string().optional(), url: z.string().optional() }),
  pages: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
  blocks: z.array(blockSchema),
  furniture: z.array(z.string()),
  fonts: fontsSchema.optional(),
  license: z.enum(LICENSES),
  provenance: z.enum(["generated", "latexml", "hand"]),
  notes: z.string().optional(),
});

/** One corpus document: the file the runner parses (a path under .bench/,
    repo-relative: the PDF when the entry names one, else the Word file),
    where it came from, and the pages scored (a reference's own pages win).
    Several entries may share one file, each with its pages and its
    reference. ref: the reference to score against when it is another
    entry's (a Word file scored against the reference of its PDF rendering).
    Unknown keys are ignored. */
const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(CATEGORIES),
  pdf: z.string().optional(),
  docx: z.string().optional(),
  url: z.string().optional(),
  ref: z.string().optional(),
  license: z.enum(LICENSES),
  pages: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
  // In the quick run (--quick): one document for each kind of fault, the fast ones.
  quick: z.boolean().optional(),
  // A whole document read without a reference, every page parsed and checked
  // (the wider corpus): run with --sweep, or named with --only or --detail,
  // so the everyday full run keeps its speed.
  sweep: z.boolean().optional(),
});
export type CorpusEntry = z.infer<typeof entrySchema>;

/** The corpus list: the private list's entries when it exists, then
    corpus.json's; the valid entries, a line for each entry that is not (an
    entry in the wrong list among them), and whether the private list was
    read. */
export function loadCorpus(): { entries: CorpusEntry[]; problems: string[]; withPrivate: boolean } {
  const withPrivate = existsSync(PRIVATE_CORPUS_PATH);
  const lists = [...(withPrivate ? [{ path: PRIVATE_CORPUS_PATH, name: ".bench/corpus-private.json", owner: true }] : []), { path: CORPUS_PATH, name: "corpus.json", owner: false }];
  const entries: CorpusEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    const raw: unknown = JSON.parse(readFileSync(list.path, "utf8"));
    if (!Array.isArray(raw)) {
      problems.push(`${list.name} is not a list`);
      continue;
    }
    raw.forEach((item, i) => {
      const parsed = entrySchema.safeParse(item);
      if (!parsed.success) {
        problems.push(`${list.name} entry ${i}: ${parsed.error.issues.map((e) => `${e.path.join(".")} ${e.message}`).join("; ")}`);
        return;
      }
      if ((parsed.data.license === "private") !== list.owner) {
        problems.push(`${list.name} entry ${i}: a ${parsed.data.license} entry belongs in ${list.owner ? "corpus.json" : ".bench/corpus-private.json"}`);
        return;
      }
      if (seen.has(parsed.data.id)) {
        problems.push(`${list.name} entry ${i}: id ${parsed.data.id} is listed twice`);
        return;
      }
      seen.add(parsed.data.id);
      entries.push(parsed.data);
    });
  }
  return { entries, problems, withPrivate };
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
