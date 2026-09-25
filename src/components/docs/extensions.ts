import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { BackgroundColor, Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { DocsFontFamily } from "@/components/docs/fonts";
import { insertExtensions } from "@/components/docs/ext/insert";
import { layerExtensions } from "@/components/docs/ext/layer";
import { pageExtensions } from "@/components/docs/ext/page";
import { toolbarExtensions } from "@/components/docs/ext/toolbar";
import { typingExtensions } from "@/components/docs/ext/typing";
import { INDEXED_NODE_TYPES, newBlockId } from "@/lib/docs/schema";

// The page editor's schema and behavior (SPEC.md §29): Google Docs' model on
// Tiptap. A new node type is added here, in lib/docs/schema.ts
// (RICH_NODE_TYPES), and in lib/docs/blocks.ts when it carries words.

/** The font sizes Google Docs lists, in points; + and − step through them. */
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96] as const;
/** Normal text's size in points. */
export const DEFAULT_FONT_SIZE = 11;
/** Normal text's face. */
export const DEFAULT_FONT = "Arial";
/** One indent step: half an inch, in points. */
export const INDENT_STEP_PT = 36;

const INDEXED = [...INDEXED_NODE_TYPES];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docsParagraph: {
      /** Line spacing: 1 is Single, 1.15, 1.5, 2 is Double; null the style's. */
      setLineSpacing: (value: number | null) => ReturnType;
      /** Space before or after the paragraphs, in points; null the style's. */
      setParagraphSpace: (side: "before" | "after", pt: number | null) => ReturnType;
      /** The paragraph style: Normal text, Title, Subtitle, or a heading. */
      setDocStyle: (style: DocStyle) => ReturnType;
      /** Indent the paragraphs, or a list's lines, one step in or out. */
      indentStep: (direction: 1 | -1) => ReturnType;
    };
    docsPageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

export type DocStyle = "normal" | "title" | "subtitle" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/** Every node the paragraph index reads carries a blockId (lib/docs/blocks.ts):
    rendered as data-block-id, so a selection in the editor anchors like a
    selection in the reader (SPEC.md §5). A split, a paste, or a duplicate
    gets a fresh one; pasted content never keeps the ids it came with. */
const BlockIds = Extension.create({
  name: "blockIds",
  addGlobalAttributes() {
    return [
      {
        types: INDEXED,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-block-id"),
            renderHTML: (attrs) => (attrs.blockId ? { "data-block-id": attrs.blockId } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const strip = (fragment: Fragment): Fragment => {
      const nodes: PMNode[] = [];
      fragment.forEach((node) => {
        const attrs = INDEXED_NODE_TYPES.has(node.type.name) ? { ...node.attrs, blockId: null } : node.attrs;
        nodes.push(node.type.create(attrs, node.isLeaf ? null : strip(node.content), node.marks));
      });
      return Fragment.fromArray(nodes);
    };
    return [
      new Plugin({
        key: new PluginKey("blockIds"),
        props: {
          transformPasted: (slice) => new Slice(strip(slice.content), slice.openStart, slice.openEnd),
        },
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          const tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!INDEXED_NODE_TYPES.has(node.type.name)) return true;
            const id = node.attrs.blockId as string | null;
            if (!id || seen.has(id)) {
              const fresh = newBlockId();
              seen.add(fresh);
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: fresh });
              changed = true;
            } else {
              seen.add(id);
            }
            return node.type.name !== "image" && node.type.name !== "horizontalRule";
          });
          if (!changed) return null;
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});

function ptAttr(name: string, css: (v: number) => string) {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(`data-${name}`);
      return v === null ? null : Number(v);
    },
    renderHTML: (attrs: Record<string, unknown>) => {
      const v = attrs[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
      return typeof v === "number" ? { [`data-${name}`]: String(v), style: css(v) } : {};
    },
  };
}

/** Google Docs' paragraph formatting: line spacing, space before and after,
    left, right, and first-line indents, and the Title and Subtitle styles
    (a heading is its own node). Spacing is padding, so a paragraph's space
    after and the next one's space before add up, as in Docs. */
const ParagraphFormat = Extension.create({
  name: "docsParagraph",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineSpacing: ptAttr("line-spacing", (v) => `--docs-ls: ${v}`),
          spaceBefore: ptAttr("space-before", (v) => `padding-top: ${v}pt`),
          spaceAfter: ptAttr("space-after", (v) => `padding-bottom: ${v}pt`),
          indentLeft: ptAttr("indent-left", (v) => `margin-left: ${v}pt`),
          indentRight: ptAttr("indent-right", (v) => `margin-right: ${v}pt`),
          indentFirstLine: ptAttr("indent-first-line", (v) => `text-indent: ${v}pt`),
        },
      },
      {
        types: ["paragraph"],
        attributes: {
          docStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-doc-style"),
            renderHTML: (attrs) => (attrs.docStyle ? { "data-doc-style": attrs.docStyle } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const eachParagraph = (
      editor: Editor,
      fn: (node: PMNode, pos: number) => Record<string, unknown> | null,
    ): boolean => {
      const { state } = editor;
      const tr = state.tr;
      let changed = false;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
        const next = fn(node, pos);
        if (next) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
          changed = true;
        }
        return false;
      });
      if (changed) editor.view.dispatch(tr);
      return changed;
    };
    return {
      setLineSpacing:
        (value) =>
        ({ editor }) =>
          eachParagraph(editor, () => ({ lineSpacing: value })),
      setParagraphSpace:
        (side, pt) =>
        ({ editor }) =>
          eachParagraph(editor, () => (side === "before" ? { spaceBefore: pt } : { spaceAfter: pt })),
      setDocStyle:
        (style) =>
        ({ chain }) => {
          if (style === "normal" || style === "title" || style === "subtitle") {
            return chain()
              .setNode("paragraph")
              .updateAttributes("paragraph", { docStyle: style === "normal" ? null : style })
              .run();
          }
          const level = Number(style.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
          return chain().setNode("heading", { level }).run();
        },
      indentStep:
        (direction) =>
        ({ editor, commands }) => {
          // A list line nests or lifts; any other paragraph moves its left
          // indent by half an inch.
          const inTask = editor.isActive("taskItem");
          const inList = editor.isActive("listItem") || inTask;
          if (inList) {
            const item = inTask ? "taskItem" : "listItem";
            return direction === 1 ? commands.sinkListItem(item) : commands.liftListItem(item);
          }
          return eachParagraph(editor, (node) => {
            const current = typeof node.attrs.indentLeft === "number" ? node.attrs.indentLeft : 0;
            const next = Math.max(0, current + direction * INDENT_STEP_PT);
            if (next === current) return null;
            return { indentLeft: next === 0 ? null : next };
          });
        },
    };
  },
});

