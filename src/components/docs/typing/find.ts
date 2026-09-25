import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { suggestEach } from "@/components/docs/ext/suggest";
import { OBJECT_CHAR } from "@/components/docs/typing/chars";

// Find and Find and replace (SPEC.md §29, typing), Google Docs' semantics:
// case-insensitive unless Match case is on; a straight quote in the query finds
// the curly ones too; "…" and "..." find each other; Ignore diacritics folds
// é to e and æ to ae on both sides; a result never crosses a table cell. The
// results are decorations: every result light green, the current one green.

export type FindOptions = { matchCase: boolean; regex: boolean; ignoreDiacritics: boolean };
type FindResult = { from: number; to: number };

type FindState = {
  /** The find bar or the Find and replace dialog is open. */
  open: boolean;
  query: string;
  options: FindOptions;
  results: FindResult[];
  /** Index of the current result, or -1. */
  current: number;
};

const findKey = new PluginKey<FindState>("docsFind");

const EMPTY_FIND: FindState = {
  open: false,
  query: "",
  options: { matchCase: false, regex: false, ignoreDiacritics: false },
  results: [],
  current: -1,
};

type Patch = Partial<Pick<FindState, "open" | "query" | "options" | "current">> & {
  /** Pick the first result at or after this position. */
  near?: number;
};

// ── The text the search runs over ───────────────────────────────────────

/** A stretch of a segment's text: `size` characters from `offset`, which
    stand at `pos` in the document — a text node character by character, an
    inline object as one character, a paragraph break as none. */
type Run = { offset: number; size: number; pos: number; kind: "text" | "object" | "break"; nodeSize: number };
type Segment = { text: string; runs: Run[]; /** End of the last block's words. */ end: number };

/** One segment per table cell and one for everything else: paragraphs join
    with "\n", a line break is "\v", an inline object is never found. */
function segments(doc: PMNode): Segment[] {
  const body: Segment = { text: "", runs: [], end: 0 };
  const out: Segment[] = [body];
  const addBlock = (seg: Segment, node: PMNode, pos: number) => {
    if (seg.runs.length) {
      seg.runs.push({ offset: seg.text.length, size: 1, pos: seg.end, kind: "break", nodeSize: 0 });
      seg.text += "\n";
    }
    let p = pos + 1;
    node.forEach((child) => {
      if (child.isText) {
        const text = child.text ?? "";
        seg.runs.push({ offset: seg.text.length, size: text.length, pos: p, kind: "text", nodeSize: child.nodeSize });
        seg.text += text;
      } else {
        seg.runs.push({ offset: seg.text.length, size: 1, pos: p, kind: "object", nodeSize: child.nodeSize });
        seg.text += child.type.name === "hardBreak" ? "\v" : OBJECT_CHAR;
      }
      p += child.nodeSize;
    });
    seg.end = pos + node.nodeSize - 1;
    if (!seg.runs.length) seg.runs.push({ offset: 0, size: 0, pos: seg.end, kind: "break", nodeSize: 0 });
  };
  const walk = (node: PMNode, pos: number, seg: Segment) => {
    node.forEach((child, offset) => {
      const childPos = pos + offset;
      if (child.type.name === "tableCell" || child.type.name === "tableHeader") {
        const cell: Segment = { text: "", runs: [], end: childPos + 1 };
        out.push(cell);
        walk(child, childPos + 1, cell);
      } else if (child.isTextblock) {
        addBlock(seg, child, childPos);
      } else if (!child.isLeaf) {
        walk(child, childPos + 1, seg);
      }
    });
  };
  walk(doc, 0, body);
  return out;
}

/** The run holding character `i` of a segment. */
function runAt(seg: Segment, i: number): Run {
  let lo = 0;
  let hi = seg.runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (seg.runs[mid].offset <= i) lo = mid;
    else hi = mid - 1;
  }
  return seg.runs[lo];
}

/** Where character `i` starts in the document, and where it ends. */
function startOf(seg: Segment, i: number): number {
  const run = runAt(seg, i);
  return run.kind === "text" ? run.pos + (i - run.offset) : run.pos;
}
function endOf(seg: Segment, i: number): number {
  const run = runAt(seg, i);
  if (run.kind === "text") return run.pos + (i - run.offset) + 1;
  return run.kind === "object" ? run.pos + run.nodeSize : run.pos;
}

const LIGATURES: Record<string, string> = {
  Æ: "AE",
  æ: "ae",
  ß: "ss",
  Ĳ: "IJ",
  ĳ: "ij",
  Œ: "OE",
  œ: "oe",
  Ǆ: "DZ",
  ǅ: "Dz",
  ǆ: "dz",
  Ǉ: "LJ",
  ǈ: "Lj",
  ǉ: "lj",
  Ǌ: "NJ",
  ǋ: "Nj",
  ǌ: "nj",
  Ǣ: "AE",
  Ǽ: "AE",
  ǣ: "ae",
  ǽ: "ae",
  Ǳ: "DZ",
  ǲ: "Dz",
  ǳ: "dz",
};

