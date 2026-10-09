// A suggest action run as the act route runs it (src/app/api/assistant/act/route.ts,
// the suggest branch): the words scope when the reader selected words, else
// the named blocks or the whole document in windows, the one pass when the
// scope fits it, the order pass beside it when the action moves blocks. The
// passes' calls go to the external model (lib/derive/external-call.ts); the
// ops come back resolved against the fixture's rows (lib/docs/suggest-ops.ts),
// and applyOps lands them on the simulated blocks the way the page would.
import { fitsOnePass, runOnePass } from "@/lib/assistant/one-pass";
import type { PlanContext } from "@/lib/assistant/plan";
import { orderSuggestOps, richTextUnits, runOrderPass } from "@/lib/assistant/reorder-run";
import { runSuggest } from "@/lib/derive/suggest";
import type { ResolvedOp } from "@/lib/docs/assistant-suggestions";
import { blockPlaces, scopeOf, windowsOf, wordsScope, type SuggestScope } from "@/lib/docs/suggest-ops";
import { SUGGEST_MAX_NEW_CHARS } from "@/lib/derive/config";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc } from "@/lib/i18n/dictionaries";
import type { ReaderProfileCtx } from "@/lib/prompts/types";
import type { AssistantAction } from "@/lib/types";
import type { BlockKind } from "@/lib/block-kind";
import type { RichNode } from "./richtext";
import type { SimBlock } from "./simulate";

export type Landed = { ops: ResolvedOp[]; warnings: string[]; summary: string };

type Passage = { blockId: string; startOffset: number; endOffset: number };

