import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { OBJECT_CHAR } from "@/components/docs/typing/chars";

// Find and Find and replace (SPEC.md §29, typing), Google Docs' semantics:
// case-insensitive unless Match case; a straight quote in the query finds
// the curly ones too; "…" and "..." find each other; Ignore diacritics folds
// é to e and æ to ae on both sides; a match never crosses a table cell. The
// matches are decorations: every match light green, the current one green.

export type FindOptions = { matchCase: boolean; regex: boolean; ignoreDiacritics: boolean };
export type FindMatch = { from: number; to: number };

export type FindState = {
  /** The find bar or the Find and replace dialog is open. */
  open: boolean;
  query: string;
  options: FindOptions;
  matches: FindMatch[];
  /** Index of the current match, or -1. */
  current: number;
};

export const findKey = new PluginKey<FindState>("docsFind");

export const EMPTY_FIND: FindState = {
  open: false,
  query: "",
  options: { matchCase: false, regex: false, ignoreDiacritics: false },
  matches: [],
  current: -1,
};

type Patch = Partial<Pick<FindState, "open" | "query" | "options" | "current">> & {
  /** Pick the first match at or after this position. */
  near?: number;
};

// ── The text the search runs over ───────────────────────────────────────

type Segment = { text: string; starts: number[]; ends: number[] };

/** One segment per table cell and one for everything else: paragraphs join
    with "\n", a line break is "\v", an inline object never matches. */
