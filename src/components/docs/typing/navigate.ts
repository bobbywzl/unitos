import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { annotationMarksKey } from "@/components/docs/annotation-marks";
import { docsCommands, type DocsCommand } from "@/components/docs/commands";
import { insertContext, insertT, toast } from "@/components/docs/insert/context";
import { matchesCombo } from "@/components/docs/keys";
import { posInBlock, wordAtCaret } from "@/components/docs/layer/anchor";
import { loadChecker, misspelledWords } from "@/components/docs/typing/spelling";
import type { TKey } from "@/lib/i18n/dictionaries";

// Google Docs' navigation keys (SPEC.md §29, typing). The chords: hold
// Ctrl+Alt (Ctrl+Alt+Shift for the comments' view), press a key, then a
// second one within a second; any other key, or letting go of Ctrl or Alt,
// cancels. N or P then a letter puts the caret at the start of the next or
// previous heading, image, list, link, and so on. Every command whose
// shortcut is a chord ("Mod+Alt+O H", the header) runs from here too. Also
// Ctrl+' and Ctrl+; (the next and previous misspelling) and Ctrl+Shift+Y
// (Dictionary).

type Run = (editor: Editor) => void;
/** A chord: its first combo, a space, its second key. */
type Chord = [keys: string, run: Run];
type Test = (node: PMNode, parent: PMNode | null, index: number) => boolean;
type Target = { what: TKey; n?: number; find: (state: EditorState) => Selection[] };

const HOLD_MS = 1000;
const MODIFIERS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const ITEMS = new Set(["listItem", "taskItem"]);

/** Where the caret goes for each node the test picks, in document order: a
    text node's or an inline object's start, a selected image, else the
    first place for the caret inside. */
function starts(state: EditorState, test: Test, from = 0, to = state.doc.content.size): Selection[] {
  const { doc } = state;
  const found: Selection[] = [];
  doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (!test(node, parent, index)) return;
    found.push(node.isInline ? TextSelection.create(doc, pos) : node.isAtom ? NodeSelection.create(doc, pos) : Selection.near(doc.resolve(pos + 1)));
  });
  return found;
}

const named = (name: string): Test => (node) => node.type.name === name;

/** A link's first words: a text node with a link its left neighbor lacks. */
const linkStart: Test = (node, parent, index) => {
  const link = node.isText ? node.marks.find((m) => m.type.name === "link") : undefined;
  if (!link) return false;
  return !(parent && index > 0 && link.isInSet(parent.child(index - 1).marks));
};

/** The items of the outermost list around the caret. */
function listItems(state: EditorState): Selection[] {
  const $from = state.selection.$from;
  for (let d = 1; d <= $from.depth; d++) {
    if (LISTS.has($from.node(d).type.name)) return starts(state, (node) => ITEMS.has(node.type.name), $from.before(d), $from.after(d));
  }
  return [];
}

/** The comments' starts. The marks layer draws each comment's icon at its
    end, keyed "comment:<id>:<start>:<end>…" with the paragraph's offsets
    (annotation-marks.tsx). */
function comments(state: EditorState): Selection[] {
  const icons = annotationMarksKey.getState(state)?.find(undefined, undefined, (spec) => String(spec.key).startsWith("comment:")) ?? [];
  return icons
    .map((icon) => {
      const $end = state.doc.resolve(icon.from);
      const start = Number(String(icon.spec.key).split(":")[2]);
      return TextSelection.create(state.doc, posInBlock($end.parent, $end.before(), start));
    })
    .sort((a, b) => a.from - b.from);
}

/** N or P, then the target's key. */
const TARGETS: Record<string, Target> = {
  H: { what: "docsTyping.navHeading", find: (s) => starts(s, (node) => node.type.name === "heading" || node.attrs.docStyle === "title") },
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n): [string, Target] => [
      String(n),
      { what: "docsTyping.navHeadingLevel", n, find: (s) => starts(s, (node) => node.type.name === "heading" && node.attrs.level === n) },
    ]),
  ),
  G: { what: "docsTyping.navImage", find: (s) => starts(s, named("image")) },
  O: { what: "docsTyping.navList", find: (s) => starts(s, (node, parent) => LISTS.has(node.type.name) && !ITEMS.has(parent?.type.name ?? "")) },
  I: { what: "docsTyping.navListItem", find: listItems },
  L: { what: "docsTyping.navLink", find: (s) => starts(s, linkStart) },
  B: { what: "docsTyping.navBookmark", find: (s) => starts(s, named("bookmark")) },
  F: { what: "docsTyping.navFootnote", find: (s) => starts(s, named("footnoteReference")) },
  T: { what: "docsTyping.navTable", find: (s) => starts(s, named("table")) },
  C: { what: "docsTyping.navComment", find: comments },
};

/** The first of `found` after the selection's start, or the last before it,
    selected and scrolled into view; a toast when there is none. */
