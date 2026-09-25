import type { Mark, MarkType, Node as PMNode, NodeType } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { findWrapping } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import {
  isLetterOrDigit,
  isWhitespace,
  isWordBoundary,
  LINE_BREAK,
  OBJECT_CHAR,
} from "@/components/docs/typing/chars";
import { listForPrefix, listLabel } from "@/components/docs/typing/lists";
import { substitutionMap, typingPrefs, type TypingPrefs } from "@/components/docs/typing/prefs";
import { spellingFix } from "@/components/docs/typing/spelling";
import { blockCorrection, correctionDeleted, SPELLING_META } from "@/components/docs/typing/trace";

// Google Docs' autocorrect engine (SPEC.md §29, typing). Each rule fires on
// the character just typed (or on Enter, Tab, Shift+Enter) and looks only at
// the word or the paragraph just finished. Each rule that fires is its own
// transaction and its own undo step, so one Ctrl+Z gives back exactly what
// was typed. Nothing runs during IME composition, on paste, or in code.

/** The meta a transaction made by the engine carries: the rule's name. */
export const AUTOCORRECT_META = "docsAutocorrect";

/** The words of a text block, one character per position: a line break is
    "\v", any other inline object one placeholder character. */
export function blockText(block: PMNode): string {
  let out = "";
  block.forEach((child) => {
    if (child.isText) out += child.text ?? "";
    else if (child.type.name === "hardBreak") out += LINE_BREAK;
    else out += OBJECT_CHAR.repeat(child.nodeSize);
  });
  return out;
}

// ── Link detection: Google Docs' own pattern ────────────────────────────
const TLD =
  "(?:com|org|net|edu|gov|aero|biz|cat|coop|info|int|jobs|mobi|museum|name|pro|travel|arpa|asia|xxx|army|mil|post|tel|xyz|[a-z][a-z])\\b";
const END = "[^\\s`!)\\[\\]{};:'\".,<>?«»“”‘’]";
const WITH_SCHEME = "(?:(https?|ftp)://|www\\.)(?:[^\\s<>]+)(?:" + END + ")";
const HOST = "[A-Za-z0-9.-]+\\.";
const BARE_DOMAIN = HOST + TLD + "(?::[0-9]+)?\\/?";
const BARE_WITH_PATH = HOST + TLD + "(?::[0-9]+)?[/#?][^\\s<>]*" + END;
const EMAIL = "\\b(?:mailto:)?([\\w.+-]+@(?:[a-zA-Z0-9-]+\\.)+[A-Za-z]{2,63})";
const LINK_SOURCE = EMAIL + "|\\b" + WITH_SCHEME + "|\\b" + BARE_WITH_PATH + "|\\b" + BARE_DOMAIN;

/** The first address in `text`, with the href Docs gives it: an email gets
    mailto:, an address without a scheme gets http://. */
