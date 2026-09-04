// Bold, italic, underline on markdown text: the markers, the wrap/unwrap, and
// the keyboard shortcut every editing surface shares (SPEC.md §6). Cmd+B/I/U
// on macOS, Ctrl+B/I/U elsewhere — one reading of the keys and one wrap, so
// the reader's edit mode, the note editor, and the comment boxes behave alike.

export type StyleCommand = "bold" | "italic" | "underline";

// The same markers the note document uses (lib/note-doc.ts).
export const STYLE_MARKERS: Record<StyleCommand, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
};

const STYLE_KEYS: Record<string, StyleCommand> = { b: "bold", i: "italic", u: "underline" };

/** The style a keystroke asks for: Cmd or Ctrl plus b, i, or u. Null otherwise. */
export function styleShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): StyleCommand | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  return STYLE_KEYS[e.key.toLowerCase()] ?? null;
}

export type Patch = { value: string; start: number; end: number };

/** Wrap the selection in markers, or unwrap when already wrapped. Markers
    hug the words: spaces at the selection's ends stay outside. */
export function wrapSelection(
  value: string,
  s: number,
  e: number,
  before: string,
  after: string,
): Patch {
  while (s < e && /\s/.test(value[s])) s += 1;
  while (e > s && /\s/.test(value[e - 1])) e -= 1;
  const selected = value.slice(s, e);
  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { value: value.slice(0, s) + inner + value.slice(e), start: s, end: s + inner.length };
  }
  if (value.slice(Math.max(0, s - before.length), s) === before && value.slice(e, e + after.length) === after) {
    return {
      value: value.slice(0, s - before.length) + selected + value.slice(e + after.length),
      start: s - before.length,
      end: s - before.length + selected.length,
    };
  }
  return {
    value: value.slice(0, s) + before + selected + after + value.slice(e),
    start: s + before.length,
    end: s + before.length + selected.length,
  };
}

/** Cmd/Ctrl+B, I, U on a textarea whose text is markdown (a comment): style
    the selection and return the new text for the caller's state. Null when the
    keystroke was not a style shortcut, or nothing is selected — a bare caret
    has no word to mark. The textarea keeps the selection around the styled
    words, so a second press unstyles them. */
export function markdownStyleKey(e: React.KeyboardEvent<HTMLTextAreaElement>): string | null {
  const command = styleShortcut(e);
  if (!command) return null;
  const el = e.currentTarget;
  const { selectionStart: start, selectionEnd: end } = el;
  e.preventDefault();
  if (start === null || end === null || start === end) return null;
  const [before, after] = STYLE_MARKERS[command];
  const patch = wrapSelection(el.value, start, end, before, after);
  el.value = patch.value;
  el.setSelectionRange(patch.start, patch.end);
  return patch.value;
}
