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
// On hover it shows the block reader's card: its reference entry and the
// site its link goes to, in the app's tooltip.

function documentIdOf(editor: Editor | undefined): string | null {
  if (!editor) return null;
  return importedOf(editor)?.documentId ?? insertContext(editor)?.documentId ?? null;
}

// Each document's cards by reference id (bibliography.tsx referenceTip), set
// by the reader from the page data (reader-interactions.tsx).
const cardsByDocument = new Map<string, ReadonlyMap<string, string>>();

export function setCitationCards(documentId: string, cards: ReadonlyMap<string, string>): void {
  cardsByDocument.set(documentId, cards);
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

  // On screen, renderHTML's span, whose card the pointer reads from the page
  // data when it comes over the words (data-tip, the app's tooltip). The
  // card and the tooltip's aria-describedby change no words, so the editor
  // does not read the span again for them.
  addMarkView() {
    return ({ mark, editor, HTMLAttributes }) => {
      const dom = document.createElement("span");
      const attrs = mergeAttributes(HTMLAttributes, { "data-citation": documentIdOf(editor) ?? "", class: "docs-citation" });
      for (const [name, value] of Object.entries(attrs)) dom.setAttribute(name, String(value));
      dom.addEventListener("pointerover", () => {
        const documentId = documentIdOf(editor);
        const card = documentId ? cardsByDocument.get(documentId)?.get(String(mark.attrs.refId)) : undefined;
        if (card && dom.getAttribute("data-tip") !== card) dom.setAttribute("data-tip", card);
      });
      return {
        dom,
        contentDOM: dom,
        ignoreMutation: (mutation) =>
          mutation.type === "attributes" && (mutation.attributeName === "data-tip" || mutation.attributeName === "aria-describedby"),
      };
    };
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
