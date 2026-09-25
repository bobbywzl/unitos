"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { docsCommands, type DocsMenu } from "@/components/docs/commands";
import type { ParagraphFlag } from "@/components/docs/ext/toolbar";
import { DOCS_EVENT, stepSelectionFontSize, type DocStyle } from "@/components/docs/extensions";
import { DOCS_FONTS, pushRecentFont, userFonts } from "@/components/docs/fonts";
import {
  AddCommentIcon,
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  BulletListIcon,
  ChecklistIcon,
  ClearFormattingIcon,
  EditIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  HighlightGlyph,
  ImageIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  LineSpacingIcon,
  LinkIcon,
  NumberedListIcon,
  PaintFormatIcon,
  PrintIcon,
  RedoIcon,
  SpellcheckIcon,
  TextColorGlyph,
  UnderlineIcon,
  UndoIcon,
  ViewIcon,
} from "@/components/docs/icons";
import { isMac, keys, matchesCombo, withKeys } from "@/components/docs/keys";
import { keepFocus } from "@/components/docs/menu";
import { addCustomColor, ColorMenu } from "@/components/docs/palette";
import { Btn, DropBtn, OPEN_MENU_EVENT, Sep } from "@/components/docs/toolbar/controls";
import { CustomColorDialog } from "@/components/docs/toolbar/custom-color";
import { FontSelect } from "@/components/docs/toolbar/font-menu";
import { FontSizeControl, formatSize, parseSize } from "@/components/docs/toolbar/font-size";
import { ImageMenu, type ImageSource } from "@/components/docs/toolbar/image-menu";
import { ListButtons, type ListState } from "@/components/docs/toolbar/list-menus";
import { currentListStyle } from "@/components/docs/toolbar/lists";
import { ModeSwitcher, type DocsMode } from "@/components/docs/toolbar/mode";
import { ToolbarRow, type ToolbarGroup } from "@/components/docs/toolbar/overflow";
import { usePaintFormat } from "@/components/docs/toolbar/paint-format";
import { SEARCH_MENUS_EVENT, SearchMenus, type SearchAction } from "@/components/docs/toolbar/search-menus";
import { setLineSpacing, setSpace, SpacingMenu, toggleFlag, type ParagraphState } from "@/components/docs/toolbar/spacing";
import { STYLE_KEYS, STYLE_LABEL, StylesSelect, menuStyles } from "@/components/docs/toolbar/styles-menu";
import {
  blockStyle,
  deepestHeading,
  readStyles,
  replaceAllChanges,
  saveDefaultStyles,
  savedDefaultStyles,
  selectionFont,
  selectionSize,
  selectionStyle,
  updateStyleToMatch,
  type Align,
} from "@/components/docs/toolbar/styles";
import { ZoomBox, ZOOMS, type Zoom } from "@/components/docs/toolbar/zoom";
import { TYPING_EVENT } from "@/components/docs/typing/events";
import type { TKey } from "@/lib/i18n/dictionaries";

// The page editor's toolbar (SPEC.md §29): Google Docs' toolbar, left to
// right — Search the menus, Undo, Redo, Print, Spelling and grammar check,
// Paint format, Zoom | Styles | Font | the size | Bold, Italic, Underline,
// Text color, Highlight color | Insert link, Add comment, Insert image |
// Align, Line & paragraph spacing, the three lists, Decrease indent,
// Increase indent, Clear formatting — and at the right end the Unitos
// tools, the mode switcher, and Hide the menus. In Viewing mode (and for a
// reader who may not edit) the left side is Print, Add comment, and Zoom.
// No control takes the page's focus, so the selection it acts on stays.

export type { DocsMode, Zoom };
export { ZOOMS };

const MENU_NAMES: Record<DocsMenu, TKey> = {
  file: "docs.menuFile",
  edit: "docs.menuEdit",
  view: "docs.menuView",
  insert: "docs.menuInsert",
  format: "docs.menuFormat",
  tools: "docs.menuTools",
};

