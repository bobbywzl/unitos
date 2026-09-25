import { z } from "zod";
import { matchInTextLoose, type QuoteHit } from "@/lib/anchors/match";
import {
  assistantAuthor,
  isAssistantSuggestion,
  type ResolvedOp,
  type SkipReason,
  type SuggestStyle,
} from "@/lib/docs/assistant-suggestions";
import { withoutSuggestions } from "@/lib/docs/blocks";
import { INDEXED_NODE_TYPES, SUGGESTION_MARK_TYPES, suggestionAuthor, ZWSP, type RichNode } from "@/lib/docs/schema";
import { SUGGEST_MAX_OPS, SUGGEST_WINDOW_CHARS } from "@/lib/derive/config";

// The assistant's suggestions on the server (SPEC.md §29): the ops the model
// answers with, checked against the paragraph index and the stored rich text
// before the page editor lands them as suggestions. An op that breaks a rule
// is skipped with its reason; the rest stand.

const id = z.string().min(1).max(64);
const why = z.string().min(1).max(240);
const find = z.string().min(1).max(2_000);
const markdown = z.string().min(1).max(20_000);
const STYLES = ["normal", "title", "subtitle", "h1", "h2", "h3", "h4", "h5", "h6", "bulleted", "numbered", "checklist"] as const satisfies readonly SuggestStyle[];
const suggestOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace_words"), blockId: id, find, text: z.string().max(4_000), why }),
  z.object({ op: z.literal("rewrite_block"), blockId: id, text: z.string().max(20_000), why }),
  z.object({ op: z.literal("replace_blocks"), blockIds: z.array(id).min(1).max(40), markdown, why }),
  z.object({ op: z.literal("insert_blocks"), afterBlockId: id.nullable(), markdown, why }),
  z.object({ op: z.literal("remove_blocks"), blockIds: z.array(id).min(1).max(40), why }),
  z.object({ op: z.literal("set_style"), blockId: id, style: z.enum(STYLES), why }),
  z.object({ op: z.literal("format_words"), blockId: id, find, format: z.enum(["bold", "italic", "underline", "strikethrough"]), why }),
]);
export const suggestAnswerSchema = z.object({
  summary: z.string().max(400),
  ops: z.array(suggestOpSchema).max(SUGGEST_MAX_OPS),
});
type SuggestOp = z.infer<typeof suggestOpSchema>;

/** A row of the paragraph index. */
export type IndexRow = { id: string; type: string; text: string };

/** Why the server skips an op; the page's own checks add "changed" and "object". */
export type ServerSkip = Exclude<SkipReason, "changed" | "object">;

/** The assistant suggests edits in a document with rich text and no format
    (slides and sheets have one): a blank document today, an import once
    imports hold rich text. */
export const takesSuggestions = (document: { richText: unknown; format: string | null }): boolean =>
  Boolean(document.richText) && !document.format;

/** What a command may change: the selected words (each block's span widened
    to whole words), or blocks. */
export type SuggestScope =
  | { kind: "words"; segments: { blockId: string; start: number; end: number }[] }
  | { kind: "blocks"; blockIds: string[] };

/** Where an indexed block stands in the rich text. */
export type BlockPlace = {
  /** Its paragraph style; null for code, a figure, a line, or an equation. */
  style: SuggestStyle | null;
  /** A table cell or a footnote takes changes to its words only. */
  where: "body" | "cell" | "footnote";
  /** The node that holds it, lists aside: blocks replaced together share one. */
  container: string;
  /** The list or the table it stands in: a window never cuts inside one. */
  group: string | null;
};

const LIST_STYLES: Record<string, SuggestStyle> = { bulletList: "bulleted", orderedList: "numbered", taskList: "checklist" };
const LIST_PARTS = new Set([...Object.keys(LIST_STYLES), "listItem", "taskItem"]);

/** Every indexed block's place, read the way the paragraph index reads the
    rich text: the assistant's suggestions as not made yet, and a block a
    person's suggestion removes left out. */
