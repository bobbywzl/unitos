import { Extension } from "@tiptap/core";

// Tools > Line numbers (SPEC.md §29): a paragraph's Suppress line numbers,
// as Google Docs and Word have it: the numbers in the left margin
// (page/line-numbers.tsx) pass its lines by, and the Word download marks it
// (w:suppressLineNumbers). Whether the document shows line numbers, and
// how they count, is the page setup's.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docsLineNumbers: {
      /** Suppress line numbers on the paragraphs the selection touches, or show them again. */
      setSuppressLineNumbers: (suppress: boolean) => ReturnType;
    };
  }
}

export const LineNumbers = Extension.create({
  name: "docsLineNumbers",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          suppressLineNumbers: {
            default: null,
            parseHTML: (el: HTMLElement) => (el.getAttribute("data-suppress-line-numbers") === "true" ? true : null),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.suppressLineNumbers === true ? { "data-suppress-line-numbers": "true" } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setSuppressLineNumbers:
        (suppress) =>
        ({ state, tr, dispatch }) => {
          const value = suppress ? true : null;
          for (const range of state.selection.ranges) {
            state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
              if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
              if ((node.attrs.suppressLineNumbers ?? null) !== value) tr.setNodeMarkup(pos, undefined, { ...node.attrs, suppressLineNumbers: value });
              return false;
            });
          }
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