// Latin letters Unicode does not decompose.
const BASES: Record<string, string> = {
  Ł: "L",
  ł: "l",
  Ø: "O",
  ø: "o",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  ı: "i",
  Ŧ: "T",
  ŧ: "t",
  Ŀ: "L",
  ŀ: "l",
  ƀ: "b",
  Ɨ: "I",
  ɨ: "i",
  Ƶ: "Z",
  ƶ: "z",
};

const DROPPED =
  /[\u02B0-\u02FF\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F\u0591-\u05BD\u0600-\u0605\u0610-\u061A\u064B-\u065F\u0670\u0674\u06D6-\u06DD\u06DF-\u06E8\u06EA-\u06ED\u070F\u0711\u0730-\u074A\u07A6-\u07B0\u0816-\u082D]/;

/** One character with its diacritics folded away: "" when it is a mark. */
function foldChar(ch: string): string {
  if (LIGATURES[ch]) return LIGATURES[ch];
  if (ch === "×") return "x";
  if (DROPPED.test(ch)) return "";
  const code = ch.charCodeAt(0);
  if ((code >= 0xc0 && code <= 0x24f) || (code >= 0x1e00 && code <= 0x1eff)) {
    if ("ÐðÞþ".includes(ch)) return ch;
    if (BASES[ch]) return BASES[ch];
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return base.length === 1 ? base : ch;
  }
  return ch;
}

/** A segment's text with diacritics folded, and for each folded character
    the character of the segment it came from. */
function foldSegment(seg: Segment): { text: string; source: Int32Array } {
  let text = "";
  const source: number[] = [];
  for (let i = 0; i < seg.text.length; i++) {
    for (const ch of foldChar(seg.text[i])) {
      text += ch;
      source.push(i);
    }
  }
  return { text, source: Int32Array.from(source) };
}

function foldText(text: string): string {
  let out = "";
  for (const ch of text) out += foldChar(ch);
  return out;
}

function escape(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** A query as a pattern: literal, with quotes and ellipses finding their
    other forms. */
function literalPattern(query: string): string {
  let out = "";
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (query.startsWith("...", i)) {
      out += "(?:\\.\\.\\.|…)";
      i += 2;
    } else if (ch === "…") out += "(?:\\.\\.\\.|…)";
    else if (ch === "'") out += "['‘’‛‚]";
    else if (ch === '"') out += '["“”‟„⹂]';
    else out += escape(ch);
  }
  return out;
}

/** The results of `query` in the document, in document order. An invalid
    regular expression finds nothing. */
function findResults(doc: PMNode, query: string, options: FindOptions): FindResult[] {
  if (!query) return [];
  const q = options.ignoreDiacritics ? foldText(query) : query;
  let re: RegExp;
  try {
    re = new RegExp(options.regex ? q : literalPattern(q), options.matchCase ? "gm" : "gmi");
  } catch {
    return [];
  }
  const out: FindResult[] = [];
  for (const seg of segments(doc)) {
    const folded = options.ignoreDiacritics ? foldSegment(seg) : null;
    const text = folded ? folded.text : seg.text;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 100000) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (m[0].includes(OBJECT_CHAR)) continue;
      const s = folded ? folded.source[m.index] : m.index;
      const e = folded ? folded.source[m.index + m[0].length - 1] : m.index + m[0].length - 1;
      out.push({ from: startOf(seg, s), to: endOf(seg, e) });
    }
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

/** The first result at or after `pos`, wrapping to the first one. */
function resultNear(results: FindResult[], pos: number): number {
  if (!results.length) return -1;
  const i = results.findIndex((m) => m.from >= pos);
  return i === -1 ? 0 : i;
}

