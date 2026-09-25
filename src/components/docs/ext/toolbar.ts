import { Extension, type AnyExtension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { firstFamily, loadFontInUse } from "@/components/docs/fonts";
import { namedStyleSheet, readChanges, STYLE_ATTR, STYLE_ORDER } from "@/components/docs/toolbar/styles";
import { SUGGESTION_MARK_TYPES } from "@/lib/docs/schema";

// The toolbar's extensions (SPEC.md §29): the named styles on the doc node,
// drawn by a style sheet for this editor; the paragraph flags of Line &
// paragraph spacing (null = the named style's); Clear formatting; and the
// loading of faces the document uses.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docsToolbar: {
      /** Clear formatting (Ctrl+\): the text loses every style but its
          links, and each paragraph it touches loses its alignment,
          spacing, and indents; the named style and the lists stay. */
      clearFormatting: () => ReturnType;
      /** A paragraph attribute of Line & paragraph spacing's checkable items. */
      setParagraphFlag: (flag: ParagraphFlag, value: boolean | null) => ReturnType;
    };
  }
}

export type ParagraphFlag = "keepWithNext" | "keepLinesTogether" | "preventSingleLines" | "pageBreakBefore";

/** The paragraph attributes Clear formatting resets. */
const PARAGRAPH_FORMAT = [
  "textAlign",
  "lineSpacing",
  "spaceBefore",
  "spaceAfter",
  "indentLeft",
  "indentRight",
  "indentFirstLine",
  "keepWithNext",
  "keepLinesTogether",
  "preventSingleLines",
  "pageBreakBefore",
];

function flagAttr(name: string, data: string) {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(`data-${data}`);
      return v === "true" ? true : v === "false" ? false : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      typeof attrs[name] === "boolean" ? { [`data-${data}`]: String(attrs[name]) } : {},
  };
}

const namedStyles = new PluginKey("docsNamedStyles");
/** Each editor's named styles apply under its own data-docs-styles. */
let editors = 0;

/** Every face (and weight) the document's runs and named styles use. */
export function facesInUse(doc: PMNode): Map<string, Set<number>> {
  const faces = new Map<string, Set<number>>();
  doc.descendants((node) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== "textStyle") continue;
      const face = firstFamily(mark.attrs.fontFamily as string | undefined);
      if (!face) continue;
      const weights = faces.get(face) ?? new Set<number>();
      if (typeof mark.attrs.fontWeight === "number") weights.add(mark.attrs.fontWeight);
      faces.set(face, weights);
    }
    return false;
  });
  for (const changes of Object.values(readChanges(doc))) {
    if (changes.font && !faces.has(changes.font)) faces.set(changes.font, new Set());
  }
  return faces;
}

const DocsToolbar = Extension.create({
  name: "docsToolbar",

  addGlobalAttributes() {
    const styleAttrs = Object.fromEntries(
      STYLE_ORDER.map((style) => [STYLE_ATTR[style], { default: null, rendered: false }]),
    );
    return [
      { types: ["doc"], attributes: styleAttrs },
      {
        types: ["paragraph", "heading"],
        attributes: {
          keepWithNext: flagAttr("keepWithNext", "keep-with-next"),
          keepLinesTogether: flagAttr("keepLinesTogether", "keep-lines-together"),
          preventSingleLines: flagAttr("preventSingleLines", "prevent-single-lines"),
          pageBreakBefore: flagAttr("pageBreakBefore", "page-break-before"),
        },
      },
    ];
  },

  addCommands() {
    return {
      clearFormatting:
        () =>
        ({ state, tr, dispatch }) => {
          const { selection, schema } = state;
          const link = schema.marks.link;
          const resetBlock = (node: PMNode, pos: number) => {
            const attrs: Record<string, unknown> = { ...node.attrs };
            let changed = false;
            for (const name of PARAGRAPH_FORMAT) {
              if (name in attrs && attrs[name] !== null && attrs[name] !== undefined) {
                attrs[name] = null;
                changed = true;
              }
            }
            if (changed) tr.setNodeMarkup(pos, undefined, attrs);
          };
          if (selection.empty) {
            const { $from } = selection;
            tr.setStoredMarks((state.storedMarks ?? $from.marks()).filter((m) => m.type === link));
            if ($from.parent.isTextblock && $from.parent.content.size === 0) resetBlock($from.parent, $from.before());
          } else {
            for (const range of selection.ranges) {
              const from = range.$from.pos;
              const to = range.$to.pos;
              for (const type of Object.values(schema.marks)) {
                if (type !== link && !SUGGESTION_MARK_TYPES.has(type.name)) tr.removeMark(from, to, type);
              }
              state.doc.nodesBetween(from, to, (node, pos) => {
                if (!node.isTextblock) return true;
                resetBlock(node, pos);
                return false;
              });
            }
          }
          if (dispatch) dispatch(tr);
          return true;
        },
      setParagraphFlag:
        (flag, value) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, [flag]: value });
            return false;
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: namedStyles,
        view: (view) => {
          const scope = `s${++editors}`;
          view.dom.setAttribute("data-docs-styles", scope);
          const sheet = document.head.appendChild(document.createElement("style"));
          let attrs: PMNode["attrs"] | null = null;
          const draw = () => {
            if (view.state.doc.attrs === attrs) return;
            attrs = view.state.doc.attrs;
            sheet.textContent = namedStyleSheet(view.state.doc, `html .docs-prose[data-docs-styles="${scope}"]`);
          };
          let timer: number | null = null;
          let last: PMNode | null = null;
          const scan = () => {
            timer = null;
            for (const [face, weights] of facesInUse(view.state.doc)) {
              if (weights.size === 0) loadFontInUse(face);
              for (const weight of weights) loadFontInUse(face, weight);
            }
          };
          const schedule = () => {
            if (last === view.state.doc) return;
            last = view.state.doc;
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(scan, 400);
          };
          draw();
          schedule();
          return {
            update: () => {
              draw();
              schedule();
            },
            destroy: () => {
              sheet.remove();
              if (timer !== null) window.clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});

export const toolbarExtensions: AnyExtension[] = [DocsToolbar];
