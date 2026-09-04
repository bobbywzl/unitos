// The note editor's editable region: a contentEditable that shows the note as
// the document it renders to (lib/note-markup.ts) while the note stays
// markdown. The browser owns typing, deleting, IME composition, and the
// caret; this module owns the text. After every edit it reads the document
// back as markdown (lib/note-doc.ts), re-renders it, and puts the selection
// back where it was — so the document is canonical again after every
// keystroke, whatever the browser did. Replacing the DOM breaks the
// browser's own undo, so undo and redo are kept here too.
//
// Offsets in this module's API are source offsets — positions in the
// markdown — so the editor's commands patch the markdown directly.
// Enter, Backspace at the start of a marked line, and undo are handled
// here; the markdown commands (bold, lists, indent) are the editor's,
// applied through setText.

import {
  noteDocHtml,
  parseNote,
  visibleOffset,
  type InlineStyle,
  type NoteLine,
  type Run,
} from "@/lib/note-markup";
import {
  SELECTION_END,
  SELECTION_START,
  leafLength,
  lineElements,
  ownLeaves,
  serializeNoteDoc,
} from "@/lib/note-doc";

export type TextSelection = { start: number; end: number };

export type NoteEditable = {
  getText(): string;
  /** The selection as source offsets; the caret at the end when it is elsewhere. */
  getSelection(): TextSelection;
  /** Replace the text. With a selection: focus and select it. Without: keep the caret where it was. */
  setText(text: string, selection?: TextSelection): void;
  /** Read the document back after a command the browser applied (execCommand). */
  refresh(): void;
  focusEnd(): void;
  destroy(): void;
};

type Snapshot = { text: string; start: number; end: number };

// Keystrokes closer than this merge into one undo step.
const COALESCE_MS = 400;
const HISTORY_MAX = 200;
const TEXT_NODE = 3;

