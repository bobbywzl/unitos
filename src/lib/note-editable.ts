// The note editor's editable region: a contentEditable that shows the note as
// the document it renders to (lib/note-markup.ts) while the note stays
// markdown. The text is the model: typed characters, Enter, and the style
// commands go into the markdown at the caret's source offset and the
// document is painted from it; deleting, pasting, IME composition, and the
// caret stay the browser's, and after each of those the document is read
// back as markdown (lib/note-doc.ts) and painted again — so the document is
// canonical after every edit, whatever the browser did. Replacing the DOM
// breaks the browser's own undo, so undo and redo are kept here too.
//
// Offsets in this module's API are source offsets — positions in the
// markdown — so the editor's line commands patch the markdown directly.

import {
  lineVisibleStart,
  noteDocHtml,
  parseNote,
  sourceOffset,
  visibleOffset,
  type InlineStyle,
  type NoteLine,
  type Run,
} from "@/lib/note-markup";
import {
  SELECTION_END,
  SELECTION_START,
  inlineMarkdown,
  leafLength,
  lineElements,
  ownLeaves,
  serializeNoteDoc,
  type InlineRun,
} from "@/lib/note-doc";

export type TextSelection = { start: number; end: number };
export type StyleCommand = "bold" | "italic" | "underline";

export type NoteEditable = {
  getText(): string;
  /** The selection as source offsets; the caret at the end when it is elsewhere. */
  getSelection(): TextSelection;
  /** Replace the text. With a selection: focus and select it. Without: keep the caret where it was. */
  setText(text: string, selection?: TextSelection): void;
  /** Bold, italic, underline: a selection is styled or unstyled; a bare caret styles what is typed next. */
  toggleStyle(command: StyleCommand): void;
  focusEnd(): void;
  destroy(): void;
};

type Snapshot = { text: string; start: number; end: number };

// Keystrokes closer than this merge into one undo step.
const COALESCE_MS = 400;
const HISTORY_MAX = 200;
const TEXT_NODE = 3;

const STYLE_OF: Record<StyleCommand, InlineStyle> = { bold: "bold", italic: "italic", underline: "underline" };
const STYLE_KEYS: Record<string, StyleCommand> = { b: "bold", i: "italic", u: "underline" };
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const MARKERS: Record<InlineStyle, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
  clay: ["<clay>", "</clay>"],
  sage: ["<sage>", "</sage>"],
  gold: ["<gold>", "</gold>"],
  plum: ["<plum>", "</plum>"],
};

// --- Caret placement in the painted document.

function beside(node: Node, after: boolean): { node: Node; offset: number } {
  const parent = node.parentNode as Node;
  const index = Array.prototype.indexOf.call(parent.childNodes, node);
  return { node: parent, offset: after ? index + 1 : index };
}

/** How many inline elements wrap a leaf inside its line. */
function inlineDepth(leaf: Node, line: Element): number {
  let depth = 0;
  for (let p = leaf.parentNode; p && p !== line; p = p.parentNode) depth += 1;
  return depth;
}

/** The position right outside the leaf's outermost inline element. */
function outsideOf(leaf: Node, line: Element, after: boolean): { node: Node; offset: number } {
  let top: Node = leaf;
  while (top.parentNode && top.parentNode !== line) top = top.parentNode;
  return beside(top, after);
}

/** The DOM position of a visible offset. At the edge of styled text the
    caret sits outside the style — so what is typed there is plain unless a
    typing style is on — except when the source offset is inside the run's
    markers (inside), which keeps typing inside the run. */
function positionOf(el: HTMLElement, offset: number, inside: boolean): { node: Node; offset: number } {
  let pos = 0;
  let lastLine: Element | null = null;
  for (const line of lineElements(el)) {
    lastLine = line;
    const leaves = ownLeaves(line);
    let length = 0;
    for (const leaf of leaves) length += leafLength(leaf);
    if (offset <= pos + length) {
      let at = pos;
      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i];
        const len = leafLength(leaf);
        const depth = inlineDepth(leaf, line);
        if (offset === at && i === 0 && depth > 0 && !inside) return outsideOf(leaf, line, false);
        if (offset < at + len || (offset === at + len && inside)) {
          if (leaf.nodeType !== TEXT_NODE) return beside(leaf, offset === at + len);
          return { node: leaf, offset: offset - at };
        }
        if (offset === at + len) {
          const next = leaves[i + 1];
          if (next && inlineDepth(next, line) < depth) {
            return next.nodeType === TEXT_NODE ? { node: next, offset: 0 } : beside(next, false);
          }
          if (!next && depth > 0) return outsideOf(leaf, line, true);
          return leaf.nodeType === TEXT_NODE ? { node: leaf, offset: len } : beside(leaf, true);
        }
        at += len;
      }
      return { node: line, offset: 0 };
    }
    pos += length + 1;
  }
  // Past the end: the end of the last line.
  if (!lastLine) return { node: el, offset: 0 };
  const leaves = ownLeaves(lastLine);
  const last = leaves[leaves.length - 1];
  if (!last) return { node: lastLine, offset: 0 };
  if (inlineDepth(last, lastLine) > 0 && !inside) return outsideOf(last, lastLine, true);
  if (last.nodeType === TEXT_NODE) return { node: last, offset: (last as Text).data.length };
  return beside(last, true);
}

