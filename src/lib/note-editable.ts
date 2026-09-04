// The note editor's editable region: a plaintext contentEditable that shows
// the note's markdown decorated live (note-markup.ts). The browser owns
// typing, deleting, IME composition, and the caret; this module owns the
// text. After every edit it reads the text back from the DOM, re-renders the
// decorated HTML, and puts the selection back at the same text offsets — the
// decoration never changes an offset, so the caret never moves. Replacing the
// DOM breaks the browser's own undo, so undo and redo are kept here too.
//
// Enter, paste, and undo are handled here; markdown commands (bold, lists,
// indent) are the editor's, applied through setText.

import { noteMarkupHtml } from "@/lib/note-markup";

export type TextSelection = { start: number; end: number };

export type NoteEditable = {
  getText(): string;
  /** The selection as text offsets; the caret at the end when it is elsewhere. */
  getSelection(): TextSelection;
  /** Replace the text. With a selection: focus and select it. Without: keep the caret where it was. */
  setText(text: string, selection?: TextSelection): void;
  focusEnd(): void;
  destroy(): void;
};

type Snapshot = { text: string; start: number; end: number };

// Keystrokes closer than this merge into one undo step.
const COALESCE_MS = 400;
const HISTORY_MAX = 200;

/** The last text or <br> node in document order. */
function lastLeaf(root: Node): Node | null {
  let node: Node | null = root;
  while (node && node.nodeType !== Node.TEXT_NODE && node.nodeName !== "BR") {
    node = node.lastChild;
  }
  return node === root ? null : node;
}

// Text length of a node: text nodes count their characters, <br> counts one
// newline — except the trailing <br> that keeps a final empty line visible,
// which stands for the newline already in the text before it.
function lengthOf(node: Node, trailing: Node | null): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  if (node.nodeName === "BR") return node === trailing ? 0 : 1;
  let n = 0;
  for (const child of node.childNodes) n += lengthOf(child, trailing);
  return n;
}

/** The text of the editable's DOM: text nodes and <br> line breaks, in order. */
export function readEditableText(el: HTMLElement): string {
  const trailing = lastLeaf(el);
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) parts.push((node as Text).data);
    else if (node.nodeName === "BR") {
      if (node !== trailing) parts.push("\n");
    } else for (const child of node.childNodes) walk(child);
  };
  walk(el);
  // Browsers type a non-breaking space where a plain one would collapse;
  // the note keeps plain spaces.
  return parts.join("").replace(/\u00a0/g, " ");
}

/** Text offset of a DOM position (node, offset) inside the editable. */
function offsetOf(el: HTMLElement, target: Node, targetOffset: number): number {
  const trailing = lastLeaf(el);
  let pos = 0;
  let found = false;
  const walk = (node: Node) => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) pos += Math.min(targetOffset, (node as Text).data.length);
      else {
        for (let i = 0; i < targetOffset && i < node.childNodes.length; i++) {
          pos += lengthOf(node.childNodes[i], trailing);
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === "BR") {
      pos += lengthOf(node, trailing);
      return;
    }
    for (const child of node.childNodes) {
      walk(child);
      if (found) return;
    }
  };
  walk(el);
  return pos;
}

/** The selection as text offsets, or null when it is not inside the editable. */
function selectionOf(el: HTMLElement): TextSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  return {
    start: offsetOf(el, range.startContainer, range.startOffset),
    end: offsetOf(el, range.endContainer, range.endOffset),
  };
}

/** The DOM position of a text offset: the earliest leaf that reaches it. */
function positionOf(el: HTMLElement, offset: number): { node: Node; offset: number } {
  const trailing = lastLeaf(el);
  let pos = 0;
  let result: { node: Node; offset: number } | null = null;
  const walk = (node: Node) => {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).data.length;
      if (pos + len >= offset) result = { node, offset: Math.max(0, offset - pos) };
      pos += len;
      return;
    }
    if (node.nodeName === "BR") {
      const len = lengthOf(node, trailing);
      const parent = node.parentNode as Node;
      const index = Array.prototype.indexOf.call(parent.childNodes, node);
      if (len === 1 && pos + 1 >= offset) result = { node: parent, offset: offset > pos ? index + 1 : index };
      else if (len === 0 && pos >= offset) result = { node: parent, offset: index };
      pos += len;
      return;
    }
    for (const child of node.childNodes) {
      walk(child);
      if (result) return;
    }
  };
  walk(el);
  if (result) return result;
  // Past the end, or an empty editable: the end of the content.
  const last = lastLeaf(el);
  if (!last) return { node: el, offset: 0 };
  if (last.nodeType === Node.TEXT_NODE) return { node: last, offset: (last as Text).data.length };
  const parent = last.parentNode as Node;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, last) };
}