export async function runSuggestAction(input: {
  dir: string;
  title: string;
  richText: RichNode;
  rows: PlanContext["blocks"];
  action: Extract<AssistantAction, { type: "suggest" }>;
  passage: Passage[];
  command: string;
  history: { role: "user" | "assistant"; content: string }[];
  profile: ReaderProfileCtx;
  lang: Lang;
  t: TFunc;
}): Promise<Landed | Error> {
  const { action, t } = input;
  const richText = input.richText as never;
  // The rows as the passes type them (a Block's type).
  const rows = input.rows as never as { id: string; type: import("@prisma/client").BlockType; text: string }[];
  const doc = { title: input.title, references: null, pageName: null, rows, places: blockPlaces(richText), richText };
  const base = {
    userId: "eval",
    profile: input.profile,
    lang: input.lang,
    t,
    command: input.command,
    instruction: action.instruction ?? null,
    material: null,
    history: input.history,
    caretBlockId: null,
    thinking: "deep" as const,
    signal: AbortSignal.timeout(120_000),
  };
  process.env.EVAL_EXTERNAL_DIR = input.dir;
  try {
    let scope: SuggestScope;
    let window: { n: number; of: number; whole: boolean } | null = null;
    const cut: string[] = [];
    let onePassRows: string[] | null = null;
    if (!action.blockIds && input.passage.length > 0) scope = wordsScope(rows, input.passage);
    else {
      const whole = !action.blockIds;
      const inScope = whole ? rows.map((r) => r.id) : scopeOf(rows, doc.places, action.blockIds!);
      const windows = windowsOf(rows, doc.places, inScope);
      if (windows.length > 1) cut.push(t("api.suggestTooLong"));
      scope = { kind: "blocks", blockIds: windows[0] ?? [] };
      window = { n: 1, of: windows.length, whole };
      const rowsInScope = whole ? [] : scopeOf(rows, doc.places, action.blockIds!);
      if (fitsOnePass(rows, rowsInScope)) onePassRows = rowsInScope;
    }
    if (onePassRows !== null) {
      const units = richTextUnits(richText, rows);
      const pass = await runOnePass({ ...base, document: { title: doc.title, references: null, rows, pageName: null }, units, places: doc.places, scopeRowIds: onePassRows, plan: false });
      const first = Math.max(-1, ...pass.ops.map((op) => op.i)) + 1;
      const moves = pass.order ? orderSuggestOps(units, pass.scope, { ...pass.order, removed: [] }, rows, pass.why, first) : [];
      return { ops: [...pass.ops, ...moves], warnings: pass.warnings, summary: pass.summary };
    }
    const units = action.reorder ? richTextUnits(richText, rows) : [];
    const selected = [...new Set(input.passage.map((segment) => segment.blockId))];
    const ordering = action.reorder
      ? runOrderPass({ ...base, document: { title: doc.title, references: null, rows, pageName: null }, units, scopeRowIds: action.blockIds ? scopeOf(rows, doc.places, action.blockIds) : selected }).catch(
          (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
        )
      : null;
    const run = await runSuggest({ ...base, document: doc, scope, window, budget: { chars: SUGGEST_MAX_NEW_CHARS }, reorder: action.reorder });
    const order = ordering ? await ordering : null;
    if (order instanceof Error) return { ops: run.ops, warnings: [...run.warnings, ...cut, order.message], summary: run.summary };
    if (!order) return { ops: run.ops, warnings: [...run.warnings, ...cut], summary: run.summary };
    const first = Math.max(-1, ...run.ops.map((op) => op.i)) + 1;
    const moves = order.plan ? orderSuggestOps(units, order.scope, order.plan, rows, order.why, first) : [];
    return {
      ops: [...run.ops, ...moves],
      warnings: [...order.warnings, ...run.warnings, ...cut],
      summary: [moves.length > 0 ? order.summary : "", run.ops.length > 0 ? run.summary : ""].filter(Boolean).join(" ") || run.summary,
    };
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  } finally {
    delete process.env.EVAL_EXTERNAL_DIR;
  }
}

const KIND_OF_STYLE: Record<string, BlockKind> = {
  normal: "paragraph",
  title: "h1",
  subtitle: "h2",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h3",
  h5: "h3",
  h6: "h3",
  bulleted: "list",
  numbered: "numbered",
  checklist: "list",
};
const TYPE_OF_KIND: Record<BlockKind, string> = { paragraph: "PARAGRAPH", h1: "HEADING", h2: "HEADING", h3: "HEADING", list: "LIST", numbered: "LIST" };

/** A markdown chunk as one row: its kind from its first marker. */
function fresh(markdown: string, n: number): SimBlock {
  const m = markdown.trim();
  const heading = /^(#{1,6})\s+([\s\S]*)$/.exec(m);
  const kind: BlockKind = heading ? (`h${Math.min(3, heading[1].length)}` as BlockKind) : /^(?:[-*+]|\[ \])\s/.test(m) ? "list" : /^\d{1,3}[.)]\s/.test(m) ? "numbered" : "paragraph";
  const text = heading ? heading[2].trim() : m;
  return { id: `new-s${n}`, type: TYPE_OF_KIND[kind], text, html: null, startTime: null, endTime: null, speaker: null, kind, fresh: true, styles: [], links: [] };
}

/** The resolved ops landed on the blocks, in words: what the reader would
    read with every suggestion accepted. Word ops of one block go from its
    end backwards so the offsets hold; table ops are noted, not landed. */
export function applyOps(start: SimBlock[], ops: ResolvedOp[]): { blocks: SimBlock[]; notes: string[] } {
  let blocks = start.map((b) => ({ ...b, styles: [...b.styles], links: [...b.links] }));
  const notes: string[] = [];
  let made = 0;
  const at = (id: string) => blocks.findIndex((b) => b.id === id);
  const chunks = (markdown: string) => markdown.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  // Word ops first, by block, from the end of each block backwards.
  const wordOps = ops.filter((op) => op.op === "replace_words" || op.op === "format_words" || op.op === "insert_footnote");
  const byBlock = new Map<string, typeof wordOps>();
  for (const op of wordOps) byBlock.set(op.blockId, [...(byBlock.get(op.blockId) ?? []), op]);
  for (const [blockId, list] of byBlock) {
    const i = at(blockId);
    if (i < 0) {
      notes.push(`${blockId}: not in the document`);
      continue;
    }
    let text = blocks[i].text;
    for (const op of [...list].sort((a, b) => b.start - a.start)) {
      if (op.op === "format_words") blocks[i].styles.push({ quote: op.find, style: op.format });
      else if (op.op === "insert_footnote") text = `${text.slice(0, op.end)}[${op.text}]${text.slice(op.end)}`;
      else {
        text = text.slice(0, op.start) + op.text + text.slice(op.end);
        if (op.format) blocks[i].styles.push({ quote: op.text, style: op.format });
      }
    }
    blocks[i] = { ...blocks[i], text };
  }
  for (const op of ops) {
    switch (op.op) {
      case "rewrite_block": {
        const i = at(op.blockId);
        if (i < 0) notes.push(`${op.blockId}: not in the document`);
        else blocks[i] = { ...blocks[i], text: op.text };
        break;
      }
      case "replace_blocks": {
        const i = at(op.blockIds[0]);
        if (i < 0) {
          notes.push(`${op.blockIds[0]}: not in the document`);
          break;
        }
        const rows = chunks(op.markdown).map((c) => fresh(c, ++made));
        blocks = [...blocks.slice(0, i), ...rows, ...blocks.slice(i + 1)].filter((b) => !op.blockIds.slice(1).includes(b.id));
        break;
      }
      case "insert_blocks": {
        const i = op.afterBlockId === null ? -1 : at(op.afterBlockId);
        if (op.afterBlockId !== null && i < 0) {
          notes.push(`${op.afterBlockId}: not in the document`);
          break;
        }
        const rows = chunks(op.markdown).map((c) => fresh(c, ++made));
        blocks = [...blocks.slice(0, i + 1), ...rows, ...blocks.slice(i + 1)];
        break;
      }
      case "remove_blocks":
        blocks = blocks.filter((b) => !op.blockIds.includes(b.id));
        break;
      case "set_style": {
        const i = at(op.blockId);
        if (i < 0) notes.push(`${op.blockId}: not in the document`);
        else {
          const kind = KIND_OF_STYLE[op.style] ?? "paragraph";
          blocks[i] = { ...blocks[i], type: TYPE_OF_KIND[kind], kind };
        }
        break;
      }
      case "move_blocks": {
        const moved: SimBlock[] = [];
        for (const item of op.items) {
          if ("markdown" in item) moved.push(...chunks(item.markdown).map((c) => fresh(c, ++made)));
          else for (const id of item.blockIds) {
            const b = blocks.find((x) => x.id === id);
            if (b) moved.push(b);
          }
        }
        const movedIds = new Set(moved.map((b) => b.id));
        const rest = blocks.filter((b) => !movedIds.has(b.id));
        const i = op.afterBlockId === null ? -1 : rest.findIndex((b) => b.id === op.afterBlockId);
        if (op.afterBlockId !== null && i < 0) {
          notes.push(`${op.afterBlockId}: not in the document`);
          break;
        }
        blocks = [...rest.slice(0, i + 1), ...moved, ...rest.slice(i + 1)];
        break;
      }
      case "set_alignment":
      case "set_spacing":
      case "set_indent":
        break;
      case "insert_row":
      case "remove_row":
      case "move_row":
      case "insert_column":
      case "remove_column":
      case "move_column":
        notes.push(`${op.op} on ${op.blockId}: a table op the simulation does not land`);
        break;
      default:
        break;
    }
  }
  return { blocks, notes };
}