function setSelection(el: HTMLElement, lines: NoteLine[], start: number, end: number) {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const a = positionOf(el, visibleOffset(lines, from), runEdge(lines, from) !== null);
  const b = start === end ? a : positionOf(el, visibleOffset(lines, to), runEdge(lines, to) !== null);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

// Painting normalizes: the document reads back in the serializer's own form
// ("1)" as "1.", a stray indent dropped), and the text follows the document,
// so offsets read from the document always fit the text.
function render(el: HTMLElement, text: string): { text: string; lines: NoteLine[] } {
  let lines = parseNote(text);
  el.innerHTML = noteDocHtml(lines);
  const normalized = serializeNoteDoc(el);
  if (normalized !== text) {
    text = normalized;
    lines = parseNote(text);
    el.innerHTML = noteDocHtml(lines);
  }
  if (text === "") el.setAttribute("data-empty", "");
  else el.removeAttribute("data-empty");
  return { text, lines };
}

/** The selection's source offsets, read by marking its ends in the DOM and serializing. */
function readSelection(el: HTMLElement): { text: string; selection: TextSelection | null } {
  const sel = window.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (!range || !el.contains(range.startContainer) || !el.contains(range.endContainer)) {
    return { text: serializeNoteDoc(el), selection: null };
  }
  const start = { node: range.startContainer, offset: range.startOffset };
  const end = { node: range.endContainer, offset: range.endOffset };
  const endMark = document.createTextNode(SELECTION_END);
  const startMark = document.createTextNode(SELECTION_START);
  // The end first: inserting there leaves the start's node and offset valid.
  const r = document.createRange();
  r.setStart(end.node, end.offset);
  r.insertNode(endMark);
  r.setStart(start.node, start.offset);
  r.insertNode(startMark);
  const marked = serializeNoteDoc(el);
  startMark.remove();
  endMark.remove();
  const a = marked.indexOf(SELECTION_START);
  const b = marked.indexOf(SELECTION_END);
  const text = marked.replace(SELECTION_START, "").replace(SELECTION_END, "");
  if (a === -1 || b === -1) return { text, selection: null };
  return { text, selection: { start: Math.min(a, b), end: Math.max(a, b) - 1 } };
}

// --- The markdown around a source offset.

// Enter continues the line's structure: a list item starts the next item
// ("- ", "N. "), a quote line the next quote line, an indented line keeps its
// indent. Enter on an empty item ends the list instead.
const LINE_LEAD = /^(\s*)(?:([-*+])|(\d{1,3})([.)])|(>))(\s+|$)/;

export function newlineFor(text: string, caret: number): { insert: string; from: number } {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const lineEndIdx = text.indexOf("\n", caret);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const line = text.slice(lineStart, lineEnd);
  const lead = LINE_LEAD.exec(line);
  if (!lead || caret < lineStart + lead[0].length) {
    // A plain line, or the caret inside the marker: split the line, keeping
    // the indent up to the caret.
    const indent = /^\s*/.exec(line)![0];
    return { insert: `\n${indent.slice(0, Math.max(0, caret - lineStart))}`, from: caret };
  }
  if (line.slice(lead[0].length).trim() === "") {
    // An empty item: the marker goes, the caret stays on a plain line.
    return { insert: lead[1], from: lineStart };
  }
  const marker = lead[2] ? `${lead[2]} ` : lead[5] ? "> " : `${Number(lead[3]) + 1}${lead[4]} `;
  return { insert: `\n${lead[1]}${marker}`, from: caret };
}

function lineAt(lines: NoteLine[], src: number): NoteLine | null {
  return lines.find((line) => src >= line.src && src <= line.end) ?? null;
}