function segments(doc: PMNode): Segment[] {
  const body: Segment = { text: "", starts: [], ends: [] };
  const out: Segment[] = [body];
  const addBlock = (seg: Segment, node: PMNode, pos: number) => {
    if (seg.text) {
      seg.text += "\n";
      const at = seg.ends[seg.ends.length - 1] ?? pos;
      seg.starts.push(at);
      seg.ends.push(at);
    }
    let p = pos + 1;
    node.forEach((child) => {
      if (child.isText) {
        const text = child.text ?? "";
        for (let i = 0; i < text.length; i++) {
          seg.starts.push(p + i);
          seg.ends.push(p + i + 1);
        }
        seg.text += text;
      } else {
        seg.text += child.type.name === "hardBreak" ? "\v" : OBJECT_CHAR;
        seg.starts.push(p);
        seg.ends.push(p + child.nodeSize);
      }
      p += child.nodeSize;
    });
  };
  const walk = (node: PMNode, pos: number, seg: Segment) => {
    node.forEach((child, offset) => {
      const childPos = pos + offset;
      if (child.type.name === "tableCell" || child.type.name === "tableHeader") {
        const cell: Segment = { text: "", starts: [], ends: [] };
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
  /[ʰ-˿̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-֑︯-ֽ؀-؅ؐ-ًؚ-ٰٟٴۖ-۝۟-۪ۨ-ۭ܏ܑܰ-݊ަ-ްࠖ-࠭]/;

/** One character with its diacritics folded away: "" when it is a mark. */
export function foldChar(ch: string): string {
  if (LIGATURES[ch]) return LIGATURES[ch];
  if (ch === "×") return "x";
  if (DROPPED.test(ch)) return "";
  const code = ch.charCodeAt(0);
  if ((code >= 0xc0 && code <= 0x24f) || (code >= 0x1e00 && code <= 0x1eff)) {
    if ("ÐðÞþ".includes(ch)) return ch;
    if (BASES[ch]) return BASES[ch];
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return base.length === 1 ? base : ch;
  }
  return ch;
}

function foldSegment(seg: Segment): Segment {
  const out: Segment = { text: "", starts: [], ends: [] };
  for (let i = 0; i < seg.text.length; i++) {
    const folded = foldChar(seg.text[i]);
    for (const ch of folded) {
      out.text += ch;
      out.starts.push(seg.starts[i]);
      out.ends.push(seg.ends[i]);
    }
  }
  return out;
}

export function foldText(text: string): string {
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

/** The matches of `query` in the document, in document order. An invalid
    regular expression finds nothing. */
export function findMatches(doc: PMNode, query: string, options: FindOptions): FindMatch[] {
  if (!query) return [];
  const q = options.ignoreDiacritics ? foldText(query) : query;
  let re: RegExp;
  try {
    re = new RegExp(options.regex ? q : literalPattern(q), options.matchCase ? "gm" : "gmi");
  } catch {
    return [];
  }
  const out: FindMatch[] = [];
  for (const raw of segments(doc)) {
    const seg = options.ignoreDiacritics ? foldSegment(raw) : raw;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(seg.text)) && guard++ < 100000) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const s = m.index;
      const e = s + m[0].length;
      if (m[0].includes(OBJECT_CHAR)) continue;
      out.push({ from: seg.starts[s], to: seg.ends[e - 1] });
    }
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

/** The first match at or after `pos`, wrapping to the first one. */
export function matchNear(matches: FindMatch[], pos: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex((m) => m.from >= pos);
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
        if (patch && "open" in patch && !patch.open) return { ...next, matches: [], current: -1 };
        if (!next.open) return next;
        const research =
          !patch ||
          tr.docChanged ||
          near !== undefined ||
          patch.query !== undefined ||
          patch.options !== undefined ||
          patch.open !== undefined;
        if (research) {
          const before = value.current >= 0 ? value.matches[value.current] : null;
          next.matches = findMatches(state.doc, next.query, next.options);
          if (near !== undefined) next.current = matchNear(next.matches, near);
          else if (patch?.current !== undefined) next.current = Math.min(patch.current, next.matches.length - 1);
          else if (before) next.current = matchNear(next.matches, tr.mapping.map(before.from));
          else next.current = next.matches.length ? 0 : -1;
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        const find = findKey.getState(state);
        if (!find?.open || !find.matches.length) return null;
        return DecorationSet.create(
          state.doc,
          find.matches.map((m, i) =>
            Decoration.inline(m.from, m.to, {
              class: i === find.current ? "docs-find-match docs-find-current" : "docs-find-match",
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

/** Change the search; the matches follow. */
export function setFind(view: EditorView, patch: Patch): FindState {
  view.dispatch(view.state.tr.setMeta(findKey, patch).setMeta("addToHistory", false));
  return findState(view.state);
}

/** Make match `index` current: it is selected in the document and scrolled
    into view. */
export function selectMatch(view: EditorView, index: number): void {
  const find = findState(view.state);
  const match = find.matches[index];
  if (!match) return;
  const tr = view.state.tr.setMeta(findKey, { current: index }).setMeta("addToHistory", false);
  try {
    tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
  } catch {
    // A match over a block boundary keeps the old selection.
  }
  view.dispatch(tr);
  revealPos(view, match.from);
}

/** Step to the next (1) or previous (-1) match, wrapping around. Returns
    true when the step wrapped. */
export function stepMatch(view: EditorView, dir: 1 | -1): boolean {
  const find = findState(view.state);
  const count = find.matches.length;
  if (!count) return false;
  let next = find.current + dir;
  let wrapped = false;
  if (find.current < 0) next = dir === 1 ? matchNear(find.matches, view.state.selection.to) : count - 1;
  if (next >= count) {
    next = 0;
    wrapped = true;
  } else if (next < 0) {
    next = count - 1;
    wrapped = true;
  }
  selectMatch(view, next);
  return wrapped;
}

/** Scroll the pane so `pos` shows below the sticky header. */
export function revealPos(view: EditorView, pos: number): void {
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

/** Replace match `index` with `text`, which takes the formatting of the
    match's first character; the next match becomes current. */
export function replaceMatch(view: EditorView, index: number, text: string): void {
  const find = findState(view.state);
  const match = find.matches[index];
  if (!match || !view.editable) return;
  const { state } = view;
  const marks = state.doc.nodeAt(match.from)?.marks ?? [];
  const tr = state.tr;
  if (text) tr.replaceWith(match.from, match.to, state.schema.text(text, marks));
  else tr.delete(match.from, match.to);
  const after = tr.mapping.map(match.to);
  tr.setMeta(findKey, { near: after });
  view.dispatch(tr);
  const next = findState(view.state);
  if (next.current >= 0) selectMatch(view, next.current);
}

/** Replace every match as one undo step. Returns how many. */
export function replaceAll(view: EditorView, text: string): number {
  const find = findState(view.state);
  if (!find.matches.length || !view.editable) return 0;
  const { state } = view;
  const tr = state.tr;
  for (let i = find.matches.length - 1; i >= 0; i--) {
    const m = find.matches[i];
    const marks = state.doc.nodeAt(m.from)?.marks ?? [];
    if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
    else tr.delete(m.from, m.to);
  }
  view.dispatch(tr);
  return find.matches.length;
}
