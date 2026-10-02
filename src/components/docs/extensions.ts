import { Extension, Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { BackgroundColor, Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { DocsFontFamily } from "@/components/docs/fonts";
import { insertExtensions } from "@/components/docs/ext/insert";
import { Citation } from "@/components/docs/insert/citation";
import { Figure, type ImportedEditor } from "@/components/docs/insert/figure";
import { PageStart, PageStartKeys } from "@/components/docs/insert/page-start";
import { layerExtensions } from "@/components/docs/ext/layer";
import { pageExtensions } from "@/components/docs/ext/page";
import { toolbarExtensions } from "@/components/docs/ext/toolbar";
import { blockStyle, readStyles, selectionSize, sizeInPt } from "@/components/docs/toolbar/styles";
import { suggestExtensions } from "@/components/docs/ext/suggest";
import { typingExtensions } from "@/components/docs/ext/typing";
import { DOCS_EVENT, TYPING_EVENT, fireDocs } from "@/components/docs/typing/events";
import { ParagraphBoxes } from "@/components/docs/toolbar/borders";
import { INDEXED_NODE_TYPES, newBlockId } from "@/lib/docs/schema";

// The page editor's schema and behavior (SPEC.md §29): Google Docs' model on
// Tiptap. A new node type is added here, in lib/docs/schema.ts
// (RICH_NODE_TYPES), and in lib/docs/blocks.ts when it carries words.

export type { FigureMediaView, ImportedEditor } from "@/components/docs/insert/figure";

/** The font sizes Google Docs' size list offers, in points. + and − do not
    step through them: they move each run by one point (stepSelectionFontSize). */
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96] as const;
/** Normal text's size in points. */
export const DEFAULT_FONT_SIZE = 11;
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
          // A copy the assistant's move suggestion adds (suggest/assistant.ts
          // moveBlocks): the id of the block it moves. Once the move is
          // accepted and that block is gone, the copy takes its id, so every
          // anchor on it stays (ext/suggest.ts settle).
          movedFrom: {
            default: null,
            keepOnSplit: false,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const strip = (fragment: Fragment): Fragment => {
      const nodes: PMNode[] = [];
      fragment.forEach((node) => {
        // Text carries no id, and a text node is never built by its type.
        if (node.isText) {
          nodes.push(node);
          return;
        }
        const attrs = INDEXED_NODE_TYPES.has(node.type.name) ? { ...node.attrs, blockId: null, movedFrom: null } : node.attrs;
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
          // The blocks alone: no indexed node holds another, and a
          // paragraph's words are never visited, so a long import's typing
          // pays for its blocks, not its letters.
          state.doc.descendants((node, pos) => {
            if (!INDEXED_NODE_TYPES.has(node.type.name)) return !node.isTextblock && !node.isAtom;
            const id = node.attrs.blockId as string | null;
            if (!id || seen.has(id)) {
              const fresh = newBlockId();
              seen.add(fresh);
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: fresh });
              changed = true;
            } else {
              seen.add(id);
            }
            return false;
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

/** A paragraph's border side, Docs' Borders and shading (an import's Word
    paragraph borders, w:pBdr: a rule under a heading, a bar beside a
    quote): "<width pt> <solid|dotted|dashed> #rrggbb <padding pt>", the
    padding the room between the line and the words. The paragraph's space
    before and after stay outside its lines, as margins in place of its
    padding: a rule sits under the words, not under the space after, and a
    bar runs down the words alone. */
const PARAGRAPH_BORDER = /^(\d{1,2}(?:\.\d{1,2})?) (solid|dotted|dashed) (#[0-9a-fA-F]{6})(?: (\d{1,2}(?:\.\d{1,2})?))?$/;

/** A line's color as the page draws it: black is the page's own line, which
    dark mode draws in the table grid's sand (--docs-grid), as it draws the
    words' black as ink. */
const lineColor = (hex: string) => (hex.toLowerCase() === "#000000" ? "var(--docs-grid, #000000)" : hex);

function borderAttr(side: "top" | "right" | "bottom" | "left") {
  const name = `border${side[0].toUpperCase()}${side.slice(1)}`;
  return {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-border-${side}`),
    renderHTML: (attrs: Record<string, unknown>) => {
      const value = attrs[name];
      const m = typeof value === "string" ? PARAGRAPH_BORDER.exec(value) : null;
      if (!m) return {};
      const css = [`border-${side}: ${m[1]}pt ${m[2]} ${lineColor(m[3])}`, `padding-${side}: ${m[4] ?? 0}pt`];
      const lined = (key: string) => typeof attrs[key] === "string" && PARAGRAPH_BORDER.test(attrs[key] as string);
      // The space before and after as margins: a lined edge keeps its own
      // side's padding, and beside a bar an edge without a line has none.
      // Beside a bar the space is also --docs-bar-top and -bottom: where
      // barred paragraphs follow one another, it lies inside their one bar
      // (css/import.css).
      for (const [edge, key, space] of [["top", "borderTop", attrs.spaceBefore], ["bottom", "borderBottom", attrs.spaceAfter]] as const) {
        if (key !== name && (side === "top" || side === "bottom" || lined(key))) continue;
        const pt = `${typeof space === "number" ? space : 0}pt`;
        if (key !== name) css.push(`padding-${edge}: 0`, `--docs-bar-${edge}: ${pt}`);
        css.push(`margin-${edge}: ${pt}`);
      }
      return { [`data-border-${side}`]: value, style: css.join("; ") };
    },
  };
}

/** A paragraph's shading, Borders and shading's background: "#rrggbb
    <padding pt>". The background fills the box and the padding all round
    it; the space before and after stay outside it, as margins. On a light
    background in dark mode the words keep the light theme's ink
    (borders.css). */
const PARAGRAPH_SHADING = /^(#[0-9a-fA-F]{6})(?: (\d{1,2}(?:\.\d{1,2})?))?$/;

const shadingAttr = {
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute("data-shading"),
  renderHTML: (attrs: Record<string, unknown>) => {
    const m = typeof attrs.shading === "string" ? PARAGRAPH_SHADING.exec(attrs.shading) : null;
    if (!m) return {};
    const pad = `${m[2] ?? 0}pt`;
    const pt = (v: unknown) => `${typeof v === "number" ? v : 0}pt`;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
    const css = [`background-color: ${m[1]}`, `padding: ${pad}`, `margin-top: ${pt(attrs.spaceBefore)}`, `margin-bottom: ${pt(attrs.spaceAfter)}`];
    return { "data-shading": attrs.shading, ...(light ? { "data-shading-light": "" } : {}), style: css.join("; ") };
  },
};

/** Borders and shading's line between the paragraphs of one box, and the
    box's inner room (toolbar/borders.ts): the line draws only where the
    next paragraph shares the box (borders.css), and inside the box the
    paragraphs keep their space before and after, a line between adding
    its padding on both sides. */
const boxInside = {
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute("data-border-between"),
  renderHTML: (attrs: Record<string, unknown>) => {
    const side = (v: unknown) => (typeof v === "string" ? PARAGRAPH_BORDER.exec(v) : null);
    const between = side(attrs.borderBetween);
    const boxed = between || side(attrs.borderTop) || side(attrs.borderBottom) || (typeof attrs.shading === "string" && PARAGRAPH_SHADING.test(attrs.shading));
    if (!boxed) return {};
    const pt = (v: unknown) => (typeof v === "number" ? v : 0);
    const pad = between ? Number(between[4] ?? 0) : 0;
    const css = [`--docs-box-inner-before: ${pt(attrs.spaceBefore) + pad}pt`, `--docs-box-inner-after: ${pt(attrs.spaceAfter) + pad}pt`];
    if (between) css.push(`--docs-box-between: ${between[1]}pt ${between[2]} ${lineColor(between[3])}`);
    return between ? { "data-border-between": attrs.borderBetween, style: css.join("; ") } : { style: css.join("; ") };
  },
};

/** Google Docs' paragraph formatting: line spacing, space before and after,
    left, right, and first-line indents, borders, and the Title and
    Subtitle styles (a heading is its own node). Spacing is padding, so a
    paragraph's space after and the next one's space before add up, as in
    Docs. */
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
          // After the spacing: a bordered side's padding and margin win.
          borderTop: borderAttr("top"),
          borderRight: borderAttr("right"),
          borderBottom: borderAttr("bottom"),
          borderLeft: borderAttr("left"),
          // Borders and shading: after the sides, so the background's
          // padding and margins win (toolbar/borders.ts).
          borderBetween: boxInside,
          shading: shadingAttr,
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
      {
        types: ["heading"],
        attributes: {
          // A run-in heading (an import's bold lead, "1.2.3. Two examples."):
          // drawn at the start of the paragraph under it, on its first line
          // (css/import.css); the outline and the paragraph index list it.
          runIn: {
            default: null,
            parseHTML: (el) => (el.hasAttribute("data-run-in") ? true : null),
            renderHTML: (attrs) => (attrs.runIn === true ? { "data-run-in": "" } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    // The paragraphs the selection touches, changed on the command's own
    // transaction, so the commands chain (editor.chain().focus()...).
    const eachParagraph = (
      { tr, dispatch }: { tr: Transaction; dispatch?: unknown },
      fn: (node: PMNode, pos: number) => Record<string, unknown> | null,
    ): boolean => {
      let changed = false;
      tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
        const next = fn(node, pos);
        if (next) {
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
          changed = true;
        }
        return false;
      });
      return changed;
    };
    return {
      setLineSpacing:
        (value) =>
        (props) =>
          eachParagraph(props, () => ({ lineSpacing: value })),
      setParagraphSpace:
        (side, pt) =>
        (props) =>
          eachParagraph(props, () => (side === "before" ? { spaceBefore: pt } : { spaceAfter: pt })),
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
        ({ editor, commands, tr, dispatch }) => {
          // A list line nests or lifts; any other paragraph moves its left
          // indent by half an inch.
          const inTask = editor.isActive("taskItem");
          const inList = editor.isActive("listItem") || inTask;
          if (inList) {
            const item = inTask ? "taskItem" : "listItem";
            return direction === 1 ? commands.sinkListItem(item) : commands.liftListItem(item);
          }
          return eachParagraph({ tr, dispatch }, (node) => {
            const current = typeof node.attrs.indentLeft === "number" ? node.attrs.indentLeft : 0;
            const next = Math.max(0, current + direction * INDENT_STEP_PT);
            if (next === current) return null;
            return { indentLeft: next === 0 ? null : next };
          });
        },
    };
  },
});

/** Small capitals (SPEC.md §30): an import's words set in a small-caps font
    (a theorem label, a legal defined term), drawn in the font's own small
    capitals. Google Docs has no such format, so no command sets it; Clear
    formatting takes it off. The style is inline on the span, so a copy into
    Word, the web page download, and print keep it. */
const SmallCaps = Mark.create({
  name: "smallCaps",
  parseHTML() {
    const smallCaps = (value: string) => (/small-caps/.test(value) ? null : false);
    return [
      { style: "font-variant", getAttrs: smallCaps },
      { style: "font-variant-caps", getAttrs: smallCaps },
    ];
  },
  renderHTML() {
    return ["span", { style: "font-variant: small-caps" }, 0];
  },
});

/** A page break (Ctrl+Enter): the text after it starts on a new page. */
const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  // Never selected by a click or an arrow: the next key would take it.
  selectable: false,
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
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.pageBreak;
          if (!type || !state.selection.$from.parent.isTextblock) return false;
          if (!dispatch) return true;
          tr.deleteSelection();
          const $at = tr.selection.$from;
          if ($at.parentOffset === 0 && $at.parent.content.size > 0) {
            // At a line's start the whole line moves to the new page.
            tr.insert($at.before(), type.create());
            return true;
          }
          // Anywhere else the line splits at the caret, and its second half,
          // empty or not, starts the new page with the caret in it.
          const at = $at.pos;
          tr.split(at);
          tr.insert(at + 1, type.create());
          tr.setSelection(TextSelection.create(tr.doc, at + 3));
          return true;
        },
    };
  },
});

/** One point up or down from `size`, clamped to 1–400 (Google Docs' + and −). */
function stepFontSize(size: number, direction: 1 | -1): number {
  return Math.max(1, Math.min(400, size + direction));
}

/** + and − (Ctrl+Shift+. and ,) on the selection: every run moves one point
    from its own size, so a 10/14 pt mix becomes 11/15 pt; a collapsed caret
    changes the size the next typed text gets. */
export function stepSelectionFontSize(editor: Editor, direction: 1 | -1): boolean {
  const { state } = editor;
  const type = state.schema.marks.textStyle;
  if (!type || !editor.isEditable) return false;
  const styles = readStyles(state.doc);
  const tr = state.tr;
  if (state.selection.empty) {
    const existing = (state.storedMarks ?? state.selection.$from.marks()).find((m) => m.type === type);
    const size = selectionSize(state, styles) ?? DEFAULT_FONT_SIZE;
    tr.addStoredMark(type.create({ ...existing?.attrs, fontSize: `${stepFontSize(size, direction)}pt` }));
  } else {
    for (const range of state.selection.ranges) {
      const start = range.$from.pos;
      const end = range.$to.pos;
      state.doc.nodesBetween(start, end, (node, pos, parent) => {
        if (!node.isText || !parent) return true;
        const existing = node.marks.find((m) => m.type === type);
        const size = sizeInPt(existing?.attrs.fontSize) ?? styles[blockStyle(parent)].size;
        const next = stepFontSize(size, direction);
        if (next !== size) {
          tr.addMark(Math.max(pos, start), Math.min(pos + node.nodeSize, end), type.create({ ...existing?.attrs, fontSize: `${next}pt` }));
        }
        return false;
      });
    }
  }
  editor.view.dispatch(tr);
  return true;
}

/** Google Docs' shortcuts that act on the document (SPEC.md §29). */
const DocsKeymap = Extension.create({
  name: "docsKeymap",
  // Before StarterKit's keys (100): Ctrl+Alt+1 keeps a heading a heading, and
  // Ctrl+Enter breaks the page rather than the line.
  priority: 150,
  addKeyboardShortcuts() {
    const style = (s: DocStyle) => () => this.editor.commands.setDocStyle(s);
    const fire = (name: string) => () => {
      fireDocs(this.editor, name);
      return true;
    };
    const size = (direction: 1 | -1) => () => stepSelectionFontSize(this.editor, direction);
    return {
      // Normal text (Ctrl+Alt+0): ext/typing.ts, before Tiptap's paragraph key.
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
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
      "Mod-Shift-j": () => this.editor.commands.setTextAlign("justify"),
      "Mod-]": () => this.editor.commands.indentStep(1),
      "Mod-[": () => this.editor.commands.indentStep(-1),
      // Clear formatting (Ctrl+\, Ctrl+Space): ext/typing.ts.
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
      "Mod-Shift-c": fire(TYPING_EVENT.wordCount),
    };
  },
});

/** The page editor's extensions. An import (SPEC.md §29) passes its figures'
    media and page labels; a blank document passes nothing. */
export function docsExtensions(imported?: ImportedEditor) {
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
      dropcursor: { color: "var(--docs-blue)", width: 2 },
      horizontalRule: false,
      undoRedo: { depth: 500, newGroupDelay: 1000 },
      // Docs ends a document on any line, a list's too; only a table or
      // another object gets an empty line after it.
      trailingNode: { notAfter: ["paragraph", "heading", "bulletList", "orderedList", "taskList"] },
    }),
    TextStyle,
    Color,
    BackgroundColor,
    DocsFontFamily,
    FontSize,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Subscript,
    Superscript,
    SmallCaps,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 32 } }),
    Image.configure({ inline: false, allowBase64: false }),
    // Never selected by a click or an arrow, as a page break.
    HorizontalRule.extend({ selectable: false }),
    // No Typography: Google Docs' substitutions and smart quotes are the
    // typing area's autocorrect (ext/typing.ts).
    BlockIds,
    ParagraphFormat,
    // Borders and shading: paragraphs sharing a box draw one box.
    ParagraphBoxes,
    PageBreak,
    // An import's figure objects, page starts, and citations.
    Figure.configure({ imported: imported ?? null }),
    PageStart,
    PageStartKeys,
    Citation,
    DocsKeymap,
    ...toolbarExtensions,
    ...pageExtensions,
    ...insertExtensions,
    ...typingExtensions,
    ...layerExtensions,
    ...suggestExtensions,
  ];
}