const ALIGNS: { align: Align; key: TKey; combo: string; Icon: typeof AlignLeftIcon }[] = [
  { align: "left", key: "docs.alignLeft", combo: "Mod+Shift+L", Icon: AlignLeftIcon },
  { align: "center", key: "docs.alignCenter", combo: "Mod+Shift+E", Icon: AlignCenterIcon },
  { align: "right", key: "docs.alignRight", combo: "Mod+Shift+R", Icon: AlignRightIcon },
  { align: "justify", key: "docs.alignJustify", combo: "Mod+Shift+J", Icon: AlignJustifyIcon },
];

const FLAG_KEYS: Record<ParagraphFlag, TKey> = {
  keepWithNext: "docs.keepWithNext",
  keepLinesTogether: "docs.keepLinesTogether",
  preventSingleLines: "docs.preventSingleLines",
  pageBreakBefore: "docs.pageBreakBefore",
};

function toast(text: string) {
  window.dispatchEvent(new CustomEvent("dissect:toast", { detail: { text } }));
}

function openMenu(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_MENU_EVENT, { detail: { id } }));
}

/** What the toolbar shows for the selection, read on every change. */
function readToolbar(e: Editor) {
  const state = e.state;
  const styles = readStyles(state.doc);
  const block = state.selection.$from.parent;
  const own = block.isTextblock ? blockStyle(block) : "normal";
  const named = styles[own];
  const num = (name: string, fallback: number) =>
    typeof block.attrs[name] === "number" ? (block.attrs[name] as number) : fallback;
  const heading = own !== "normal";
  const styleFlags: Record<ParagraphFlag, boolean> = {
    keepWithNext: heading,
    keepLinesTogether: heading,
    preventSingleLines: true,
    pageBreakBefore: false,
  };
  const flag = (name: ParagraphFlag) =>
    typeof block.attrs[name] === "boolean" ? (block.attrs[name] as boolean) : styleFlags[name];
  const textStyle = e.getAttributes("textStyle");
  const align = block.attrs.textAlign;
  const para: ParagraphState = {
    lineSpacing: num("lineSpacing", named.lineSpacing),
    spaceBefore: num("spaceBefore", named.spaceBefore),
    spaceAfter: num("spaceAfter", named.spaceAfter),
    styleLineSpacing: named.lineSpacing,
    styleSpaceBefore: named.spaceBefore,
    styleSpaceAfter: named.spaceAfter,
    inList: e.isActive("listItem") || e.isActive("taskItem"),
    flags: {
      keepWithNext: flag("keepWithNext"),
      keepLinesTogether: flag("keepLinesTogether"),
      preventSingleLines: flag("preventSingleLines"),
      pageBreakBefore: flag("pageBreakBefore"),
    },
    styleFlags,
  };
  const lists: ListState = {
    bullet: e.isActive("bulletList"),
    ordered: e.isActive("orderedList"),
    task: e.isActive("taskList"),
    styles: {
      bulletList: currentListStyle(state, "bulletList"),
      orderedList: currentListStyle(state, "orderedList"),
      taskList: currentListStyle(state, "taskList"),
    },
  };
  return {
    canUndo: e.can().undo(),
    canRedo: e.can().redo(),
    bold: e.isActive("bold"),
    italic: e.isActive("italic"),
    underline: e.isActive("underline"),
    style: selectionStyle(state),
    styles,
    deepest: deepestHeading(state.doc),
    font: selectionFont(state, styles),
    size: selectionSize(state, styles),
    color: typeof textStyle.color === "string" ? textStyle.color : null,
    highlight: typeof textStyle.backgroundColor === "string" ? textStyle.backgroundColor : null,
    styleColor: named.color,
    align: (align === "center" || align === "right" || align === "justify" || align === "left" ? align : named.align) as Align,
    para,
    lists,
  };
}