// ── The plugin ──────────────────────────────────────────────────────────

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => EMPTY_FIND,
      apply(tr: Transaction, value: FindState, _old: EditorState, state: EditorState): FindState {
        const patch = tr.getMeta(findKey) as Patch | undefined;
        if (!patch && !(tr.docChanged && value.open)) return value;
        const { near, ...rest } = patch ?? {};
        const next: FindState = { ...value, ...rest };
        if (patch && "open" in patch && !patch.open) return { ...next, results: [], current: -1 };
        if (!next.open) return next;
        const research =
          !patch ||
          tr.docChanged ||
          near !== undefined ||
          patch.query !== undefined ||
          patch.options !== undefined ||
          patch.open !== undefined;
        if (research) {
          const before = value.current >= 0 ? value.results[value.current] : null;
          next.results = findResults(state.doc, next.query, next.options);
          if (near !== undefined) next.current = resultNear(next.results, near);
          else if (patch?.current !== undefined) next.current = Math.min(patch.current, next.results.length - 1);
          else if (before) next.current = resultNear(next.results, tr.mapping.map(before.from));
          else next.current = next.results.length ? 0 : -1;
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        const find = findKey.getState(state);
        if (!find?.open || !find.results.length) return null;
        return DecorationSet.create(
          state.doc,
          find.results.map((m, i) =>
            Decoration.inline(m.from, m.to, {
              class: i === find.current ? "docs-find-result docs-find-current" : "docs-find-result",
            }),
          ),
        );
      },
    },
  });
}

export function findState(state: EditorState): FindState {
  return findKey.getState(state) ?? EMPTY_FIND;
}

/** Change the search; the results follow. */
export function setFind(view: EditorView, patch: Patch): FindState {
  view.dispatch(view.state.tr.setMeta(findKey, patch).setMeta("addToHistory", false));
  return findState(view.state);
}

/** Change the search from the caret: the first result after it is selected. */
export function searchFrom(view: EditorView, patch: Patch): void {
  const next = setFind(view, { ...patch, near: view.state.selection.from });
  if (next.current >= 0) selectResult(view, next.current);
}

/** Make result `index` current: it is selected in the document and scrolled
    into view. */
function selectResult(view: EditorView, index: number): void {
  const find = findState(view.state);
  const result = find.results[index];
  if (!result) return;
  const tr = view.state.tr.setMeta(findKey, { current: index }).setMeta("addToHistory", false);
  try {
    tr.setSelection(TextSelection.create(tr.doc, result.from, result.to));
  } catch {
    // A result over a block boundary keeps the old selection.
  }
  view.dispatch(tr);
  revealPos(view, result.from);
}

/** Step to the next (1) or previous (-1) result, wrapping around. Returns
    true when the step wrapped. */
export function stepResult(view: EditorView, dir: 1 | -1): boolean {
  const find = findState(view.state);
  const count = find.results.length;
  if (!count) return false;
  let next = find.current + dir;
  let wrapped = false;
  if (find.current < 0) next = dir === 1 ? resultNear(find.results, view.state.selection.to) : count - 1;
  if (next >= count) {
    next = 0;
    wrapped = true;
  } else if (next < 0) {
    next = count - 1;
    wrapped = true;
  }
  selectResult(view, next);
  return wrapped;
}

/** Scroll the pane so `pos` shows below the sticky header. */
function revealPos(view: EditorView, pos: number): void {
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    return;
  }
  let scroller: HTMLElement | null = view.dom.parentElement;
  while (scroller) {
    const style = getComputedStyle(scroller);
    if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
    scroller = scroller.parentElement;
  }
  const header = view.dom.closest("[data-docs-editor]")?.querySelector<HTMLElement>(".docs-header");
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  const top = Math.max(box.top, headerBottom) + 24;
  const bottom = box.bottom - 24;
  if (coords.top >= top && coords.bottom <= bottom) return;
  const delta = coords.top - (top + (bottom - top) / 3);
  if (scroller) scroller.scrollBy({ top: delta });
  else window.scrollBy({ top: delta });
}

/** Replace result `index` with `text`, which takes the formatting of the
    result's first character; the next result becomes current. */
export function replaceResult(view: EditorView, index: number, text: string): void {
  const find = findState(view.state);
  const result = find.results[index];
  if (!result || !view.editable) return;
  const { state } = view;
  const marks = state.doc.nodeAt(result.from)?.marks ?? [];
  const tr = state.tr;
  if (text) tr.replaceWith(result.from, result.to, state.schema.text(text, marks));
  else tr.delete(result.from, result.to);
  const after = tr.mapping.map(result.to);
  tr.setMeta(findKey, { near: after });
  view.dispatch(tr);
  const next = findState(view.state);
  if (next.current >= 0) selectResult(view, next.current);
}

/** Replace every result as one undo step; in Suggesting mode each is a
    suggestion of its own. Returns how many. */
export function replaceAll(view: EditorView, text: string): number {
  const find = findState(view.state);
  if (!find.results.length || !view.editable) return 0;
  const { state } = view;
  const tr = state.tr;
  for (let i = find.results.length - 1; i >= 0; i--) {
    const m = find.results[i];
    const marks = state.doc.nodeAt(m.from)?.marks ?? [];
    if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
    else tr.delete(m.from, m.to);
  }
  view.dispatch(suggestEach(tr));
  return find.results.length;
}
