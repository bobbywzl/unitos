import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { insertFileChip } from "@/components/docs/insert/actions";
import { insertContext, insertT } from "@/components/docs/insert/context";
import { projectDocOf } from "@/components/docs/insert/links";
import { closeEdit } from "@/components/docs/typing/keys";

// "Tab to replace" (SPEC.md §29, typing), as Google Docs offers it: the
// address of a project document pasted on its own shows the prompt under
// it, and Tab puts the document's chip in its place. Moving the caret or
// typing leaves the link.

type Prompt = { from: number; to: number; href: string; documentId: string };

const promptKey = new PluginKey<Prompt | null>("docsUrlChip");

/** The pasted address before the caret, when the paste was that address alone. */
function pastedAddress(editor: Editor, tr: Transaction, state: EditorState): Prompt | null {
  const step = tr.steps[0];
  const ctx = insertContext(editor);
  const { $from, empty } = state.selection;
  if (!(step instanceof ReplaceStep) || !ctx || !empty) return null;
  const href = step.slice.content.textBetween(0, step.slice.content.size, "\n").trim();
  const from = $from.pos - href.length;
  if (!href || from < $from.start() || state.doc.textBetween(from, $from.pos) !== href) return null;
  const documentId = projectDocOf(href, ctx.notebookId);
  if (!documentId || !ctx.documents.some((d) => d.id === documentId)) return null;
  return { from, to: $from.pos, href, documentId };
}

function promptWidget(label: string) {
  return () => {
    const span = document.createElement("span");
    span.className = "docs-tab-hint";
    span.contentEditable = "false";
    span.setAttribute("data-anchor-skip", "");
    span.setAttribute("aria-hidden", "true");
    span.textContent = label;
    return span;
  };
}

export function urlChipPlugin(editor: Editor): Plugin<Prompt | null> {
  return new Plugin<Prompt | null>({
    key: promptKey,
    state: {
      init: () => null,
      apply(tr, prompt, _old, state) {
        if (tr.getMeta("uiEvent") === "paste") return pastedAddress(editor, tr, state);
        if (!prompt) return null;
        const from = tr.mapping.map(prompt.from);
        const to = tr.mapping.map(prompt.to, -1);
        // The prompt stays while the address stays and the caret rests right after it.
        const { empty, head } = state.selection;
        return empty && head === to && state.doc.textBetween(from, to) === prompt.href ? { ...prompt, from, to } : null;
      },
    },
    props: {
      decorations(state) {
        const prompt = promptKey.getState(state);
        if (!prompt) return null;
        const widget = promptWidget(insertT(editor)("docsTyping.tabToReplace"));
        return DecorationSet.create(state.doc, [Decoration.widget(prompt.from, widget, { side: 1, key: "tab-hint" })]);
      },
    },
  });
}

/** Tab while the prompt shows: the document's chip replaces its address,
    an undo step of its own. */
export function replaceWithChip(editor: Editor): boolean {
  const prompt = promptKey.getState(editor.state);
  const ctx = insertContext(editor);
  const doc = ctx?.documents.find((d) => d.id === prompt?.documentId);
  if (!prompt || !ctx || !doc) return false;
  closeEdit(editor.view);
  return insertFileChip(editor, doc, ctx.notebookId, { from: prompt.from, to: prompt.to });
}