export function blockPlaces(doc: RichNode): Map<string, BlockPlace> {
  const places = new Map<string, BlockPlace>();
  type At = Omit<BlockPlace, "style"> & { list: SuggestStyle | null };
  const walk = (node: RichNode, path: string, at: At) => {
    if (node.marks?.some((m) => m.type === "deletion")) return;
    if (INDEXED_NODE_TYPES.has(node.type)) {
      const blockId = node.attrs?.blockId;
      if (typeof blockId !== "string") return;
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      const docStyle = node.attrs?.docStyle;
      const style: SuggestStyle | null =
        node.type === "heading"
          ? (`h${level}` as SuggestStyle)
          : node.type !== "paragraph"
            ? null
            : (at.list ?? (docStyle === "title" || docStyle === "subtitle" ? docStyle : "normal"));
      places.set(blockId, { style, where: at.where, container: at.container, group: at.group });
      return;
    }
    const cell = node.type === "tableCell" || node.type === "tableHeader";
    const next: At = {
      list: LIST_STYLES[node.type] ?? (cell ? null : at.list),
      where: cell ? "cell" : node.type === "footnote" ? "footnote" : at.where,
      container: LIST_PARTS.has(node.type) ? at.container : path,
      group: at.group ?? (LIST_STYLES[node.type] || node.type === "table" ? path : null),
    };
    (node.content ?? []).forEach((child, i) => walk(child, `${path}.${i}`, next));
  };
  const [readable] = withoutSuggestions([doc], isAssistantSuggestion);
  if (readable) walk(readable, "", { list: null, where: "body", container: "", group: null });
  return places;
}

const levelOf = (style: SuggestStyle | null | undefined): number =>
  style === "title" ? 1 : style && /^h[1-6]$/.test(style) ? Number(style.slice(1)) : 0;

/** The blocks a command names, in document order: a heading grows to its
    section, down to the next heading of its level or above. */
export function scopeOf(rows: IndexRow[], places: Map<string, BlockPlace>, blockIds: string[]): string[] {
  const named = new Set(blockIds);
  const out: string[] = [];
  let open = 0;
  for (const row of rows) {
    const level = row.type === "HEADING" ? levelOf(places.get(row.id)?.style) : 0;
    if (level && level <= open) open = 0;
    if (level && !open && named.has(row.id)) open = level;
    if (open || named.has(row.id)) out.push(row.id);
  }
  return out;
}

/** The scope cut into windows of SUGGEST_WINDOW_CHARS of text: a window
    ends before a heading once it passes half its size, and never inside a
    list or a table. */
