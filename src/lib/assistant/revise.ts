import type { Block } from "@prisma/client";
import type { Thinking } from "@/lib/assistant/thinking";
import { blockKind, withListMarkers, type BlockKind } from "@/lib/block-kind";
import { blockTakes, isWebAddress, keepsLines, type DocumentShape } from "@/lib/block-takes";
import type { ChatTurn } from "@/lib/conversation";
import { SUGGEST_MAX_NEW_CHARS, SUGGEST_MAX_WINDOWS, SUGGEST_PARALLEL } from "@/lib/derive/config";
import { runSuggest } from "@/lib/derive/suggest";
import type { ResolvedOp, SuggestStyle } from "@/lib/docs/assistant-suggestions";
import { scopeOf, windowsOf, type BlockPlace } from "@/lib/docs/suggest-ops";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { mapLimit } from "@/lib/jev";
import type { ReaderProfileCtx } from "@/lib/prompts/types";
import { replicaEdit, replicaWarning } from "@/lib/replica";
import { hexStyle } from "@/lib/text-style";
import type { AssistantAction, AssistantAnchor } from "@/lib/types";

// The revise action (SPEC.md §7): a change to many blocks of a document
// without rich text, the spelling or the grammar across it, its register, a
// section rewritten. The sidebar assistant names the change; the server
// reads the document part by part the way the page editor's suggestions do
// (lib/derive/suggest.ts, one code path: windows, one model call each), and
// turns the ops into the plan card's block actions, each one the block
// routes take (lib/block-takes.ts). The reader checks them and applies them;
// Undo takes them back.

/** A block of the open document as the revision reads it. */
export type RevisedBlock = Pick<Block, "id" | "type" | "text" | "html"> & Partial<Pick<Block, "startTime" | "endTime">>;

const STYLE_OF_KIND: Record<BlockKind, SuggestStyle> = {
  paragraph: "normal",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  list: "bulleted",
  numbered: "numbered",
};

/** Each block whose words the revision may change, as the ops read it: its
    format as a paragraph style (code has none), and one container for all,
    so consecutive blocks change together; a slide or a sheet its words
    alone. An equation's TeX changes by rewrite_block, which needs no place;
    a transcript line waits for the video's turn. */
export function revisePlaces(blocks: RevisedBlock[], shape: DocumentShape): Map<string, BlockPlace> {
  const places = new Map<string, BlockPlace>();
  for (const b of blocks) {
    // A slide's words change within its lines, a sheet's within its cells,
    // and nothing else of them.
    if ((b.type === "SLIDE" || b.type === "SHEET") && blockTakes.words(b.type, shape)) {
      places.set(b.id, { style: null, where: "words", container: "", group: null });
      continue;
    }
    if (!blockTakes.words(b.type, shape) || b.type === "EQUATION" || b.type === "TRANSCRIPT") continue;
    const style = b.type === "CODE" ? null : STYLE_OF_KIND[blockKind(b.type, b.html, b.text)];
    places.set(b.id, { style, where: "body", container: "", group: null });
  }
  return places;
}

/** The blocks the revision reads, in document order: the named ones (a
    heading grows to its section), else the whole document; only blocks
    whose words it may change. */
export function reviseScope(blocks: RevisedBlock[], places: Map<string, BlockPlace>, blockIds: string[] | undefined): string[] {
  const takes = (b: RevisedBlock) => places.has(b.id) || b.type === "EQUATION";
  const named = blockIds?.length ? new Set(scopeOf(blocks, places, blockIds)) : null;
  return blocks.filter((b) => takes(b) && (!named || named.has(b.id))).map((b) => b.id);
}

// ── Ops to block actions ───────────────────────────────────────────────────

type NewBlock = { kind: BlockKind; text: string };
// A list being read: its kind, its lines, and the indents of its open levels.
type OpenList = { kind: "list" | "numbered"; lines: string[]; indents: number[] };

/** Inline markdown as plain words: bold markers dropped, a link its text,
    code its words. */