/** A page break (Ctrl+Enter): the text after it starts on a new page. */
const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "docs-page-break" })];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: "pageBreak" }, { type: "paragraph" }]).run(),
    };
  },
});

/** The font size under the caret in points, or null when the selection mixes sizes. */
export function currentFontSize(editor: Editor): number | null {
  const size = editor.getAttributes("textStyle").fontSize as string | undefined;
  if (!size) return DEFAULT_FONT_SIZE;
  const n = parseFloat(size);
  return Number.isFinite(n) ? n : null;
}

/** The next size up or down Google Docs' list from `size`. */
export function stepFontSize(size: number, direction: 1 | -1): number {
  if (direction === 1) return FONT_SIZES.find((s) => s > size) ?? Math.min(400, size + 1);
  return [...FONT_SIZES].reverse().find((s) => s < size) ?? Math.max(1, size - 1);
}

/** The events the keymap raises for the page editor's own dialogs. */
export const DOCS_EVENT = {
  link: "docs:link",
  comment: "docs:comment",
  wordCount: "docs:word-count",
  find: "docs:find",
} as const;

/** Google Docs' shortcuts that act on the document (SPEC.md §29). */
const DocsKeymap = Extension.create({
  name: "docsKeymap",
  addKeyboardShortcuts() {
    const style = (s: DocStyle) => () => this.editor.commands.setDocStyle(s);
    const fire = (name: string) => () => {
      window.dispatchEvent(new CustomEvent(name));
      return true;
    };
    const size = (direction: 1 | -1) => () => {
      const now = currentFontSize(this.editor) ?? DEFAULT_FONT_SIZE;
      return this.editor.chain().focus().setFontSize(`${stepFontSize(now, direction)}pt`).run();
    };
    return {
      "Mod-Alt-0": style("normal"),
      "Mod-Alt-1": style("h1"),
      "Mod-Alt-2": style("h2"),
      "Mod-Alt-3": style("h3"),
      "Mod-Alt-4": style("h4"),
      "Mod-Alt-5": style("h5"),
      "Mod-Alt-6": style("h6"),
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList(),
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList(),
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),
      "Mod-Shift-l": () => this.editor.commands.setTextAlign("left"),
      "Mod-Shift-e": () => this.editor.commands.setTextAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
      "Mod-Shift-j": () => this.editor.commands.setTextAlign("justify"),
      "Mod-]": () => this.editor.commands.indentStep(1),
      "Mod-[": () => this.editor.commands.indentStep(-1),
      "Mod-\\": () => this.editor.chain().focus().unsetAllMarks().run(),
      "Mod-.": () => this.editor.commands.toggleSuperscript(),
      "Mod-,": () => this.editor.commands.toggleSubscript(),
      // Strikethrough: Alt+Shift+5, ⌘+Shift+X on a Mac (ext/typing.ts).
      "Mod-Shift-.": size(1),
      "Mod-Shift->": size(1),
      "Mod-Shift-,": size(-1),
      "Mod-Shift-<": size(-1),
      "Mod-Enter": () => this.editor.commands.setPageBreak(),
      "Mod-k": fire(DOCS_EVENT.link),
      "Mod-Alt-m": fire(DOCS_EVENT.comment),
      "Mod-Shift-c": fire(DOCS_EVENT.wordCount),
    };
  },
});

/** The page editor's extensions. `placeholder` is the hint on an empty line. */
export function docsExtensions({ placeholder }: { placeholder: string }) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      hardBreak: { HTMLAttributes: { "data-hard-break": "" } },
      link: {
        openOnClick: false,
        // Docs detects a link when a space, Enter, or Tab ends it, with its
        // own pattern (ext/typing.ts); off, a link also stops growing when
        // text is typed at its end.
        autolink: false,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
      dropcursor: { color: "#0b57d0", width: 2 },
      undoRedo: { depth: 500, newGroupDelay: 500 },
    }),
    TextStyle,
    Color,
    BackgroundColor,
    DocsFontFamily,
    FontSize,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 32 } }),
    Image.configure({ inline: false, allowBase64: false }),
    Placeholder.configure({ placeholder, showOnlyCurrent: true, includeChildren: true }),
    CharacterCount,
    // No Typography: Google Docs' substitutions and smart quotes are the
    // typing area's autocorrect (ext/typing.ts).
    BlockIds,
    ParagraphFormat,
    PageBreak,
    DocsKeymap,
    ...toolbarExtensions,
    ...pageExtensions,
    ...insertExtensions,
    ...typingExtensions,
    ...layerExtensions,
  ];
}