/** The DOM position of a visible offset: the earliest leaf that reaches it. */
function positionOf(el: HTMLElement, offset: number): { node: Node; offset: number } {
  const beside = (leaf: Node, after: boolean) => {
    const parent = leaf.parentNode as Node;
    const index = Array.prototype.indexOf.call(parent.childNodes, leaf);
    return { node: parent, offset: after ? index + 1 : index };
  };
  let pos = 0;
  let lastLine: Element | null = null;
  for (const line of lineElements(el)) {
    lastLine = line;
    const leaves = ownLeaves(line);
    let length = 0;
    for (const leaf of leaves) length += leafLength(leaf);
    if (offset <= pos + length) {
      let at = pos;
      for (const leaf of leaves) {
        const len = leafLength(leaf);
        if (offset <= at + len) {
          if (leaf.nodeType !== TEXT_NODE) return beside(leaf, offset > at);
          return { node: leaf, offset: offset - at };
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
  if (last.nodeType === TEXT_NODE) return { node: last, offset: (last as Text).data.length };
  return beside(last, true);
}

function setSelection(el: HTMLElement, lines: NoteLine[], start: number, end: number) {
  const a = positionOf(el, visibleOffset(lines, Math.min(start, end)));
  const b = start === end ? a : positionOf(el, visibleOffset(lines, Math.max(start, end)));
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

// The browser's typing style — bold set with a bare caret styles the next
// keystroke. Repainting the document drops it, so it is read before and set
// again after.
const TYPING_COMMANDS = ["bold", "italic", "underline", "strikeThrough"] as const;

function typingStyles(): Record<string, boolean> {
  const styles: Record<string, boolean> = {};
  for (const cmd of TYPING_COMMANDS) {
    try {
      styles[cmd] = document.queryCommandState(cmd);
    } catch {
      styles[cmd] = false;
    }
  }
  return styles;
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

/** The run a source offset is strictly inside, if any. */
function runAt(lines: NoteLine[], src: number): Run | null {
  for (const line of lines) {
    if (src > line.end) continue;
    for (const run of line.runs) {
      if (run.chip) continue;
      if (src > run.src && src < run.src + run.srcLen) return run;
    }
    return null;
  }
  return null;
}

/** A source offset at a run's edge, moved outside the run's markers. */
function outsideMarkers(lines: NoteLine[], src: number): number {
  for (const line of lines) {
    if (src > line.end) continue;
    for (const run of line.runs) {
      if (src === run.src && run.openLen > 0) return src - run.openLen;
      if (src === run.src + run.srcLen && run.closeLen > 0) return src + run.closeLen;
    }
    return src;
  }
  return src;
}

export function attachNoteEditable(
  el: HTMLElement,
  opts: { text: string; onChange: (text: string) => void },
): NoteEditable {
  const first = render(el, opts.text);
  let text = first.text;
  let lines = first.lines;
  let composing = false;
  // Set while a typing style is put back: the command's input event is not an edit.
  let arming = false;
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

  function paint(sel: TextSelection | null, styles?: Record<string, boolean>) {
    const painted = render(el, text);
    text = painted.text;
    lines = painted.lines;
    if (sel) setSelection(el, lines, sel.start, sel.end);
    if (!styles || !sel || sel.start !== sel.end) return;
    const now = typingStyles();
    for (const cmd of TYPING_COMMANDS) {
      if (!styles[cmd] || now[cmd]) continue;
      arming = true;
      try {
        document.execCommand(cmd);
      } finally {
        arming = false;
      }
    }
  }

  /** The text changed: paint it, keep the selection, record it, report it. */
  function commit(next: string, sel: TextSelection, coalesce: boolean, styles?: Record<string, boolean>) {
    const before = text;
    text = next;
    paint(clamp(sel), styles);
    push(clamp(sel), coalesce);
    if (text !== before) opts.onChange(text);
  }

  /** Read the document after the browser edited it, and make it canonical again. */
  function sync(coalesce: boolean) {
    const styles = typingStyles();
    const read = readSelection(el);
    commit(read.text, read.selection ?? { start: read.text.length, end: read.text.length }, coalesce, styles);
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
        const closers = [...run.styles].reverse().map((s) => MARKERS[s][1]).join("");
        const openers = run.styles.map((s) => MARKERS[s][0]).join("");
        insert = closers + insert + openers;
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

  function undo() {
    if (index <= 0) return;
    index -= 1;
    const s = history[index];
    text = s.text;
    paint({ start: s.start, end: s.end });
    opts.onChange(text);
  }

  function redo() {
    if (index >= history.length - 1) return;
    index += 1;
    const s = history[index];
    text = s.text;
    paint({ start: s.start, end: s.end });
    opts.onChange(text);
  }

  function onBeforeInput(e: InputEvent) {
    if (composing) return;
    switch (e.inputType) {
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
    if (composing || arming || (e as InputEvent).isComposing) return;
    sync(true);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
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
  el.addEventListener("compositionstart", onCompositionStart);
  el.addEventListener("compositionend", onCompositionEnd);

  push({ start: text.length, end: text.length }, false);
  if (text !== opts.text) opts.onChange(text);

  return {
    getText: () => text,
    getSelection: currentSelection,
    setText(next, selection) {
      if (next === text && !selection) return;
      const focused = document.activeElement === el;
      const keep = selection ?? (focused ? currentSelection() : null);
      text = next;
      paint(keep ? clamp(keep) : null);
      if (selection && !focused) el.focus({ preventScroll: true });
      if (selection) setSelection(el, lines, selection.start, selection.end);
      push(keep ? clamp(keep) : { start: text.length, end: text.length }, false);
      if (text !== next) opts.onChange(text);
    },
    refresh() {
      if (!composing) sync(false);
    },
    focusEnd() {
      el.focus({ preventScroll: true });
      setSelection(el, lines, text.length, text.length);
    },
    destroy() {
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
    },
  };
}