function setSelection(el: HTMLElement, start: number, end: number) {
  const a = positionOf(el, Math.min(start, end));
  const b = start === end ? a : positionOf(el, Math.max(start, end));
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function render(el: HTMLElement, text: string): string {
  // A text ending in a newline has an empty last line; the <br> gives that
  // line a height so the caret can sit on it.
  const html = noteMarkupHtml(text) + (text.endsWith("\n") ? "<br>" : "");
  el.innerHTML = html;
  return html;
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

export function attachNoteEditable(
  el: HTMLElement,
  opts: { text: string; onChange: (text: string) => void },
): NoteEditable {
  let text = opts.text;
  let html = render(el, text);
  let composing = false;
  const history: Snapshot[] = [];
  let index = -1;
  let lastPush = 0;
  // Only typing merges with typing: a keystroke after Enter, paste, or a
  // command starts its own undo step.
  let lastCoalescable = false;

  function currentSelection(): TextSelection {
    return selectionOf(el) ?? { start: text.length, end: text.length };
  }

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

  function paint(sel: TextSelection | null) {
    html = render(el, text);
    if (sel) setSelection(el, sel.start, sel.end);
  }

  /** The text changed: paint it, keep the selection, record it, report it. */
  function commit(next: string, sel: TextSelection, coalesce: boolean) {
    text = next;
    paint(sel);
    push(sel, coalesce);
    opts.onChange(text);
  }

  /** Read the DOM after the browser edited it. */
  function sync(coalesce: boolean) {
    const next = readEditableText(el);
    if (next === text && el.innerHTML === html) return;
    const sel = currentSelection();
    commit(next, sel, coalesce);
  }

  function replaceSelection(insert: string, sel = currentSelection(), from = Math.min(sel.start, sel.end)) {
    const to = Math.max(sel.start, sel.end);
    const next = text.slice(0, from) + insert + text.slice(to);
    const caret = from + insert.length;
    commit(next, { start: caret, end: caret }, false);
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
      case "insertFromPaste": {
        const data = e.dataTransfer?.getData("text/plain");
        if (data === undefined) return;
        e.preventDefault();
        replaceSelection(data.replace(/\r\n?/g, "\n"));
        break;
      }
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

  /** Enter: a new line that continues the structure; Shift+Enter a plain one. */
  function newline(plain: boolean) {
    const sel = currentSelection();
    if (plain || sel.start !== sel.end) {
      replaceSelection("\n", sel);
      return;
    }
    const { insert, from } = newlineFor(text, sel.start);
    replaceSelection(insert, sel, from);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    // Cmd+Enter and Ctrl+Enter are the editor's (save); plain and Shift+Enter
    // are handled here, because a plaintext contentEditable reports both as
    // one input type.
    if (e.key === "Enter" && !mod && !e.altKey) {
      e.preventDefault();
      newline(e.shiftKey);
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

  return {
    getText: () => text,
    getSelection: currentSelection,
    setText(next, selection) {
      if (next === text && !selection) return;
      const focused = document.activeElement === el;
      const keep = selection ?? (focused ? currentSelection() : null);
      text = next;
      paint(keep ? { start: Math.min(keep.start, text.length), end: Math.min(keep.end, text.length) } : null);
      if (selection && !focused) el.focus({ preventScroll: true });
      if (selection) setSelection(el, selection.start, selection.end);
      push(keep ?? { start: text.length, end: text.length }, false);
    },
    focusEnd() {
      el.focus({ preventScroll: true });
      setSelection(el, text.length, text.length);
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