export function findLink(text: string): { index: number; length: number; href: string } | null {
  const m = new RegExp(LINK_SOURCE, "i").exec(text);
  if (!m) return null;
  const found = m[0];
  let href: string;
  if (m[1]) href = /^mailto:/i.test(found) ? found : `mailto:${m[1]}`;
  else if (/^https?:\/\//i.test(found)) href = found;
  else if (/^ftp:\/\//i.test(found)) return null;
  else href = `http://${found}`;
  return { index: m.index, length: found.length, href };
}

/** Every address in `text` (for pasted text). */
export function findLinks(text: string): { index: number; length: number; href: string }[] {
  const out: { index: number; length: number; href: string }[] = [];
  let offset = 0;
  while (offset < text.length) {
    const found = findLink(text.slice(offset));
    if (!found) break;
    out.push({ ...found, index: found.index + offset });
    offset += found.index + Math.max(1, found.length);
  }
  return out;
}

// ── Automatic capitalization ────────────────────────────────────────────
const ABBREVIATIONS = new Set(
  (
    "dr mr mrs ms jr sr phd sc ic avg ger lat lit sq in ft km m gal oz lb etc eg cf et al ie c st mt av ave rd " +
    "cr tr co ltd inc jan feb mar apr jun jul aug sep sept oct nov dec mo mon tu tue we wed th thu fr fri sa " +
    "sat su sun no pron feat est abbr fem colloq approx pop ret v vs e.g i.e"
  ).split(" "),
);

function isAbbrev(s: string): boolean {
  return ABBREVIATIONS.has(s.toLowerCase()) || (s.length <= 4 && /^[A-Z]/.test(s));
}

/** Whether a token ends a sentence: it ends in . ! or ?, the text before a
    final "." is no abbreviation, and the dots are no ellipsis. A trailing
    quote or parenthesis means no. */
export function isSentenceEnd(token: string): boolean {
  const t = token.replace(/^['{"(\[‘“]+/, "");
  if (!t) return false;
  const last = t[t.length - 1];
  if (last !== "." && last !== "!" && last !== "?") return false;
  if (last === ".") {
    const dots = /\.+$/.exec(t)?.[0].length ?? 0;
    if (dots % 3 === 0) return false;
    if (isAbbrev(t.slice(0, -1))) return false;
  }
  return true;
}

// ── The rules ───────────────────────────────────────────────────────────

type Ctx = {
  state: EditorState;
  prefs: TypingPrefs;
  block: PMNode;
  /** Doc position of the block's first character. */
  start: number;
  text: string;
  trigger: string;
  /** The trigger's offset in `text`; text.length for Enter, which is not in it. */
  at: number;
  /** The trigger is Enter: the block is the paragraph Enter just ended. */
  virtual: boolean;
};

type Rule = (ctx: Ctx) => Transaction | null;

const SPACE_LIKE = new Set([" ", "\n", "\t", LINE_BREAK]);

/** The marks the characters in [from, to) carry: the first character's. */
function marksAt(doc: PMNode, pos: number): readonly Mark[] {
  return doc.nodeAt(pos)?.marks ?? [];
}

function replaceText(tr: Transaction, from: number, to: number, text: string): Transaction {
  const marks = marksAt(tr.doc, from);
  return tr.replaceWith(from, to, tr.doc.type.schema.text(text, marks));
}

/** Start of the whitespace-delimited token that ends at `end`. */
function tokenStart(text: string, end: number): number {
  let s = end;
  while (s > 0 && !isWhitespace(text[s - 1]) && text[s - 1] !== OBJECT_CHAR) s--;
  return s;
}

const autoCapitalize: Rule = ({ state, prefs, start, text, trigger, at }) => {
  if (!prefs.autoCapitalize || !SPACE_LIKE.has(trigger)) return null;
  const s = tokenStart(text, at);
  const word = text.slice(s, at);
  if (!word) return null;
  if (findLink(word)) return null;
  if (word !== word.toLowerCase()) return null;
  if (/[@#$%^&*<>/=()]/.test(word)) return null;
  let f = s;
  while (f < at && `'"‘’“”`.includes(text[f])) f++;
  const first = String.fromCodePoint(text.codePointAt(f) ?? 0);
  if (f >= at || first.toUpperCase() === first || /[\u10A0-\u10FF]/.test(first)) return null;
  let b = s;
  while (b > 0 && (text[b - 1] === " " || text[b - 1] === "\t")) b--;
  let capitalize: boolean;
  if (b === 0 || isWhitespace(text[b - 1])) capitalize = true;
  else capitalize = isSentenceEnd(text.slice(tokenStart(text, b), b));
  if (!capitalize) return null;
  return replaceText(state.tr, start + f, start + f + first.length, first.toUpperCase());
};

const detectLink: Rule = (ctx) => {
  const { state, prefs, start, text, trigger, at } = ctx;
  if (!SPACE_LIKE.has(trigger)) return null;
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  const s = tokenStart(text, at);
  if (s === at) return null;
  if (state.doc.rangeHasMark(start + s, start + at, linkType)) return null;
  const token = text.slice(s, at);
  if (prefs.markdown) {
    const md = markdownLink(ctx, s, token);
    if (md) return md;
  }
  if (!prefs.detectLinks) return null;
  const found = findLink(token);
  if (!found) return null;
  const from = start + s + found.index;
  return state.tr.addMark(from, from + found.length, linkType.create({ href: found.href }));
};

/** [text](url) then a space: the text becomes a link to the url. */
function markdownLink({ state, start, text, at }: Ctx, s: number, token: string): Transaction | null {
  const linkType = state.schema.marks.link;
  if (!token.endsWith(")")) return null;
  const open = token.lastIndexOf("](");
  if (open < 0) return null;
  const url = token.slice(open + 2, -1);
  const found = findLink(url);
  if (!found || found.index !== 0 || found.length !== url.length) return null;
  const close = s + open; // offset of "]"
  let depth = 0;
  let bracket = -1;
  for (let i = close - 1; i >= Math.max(0, close - 100); i--) {
    if (text[i] === "]") depth++;
    else if (text[i] === "[") {
      if (depth === 0) {
        bracket = i;
        break;
      }
      depth--;
    }
  }
  if (bracket < 0 || bracket + 1 >= close) return null;
  const tr = state.tr;
  tr.delete(start + close, start + at);
  tr.delete(start + bracket, start + bracket + 1);
  tr.addMark(start + bracket, start + close - 1, linkType.create({ href: found.href }));
  return tr;
}

const markdownHeading: Rule = ({ state, prefs, block, start, text, trigger, at }) => {
  if (!prefs.markdown || trigger !== " " || block.type.name !== "paragraph") return null;
  const hashes = text.slice(0, at);
  if (!/^#{1,6}$/.test(hashes)) return null;
  const $start = state.doc.resolve(start);
  if (isListItem($start.node($start.depth - 1))) return null;
  const heading = state.schema.nodes.heading;
  if (!heading) return null;
  const tr = state.tr.delete(start, start + at + 1);
  tr.setBlockType(start, start, heading, { ...block.attrs, level: hashes.length });
  return tr;
};

const MARKERS = "*_~`";

function markerSide(ch: string | undefined): "outer" | "inner" | "other" {
  if (ch === undefined || isWhitespace(ch) || ch === OBJECT_CHAR) return "outer";
  if (isLetterOrDigit(ch) || MARKERS.includes(ch)) return "inner";
  return "other";
}

/** A run of markers opens (outer before, inner after) or closes (inner
    before, outer after); punctuation on one side defers to the other. */
function delimiter(text: string, from: number, to: number): "open" | "close" | null {
  const b = markerSide(from > 0 ? text[from - 1] : undefined);
  const a = markerSide(to < text.length ? text[to] : undefined);
  if (b === "other" && a === "other") return null;
  if (b === "other") return a === "outer" ? "close" : "open";
  if (a === "other") return b === "outer" ? "open" : "close";
  if (b === "outer" && a === "inner") return "open";
  if (b === "inner" && a === "outer") return "close";
  return null;
}

function runAround(text: string, i: number): [number, number] {
  let from = i;
  let to = i + 1;
  while (from > 0 && text[from - 1] === text[i]) from--;
  while (to < text.length && text[to] === text[i]) to++;
  return [from, to];
}

const markdownFormatting: Rule = ({ state, prefs, start, text, trigger, at, virtual }) => {
  if (!prefs.markdown || virtual || !MARKERS.includes(trigger)) return null;
  const [rs, re] = runAround(text, at);
  const len = re - rs;
  if (trigger === "`" ? len !== 1 : len > 3) return null;
  const kind = delimiter(text, rs, re);
  if (!kind) return null;
  let other: [number, number] | null = null;
  if (kind === "close") {
    for (let i = rs - 1; i >= Math.max(0, rs - 200); i--) {
      if (text[i] !== trigger) continue;
      const [os, oe] = runAround(text, i);
      if (oe - os === len && delimiter(text, os, oe) === "open") {
        other = [os, oe];
        break;
      }
      i = os;
    }
  } else {
    for (let i = re; i < Math.min(text.length, re + 200); i++) {
      if (text[i] !== trigger) continue;
      const [cs, ce] = runAround(text, i);
      if (ce - cs === len && delimiter(text, cs, ce) === "close") {
        other = [cs, ce];
        break;
      }
      i = ce - 1;
    }
  }
  if (!other) return null;
  const [open, close] = kind === "close" ? [other, [rs, re] as [number, number]] : [[rs, re] as [number, number], other];
  if (close[0] <= open[1]) return null;
  const { marks } = state.schema;
  const types: MarkType[] =
    trigger === "`"
      ? [marks.code]
      : trigger === "~"
        ? [marks.strike]
        : len === 1
          ? [marks.italic]
          : len === 2
            ? [marks.bold]
            : [marks.bold, marks.italic];
  if (types.some((m) => !m)) return null;
  const from = start + open[1];
  const to = start + close[0];
  const already = types.every((type) => {
    let all = true;
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && !type.isInSet(node.marks)) all = false;
    });
    return all;
  });
  if (already) return null;
  const tr = state.tr;
  tr.delete(start + close[0], start + close[1]);
  tr.delete(start + open[0], start + open[1]);
  const innerFrom = start + open[0];
  const innerTo = innerFrom + (close[0] - open[1]);
  for (const type of types) tr.addMark(innerFrom, innerTo, type.create());
  // Typing goes on in the style the text had before the markers.
  const $caret = tr.selection.$from;
  const after = $caret.marks().filter((m) => !types.includes(m.type));
  tr.setStoredMarks(after);
  return tr;
};

const smartQuotes: Rule = ({ state, prefs, block, start, text, trigger, at, virtual }) => {
  if (!prefs.smartQuotes || virtual || (trigger !== "'" && trigger !== '"')) return null;
  if (/^[^A-Za-z\u00C0-\u024F]*[\u0590-\u08FF]/.test(block.textContent)) return null;
  const double = trigger === '"';
  const b = at > 0 ? text[at - 1] : undefined;
  const opening =
    b === undefined || isWhitespace(b) || b === "(" || b === "[" || b === "{" || (double && b === "‘") || (!double && b === "“");
  const quote = double ? (opening ? "“" : "”") : opening ? "‘" : "’";
  return replaceText(state.tr, start + at, start + at + 1, quote);
};

/** A capital in the typed text carries over: "TM" gives "™", "Tm" too. */
export function transferCase(original: string, value: string): string {
  const f = original[0];
  if (f && /\p{L}/u.test(f) && f === f.toUpperCase() && f !== f.toLowerCase()) {
    return original === original.toUpperCase() ? value.toUpperCase() : value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

const substitute: Rule = ({ state, prefs, start, text, trigger, at, virtual }) => {
  if (!isWordBoundary(trigger)) return null;
  const map = substitutionMap(prefs);
  if (map.size === 0 || at === 0) return null;
  const q = at - 1;
  const ts = tokenStart(text, at);
  if (ts === at) return null;
  const boundary = isWordBoundary(text[q]);
  let rs = at;
  while (rs > ts && isWordBoundary(text[rs - 1]) === boundary) rs--;
  const candidates: [number, number][] = virtual
    ? [
        [ts, at],
        [rs, at],
      ]
    : [
        [ts, at + 1],
        [rs, at + 1],
        [ts, at],
        [rs, at],
      ];
  for (const [a, b] of candidates) {
    if (a >= b) continue;
    const original = text.slice(a, b);
    const key = original.toLowerCase();
    const value = map.get(key);
    if (value === undefined || prefs.substitutionBlocklist.includes(key)) continue;
    return replaceText(state.tr, start + a, start + b, transferCase(original, value));
  }
  return null;
};

const correctSpelling: Rule = ({ state, prefs, start, text, trigger, at }) => {
  if (!prefs.correctSpelling || !isWordBoundary(trigger) || trigger === "@") return null;
  let s = at;
  while (s > 0 && /[\p{L}'’]/u.test(text[s - 1])) s--;
  while (s < at && /['’]/.test(text[s])) s++;
  if (s === at) return null;
  if (s > 0 && !isWordBoundary(text[s - 1]) && text[s - 1] !== OBJECT_CHAR) return null;
  const word = text.slice(s, at);
  const found = spellingFix(word, trigger);
  if (!found || prefs.spellingBlocklist.includes(word.toLowerCase())) return null;
  // Deleted right after its correction and typed again: the word stays.
  if (correctionDeleted(word)) {
    blockCorrection(word);
    return null;
  }
  const fix = prefs.smartQuotes ? found.replace(/'/g, "’") : found;
  const tr = replaceText(state.tr, start + s, start + at, fix);
  tr.setMeta(SPELLING_META, { from: start + s, to: start + s + fix.length, original: word });
  return tr;
};


// ── List detection ──────────────────────────────────────────────────────

function isListItem(node: PMNode | null | undefined): boolean {
  return node?.type.name === "listItem" || node?.type.name === "taskItem";
}

function isList(node: PMNode | null | undefined): boolean {
  return node?.type.name === "bulletList" || node?.type.name === "orderedList" || node?.type.name === "taskList";
}

/** The text block that ends before `pos` (a position between blocks), or null. */
export function previousTextblock(doc: PMNode, pos: number): { node: PMNode; start: number } | null {
  if (pos <= 0) return null;
  const found = Selection.findFrom(doc.resolve(pos), -1, true);
  if (!found || found.from >= pos) return null;
  const $at = found.$from;
  return $at.parent.isTextblock ? { node: $at.parent, start: $at.start() } : null;
}

/** The text of the text block just before `pos` in the document, or "". */
function previousBlockText(doc: PMNode, pos: number): string {
  return previousTextblock(doc, pos)?.node.textContent ?? "";
}

/** The label a list would give its next top-level item: "4." after 3. */
function nextLabel(list: PMNode): string | null {
  if (list.type.name !== "orderedList") return null;
  const start = typeof list.attrs.start === "number" ? list.attrs.start : 1;
  const style = typeof list.attrs.listStyle === "string" ? list.attrs.listStyle : null;
  return listLabel(style, 0, start + list.childCount);
}

const detectList: Rule = ({ state, prefs, block, start, text, trigger, at, virtual }) => {
  if (!prefs.detectLists || trigger !== " " || virtual || block.type.name !== "paragraph") return null;
  const $start = state.doc.resolve(start);
  const parent = $start.node($start.depth - 1);
  if (isListItem(parent)) return null;
  if (!state.selection.empty || state.selection.from !== start + at + 1) return null;
  const before = text.slice(0, at);
  if (!/^\s*\S+$/.test(before)) return null;
  const prefix = before.trim();
  if (previousBlockText(state.doc, $start.before()).trimStart().startsWith(prefix)) return null;
  const { schema } = state;
  const blockPos = $start.before();
  const index = $start.index($start.depth - 1);

  // An earlier list whose next label is the prefix continues.
  let earlier: { node: PMNode; pos: number; adjacent: boolean } | null = null;
  for (let i = index - 1, pos = blockPos; i >= 0 && i >= index - 60; i--) {
    const node = parent.child(i);
    pos -= node.nodeSize;
    if (isList(node)) {
      earlier = { node, pos, adjacent: i === index - 1 };
      break;
    }
  }
  let listType: NodeType | undefined;
  let attrs: Record<string, unknown> = {};
  if (earlier && nextLabel(earlier.node) === prefix) {
    listType = earlier.node.type;
    attrs = { ...earlier.node.attrs, start: (Number(earlier.node.attrs.start) || 1) + earlier.node.childCount };
  } else {
    const found = listForPrefix(prefix);
    if (!found) return null;
    listType = schema.nodes[found.type];
    attrs = found.style ? { listStyle: found.style } : {};
    earlier = null;
  }
  if (!listType) return null;
  const tr = state.tr.delete(start, start + at + 1);
  const $from = tr.doc.resolve(start);
  const range = $from.blockRange($from);
  if (!range) return null;
  const known = listType.spec.attrs ?? {};
  const listAttrs = Object.fromEntries(Object.entries(attrs).filter(([k]) => k in known && k !== "blockId"));
  const wrapping = findWrapping(range, listType, listAttrs);
  if (!wrapping) return null;
  tr.wrap(range, wrapping);
  // A continued list right after its earlier part becomes one list again.
  if (earlier?.adjacent) {
    const joinAt = tr.mapping.map(blockPos, -1);
    if (tr.doc.resolve(joinAt).nodeBefore?.type === listType) {
      tr.join(joinAt);
    }
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(start))));
  return tr;
};

/** The rules in Google's order: lists before capitals, then links,
    Markdown, quotes, substitutions, spelling. */
const RULES: Rule[] = [
  detectList,
  autoCapitalize,
  detectLink,
  markdownHeading,
  markdownFormatting,
  smartQuotes,
  substitute,
  correctSpelling,
];

/** Whether autocorrect may look at the text before `pos`: not in code, not
    in inline code. */
function allowedAt(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.spec.code) return false;
  const code = state.schema.marks.code;
  if (code && ($pos.nodeBefore?.marks.some((m) => m.type === code) || $pos.marks().some((m) => m.type === code))) return false;
  return true;
}

/** The context for the character just before the caret: the trigger. */
function typedContext(state: EditorState, trigger: string): Ctx | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = blockText($from.parent);
  const at = $from.parentOffset - 1;
  if (at < 0 || text[at] !== trigger) return null;
  return { state, prefs: typingPrefs(), block: $from.parent, start: $from.start(), text, trigger, at, virtual: false };
}

/** The context for Enter: the text block just before the caret's. */
function enterContext(state: EditorState): Ctx | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  const prev = previousTextblock(state.doc, $from.before());
  if (!prev) return null;
  const text = blockText(prev.node);
  return { state, prefs: typingPrefs(), block: prev.node, start: prev.start, text, trigger: "\n", at: text.length, virtual: true };
}

/** Run the rules for a trigger typed just before the caret ("\n" for Enter,
    after the new paragraph exists). Each rule that fires is dispatched as
    its own undo step; the typing that follows starts a new one. */
export function runAutocorrect(view: EditorView, trigger: string): boolean {
  if (view.composing || !view.editable) return false;
  let fired = false;
  for (const rule of RULES) {
    const state = view.state;
    const ctx = trigger === "\n" ? enterContext(state) : typedContext(state, trigger);
    if (!ctx) break;
    const probe = ctx.virtual ? ctx.start + ctx.text.length : ctx.start + ctx.at;
    if (!allowedAt(state, Math.max(ctx.start, probe))) break;
    const tr = rule(ctx);
    if (!tr || !tr.docChanged) continue;
    const stored = state.storedMarks;
    if (stored && !tr.storedMarksSet) tr.setStoredMarks(stored);
    closeHistory(tr);
    tr.setMeta(AUTOCORRECT_META, rule.name || "rule");
    view.dispatch(tr);
    fired = true;
  }
  if (fired) view.dispatch(closeHistory(view.state.tr));
  return fired;
}

// ── Markdown code block (Enter) ─────────────────────────────────────────

const CODE_LANGUAGES: Record<string, string> = {
  c: "cpp",
  cpp: "cpp",
  "c++": "cpp",
  "c#": "csharp",
  csharp: "csharp",
  css: "css",
  dart: "dart",
  go: "go",
  golang: "go",
  html: "html",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  kotlin: "kotlin",
  php: "php",
  protobuf: "protobuf",
  proto: "protobuf",
  py: "python",
  python: "python",
  rust: "rust",
  shell: "shell",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  swift: "swift",
  textproto: "textproto",
  ts: "typescript",
  typescript: "typescript",
  xml: "xml",
};

/** The language a fence line asks for: "" for a bare ```, null when the
    line is no fence Docs knows. */
export function fenceLanguage(text: string): string | null {
  const m = /^```(\S*)$/.exec(text);
  if (!m) return null;
  if (!m[1]) return "";
  return CODE_LANGUAGES[m[1].toLowerCase()] ?? null;
}

/** After Enter ended a ``` line (Markdown on): the fence and the new empty
    paragraph become one code block, the caret inside. Its own undo step. */
export function runCodeFence(view: EditorView): boolean {
  const { state } = view;
  const prefs = typingPrefs();
  const codeBlock = state.schema.nodes.codeBlock;
  if (!prefs.markdown || !codeBlock) return false;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.content.size > 0 || $from.parent.type.name !== "paragraph") return false;
  const index = $from.index($from.depth - 1);
  if (index === 0) return false;
  const container = $from.node($from.depth - 1);
  if (isListItem(container)) return false;
  const fence = container.child(index - 1);
  if (fence.type.name !== "paragraph") return false;
  const language = fenceLanguage(fence.textContent);
  if (language === null) return false;
  const from = $from.before() - fence.nodeSize;
  const to = $from.after();
  const tr = state.tr.replaceWith(from, to, codeBlock.create({ language: language || null }));
  tr.setSelection(TextSelection.create(tr.doc, from + 1));
  closeHistory(tr);
  tr.setMeta(AUTOCORRECT_META, "markdownCodeBlock");
  view.dispatch(tr);
  view.dispatch(closeHistory(view.state.tr));
  return true;
}