function jump(editor: Editor, found: Selection[], dir: 1 | -1, what: string): void {
  const at = editor.state.selection.from;
  const target = dir === 1 ? found.find((s) => s.from > at) : found.findLast((s) => s.from < at);
  if (!target) {
    toast(insertT(editor)(dir === 1 ? "docsTyping.noNext" : "docsTyping.noPrevious", { what }));
    return;
  }
  editor.view.focus();
  editor.view.dispatch(editor.state.tr.setSelection(target).scrollIntoView());
}

const go = (target: Target, dir: 1 | -1): Run => (editor) =>
  jump(editor, target.find(editor.state), dir, insertT(editor)(target.what, target.n ? { n: target.n } : undefined));

/** Ctrl+' and Ctrl+;: the next or previous misspelled English word. */
async function misspelling(editor: Editor, dir: 1 | -1): Promise<void> {
  const { selection } = editor.state;
  const spell = await loadChecker();
  if (!spell) return toast(insertT(editor)("common.requestFailed"));
  // Typing while the dictionary loads keeps the caret where it is.
  if (!editor.state.selection.eq(selection)) return;
  const { doc } = editor.state;
  const words = misspelledWords(doc, spell).map((w) => TextSelection.create(doc, w.from, w.to));
  jump(editor, words, dir, insertT(editor)("docsTyping.navMisspelling"));
}

/** Tools > Dictionary (Ctrl+Shift+Y): Unitos's Explain on the selected
    words, or on the word at the caret. */
export function lookUpWord(editor: Editor): void {
  const context = insertContext(editor);
  if (!context) return;
  editor.view.focus();
  const word = wordAtCaret(editor);
  if (word) editor.commands.setTextSelection(word);
  window.dispatchEvent(new CustomEvent("docs:unitos-tool", { detail: { documentId: context.documentId, tool: "explain" } }));
}

const runCommand = (command: DocsCommand): Run => (editor) => {
  if (command.enabled?.(editor) ?? true) command.run(editor);
};
const runId = (id: string): Run => (editor) => {
  const command = docsCommands().find((c) => c.id === id);
  if (command) runCommand(command)(editor);
};

function chords(): Chord[] {
  return [
    ...Object.entries(TARGETS).flatMap(([key, target]): Chord[] => [
      [`Mod+Alt+N ${key}`, go(target, 1)],
      [`Mod+Alt+P ${key}`, go(target, -1)],
    ]),
    // Google's own keys for tables hold Shift too.
    ["Mod+Alt+Shift+N T", go(TARGETS.T, 1)],
    ["Mod+Alt+Shift+P T", go(TARGETS.T, -1)],
    // Select none.
    ["Mod+Alt+U A", (editor) => editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.selection.$head)))],
    ["Mod+Alt+Shift+W E", runId("layer:comments-all")],
    ...docsCommands().flatMap((c): Chord[] => (c.shortcut?.includes(" ") ? [[c.shortcut, runCommand(c)]] : [])),
  ];
}

const KEYS: Chord[] = [
  ["Mod+'", (editor) => void misspelling(editor, 1)],
  ["Mod+;", (editor) => void misspelling(editor, -1)],
  ["Mod+Shift+Y", lookUpWord],
];

/** The navigation keys, while `active` says a key is the page editor's.
    Returns the cleanup. */
export function listenNavigation(editor: Editor, active: () => boolean): () => void {
  let armed: { first: string; at: number } | null = null;
  const take = (e: KeyboardEvent, run?: Run) => {
    e.preventDefault();
    e.stopPropagation();
    run?.(editor);
  };
  const onDown = (e: KeyboardEvent) => {
    if (MODIFIERS.has(e.key)) return;
    const was = armed;
    armed = null;
    // AltGr, which Windows reports as Ctrl+Alt, types letters such as ó and ń.
    if ((!e.ctrlKey && !e.metaKey) || e.isComposing || e.getModifierState("AltGraph") || !active()) return;
    const list = chords();
    if (was && Date.now() - was.at < HOLD_MS) {
      const chord = list.find(([keys]) => {
        const [first, second] = keys.split(" ");
        return first === was.first && matchesCombo(e, first.replace(/[^+]+$/, second));
      });
      if (chord) return take(e, chord[1]);
    }
    const first = list.map(([keys]) => keys.split(" ")[0]).find((combo) => matchesCombo(e, combo));
    if (first) {
      armed = { first, at: Date.now() };
      return take(e);
    }
    const key = KEYS.find(([combo]) => matchesCombo(e, combo));
    if (key) take(e, key[1]);
  };
  const onUp = (e: KeyboardEvent) => {
    if (e.key === "Control" || e.key === "Alt" || e.key === "Meta") armed = null;
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keyup", onUp, true);
  return () => {
    window.removeEventListener("keydown", onDown, true);
    window.removeEventListener("keyup", onUp, true);
  };
}