/** The run a source offset is strictly inside, if any. */
function runAt(lines: NoteLine[], src: number): Run | null {
  const line = lineAt(lines, src);
  if (!line) return null;
  for (const run of line.runs) {
    if (!run.chip && src > run.src && src < run.src + run.srcLen) return run;
  }
  return null;
}

/** The run whose text ends or starts exactly at a source offset inside its markers. */
function runEdge(lines: NoteLine[], src: number): Run | null {
  const line = lineAt(lines, src);
  if (!line) return null;
  for (const run of line.runs) {
    if (run.chip) continue;
    if (src === run.src && run.openLen > 0) return run;
    if (src === run.src + run.srcLen && run.closeLen > 0) return run;
  }
  return null;
}

/** A source offset at a run's edge, moved outside the run's markers. */
function outsideMarkers(lines: NoteLine[], src: number): number {
  const run = runEdge(lines, src);
  if (!run) return src;
  return src === run.src ? src - run.openLen : src + run.closeLen;
}

const openers = (styles: InlineStyle[]) => styles.map((s) => MARKERS[s][0]).join("");
const closers = (styles: InlineStyle[]) => [...styles].reverse().map((s) => MARKERS[s][1]).join("");

/** A line's runs with a style toggled over a visible range: on for all when any lacks it, else off. */
function toggledRuns(line: NoteLine, from: number, to: number, style: InlineStyle): InlineRun[] {
  const out: InlineRun[] = [];
  const selected: InlineRun[] = [];
  let at = 0;
  for (const run of line.runs) {
    const end = at + run.text.length;
    const piece = (text: string, inside: boolean) => {
      const r: InlineRun = { text, styles: [...run.styles], href: run.href, chip: run.chip };
      out.push(r);
      if (inside) selected.push(r);
    };
    if (run.chip || end <= from || at >= to) piece(run.text, run.chip ? at >= from && end <= to : false);
    else {
      const a = Math.max(from, at) - at;
      const b = Math.min(to, end) - at;
      if (a > 0) piece(run.text.slice(0, a), false);
      piece(run.text.slice(a, b), true);
      if (b < run.text.length) piece(run.text.slice(b), false);
    }
    at = end;
  }
  const on = selected.some((r) => !r.styles.includes(style));
  for (const r of selected) {
    if (on && !r.styles.includes(style)) r.styles.push(style);
    if (!on) r.styles = r.styles.filter((s) => s !== style);
  }
  return out;
}