export function windowsOf(rows: IndexRow[], places: Map<string, BlockPlace>, scope: string[]): string[][] {
  const wanted = new Set(scope);
  const windows: string[][] = [];
  let current: string[] = [];
  let used = 0;
  let group: string | null = null;
  for (const row of rows) {
    if (!wanted.has(row.id)) continue;
    const place = places.get(row.id);
    const inside = group !== null && place?.group === group;
    const full = used + row.text.length > SUGGEST_WINDOW_CHARS;
    const heading = row.type === "HEADING" && used >= SUGGEST_WINDOW_CHARS / 2;
    if (current.length > 0 && !inside && (full || heading)) {
      windows.push(current);
      current = [];
      used = 0;
    }
    current.push(row.id);
    used += row.text.length;
    group = place?.group ?? null;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

// A word's letters, apostrophes, and hyphens (don't, well-known). Chinese and
// Japanese characters are words of their own: a selection never widens over them.
const WORD = /(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{N}\p{M}_'’-]/u;

/** The selected words as a scope: each block's span widened to whole words. */
export function wordsScope(rows: IndexRow[], segments: { blockId: string; startOffset: number; endOffset: number }[]): SuggestScope {
  const texts = new Map(rows.map((r) => [r.id, r.text]));
  return {
    kind: "words",
    segments: segments.flatMap((s) => {
      const text = texts.get(s.blockId);
      if (text === undefined) return [];
      let start = Math.min(s.startOffset, text.length);
      let end = Math.max(start, Math.min(s.endOffset, text.length));
      while (start > 0 && WORD.test(text[start - 1]) && WORD.test(text[start] ?? "")) start--;
      while (end > 0 && end < text.length && WORD.test(text[end - 1]) && WORD.test(text[end])) end++;
      return [{ blockId: s.blockId, start, end }];
    }),
  };
}

/** The asker's pending assistant suggestions on the scope's blocks, one line
    each, for the prompt: a new op on their words takes their place. */
export function assistantSuggestionsIn(doc: RichNode, asker: string, scope: ReadonlySet<string>): string[] {
  const author = assistantAuthor(asker);
  type Side = { id: string; kind: "added" | "removed" };
  const entries = new Map<string, { blockId: string; added: string; removed: string; format: boolean }>();
  let anchor = "";
  const entry = (suggestionId: string) => {
    const key = `${suggestionId} ${anchor}`;
    let e = entries.get(key);
    if (!e) entries.set(key, (e = { blockId: anchor, added: "", removed: "", format: false }));
    return e;
  };
  const walk = (node: RichNode, inside: Side | null) => {
    const mine = (node.marks ?? []).filter((m) => SUGGESTION_MARK_TYPES.has(m.type) && suggestionAuthor(m.attrs?.id) === author);
    const words = mine.find((m) => m.type === "deletion") ?? mine.find((m) => m.type === "insertion");
    const side: Side | null = inside ?? (words ? { id: String(words.attrs?.id), kind: words.type === "insertion" ? "added" : "removed" } : null);
    if (INDEXED_NODE_TYPES.has(node.type)) {
      // A block the asker's suggestion adds is no row: its words stand after the row before it.
      if (side?.kind === "added") {
        const e = entry(side.id);
        if (e.added) e.added += " ";
      } else if (typeof node.attrs?.blockId === "string") anchor = node.attrs.blockId;
    }
    for (const m of mine) if (m.type === "modification") entry(String(m.attrs?.id)).format = true;
    if (node.type === "text" && side) entry(side.id)[side.kind] += (node.text ?? "").replaceAll(ZWSP, "");
    for (const child of node.content ?? []) walk(child, side);
  };
  walk(doc, null);
  const quoted = (s: string) => `"${s.length > 300 ? `${s.slice(0, 300)}…` : s}"`;
  return [...entries.values()]
    .filter((e) => scope.has(e.blockId) && (e.added.trim() || e.removed.trim() || e.format))
    .map((e) => {
      const change =
        e.added && e.removed
          ? `replace ${quoted(e.removed)} with ${quoted(e.added)}`
          : e.removed
            ? `delete ${quoted(e.removed)}`
            : e.added
              ? `add ${quoted(e.added)}`
              : "change the format";
      return `[block ${e.blockId}] ${change}`;
    });
}

// ── Resolution ───────────────────────────────────────────────────────────────

const TEXT_ROWS = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE"]);

/** What an op takes: words of one row, whole rows, or the gap after a row
    (-1: the document's start). */
type Claim =
  | { kind: "words"; row: number; from: number; to: number }
  | { kind: "rows"; rows: number[] }
  | { kind: "gap"; after: number };

/** Two ops that take the same or touching words, a word op and a block op
    on one row, two block ops on one row, and new blocks beside a block op's
    rows conflict: the first stands, so one command's suggestions never merge. */
function conflicts(a: Claim, b: Claim): boolean {
  if (b.kind === "gap" && a.kind !== "gap") return conflicts(b, a);
  if (a.kind === "gap") {
    if (b.kind === "gap") return a.after === b.after;
    return b.kind === "rows" && b.rows.some((k) => k === a.after || k === a.after + 1);
  }
  if (a.kind === "words" && b.kind === "words") return a.row === b.row && a.from <= b.to && b.from <= a.to;
  const rowsOf = (c: Claim) => (c.kind === "words" ? [c.row] : c.kind === "rows" ? c.rows : []);
  return rowsOf(a).some((k) => rowsOf(b).includes(k));
}

/** `needle` in `text` by the quote ladder (exact, whitespace, typography),
    when it occurs once. */
function once(text: string, needle: string): QuoteHit | "notFound" | "ambiguous" {
  const selector = { quotedText: needle, prefix: "", suffix: "" };
  const hit = matchInTextLoose(text, selector);
  if (!hit) return "notFound";
  const rest = text.slice(0, hit.start) + "\u0000".repeat(hit.end - hit.start) + text.slice(hit.end);
  return matchInTextLoose(rest, selector) ? "ambiguous" : hit;
}

/** Markdown as the page takes it: no images, no HTML, at most 200 lines. */
function cleanMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .split("\n")
    .slice(0, 200)
    .join("\n")
    .trim();
}

/** The selected words take the whole row. */
const coversRow = (text: string, span: { start: number; end: number } | undefined): boolean =>
  span !== undefined && !text.slice(0, span.start).trim() && !text.slice(span.end).trim();

type Resolved = { op: ResolvedOp; claim: Claim; chars: number };

/** The model's ops checked against the paragraph index (SPEC.md §29): each
    lands with its offsets or bases, or is skipped with its reason; an op
    that changes nothing is dropped. `budget` is the new text the command
    has left, shared by its windows. */
export function resolveOps(
  ops: SuggestOp[],
  ctx: { rows: IndexRow[]; places: Map<string, BlockPlace>; scope: SuggestScope; budget: { chars: number } },
): { ops: ResolvedOp[]; skipped: { reason: ServerSkip; why: string }[] } {
  const { rows, places, scope, budget } = ctx;
  const order = new Map(rows.map((r, k) => [r.id, k]));
  const spans = new Map(scope.kind === "words" ? scope.segments.map((s) => [s.blockId, s]) : []);
  const inScope = new Set(scope.kind === "words" ? spans.keys() : scope.blockIds);

  const resolve = (op: SuggestOp, i: number): Resolved | ServerSkip | null => {
    if (op.op === "insert_blocks") {
      let after = -1;
      if (op.afterBlockId === null) {
        // The document's start belongs to the window that starts the document.
        if (scope.kind !== "blocks" || scope.blockIds[0] !== rows[0]?.id) return "outside";
      } else {
        const k = order.get(op.afterBlockId);
        if (k === undefined || !inScope.has(op.afterBlockId)) return "outside";
        if (places.get(op.afterBlockId)?.where !== "body") return "notText";
        after = k;
      }
      const md = cleanMarkdown(op.markdown);
      if (!md) return "notText";
      return { op: { i, op: op.op, afterBlockId: op.afterBlockId, markdown: md, why: op.why }, claim: { kind: "gap", after }, chars: md.length };
    }
    if (op.op === "replace_blocks" || op.op === "remove_blocks") {
      const ks: number[] = [];
      for (const blockId of op.blockIds) {
        const k = order.get(blockId);
        if (k === undefined || !inScope.has(blockId)) return "outside";
        ks.push(k);
      }
      ks.sort((a, b) => a - b);
      const picked = ks.map((k) => rows[k]);
      const container = places.get(picked[0].id)?.container;
      // Consecutive text rows of one container, outside tables and footnotes.
      const shaped = picked.every((r, j) => {
        const place = places.get(r.id);
        return TEXT_ROWS.has(r.type) && place?.where === "body" && place.container === container && (j === 0 || ks[j] === ks[j - 1] + 1);
      });
      if (!shaped) return "notText";
      if (scope.kind === "words" && !picked.every((r) => coversRow(r.text, spans.get(r.id)))) return "outside";
      const blockIds = picked.map((r) => r.id);
      const base = picked.map((r) => r.text);
      const claim: Claim = { kind: "rows", rows: ks };
      if (op.op === "remove_blocks") return { op: { i, op: op.op, blockIds, base, why: op.why }, claim, chars: 0 };
      const md = cleanMarkdown(op.markdown);
      if (!md) return "notText";
      return { op: { i, op: op.op, blockIds, base, markdown: md, why: op.why }, claim, chars: md.length };
    }
    const k = order.get(op.blockId);
    if (k === undefined || !inScope.has(op.blockId)) return "outside";
    const row = rows[k];
    const place = places.get(row.id);
    if (!TEXT_ROWS.has(row.type) || !place) return "notText";
    if (op.op === "set_style") {
      if (!place.style || place.where !== "body") return "notText";
      if (op.style === place.style) return null;
      return { op: { i, op: op.op, blockId: row.id, style: op.style, baseStyle: place.style, why: op.why }, claim: { kind: "rows", rows: [k] }, chars: 0 };
    }
    if (op.op === "rewrite_block") {
      if (scope.kind === "words" && !coversRow(row.text, spans.get(row.id))) return "outside";
      // A new paragraph is replace_blocks.
      if (/\n\s*\n/.test(op.text)) return "notText";
      if (op.text.trim() === row.text.trim()) return null;
      return { op: { i, op: op.op, blockId: row.id, base: row.text, text: op.text, why: op.why }, claim: { kind: "rows", rows: [k] }, chars: op.text.length };
    }
    // Code takes no formatting.
    if (op.op === "format_words" && row.type === "CODE") return "notText";
    // A word op: `find` once in the selected words, or once in the block.
    const span = spans.get(row.id) ?? { start: 0, end: row.text.length };
    const hit = once(row.text.slice(span.start, span.end), op.find);
    if (hit === "notFound" && scope.kind === "words" && once(row.text, op.find) !== "notFound") return "outside";
    if (typeof hit === "string") return hit;
    const start = span.start + hit.start;
    const end = span.start + hit.end;
    const found = row.text.slice(start, end);
    const claim: Claim = { kind: "words", row: k, from: start, to: end };
    if (op.op === "format_words") {
      return { op: { i, op: op.op, blockId: row.id, start, end, find: found, format: op.format, why: op.why }, claim, chars: 0 };
    }
    if (found === op.text) return null;
    return { op: { i, op: op.op, blockId: row.id, start, end, find: found, text: op.text, why: op.why }, claim, chars: op.text.length };
  };

  const out: ResolvedOp[] = [];
  const claims: Claim[] = [];
  const skipped: { reason: ServerSkip; why: string }[] = [];
  ops.forEach((op, i) => {
    const got = resolve(op, i);
    if (got === null) return;
    if (typeof got === "string") {
      skipped.push({ reason: got, why: op.why });
      return;
    }
    const reason = claims.some((c) => conflicts(c, got.claim)) ? "overlap" : got.chars > budget.chars ? "limit" : null;
    if (reason) {
      skipped.push({ reason, why: op.why });
      return;
    }
    claims.push(got.claim);
    budget.chars -= got.chars;
    out.push(got.op);
  });
  return { ops: out, skipped };
}
