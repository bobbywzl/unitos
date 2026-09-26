import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { insertContext } from "@/components/docs/insert/context";
import { importedOf } from "@/components/docs/insert/figure";

// An in-text citation (SPEC.md §29): the words of a web page or a Markdown
// file that point at an entry of its references (Document.references),
// drawn as a quiet dotted underline (css/import.css). It moves with its
// words, and the paragraph index reads it into Block.citations. A click on
// it in Viewing mode, or a Ctrl+click (⌘+click) in any mode, opens its
// entry in the References section under the page, as in the block reader.

function documentIdOf(editor: Editor | undefined): string | null {
  if (!editor) return null;
  return importedOf(editor)?.documentId ?? insertContext(editor)?.documentId ?? null;
}

export const Citation = Mark.create({
  name: "citation",
  // Typing at a citation's end stays outside it.
  inclusive: false,

  addAttributes() {
    return {
      refId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-ref-id"),
        renderHTML: (attrs) => (attrs.refId ? { "data-ref-id": String(attrs.refId) } : {}),
      },
    };
  },

  // A citation copied in this document pastes back with its words; one
  // from another document names none of this document's references, and
  // its words paste without it.
  parseHTML() {
    const editor = this.editor;
    return [
      {
        tag: "span[data-citation]",
        getAttrs: (el) => {
          const own = documentIdOf(editor);
          return own && el.getAttribute("data-citation") === own ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-citation": documentIdOf(this.editor) ?? "", class: "docs-citation" }), 0];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("docsCitation"),
        props: {
          handleClick(view, _pos, event) {
            if (event.button !== 0 || !(event.target instanceof Element)) return false;
            const citation = event.target.closest<HTMLElement>("[data-ref-id]");
            const refId = citation?.getAttribute("data-ref-id");
            if (!citation || !refId || !view.dom.contains(citation)) return false;
            if (view.editable && !(event.ctrlKey || event.metaKey)) return false;
            // The References section (reader/bibliography.tsx) opens, scrolls
            // to the entry, and flashes it; the caret still goes to the click.
            window.dispatchEvent(new CustomEvent("dissect:open-reference", { detail: { referenceId: refId, origin: citation } }));
            return false;
          },
        },
      }),
    ];
  },
});