export function attachNoteEditable(
  el: HTMLElement,
  opts: { text: string; onChange: (text: string) => void },
): NoteEditable {
  const first = render(el, opts.text);
  let text = first.text;
  let lines = first.lines;
  let composing = false;
  // The typing styles the user switched on or off with a bare caret
  // (Cmd+B, the bar's B): they shape what is typed next, until the caret
  // moves on its own.
  const intent: Partial<Record<StyleCommand, boolean>> = {};
  const history: Snapshot[] = [];
  let index = -1;
  let lastPush = 0;
  // Only typing merges with typing: a keystroke after Enter, paste, or a
  // command starts its own undo step.
  let lastCoalescable = false;

  function push(sel: TextSelection, coalesce: boolean) {
    const now = Date.now();
    const current = history[index];
    if (current && current.text === text) {
      current.start = sel.start;
      current.end = sel.end;
      return;
    }
    if (coalesce && lastCoalescable && current && now - lastPush < COALESCE_MS) {
      history[index] = { text, ...sel };
    } else {
      history.splice(index + 1);
      history.push({ text, ...sel });
      if (history.length > HISTORY_MAX) history.shift();
      index = history.length - 1;
    }
    lastPush = now;
    lastCoalescable = coalesce;
  }

  function clamp(sel: TextSelection): TextSelection {
    return { start: Math.min(sel.start, text.length), end: Math.min(sel.end, text.length) };
  }

  function paint(sel: TextSelection | null) {
    const painted = render(el, text);
    text = painted.text;
    lines = painted.lines;
    if (sel) setSelection(el, lines, sel.start, sel.end);
  }

  /** The text changed: paint it, keep the selection, record it, report it. */
  function commit(next: string, sel: TextSelection, coalesce: boolean) {
    const before = text;
    text = next;
    paint(clamp(sel));
    push(clamp(sel), coalesce);
    if (text !== before) opts.onChange(text);
  }

  /** Read the document after the browser edited it, and make it canonical again. */
  function sync(coalesce: boolean) {
    const read = readSelection(el);
    commit(read.text, read.selection ?? { start: read.text.length, end: read.text.length }, coalesce);
  }

  /** The selection as source offsets. The document may read back normalized; the text follows it. */
  function currentSelection(): TextSelection {
    const read = readSelection(el);
    if (read.text !== text) {
      text = read.text;
      lines = parseNote(text);
    }
    return read.selection ?? { start: text.length, end: text.length };
  }

  function clearIntent() {
    for (const command of Object.keys(intent) as StyleCommand[]) delete intent[command];
  }

  /** Typed text goes into the markdown at the caret: inside the run the caret
      is in, outside a run's markers when it is whitespace at the run's edge,
      and wrapped in the typing styles that are on. */
  function insertTyped(str: string) {
    const sel = currentSelection();
    let from = Math.min(sel.start, sel.end);
    let to = Math.max(sel.start, sel.end);
    let insert = str;
    let closeLen = 0;
    if (from === to) {
      const run = runAt(lines, from) ?? runEdge(lines, from);
      const inside = run ? run.styles : [];
      if (/^\s+$/.test(str)) {
        if (runEdge(lines, from)) from = to = outsideMarkers(lines, from);
      } else {
        const commands = Object.keys(intent) as StyleCommand[];
        const off = commands.filter((c) => intent[c] === false && inside.includes(STYLE_OF[c])).map((c) => STYLE_OF[c]);
        const on = commands.filter((c) => intent[c] === true).map((c) => STYLE_OF[c]);
        let wrap: InlineStyle[];
        if (off.length > 0) {
          // A style switched off inside its run: the text leaves the run and
          // keeps the run's other styles.
          from = to = outsideMarkers(lines, from);
          wrap = [...inside.filter((s) => !off.includes(s)), ...on.filter((s) => !inside.includes(s))];
        } else {
          wrap = on.filter((s) => !inside.includes(s));
        }
        if (wrap.length > 0) {
          const close = closers(wrap);
          insert = openers(wrap) + str + close;
          closeLen = close.length;
        }
      }
    }
    const next = text.slice(0, from) + insert + text.slice(to);
    const caret = from + insert.length - closeLen;
    commit(next, { start: caret, end: caret }, true);
  }

  /** Enter: a new line that continues the structure; Shift+Enter a plain one.
      Inside styled text the styles close before the break and reopen after
      it, so the markers never straddle a line. */
  function newline(plain: boolean) {
    const sel = currentSelection();
    const collapsed = sel.start === sel.end;
    let { insert, from } = plain || !collapsed ? { insert: "\n", from: Math.min(sel.start, sel.end) } : newlineFor(text, sel.start);
    let to = Math.max(sel.start, sel.end);
    if (insert.startsWith("\n") && collapsed) {
      const run = runAt(lines, from);
      if (run) {
        // Spaces beside the break would sit against a marker; markdown wants
        // the markers on the words.
        while (from > 0 && text[from - 1] === " ") from -= 1;
        while (to < text.length && text[to] === " ") to += 1;
        insert = closers(run.styles) + insert + openers(run.styles);
      } else {
        // At a run's edge the break goes outside its markers.
        from = to = outsideMarkers(lines, from);
      }
    }
    const next = text.slice(0, from) + insert + text.slice(to);
    const caret = from + insert.length;
    commit(next, { start: caret, end: caret }, false);
  }

  /** Backspace at the start of a marked line: a nested item outdents, any other marker goes. */
  function backspaceAtLineStart(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!range.collapsed || !el.contains(range.startContainer)) return false;
    const startEl =
      range.startContainer.nodeType === TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as Element);
    const lineEl = startEl?.closest("p, h1, h2, h3, h4, h5, h6, li");
    if (!lineEl || !el.contains(lineEl)) return false;
    const before = document.createRange();
    before.setStart(lineEl, 0);
    before.setEnd(range.startContainer, range.startOffset);
    if (before.toString().replace(/\u200b/g, "") !== "") return false;
    const line = lines[lineElements(el).indexOf(lineEl)];
    if (!line || line.kind === "p" || line.kind === "code") return false;
    let next: string;
    let caret: number;
    if ((line.kind === "bullet" || line.kind === "numbered") && line.indent >= 2) {
      next = text.slice(0, line.src) + text.slice(line.src + 2);
      caret = line.bodySrc - 2;
    } else {
      next = text.slice(0, line.src) + text.slice(line.bodySrc);
      caret = line.src;
    }
    commit(next, { start: caret, end: caret }, false);
    return true;
  }

  /** A style over a selection, line by line, the runs rebuilt and re-emitted. */
  function toggleRange(style: InlineStyle, sel: TextSelection) {
    const start = Math.min(sel.start, sel.end);
    const end = Math.max(sel.start, sel.end);
    const visStart = visibleOffset(lines, start);
    const visEnd = visibleOffset(lines, end);
    let next = text;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.end < start || line.src > end || line.kind === "code") continue;
      const lineStart = lineVisibleStart(lines, i);
      const from = Math.max(0, visStart - lineStart);
      const to = Math.min(line.runs.reduce((n, r) => n + r.text.length, 0), visEnd - lineStart);
      if (to <= from) continue;
      const body = inlineMarkdown(toggledRuns(line, from, to, style));
      next = next.slice(0, line.bodySrc) + body + next.slice(line.end);
    }
    const after = parseNote(next);
    commit(next, { start: sourceOffset(after, visStart), end: sourceOffset(after, visEnd) }, false);
  }

  function toggleStyle(command: StyleCommand) {
    el.focus({ preventScroll: true });
    const sel = currentSelection();
    const style = STYLE_OF[command];
    if (sel.start !== sel.end) {
      toggleRange(style, sel);
      return;
    }
    const run = runAt(lines, sel.start) ?? runEdge(lines, sel.start);
    const inside = run ? run.styles.includes(style) : false;
    intent[command] = !(intent[command] ?? inside);
    paint(sel);
  }

  function undo() {
    if (index <= 0) return;
    clearIntent();
    index -= 1;
    const s = history[index];
    text = s.text;
    paint({ start: s.start, end: s.end });
    opts.onChange(text);
  }

  function redo() {
    if (index >= history.length - 1) return;
    clearIntent();
    index += 1;
    const s = history[index];
    text = s.text;
    paint({ start: s.start, end: s.end });
    opts.onChange(text);
  }

  function onBeforeInput(e: InputEvent) {
    if (composing) return;
    switch (e.inputType) {
      case "insertText":
        if (e.data === null) return;
        e.preventDefault();
        insertTyped(e.data);
        break;
      case "insertParagraph":
      case "insertLineBreak":
        // A soft keyboard's Enter: no keydown told Shift apart.
        e.preventDefault();
        newline(false);
        break;
      case "historyUndo":
        e.preventDefault();
        undo();
        break;
      case "historyRedo":
        e.preventDefault();
        redo();
        break;
    }
  }

  function onInput(e: Event) {
    if (composing || (e as InputEvent).isComposing) return;
    sync(true);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    if (CARET_KEYS.has(e.key)) {
      // The caret moves on its own: the typing style is the text's again.
      clearIntent();
      return;
    }
    const styleKey = mod && !e.altKey && !e.shiftKey ? STYLE_KEYS[e.key.toLowerCase()] : undefined;
    if (styleKey) {
      e.preventDefault();
      toggleStyle(styleKey);
      return;
    }
    // Cmd+Enter and Ctrl+Enter are the editor's (save); plain and Shift+Enter
    // are handled here, because a contentEditable reports both as one input.
    if (e.key === "Enter" && !mod && !e.altKey) {
      e.preventDefault();
      newline(e.shiftKey);
      return;
    }
    if (e.key === "Backspace" && !mod && !e.altKey && !e.shiftKey) {
      if (backspaceAtLineStart()) e.preventDefault();
      return;
    }
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (key === "y" && !e.metaKey) {
      e.preventDefault();
      redo();
    }
  }

  function onCompositionStart() {
    composing = true;
  }

  function onCompositionEnd() {
    composing = false;
    // Chrome fires input before compositionend, Safari after: sync once
    // both are past.
    setTimeout(() => sync(false), 0);
  }

  el.addEventListener("beforeinput", onBeforeInput);
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("pointerdown", clearIntent);
  el.addEventListener("compositionstart", onCompositionStart);
  el.addEventListener("compositionend", onCompositionEnd);

  push({ start: text.length, end: text.length }, false);
  if (text !== opts.text) opts.onChange(text);

  return {
    getText: () => text,
    getSelection: currentSelection,
    setText(next, selection) {
      if (next === text && !selection) return;
      clearIntent();
      const focused = document.activeElement === el;
      const keep = selection ?? (focused ? currentSelection() : null);
      text = next;
      paint(keep ? clamp(keep) : null);
      if (selection && !focused) el.focus({ preventScroll: true });
      if (selection) setSelection(el, lines, selection.start, selection.end);
      push(keep ? clamp(keep) : { start: text.length, end: text.length }, false);
      if (text !== next) opts.onChange(text);
    },
    toggleStyle,
    focusEnd() {
      clearIntent();
      el.focus({ preventScroll: true });
      setSelection(el, lines, text.length, text.length);
    },
    destroy() {
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", clearIntent);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
    },
  };
}