const plain = (text: string): string =>
  text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

/** Markdown as the blocks of a document without rich text: a heading (#
    to ###; deeper is ###), a paragraph (its lines joined), or a list: its
    lines one LIST block, each with its marker and two spaces per level of
    nesting, the first line's marker naming the list's kind. */
export function markdownBlocks(markdown: string): NewBlock[] {
  const blocks: NewBlock[] = [];
  let paragraph: string[] = [];
  let list = null as OpenList | null;
  const endParagraph = () => {
    const text = plain(paragraph.join(" "));
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };
  const endList = () => {
    if (list && list.lines.length > 0) blocks.push({ kind: list.kind, text: withListMarkers(list.lines.join("\n"), list.kind) });
    list = null;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/\t/g, "    ").trimEnd();
    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    // An image takes no place in a document without rich text: it ends the
    // block before it, as a blank line does.
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) {
      endParagraph();
      endList();
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?$/.exec(line);
    if (heading) {
      endParagraph();
      endList();
      const text = plain(heading[2]);
      if (text) blocks.push({ kind: `h${Math.min(3, heading[1].length)}` as BlockKind, text });
      continue;
    }
    const item = /^(\s*)([-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      endParagraph();
      const kind = /\d/.test(item[2]) ? "numbered" : "list";
      const indent = item[1].length;
      // A new marker at the top level starts a new list.
      if (list && indent === 0 && list.kind !== kind) endList();
      const open: OpenList = (list ??= { kind, lines: [], indents: [] });
      // One level per step in, whatever the step's width.
      while (open.indents.length > 0 && indent < open.indents[open.indents.length - 1]) open.indents.pop();
      if (open.indents.length === 0 || indent > open.indents[open.indents.length - 1]) open.indents.push(indent);
      open.lines.push(`${"  ".repeat(open.indents.length - 1)}- ${plain(item[3])}`);
      continue;
    }
    // An indented line under a list item goes on with it.
    if (list && /^\s/.test(line)) {
      list.lines[list.lines.length - 1] += ` ${plain(line)}`;
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  return blocks;
}

const KIND_OF_STYLE: Record<SuggestStyle, BlockKind> = {
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

const DESCRIPTION_MAX = 300;
const describe = (whys: string[]): string => {
  const text = [...new Set(whys.map((w) => w.trim()).filter(Boolean))].join(" ");
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : text;
};

const anchorIn = (text: string, blockId: string, start: number, end: number): AssistantAnchor => ({
  blockId,
  startOffset: start,
  endOffset: end,
  quotedText: text.slice(start, end),
  prefix: text.slice(Math.max(0, start - 32), start),
  suffix: text.slice(end, end + 32),
});

/** #rgb as #rrggbb. */
const longHex = (value: string): string => (/^#[0-9a-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value);

/** The indexes of an alignment of two lists by equal items (the longest
    common run), as pairs [i, j]. */
function commonPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** The resolved ops of every window as the plan card's block actions, in
    document order: a block's word changes as one edit_block with the styles
    and links on its new words after it, then its format; replaced blocks
    as edits of the blocks they pair with, removals, and new blocks; each
    one checked against what the block takes. An op the plan cannot carry
    is a warning with its why. */
export function reviseActions(
  ops: ResolvedOp[],
  ctx: { blocks: RevisedBlock[]; shape: DocumentShape; t: TFunc },
): { actions: AssistantAction[]; warnings: string[] } {
  const { blocks, shape, t } = ctx;
  const index = new Map(blocks.map((b, k) => [b.id, k]));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const warnings: string[] = [];
  const refuse = (why: string) => warnings.push(t("api.warnActionNotForDocument", { description: why }));
  // Each unit sorts by the place it concerns; new blocks after a block
  // stand between it and the next.
  const units: { at: number; seq: number; actions: AssistantAction[] }[] = [];
  const add = (at: number, actions: AssistantAction[]) => units.push({ at, seq: units.length, actions });

  // A block's own changes, gathered: its words, their styles, its format.
  type Own = { rewrite?: Extract<ResolvedOp, { op: "rewrite_block" }>; words: Extract<ResolvedOp, { op: "replace_words" | "format_words" }>[]; style?: Extract<ResolvedOp, { op: "set_style" }> };
  const own = new Map<string, Own>();
  const ownOf = (blockId: string): Own => {
    let entry = own.get(blockId);
    if (!entry) own.set(blockId, (entry = { words: [] }));
    return entry;
  };

  const kindOf = (b: RevisedBlock): BlockKind => blockKind(b.type, b.html, b.text);
  const insertAfter = (afterId: string | null, fresh: NewBlock[], why: string): AssistantAction[] =>
    fresh.map((n) => ({
      type: "insert_paragraph",
      afterBlockId: afterId,
      text: n.text,
      ...(n.kind === "paragraph" ? {} : { kind: n.kind }),
      description: why,
    }));

  for (const op of ops) {
    switch (op.op) {
      case "replace_words":
      case "format_words":
        ownOf(op.blockId).words.push(op);
        break;
      case "rewrite_block":
        if (byId.get(op.blockId)?.type === "FIGURE") refuse(op.why);
        else ownOf(op.blockId).rewrite = op;
        break;
      case "set_style":
        ownOf(op.blockId).style = op;
        break;
      case "remove_blocks":
        add(
          index.get(op.blockIds[0]) ?? 0,
          op.blockIds.map((blockId) => ({ type: "remove_block", blockId, description: op.why })),
        );
        break;
      case "insert_blocks": {
        const fresh = markdownBlocks(op.markdown);
        if (fresh.length === 0) refuse(op.why);
        else add(op.afterBlockId === null ? -0.5 : (index.get(op.afterBlockId) ?? 0) + 0.5, insertAfter(op.afterBlockId, fresh, op.why));
        break;
      }
      case "replace_blocks": {
        const olds = op.blockIds.map((id) => byId.get(id)!).filter(Boolean);
        const fresh = markdownBlocks(op.markdown);
        const actions: AssistantAction[] = [];
        // Blocks that stay as they were anchor the rest; between two, the
        // blocks pair up in order, the extra old ones go, and the extra new
        // ones follow the last block that stays.
        const pairs = commonPairs(olds.map((b) => b.text.trim()), fresh.map((b) => b.text.trim()));
        const before = index.get(olds[0].id) ?? 0;
        let lastKept: string | null = before > 0 ? blocks[before - 1].id : null;
        let i = 0;
        let j = 0;
        for (const [pi, pj] of [...pairs, [olds.length, fresh.length] as [number, number]]) {
          const gapOld = olds.slice(i, pi);
          const gapNew = fresh.slice(j, pj);
          const paired = Math.min(gapOld.length, gapNew.length);
          for (let k = 0; k < paired; k++) {
            const was = gapOld[k];
            const now = gapNew[k];
            if (now.text !== was.text) actions.push({ type: "edit_block", blockId: was.id, newText: now.text, description: op.why });
            if (now.kind !== kindOf(was)) actions.push({ type: "format_block", blockId: was.id, kind: now.kind, description: op.why });
            lastKept = was.id;
          }
          for (const was of gapOld.slice(paired)) actions.push({ type: "remove_block", blockId: was.id, description: op.why });
          actions.push(...insertAfter(lastKept, gapNew.slice(paired), op.why));
          if (pi < olds.length) {
            const kept = olds[pi];
            if (fresh[pj].kind !== kindOf(kept)) actions.push({ type: "format_block", blockId: kept.id, kind: fresh[pj].kind, description: op.why });
            lastKept = kept.id;
          }
          i = pi + 1;
          j = pj + 1;
        }
        add(before, actions);
        break;
      }
      default:
        // Alignment, tables, footnotes: a document without rich text has none.
        refuse(op.why);
    }
  }

  for (const [blockId, entry] of own) {
    const block = byId.get(blockId);
    if (!block) continue;
    const actions: AssistantAction[] = [];
    let text = block.text;
    // The styles and links on the new words: their spans in the new text.
    const marks: { start: number; end: number; format: string; value?: string; why: string }[] = [];
    const whys: string[] = [];
    if (entry.rewrite) {
      text = block.type === "EQUATION" ? entry.rewrite.text.trim() : entry.rewrite.text.trimEnd();
      whys.push(entry.rewrite.why);
    } else {
      const words = [...entry.words].sort((a, b) => a.start - b.start);
      let out = "";
      let at = 0;
      // Old offset → new offset, for spans that no replacement touches.
      const shifts: { end: number; delta: number }[] = [];
      const moved = (p: number) => p + shifts.filter((s) => s.end <= p).reduce((sum, s) => sum + s.delta, 0);
      for (const op of words) {
        if (op.op !== "replace_words") continue;
        out += block.text.slice(at, op.start);
        const start = out.length;
        out += op.text;
        if (op.format && op.text) marks.push({ start, end: start + op.text.length, format: op.format, why: op.why });
        shifts.push({ end: op.end, delta: op.text.length - (op.end - op.start) });
        whys.push(op.why);
        at = op.end;
      }
      text = out + block.text.slice(at);
      for (const op of words) {
        if (op.op === "format_words") marks.push({ start: moved(op.start), end: moved(op.end), format: op.format, value: op.value, why: op.why });
      }
    }
    if (text !== block.text) actions.push({ type: "edit_block", blockId, newText: text, description: describe(whys) });
    for (const mark of marks) {
      const anchor = anchorIn(text, blockId, mark.start, mark.end);
      if (mark.format === "bold" || mark.format === "italic" || mark.format === "underline") {
        actions.push({ type: "style", anchor, style: mark.format, description: mark.why });
      } else if (mark.format === "color" || mark.format === "highlight_color") {
        const style = hexStyle(mark.format === "color" ? "color" : "highlight", longHex(mark.value ?? ""));
        if (style) actions.push({ type: "style", anchor, style, description: mark.why });
        else refuse(mark.why);
      } else if (mark.format === "link" && (mark.value === "" || isWebAddress(mark.value ?? ""))) {
        actions.push({ type: "link", anchor, href: (mark.value ?? "").trim(), description: mark.why });
      } else refuse(mark.why);
    }
    if (entry.style) {
      const kind = KIND_OF_STYLE[entry.style.style];
      if (kind !== kindOf(block)) actions.push({ type: "format_block", blockId, kind, description: entry.style.why });
    }
    add(index.get(blockId) ?? 0, actions);
  }

  // Each action as the block routes take it: an edit the block does not
  // take is a warning, never a write.
  const next = (id: string) => blocks[(index.get(id) ?? -2) + 1]?.type;
  const takes = (action: AssistantAction): boolean => {
    switch (action.type) {
      case "edit_block": {
        const block = byId.get(action.blockId);
        return Boolean(block) && blockTakes.words(block!.type, shape);
      }
      case "remove_block":
        return blockTakes.removal(byId.get(action.blockId)?.type ?? "", shape);
      case "format_block":
        return blockTakes.kind(byId.get(action.blockId)?.type ?? "", shape);
      case "style":
      case "link":
        return blockTakes.style(byId.get(action.anchor.blockId)?.type ?? "");
      case "insert_paragraph":
        return action.afterBlockId === null
          ? blockTakes.start(blocks[0]?.type, shape)
          : blockTakes.after(byId.get(action.afterBlockId)?.type ?? "", next(action.afterBlockId), shape);
      default:
        return false;
    }
  };
  // A slide's or a sheet's words change within its lines and cells, as its
  // replica takes them (lib/replica.ts): why not, or null.
  const replicaWhy = (action: AssistantAction): string | null => {
    const block = action.type === "edit_block" ? byId.get(action.blockId) : undefined;
    if (action.type !== "edit_block" || !block || (block.type !== "SLIDE" && block.type !== "SHEET")) return null;
    const edited = keepsLines(block.text, action.newText)
      ? replicaEdit(block.type, block.html ?? "", block.text, action.newText)
      : { refused: block.type === "SLIDE" ? ("lines" as const) : ("grid" as const) };
    return "refused" in edited ? replicaWarning(t, edited.refused, action.description) : null;
  };
  const actions: AssistantAction[] = [];
  for (const unit of units.sort((a, b) => a.at - b.at || a.seq - b.seq)) {
    for (const action of unit.actions) {
      const why = replicaWhy(action);
      if (why) warnings.push(why);
      else if (takes(action)) actions.push(action);
      else refuse(action.description);
    }
  }
  return { actions, warnings };
}

// ── The run ────────────────────────────────────────────────────────────────

export type ReviseRun = {
  userId: string;
  document: { title: string; references: unknown; blocks: RevisedBlock[] };
  shape: DocumentShape;
  profile: ReaderProfileCtx;
  lang: Lang;
  t: TFunc;
  // The reader's message, the revise action's instruction, and the answer.
  command: string;
  instruction: string;
  material: string | null;
  history: ChatTurn[];
  blockIds: string[] | undefined;
  caretBlockId: string | null;
  thinking: Thinking;
  // Windows not started by then are reported.
  signal: AbortSignal;
  deadline: AbortSignal;
};

/** The revision over its windows, SUGGEST_PARALLEL at once, as block
    actions and warnings. */
export async function runRevise(run: ReviseRun): Promise<{ actions: AssistantAction[]; warnings: string[] }> {
  const { t } = run;
  const blocks = run.document.blocks;
  const places = revisePlaces(blocks, run.shape);
  const scope = reviseScope(blocks, places, run.blockIds);
  if (scope.length === 0) return { actions: [], warnings: [t("api.reviseNoBlocks")] };
  const all = windowsOf(blocks, places, scope);
  const windows = all.slice(0, SUGGEST_MAX_WINDOWS);
  const warnings = all.length > windows.length ? [t("api.suggestTooLong")] : [];
  const whole = !run.blockIds?.length;
  const budget = { chars: SUGGEST_MAX_NEW_CHARS };
  const found: ResolvedOp[][] = [];
  const summaries: string[] = [];
  let late = false;
  await mapLimit(windows, SUGGEST_PARALLEL, async (blockIds, i) => {
    // The first window writes the prefix to the cache; the others of the
    // first wave start a second later and read it.
    if (i > 0 && i < SUGGEST_PARALLEL) await new Promise((resolve) => setTimeout(resolve, 1000));
    if (run.signal.aborted) {
      late ||= run.deadline.aborted;
      return;
    }
    try {
      const result = await runSuggest({
        userId: run.userId,
        document: { title: run.document.title, references: run.document.references, pageName: null, rows: blocks, places, richText: null },
        profile: run.profile,
        lang: run.lang,
        t,
        command: run.command,
        instruction: run.instruction,
        material: run.material,
        history: run.history,
        scope: { kind: "blocks", blockIds },
        window: { n: i + 1, of: windows.length, whole },
        caretBlockId: run.caretBlockId,
        thinking: run.thinking,
        budget,
        signal: run.signal,
        target: "plan",
      });
      found[i] = result.ops;
      summaries[i] = result.summary;
      warnings.push(...result.warnings);
    } catch (err) {
      if (run.deadline.aborted) late = true;
      else warnings.push(err instanceof Error ? err.message : String(err));
    }
  });
  if (late) warnings.push(t("api.suggestOutOfTime"));
  const converted = reviseActions(found.flat(), { blocks, shape: run.shape, t });
  // Nothing to change: the first window's word on why.
  if (converted.actions.length === 0 && converted.warnings.length === 0 && warnings.length === 0) {
    const said = summaries.find(Boolean);
    warnings.push(said ?? t("api.reviseNoEdits"));
  }
  return { actions: converted.actions, warnings: [...warnings, ...converted.warnings] };
}