export function DocsToolbar({
  editor,
  mode,
  onMode,
  canEdit,
  zoom,
  onZoom,
  aiControls,
  headerHidden,
  onToggleHeader,
  onInsertImage,
  pageless = false,
}: {
  editor: Editor;
  mode: DocsMode;
  onMode: (mode: DocsMode) => void;
  canEdit: boolean;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  aiControls?: ReactNode;
  headerHidden: boolean;
  onToggleHeader: () => void;
  onInsertImage: (source: ImageSource) => void;
  /** The page is pageless: the bar is lighter and the page flags go. */
  pageless?: boolean;
}) {
  const t = useT();
  const s = useEditorState({ editor, selector: ({ editor: e }) => readToolbar(e) });
  const paint = usePaintFormat(editor);
  const [customFor, setCustomFor] = useState<"text" | "highlight" | null>(null);
  const editing = mode === "editing" && canEdit;
  const off = !editing;
  // At once, not on the next frame as editor.commands.focus() does: a key
  // pressed right after (Alt+/ again) keeps its own target.
  const focusPage = () => {
    if (!editor.isDestroyed) editor.view.focus();
  };
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();

  // Search the menus (Alt+/), and the modes' keys: Ctrl+Alt+Shift+Z is
  // Editing, Ctrl+Alt+Shift+C and D are Viewing (Docs' help page and its
  // code disagree on the letter; both work).
  const modeRef = useRef({ canEdit, onMode });
  useEffect(() => {
    modeRef.current = { canEdit, onMode };
  });
  useEffect(() => {
    const shell = editor.view.dom.closest("[data-docs-editor]");
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && active !== document.body && shell && !shell.contains(active)) return;
      const mac = isMac();
      const search =
        matchesCombo(e, "Alt+/") ||
        (mac ? matchesCombo(e, "Ctrl+Alt+Z") : matchesCombo(e, "Alt+Z") || matchesCombo(e, "Alt+Shift+Z"));
      if (search) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent(SEARCH_MENUS_EVENT));
        return;
      }
      const { canEdit: may, onMode: set } = modeRef.current;
      if (!may) return;
      if (matchesCombo(e, "Mod+Alt+Shift+Z")) {
        e.preventDefault();
        set("editing");
      } else if (matchesCombo(e, "Mod+Alt+Shift+C") || matchesCombo(e, "Mod+Alt+Shift+D")) {
        e.preventDefault();
        set("viewing");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor]);

  const applyColor = (kind: "text" | "highlight", hex: string | null) => {
    if (kind === "text") {
      // Black is the page's own text color: in dark mode it draws light.
      if (!hex || hex === "#000000") run((c) => c.unsetColor());
      else run((c) => c.setColor(hex));
    } else if (!hex) run((c) => c.unsetBackgroundColor());
    else run((c) => c.setBackgroundColor(hex));
  };

  const AlignGlyph = ALIGNS.find((a) => a.align === s.align)?.Icon ?? AlignLeftIcon;
  const textBar = s.color ?? (s.styleColor !== "#000000" ? s.styleColor : "var(--docs-ink)");

  // ── Search the menus: every toolbar action, then the areas' commands ───
  const actions = (): SearchAction[] => {
    const format = t("docs.menuFormat");
    const registered: SearchAction[] = docsCommands().map((c) => ({
      id: c.id,
      label: t(c.label),
      where: t(MENU_NAMES[c.menu]),
      keywords: c.keywords,
      shortcut: c.shortcut ? keys(c.shortcut) : undefined,
      enabled: c.enabled ? c.enabled(editor) : true,
      run: () => c.run(editor),
    }));
    // An area's own command wins over the toolbar's action of that name.
    const taken = new Set(registered.map((c) => c.label.toLowerCase()));
    const list: SearchAction[] = [];
    const add = (a: Omit<SearchAction, "where"> & { where?: string }) => {
      if (!taken.has(a.label.toLowerCase())) list.push({ where: format, ...a });
    };
    const on = !off;
    const edit = t("docs.menuEdit");
    const view = t("docs.menuView");
    const insert = t("docs.menuInsert");
    add({ id: "undo", label: t("docs.undo"), where: edit, shortcut: keys("Mod+Z"), icon: <UndoIcon />, enabled: on && s.canUndo, run: () => run((c) => c.undo()) });
    add({ id: "redo", label: t("docs.redo"), where: edit, shortcut: keys("Mod+Y"), icon: <RedoIcon />, enabled: on && s.canRedo, run: () => run((c) => c.redo()) });
    add({ id: "print", label: t("docs.print"), where: t("docs.menuFile"), shortcut: keys("Mod+P"), icon: <PrintIcon />, run: () => window.print() });
    add({
      id: "spelling",
      label: t("docs.spellcheck"),
      where: t("docs.menuTools"),
      shortcut: keys("Mod+Alt+X"),
      keywords: ["spell check", "grammar", "typos"],
      icon: <SpellcheckIcon />,
      run: () => window.dispatchEvent(new CustomEvent(TYPING_EVENT.spelling)),
    });
    add({ id: "paint", label: t("docs.paintFormat"), keywords: ["copy formatting", "format painter"], icon: <PaintFormatIcon />, enabled: on, run: paint.press });
    add({ id: "zoom-fit", label: `${t("docs.zoom")}: ${t("docs.zoomFit")}`, where: view, run: () => onZoom("fit") });
    for (const z of ZOOMS) add({ id: `zoom-${z}`, label: t("docs.zoomValue", { n: z }), where: view, run: () => onZoom(z) });
    for (const style of menuStyles(6)) {
      const name = t(STYLE_LABEL[style]);
      const combo = STYLE_KEYS[style];
      add({
        id: `style-${style}`,
        label: name,
        keywords: ["paragraph styles", t("docs.styles")],
        shortcut: combo ? keys(combo) : undefined,
        enabled: on,
        run: () => run((c) => c.setDocStyle(style)),
      });
      add({ id: `update-${style}`, label: t("docs.updateStyle", { name }), keywords: ["paragraph styles"], enabled: on, run: () => updateStyleToMatch(editor, style) });
    }
    add({
      id: "save-styles",
      label: t("docs.saveDefaultStyles"),
      keywords: ["paragraph styles"],
      enabled: on,
      run: () => {
        saveDefaultStyles(editor.state.doc);
        toast(t("docs.defaultStylesSaved"));
      },
    });
    add({
      id: "use-styles",
      label: t("docs.useDefaultStyles"),
      keywords: ["paragraph styles"],
      enabled: on,
      run: () => {
        replaceAllChanges(editor, savedDefaultStyles());
        toast(t("docs.usingDefaultStyles"));
      },
    });
    add({ id: "reset-styles", label: t("docs.resetStyles"), keywords: ["paragraph styles"], enabled: on, run: () => replaceAllChanges(editor, {}) });
    add({ id: "font", label: t("docs.font"), keywords: ["typeface", "fonts"], enabled: on, run: () => openMenu("font") });
    add({ id: "more-fonts", label: t("docs.moreFonts"), keywords: ["add fonts", "google fonts"], enabled: on, run: () => openMenu("font") });
    add({
      id: "size-down",
      label: t("docs.decreaseFontSize"),
      shortcut: keys("Mod+Shift+,"),
      keywords: ["smaller", "make the font smaller", "make smaller", "make it smaller"],
      enabled: on,
      run: () => stepSelectionFontSize(editor, -1),
    });
    add({
      id: "size-up",
      label: t("docs.increaseFontSize"),
      shortcut: keys("Mod+Shift+."),
      keywords: ["bigger", "make the font bigger", "make bigger", "make it bigger", "larger"],
      enabled: on,
      run: () => stepSelectionFontSize(editor, 1),
    });
    add({ id: "bold", label: t("docs.bold"), shortcut: keys("Mod+B"), keywords: ["strong", "text"], icon: <BoldIcon />, enabled: on, run: () => run((c) => c.toggleBold()) });
    add({ id: "italic", label: t("docs.italic"), shortcut: keys("Mod+I"), keywords: ["slant", "text"], icon: <ItalicIcon />, enabled: on, run: () => run((c) => c.toggleItalic()) });
    add({ id: "underline", label: t("docs.underline"), shortcut: keys("Mod+U"), keywords: ["text"], icon: <UnderlineIcon />, enabled: on, run: () => run((c) => c.toggleUnderline()) });
    add({ id: "text-color", label: t("docs.textColor"), keywords: ["font color", "colour"], icon: <TextColorGlyph />, enabled: on, run: () => openMenu("text-color") });
    add({
      id: "highlight-color",
      label: t("docs.highlightColor"),
      keywords: ["background color", "marker", "colour"],
      icon: <HighlightGlyph />,
      enabled: on,
      run: () => openMenu("highlight-color"),
    });
    add({
      id: "link",
      label: t("docs.insertLink"),
      where: insert,
      shortcut: keys("Mod+K"),
      keywords: ["hyperlink", "url"],
      icon: <LinkIcon />,
      enabled: on,
      run: () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link)),
    });
    add({
      id: "comment",
      label: t("docs.addComment"),
      where: insert,
      shortcut: keys("Mod+Alt+M"),
      keywords: ["annotation"],
      icon: <AddCommentIcon />,
      enabled: canEdit,
      run: () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.comment)),
    });
    add({
      id: "image",
      label: t("docs.insertImage"),
      where: insert,
      keywords: ["picture", "photo", t("docs.uploadFromComputer"), t("docs.imageByUrl")],
      icon: <ImageIcon />,
      enabled: on,
      run: () => openMenu("image"),
    });
    for (const a of ALIGNS) {
      add({
        id: `align-${a.align}`,
        label: t(a.key),
        shortcut: keys(a.combo),
        keywords: ["align", "alignment"],
        icon: <a.Icon />,
        enabled: on,
        run: () => run((c) => c.setTextAlign(a.align)),
      });
    }
    const spacings: [number, TKey][] = [
      [1, "docs.spacingSingle"],
      [1.15, "docs.spacing115"],
      [1.5, "docs.spacing15"],
      [2, "docs.spacingDouble"],
    ];
    for (const [value, key] of spacings) {
      add({
        id: `spacing-${value}`,
        label: `${t("docs.lineSpacing")}: ${t(key)}`,
        keywords: ["line spacing"],
        icon: <LineSpacingIcon />,
        enabled: on,
        run: () => setLineSpacing(editor, s.para, value),
      });
    }
    const before = s.para.spaceBefore > 0;
    const after = s.para.spaceAfter > 0;
    add({
      id: "space-before",
      label: t(before ? "docs.removeSpaceBefore" : "docs.addSpaceBefore"),
      keywords: ["paragraph spacing"],
      enabled: on,
      run: () => setSpace(editor, s.para, "before", before ? 0 : 10),
    });
    add({
      id: "space-after",
      label: t(after ? "docs.removeSpaceAfter" : "docs.addSpaceAfter"),
      keywords: ["paragraph spacing"],
      enabled: on,
      run: () => setSpace(editor, s.para, "after", after ? 0 : 10),
    });
    add({ id: "custom-spacing", label: t("docs.customSpacing"), keywords: ["line spacing", "paragraph spacing"], enabled: on, run: () => openMenu("line-spacing") });
    if (!pageless) {
      for (const flag of Object.keys(FLAG_KEYS) as ParagraphFlag[]) {
        add({ id: flag, label: t(FLAG_KEYS[flag]), keywords: ["pagination", "page break"], enabled: on, run: () => toggleFlag(editor, s.para, flag) });
      }
    }
    add({
      id: "checklist",
      label: t("docs.checklist"),
      shortcut: keys("Mod+Shift+9"),
      keywords: ["todo", "tasks", "checkbox"],
      icon: <ChecklistIcon />,
      enabled: on,
      run: () => run((c) => c.toggleTaskList()),
    });
    add({
      id: "bulleted",
      label: t("docs.bulletedList"),
      shortcut: keys("Mod+Shift+8"),
      keywords: ["bullets", "list"],
      icon: <BulletListIcon />,
      enabled: on,
      run: () => run((c) => c.toggleBulletList()),
    });
    add({
      id: "numbered",
      label: t("docs.numberedList"),
      shortcut: keys("Mod+Shift+7"),
      keywords: ["numbers", "list"],
      icon: <NumberedListIcon />,
      enabled: on,
      run: () => run((c) => c.toggleOrderedList()),
    });
    add({ id: "checklist-menu", label: t("docs.checklistMenu"), keywords: ["checklist styles"], enabled: on, run: () => openMenu("checklist") });
    add({ id: "bulleted-menu", label: t("docs.bulletedListMenu"), keywords: ["bullet styles"], enabled: on, run: () => openMenu("bulleted-list") });
    add({ id: "numbered-menu", label: t("docs.numberedListMenu"), keywords: ["numbering styles"], enabled: on, run: () => openMenu("numbered-list") });
    add({
      id: "outdent",
      label: t("docs.decreaseIndent"),
      shortcut: keys("Mod+["),
      keywords: ["indent", "outdent"],
      icon: <IndentDecreaseIcon />,
      enabled: on,
      run: () => run((c) => c.indentStep(-1)),
    });
    add({
      id: "indent",
      label: t("docs.increaseIndent"),
      shortcut: keys("Mod+]"),
      keywords: ["indent"],
      icon: <IndentIncreaseIcon />,
      enabled: on,
      run: () => run((c) => c.indentStep(1)),
    });
    add({
      id: "clear",
      label: t("docs.clearFormatting"),
      shortcut: keys("Mod+\\"),
      keywords: ["remove formatting", "plain text"],
      icon: <ClearFormattingIcon />,
      enabled: on,
      run: () => run((c) => c.clearFormatting()),
    });
    if (canEdit) {
      add({ id: "mode-editing", label: t("docs.editingMode"), where: view, shortcut: keys("Mod+Alt+Shift+Z"), keywords: ["mode", "edit"], icon: <EditIcon />, run: () => onMode("editing") });
      add({ id: "mode-viewing", label: t("docs.viewingMode"), where: view, shortcut: keys("Mod+Alt+Shift+C"), keywords: ["mode", "read"], icon: <ViewIcon />, run: () => onMode("viewing") });
    }
    add({
      id: "menus",
      label: t(headerHidden ? "docs.showMenus" : "docs.hideMenus"),
      where: view,
      shortcut: keys("Ctrl+Shift+F"),
      keywords: ["compact mode", "title"],
      run: onToggleHeader,
    });
    return [...list, ...registered];
  };

  // A typed value: "font size 14" or "14", "zoom 150", a face's name.
  const valueActions = (query: string): SearchAction[] => {
    const q = query.trim().toLowerCase();
    const out: SearchAction[] = [];
    const size = /^(?:font\s*size|size)?\s*(\d+(?:\.\d+)?)\s*(?:pt)?$/.exec(q);
    if (size && !off) {
      const n = parseSize(size[1]);
      if (n !== null) {
        out.push({
          id: `size-${n}`,
          label: t("docs.fontSizeValue", { n: formatSize(n) }),
          where: t("docs.menuFormat"),
          run: () => run((c) => c.setFontSize(`${n}pt`)),
        });
      }
    }
    const zoomQ = /^zoom\s*(\d+)\s*%?$/.exec(q);
    if (zoomQ) {
      const n = Math.max(50, Math.min(200, parseInt(zoomQ[1], 10)));
      out.push({ id: `zoom-to-${n}`, label: t("docs.zoomValue", { n }), where: t("docs.menuView"), run: () => onZoom(n) });
    }
    const face = q.replace(/^font\s+/, "");
    if (face.length >= 2 && !off) {
      const names = [...DOCS_FONTS.map((f) => f.name), ...userFonts().map((f) => f.name)];
      for (const name of names.filter((n) => n.toLowerCase().startsWith(face)).slice(0, 5)) {
        out.push({
          id: `font-${name}`,
          label: t("docs.fontValue", { name }),
          where: t("docs.menuFormat"),
          run: () => {
            pushRecentFont(name);
            run((c) => c.setFontFamily(name));
          },
        });
      }
    }
    return out;
  };

  // ── The groups, left to right ───────────────────────────────────────────
  const printBtn = (
    <Btn label={t("docs.print")} tip={withKeys(t("docs.print"), "Mod+P")} track="print" onClick={() => window.print()}>
      <PrintIcon />
    </Btn>
  );
  const commentBtn = (
    <Btn
      label={t("docs.addComment")}
      tip={withKeys(t("docs.addComment"), "Mod+Alt+M")}
      track="comment"
      disabled={!canEdit}
      onClick={() => window.dispatchEvent(new CustomEvent(DOCS_EVENT.comment))}
    >
      <AddCommentIcon />
    </Btn>
  );
  const zoomBox = <ZoomBox zoom={zoom} onZoom={onZoom} onDone={focusPage} />;

  const colorButton = (kind: "text" | "highlight") => {
    const text = kind === "text";
    const label = t(text ? "docs.textColor" : "docs.highlightColor");
    return (
      <DropBtn
        id={text ? "text-color" : "highlight-color"}
        label={label}
        track={text ? "text-color" : "highlight-color"}
        disabled={off}
        arrow={false}
        className="docs-tb-color"
        menuClassName="docs-menu-colors"
        face={
          <>
            {text ? <TextColorGlyph /> : <HighlightGlyph className="docs-highlight-glyph" />}
            <span className="docs-tb-colorbar" style={{ background: text ? textBar : (s.highlight ?? "transparent") }} />
          </>
        }
      >
        {(close) => (
          <ColorMenu
            kind={kind}
            current={text ? s.color : s.highlight}
            onPick={(hex) => {
              close();
              applyColor(kind, hex);
            }}
            onNone={
              text
                ? undefined
                : () => {
                    close();
                    applyColor("highlight", null);
                  }
            }
            onCustom={() => {
              close();
              setCustomFor(kind);
            }}
          />
        )}
      </DropBtn>
    );
  };

  const groups: ToolbarGroup[] = off
    ? [
        {
          key: "view",
          sep: false,
          content: (
            <>
              {printBtn}
              {canEdit && commentBtn}
              <Sep />
              {zoomBox}
            </>
          ),
        },
      ]
    : [
        {
          key: "history",
          sep: false,
          content: (
            <>
              <SearchMenus actions={actions} valueActions={valueActions} onDone={focusPage} />
              <Btn
                label={t("docs.undo")}
                tip={withKeys(t("docs.undo"), "Mod+Z")}
                track="undo"
                disabled={!s.canUndo}
                onClick={() => run((c) => c.undo())}
              >
                <UndoIcon />
              </Btn>
              <Btn
                label={t("docs.redo")}
                tip={withKeys(t("docs.redo"), "Mod+Y")}
                track="redo"
                disabled={!s.canRedo}
                onClick={() => run((c) => c.redo())}
              >
                <RedoIcon />
              </Btn>
              {printBtn}
              <Btn
                label={t("docs.spellcheck")}
                tip={withKeys(t("docs.spellcheck"), "Mod+Alt+X")}
                track="spellcheck"
                onClick={() => window.dispatchEvent(new CustomEvent(TYPING_EVENT.spelling))}
              >
                <SpellcheckIcon />
              </Btn>
              <Btn label={t("docs.paintFormat")} track="paint-format" pressed={paint.active} onClick={paint.press}>
                <PaintFormatIcon />
              </Btn>
              {zoomBox}
            </>
          ),
        },
        {
          key: "styles",
          sep: true,
          menus: ["styles"],
          content: <StylesSelect editor={editor} style={s.style} styles={s.styles} deepest={s.deepest} disabled={off} toast={toast} />,
        },
        { key: "font", sep: true, menus: ["font"], content: <FontSelect editor={editor} font={s.font} disabled={off} /> },
        { key: "size", sep: true, content: <FontSizeControl editor={editor} size={s.size} disabled={off} /> },
        {
          key: "text",
          sep: true,
          menus: ["text-color", "highlight-color"],
          content: (
            <>
              <Btn
                label={t("docs.bold")}
                tip={withKeys(t("docs.bold"), "Mod+B")}
                track="bold"
                pressed={s.bold}
                onClick={() => run((c) => c.toggleBold())}
              >
                <BoldIcon />
              </Btn>
              <Btn
                label={t("docs.italic")}
                tip={withKeys(t("docs.italic"), "Mod+I")}
                track="italic"
                pressed={s.italic}
                onClick={() => run((c) => c.toggleItalic())}
              >
                <ItalicIcon />
              </Btn>
              <Btn
                label={t("docs.underline")}
                tip={withKeys(t("docs.underline"), "Mod+U")}
                track="underline"
                pressed={s.underline}
                onClick={() => run((c) => c.toggleUnderline())}
              >
                <UnderlineIcon />
              </Btn>
              {colorButton("text")}
              {colorButton("highlight")}
            </>
          ),
        },
        {
          key: "insert",
          sep: true,
          menus: ["image"],
          content: (
            <>
              <Btn
                label={t("docs.insertLink")}
                tip={withKeys(t("docs.insertLink"), "Mod+K")}
                track="link"
                onClick={() => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link))}
              >
                <LinkIcon />
              </Btn>
              {commentBtn}
              <ImageMenu disabled={off} onInsert={onInsertImage} onDone={focusPage} />
            </>
          ),
        },
        {
          key: "paragraph",
          sep: true,
          menus: ["align", "line-spacing", "checklist", "bulleted-list", "numbered-list"],
          content: (
            <>
              <DropBtn
                id="align"
                label={t("docs.align")}
                track="align"
                className="docs-tb-align"
                menuClassName="docs-menu-align"
                face={<AlignGlyph />}
              >
                {(close) => (
                  <div className="docs-align-row" data-grid-cols={4} role="group">
                    {ALIGNS.map((a) => (
                      <button
                        key={a.align}
                        type="button"
                        role="menuitemradio"
                        aria-checked={s.align === a.align}
                        aria-label={t(a.key)}
                        data-tip={withKeys(t(a.key), a.combo)}
                        data-menu-item
                        tabIndex={-1}
                        onMouseDown={keepFocus}
                        onClick={() => {
                          close();
                          run((c) => c.setTextAlign(a.align));
                        }}
                        data-track={`docs:align-${a.align}`}
                        className="docs-tb-btn"
                      >
                        <a.Icon />
                      </button>
                    ))}
                  </div>
                )}
              </DropBtn>
              <SpacingMenu editor={editor} para={s.para} pageless={pageless} disabled={off} />
              <ListButtons editor={editor} lists={s.lists} disabled={off} />
            </>
          ),
        },
        {
          key: "indent",
          // Docs keeps a separator here that it never draws.
          sep: false,
          content: (
            <>
              <Btn
                label={t("docs.decreaseIndent")}
                tip={withKeys(t("docs.decreaseIndent"), "Mod+[")}
                track="indent-decrease"
                onClick={() => run((c) => c.indentStep(-1))}
              >
                <IndentDecreaseIcon />
              </Btn>
              <Btn
                label={t("docs.increaseIndent")}
                tip={withKeys(t("docs.increaseIndent"), "Mod+]")}
                track="indent-increase"
                onClick={() => run((c) => c.indentStep(1))}
              >
                <IndentIncreaseIcon />
              </Btn>
              <Btn
                label={t("docs.clearFormatting")}
                tip={withKeys(t("docs.clearFormatting"), "Mod+\\")}
                track="clear-formatting"
                onClick={() => run((c) => c.clearFormatting())}
              >
                <ClearFormattingIcon />
              </Btn>
            </>
          ),
        },
      ];

  const hideLabel = t(headerHidden ? "docs.showMenus" : "docs.hideMenus");
  return (
    <>
      <ToolbarRow
        groups={groups}
        foldable={canEdit}
        label={t("docs.toolbar")}
        moreLabel={t("docs.more")}
        pageless={pageless}
        onEscape={focusPage}
        right={(folded) => (
          <>
            {aiControls}
            {canEdit && (
              <>
                <Sep className="docs-tb-mode-sep" />
                <ModeSwitcher mode={mode} onMode={onMode} folded={folded} />
              </>
            )}
            <Btn label={hideLabel} tip={withKeys(hideLabel, "Ctrl+Shift+F")} track="hide-menus" onClick={onToggleHeader}>
              {headerHidden ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </Btn>
          </>
        )}
      />
      {customFor && (
        <CustomColorDialog
          initial={(customFor === "text" ? s.color : s.highlight) ?? "#000000"}
          onClose={() => {
            setCustomFor(null);
            focusPage();
          }}
          onApply={(hex) => {
            addCustomColor(hex);
            const kind = customFor;
            setCustomFor(null);
            applyColor(kind, hex);
          }}
        />
      )}
    </>
  );
}

/** The named style of the paragraph the selection starts in. */
export function currentStyle(editor: Editor): DocStyle {
  const { $from } = editor.state.selection;
  return $from.parent.isTextblock ? blockStyle($from.parent) : "normal";
}
