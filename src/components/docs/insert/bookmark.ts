import { Node } from "@tiptap/core";

// A bookmark (SPEC.md §29): a place in the text a link can point to, drawn
// as Google Docs draws it — a small blue ribbon at the spot. It has no
// words. A link to it is the document's address with #bookmark=<id>.

export const Bookmark = Node.create({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      bookmarkId: { default: null, parseHTML: (el) => el.getAttribute("data-bookmark"), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-bookmark]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-bookmark": String(node.attrs.bookmarkId ?? ""),
        class: "docs-bookmark",
        "data-anchor-skip": "",
      },
    ];
  },
});
