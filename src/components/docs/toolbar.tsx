"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useT } from "@/components/lang-provider";
import { docsCommands, type DocsMenu } from "@/components/docs/commands";
import type { ParagraphFlag } from "@/components/docs/ext/toolbar";
import { DOCS_EVENT, stepSelectionFontSize } from "@/components/docs/extensions";
import { DOCS_FONTS, pushRecentFont, userFonts } from "@/components/docs/fonts";
import {
  AddCommentIcon,
  AddIcon,
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  BulletListIcon,
  ChecklistIcon,
  ClearFormattingIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  HighlightGlyph,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  PaintFormatIcon,
  PrintIcon,
  RedoIcon,
  RemoveIcon,
  SpellcheckIcon,
  TextColorGlyph,
  UnderlineIcon,
  UndoIcon,
} from "@/components/docs/icons";
import { BorderButtons, ColorButton } from "@/components/docs/insert/colors";
import { emitInsert } from "@/components/docs/insert/context";
import { FillIcon } from "@/components/docs/insert/icons";
import { borderTarget, cellBorder, selectedCells } from "@/components/docs/insert/table";
import { isMac, keys, matchesCombo, withKeys } from "@/components/docs/keys";
import { keepFocus, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { addCustomColor, ColorMenu } from "@/components/docs/palette";
import { Btn, DropBtn, OPEN_MENU_EVENT, Sep, SplitButton } from "@/components/docs/toolbar/controls";
import { CustomColorDialog } from "@/components/docs/toolbar/custom-color";
import { FontSelect } from "@/components/docs/toolbar/font-menu";
import { FontSizeBox, formatSize, parseSize } from "@/components/docs/toolbar/font-size";
import { ImageMenu, type ImageSource } from "@/components/docs/toolbar/image-menu";
import { IndentDialog } from "@/components/docs/toolbar/indent-dialog";
import { ChecklistPalette, PresetGrid, RestartNumberingDialog } from "@/components/docs/toolbar/list-menus";
import { BULLET_PRESETS, continueNumbering, currentListStyle, NUMBER_PRESETS, numberedLine } from "@/components/docs/toolbar/lists";
import { ModeSwitcher, type DocsMode } from "@/components/docs/toolbar/mode";
import { ToolbarRow, type ToolbarGroup } from "@/components/docs/toolbar/overflow";
import { usePaintFormat } from "@/components/docs/toolbar/paint-format";
import { SEARCH_MENUS_EVENT, SearchMenus, type SearchAction } from "@/components/docs/toolbar/search-menus";
import {
  LINE_SPACINGS,
  PARAGRAPH_FLAGS,
  setLineSpacing,
  setSpace,
  SpacingMenu,
  toggleFlag,
  type ParagraphState,
} from "@/components/docs/toolbar/spacing";
import { STYLE_KEYS, STYLE_LABEL, StylesSelect, menuStyles, styleOptions } from "@/components/docs/toolbar/styles-menu";
import {
  blockStyle,
  deepestHeading,
  readStyles,
  selectionFont,
  selectionSize,
  selectionStyle,
  updateStyleToMatch,
  type Align,
} from "@/components/docs/toolbar/styles";
import { ZoomBox, ZOOMS, type Zoom } from "@/components/docs/toolbar/zoom";
import { TYPING_EVENT } from "@/components/docs/typing/events";
import type { TKey } from "@/lib/i18n/dictionaries";

// The page editor's toolbar (SPEC.md §29): Google Docs' controls in Google's
// order, then the Unitos tools, the mode switcher, and Hide the menus. In
// Viewing mode, and for a reader who may not edit, the left side is Print,
// Add comment, and Zoom.

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

/** Google Docs' Format submenu of the lists: the list menus and List options. */
const BULLETS = "bullets & numbering";

const ALIGNS: { align: Align; key: TKey; combo: string; Icon: typeof AlignLeftIcon; words: string[] }[] = [
  { align: "left", key: "docs.alignLeft", combo: "Mod+Shift+L", Icon: AlignLeftIcon, words: ["align left", "left alignment"] },
  { align: "center", key: "docs.alignCenter", combo: "Mod+Shift+E", Icon: AlignCenterIcon, words: ["align center", "center alignment"] },
  { align: "right", key: "docs.alignRight", combo: "Mod+Shift+R", Icon: AlignRightIcon, words: ["align right", "right alignment"] },
  { align: "justify", key: "docs.alignJustify", combo: "Mod+Shift+J", Icon: AlignJustifyIcon, words: ["justified", "align justified", "justified alignment"] },
];

/** The toolbar menus Search the menus opens, by their DropBtn id, and the
    Google Docs menu each lives in when not Format. */
const MENUS: [string, TKey, string[], DocsMenu?][] = [
  ["styles", "docs.styles", ["paragraph styles"]],
  ["font", "docs.font", ["typeface", "more fonts", "get fonts"]],
  ["text-color", "docs.textColor", ["font color", "colour"]],
  ["highlight-color", "docs.highlightColor", ["background color", "marker"]],
  ["image", "docs.insertImage", ["picture", "photo", "add a photo", "add a picture", "add an image", "upload from computer", "by url"], "insert"],
  ["align", "docs.align", ["align & indent", "alignment"]],
  ["line-spacing", "docs.customSpacing", ["line spacing", "paragraph spacing", "set line spacing", "change line spacing", "custom space"]],
  ["checklist", "docs.checklistMenu", ["checklist styles", BULLETS, "create checklist", "insert checklist", "todo", "task", "action item", "strikethrough when checked", "don't strikethrough when checked"]],
  ["bulleted-list", "docs.bulletedListMenu", ["bullet styles", BULLETS, "apply bulleted list", "toggle bulleted list", "start bulleted list"]],
  ["numbered-list", "docs.numberedListMenu", ["numbering styles", BULLETS, "apply numbered list", "toggle numbered list", "start numbered list"]],
];

/** An action a button runs and Search the menus finds; `on: false` is off. */
type Act = { id: string; key: TKey; combo?: string; Icon?: typeof UndoIcon; where?: DocsMenu; words?: string[]; run: () => void; on?: boolean };

/** What the toolbar shows for the selection, read on every change. */
function readToolbar(e: Editor) {
  const state = e.state;
  const styles = readStyles(state.doc);
  const block = state.selection.$from.parent;
  const named = styles[block.isTextblock ? blockStyle(block) : "normal"];
  const heading = block.type.name === "heading" || Boolean(block.attrs.docStyle);
  const num = (name: string, fallback: number) => (typeof block.attrs[name] === "number" ? (block.attrs[name] as number) : fallback);
  const styleFlags: Record<ParagraphFlag, boolean> = {
    keepWithNext: heading,
    keepLinesTogether: heading,
    preventSingleLines: true,
    pageBreakBefore: false,
  };
  const flag = (name: ParagraphFlag) => (typeof block.attrs[name] === "boolean" ? (block.attrs[name] as boolean) : styleFlags[name]);
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
  const cell = selectedCells(state)[0];
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
    align: (["left", "center", "right", "justify"].includes(align) ? align : named.align) as Align,
    para,
    // Each kind's preset around the selection: undefined outside such a list.
    lists: {
      bulletList: currentListStyle(state, "bulletList"),
      orderedList: currentListStyle(state, "orderedList"),
      taskList: currentListStyle(state, "taskList"),
    },
    // The caret's cell: the table's buttons show while the caret is in a table.
    table: cell ? { background: (cell.node.attrs.backgroundColor as string | null) ?? null, border: cellBorder(state, borderTarget(e)) } : null,
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
  const [dialog, setDialog] = useState<"indent" | "numbering" | null>(null);
  const off = mode === "viewing" || !canEdit;
  // At once, not on the next frame as editor.commands.focus() does, so a key
  // pressed right after (Alt+/ again) keeps its own target.
  const focusPage = () => {
    if (!editor.isDestroyed) editor.view.focus();
  };
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();
  const fire = (name: string) => window.dispatchEvent(new CustomEvent(name));
  // File > Rename: the title row shows, and its field takes the focus.
  const rename = () => {
    if (headerHidden) flushSync(onToggleHeader);
    editor.view.dom.closest("[data-docs-editor]")?.querySelector<HTMLInputElement>(".docs-title-input")?.focus();
  };
  const closeDialog = () => {
    setDialog(null);
    focusPage();
  };

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
      const search = isMac()
        ? matchesCombo(e, "Alt+/") || matchesCombo(e, "Ctrl+Alt+Z")
        : matchesCombo(e, "Alt+/") || matchesCombo(e, "Alt+Z") || matchesCombo(e, "Alt+Shift+Z");
      if (search) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent(SEARCH_MENUS_EVENT));
        return;
      }
      if (!modeRef.current.canEdit) return;
      if (matchesCombo(e, "Mod+Alt+Shift+Z")) {
        e.preventDefault();
        modeRef.current.onMode("editing");
      } else if (matchesCombo(e, "Mod+Alt+Shift+C") || matchesCombo(e, "Mod+Alt+Shift+D")) {
        e.preventDefault();
        modeRef.current.onMode("viewing");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor]);

  const applyColor = (kind: "text" | "highlight", hex: string | null) => {
    // Black is the page's own text color: in dark mode it draws light.
    if (kind === "text") run((c) => (!hex || hex === "#000000" ? c.unsetColor() : c.setColor(hex)));
    else run((c) => (hex ? c.setBackgroundColor(hex) : c.unsetBackgroundColor()));
  };

  const A = {
    undo: { id: "undo", key: "docs.undo", combo: "Mod+Z", Icon: UndoIcon, where: "edit", run: () => run((c) => c.undo()), on: s.canUndo },
    redo: { id: "redo", key: "docs.redo", combo: "Mod+Y", Icon: RedoIcon, where: "edit", run: () => run((c) => c.redo()), on: s.canRedo },
    print: { id: "print", key: "docs.print", combo: "Mod+P", Icon: PrintIcon, where: "file", words: ["printer", "print preview"], run: () => window.print() },
    spelling: { id: "spelling", key: "docs.spellcheck", combo: "Mod+Alt+X", Icon: SpellcheckIcon, where: "tools", run: () => fire(TYPING_EVENT.spelling) },
    paint: { id: "paint-format", key: "docs.paintFormat", Icon: PaintFormatIcon, words: ["copy formatting"], run: paint.press },
    bold: { id: "bold", key: "docs.bold", combo: "Mod+B", Icon: BoldIcon, words: ["strong", "dark"], run: () => run((c) => c.toggleBold()) },
    italic: { id: "italic", key: "docs.italic", combo: "Mod+I", Icon: ItalicIcon, words: ["emphasis", "emphasized", "italicize"], run: () => run((c) => c.toggleItalic()) },
    underline: { id: "underline", key: "docs.underline", combo: "Mod+U", Icon: UnderlineIcon, run: () => run((c) => c.toggleUnderline()) },
    link: { id: "link", key: "docs.insertLink", combo: "Mod+K", Icon: LinkIcon, where: "insert", words: ["hyperlink", "url"], run: () => fire(DOCS_EVENT.link) },
    comment: { id: "comment", key: "docs.addComment", combo: "Mod+Alt+M", Icon: AddCommentIcon, where: "insert", run: () => fire(DOCS_EVENT.comment), on: canEdit },
    outdent: {
      id: "indent-decrease",
      key: "docs.decreaseIndent",
      combo: "Mod+[",
      Icon: IndentDecreaseIcon,
      words: ["decrease paragraph indent", "unindent", "outdent", "dedent"],
      run: () => run((c) => c.indentStep(-1)),
    },
    indent: { id: "indent-increase", key: "docs.increaseIndent", combo: "Mod+]", Icon: IndentIncreaseIcon, words: ["tab", "increase paragraph indent"], run: () => run((c) => c.indentStep(1)) },
    clear: { id: "clear-formatting", key: "docs.clearFormatting", combo: "Mod+\\", Icon: ClearFormattingIcon, words: ["remove formatting"], run: () => run((c) => c.clearFormatting()) },
    sizeDown: {
      id: "font-size-down",
      key: "docs.decreaseFontSize",
      combo: "Mod+Shift+,",
      Icon: RemoveIcon,
      words: ["smaller", "make the font smaller", "make it smaller"],
      run: () => stepSelectionFontSize(editor, -1),
    },
    sizeUp: {
      id: "font-size-up",
      key: "docs.increaseFontSize",
      combo: "Mod+Shift+.",
      Icon: AddIcon,
      words: ["bigger", "make the font bigger", "make it bigger", "larger"],
      run: () => stepSelectionFontSize(editor, 1),
    },
    checklist: { id: "checklist", key: "docs.checklist", combo: "Mod+Shift+9", Icon: ChecklistIcon, run: () => run((c) => c.toggleTaskList()) },
    bulleted: {
      id: "bulleted-list",
      key: "docs.bulletedList",
      combo: "Mod+Shift+8",
      Icon: BulletListIcon,
      words: ["circles", "create bulleted list", "insert bulleted list"],
      run: () => run((c) => c.toggleBulletList()),
    },
    numbered: {
      id: "numbered-list",
      key: "docs.numberedList",
      combo: "Mod+Shift+7",
      Icon: NumberedListIcon,
      words: ["numbers", "123", "create numbered list", "insert numbered list"],
      run: () => run((c) => c.toggleOrderedList()),
    },
  } satisfies Record<string, Act>;
  const split = (a: Act, pressed: boolean, menuKey: TKey, menu: (close: () => void) => ReactNode) => (
    <SplitButton
      id={a.id}
      label={t(a.key)}
      tip={withKeys(t(a.key), a.combo)}
      menuLabel={t(menuKey)}
      pressed={pressed}
      onToggle={a.run}
      icon={a.Icon && <a.Icon />}
      track={a.id}
    >
      {menu}
    </SplitButton>
  );
  const button = (a: Act, pressed?: boolean) => (
    <Btn label={t(a.key)} tip={withKeys(t(a.key), a.combo)} track={a.id} pressed={pressed} disabled={a.on === false} onClick={a.run}>
      {a.Icon && <a.Icon />}
    </Btn>
  );

  // Search the menus: the toolbar's actions, then the areas' commands (an
  // area's own command wins over a toolbar action of the same name).
  const actions = (): SearchAction[] => {
    const registered: SearchAction[] = docsCommands().map((c) => ({
      id: c.id,
      label: t(c.label),
      where: t(MENU_NAMES[c.menu]),
      keywords: c.keywords,
      shortcut: c.shortcut ? keys(c.shortcut) : undefined,
      enabled: c.enabled ? c.enabled(editor) : true,
      run: () => c.run(editor),
    }));
    const edits = (a: Act) => a.where === "file" || a.where === "tools" || a.id === "comment";
    const own: Act[] = [
      ...Object.values(A).map((a: Act) => ({ ...a, on: a.on !== false && (edits(a) || !off) })),
      ...ALIGNS.map((a) => ({ id: `align-${a.align}`, key: a.key, combo: a.combo, Icon: a.Icon, words: a.words, run: () => run((c) => c.setTextAlign(a.align)), on: !off })),
      ...MENUS.map(([id, key, words, where]) => ({ id: `open-${id}`, key, words, where, run: () => window.dispatchEvent(new CustomEvent(OPEN_MENU_EVENT, { detail: { id } })), on: !off })),
    ];
    const list: SearchAction[] = own.map((a) => ({
      id: a.id,
      label: t(a.key),
      where: t(MENU_NAMES[a.where ?? "format"]),
      keywords: a.words,
      shortcut: a.combo ? keys(a.combo) : undefined,
      icon: a.Icon && <a.Icon />,
      enabled: a.on !== false,
      run: a.run,
    }));
    const add = (id: string, label: string, where: DocsMenu, runIt: () => void, o: { enabled?: boolean; shortcut?: string; words?: string[] } = {}) =>
      list.push({ id, label, where: t(MENU_NAMES[where]), run: runIt, enabled: o.enabled ?? !off, shortcut: o.shortcut && keys(o.shortcut), keywords: o.words });
    add("zoom-fit", `${t("docs.zoom")}: ${t("docs.zoomFit")}`, "view", () => onZoom("fit"), { enabled: true });
    for (const z of ZOOMS) add(`zoom-${z}`, t("docs.zoomValue", { n: z }), "view", () => onZoom(z), { enabled: true });
    for (const style of menuStyles(6)) {
      const name = t(STYLE_LABEL[style]);
      // Docs' own words: Apply 'Heading 1', apply h1, apply header 1.
      const words = [t("docs.applyStyle", { name })];
      if (style[0] === "h") words.push(`apply ${style}`, `apply header ${style[1]}`);
      else if (style !== "normal") words.push(`apply ${style} style`);
      add(`style-${style}`, name, "format", () => run((c) => c.setDocStyle(style)), { shortcut: STYLE_KEYS[style], words });
      add(`update-${style}`, t("docs.updateStyle", { name }), "format", () => updateStyleToMatch(editor, style));
    }
    for (const o of styleOptions(editor, t)) add(o.key, t(o.key), "format", o.run, { words: o.words });
    for (const { value, key, words } of LINE_SPACINGS) add(`spacing-${value}`, `${t("docs.lineSpacing")}: ${t(key)}`, "format", () => setLineSpacing(editor, s.para, value), { words });
    const before = s.para.spaceBefore > 0;
    const after = s.para.spaceAfter > 0;
    add("space-before", t(before ? "docs.removeSpaceBefore" : "docs.addSpaceBefore"), "format", () => setSpace(editor, s.para, "before", before ? 0 : 10));
    add("space-after", t(after ? "docs.removeSpaceAfter" : "docs.addSpaceAfter"), "format", () => setSpace(editor, s.para, "after", after ? 0 : 10));
    if (!pageless) for (const { flag, key, words } of PARAGRAPH_FLAGS) add(flag, t(key), "format", () => toggleFlag(editor, s.para, flag), { words });
    add("indentation-options", t("docs.indentationOptions"), "format", () => setDialog("indent"), { words: ["hanging indent", "first line indent"] });
    // List options: Restart numbering asks for the number; the right-click
    // menu's restarts at 1.
    const listWords = ["list options", BULLETS];
    add("restart-numbering", t("docs.restartNumbering"), "format", () => setDialog("numbering"), {
      enabled: !off && numberedLine(editor.state) !== null,
      words: ["start over", "renumber", ...listWords],
    });
    add("continue-numbering", t("docs.continueNumbering"), "format", () => continueNumbering(editor.state, editor.view.dispatch), {
      enabled: !off && continueNumbering(editor.state),
      words: ["maintain numbering", "join list", "continue preceding list", "continue previous list", "combine list", ...listWords],
    });
    add("rename", t("docs.renameTitle"), "file", rename, { enabled: canEdit, words: ["title", "save as"] });
    if (canEdit) {
      add("mode-editing", t("docs.editingMode"), "view", () => onMode("editing"), {
        enabled: true,
        shortcut: "Mod+Alt+Shift+Z",
        words: ["switch to editing", "return to editing"],
      });
      add("mode-viewing", t("docs.viewingMode"), "view", () => onMode("viewing"), { enabled: true, shortcut: "Mod+Alt+Shift+C", words: ["switch to viewing"] });
    }
    add("menus", t(headerHidden ? "docs.showMenus" : "docs.hideMenus"), "view", onToggleHeader, { enabled: true, shortcut: "Ctrl+Shift+F", words: ["compact mode", "compact controls"] });
    const taken = new Set(registered.map((c) => c.label.toLowerCase()));
    return [...list.filter((a) => !taken.has(a.label.toLowerCase())), ...registered];
  };

  // A typed value: "font size 14" or "14", "zoom 150", a face's name.
  const valueActions = (query: string): SearchAction[] => {
    const q = query.trim().toLowerCase();
    const format = t("docs.menuFormat");
    const out: SearchAction[] = [];
    const size = parseSize(/^(?:font\s*size|size)?\s*(\d+(?:\.\d+)?)\s*(?:pt)?$/.exec(q)?.[1] ?? "");
    if (size !== null && !off) {
      out.push({ id: "size", label: t("docs.fontSizeValue", { n: formatSize(size) }), where: format, run: () => run((c) => c.setFontSize(`${size}pt`)) });
    }
    const z = /^zoom\s*(\d+)\s*%?$/.exec(q);
    if (z) {
      const n = Math.max(50, Math.min(200, parseInt(z[1], 10)));
      out.push({ id: "zoom", label: t("docs.zoomValue", { n }), where: t("docs.menuView"), run: () => onZoom(n) });
    }
    const face = q.replace(/^font\s+/, "");
    if (face.length >= 2 && !off) {
      const names = [...DOCS_FONTS, ...userFonts()].map((f) => f.name).filter((n) => n.toLowerCase().startsWith(face));
      for (const name of names.slice(0, 5)) {
        out.push({
          id: `font-${name}`,
          label: t("docs.fontValue", { name }),
          where: format,
          run: () => {
            pushRecentFont(name);
            run((c) => c.setFontFamily(name));
          },
        });
      }
    }
    return out;
  };

  const zoomBox = <ZoomBox zoom={zoom} onZoom={onZoom} onDone={focusPage} />;
  const textBar = s.color ?? (s.styleColor !== "#000000" ? s.styleColor : "var(--docs-ink)");
  const colorButton = (kind: "text" | "highlight") => {
    const text = kind === "text";
    return (
      <DropBtn
        id={text ? "text-color" : "highlight-color"}
        label={t(text ? "docs.textColor" : "docs.highlightColor")}
        track={text ? "text-color" : "highlight-color"}
        arrow={false}
        className="docs-tb-menu-btn"
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
  const AlignGlyph = ALIGNS.find((a) => a.align === s.align)?.Icon ?? AlignLeftIcon;

  const groups: ToolbarGroup[] = off
    ? [
        {
          key: "view",
          sep: false,
          content: (
            <>
              {button(A.print)}
              {canEdit && button(A.comment)}
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
              {button(A.undo)}
              {button(A.redo)}
              {button(A.print)}
              {button(A.spelling)}
              {button(A.paint, paint.active)}
              {zoomBox}
            </>
          ),
        },
        {
          key: "styles",
          sep: true,
          menus: ["styles"],
          content: <StylesSelect editor={editor} style={s.style} styles={s.styles} deepest={s.deepest} />,
        },
        { key: "font", sep: true, menus: ["font"], content: <FontSelect editor={editor} font={s.font} /> },
        {
          key: "size",
          sep: true,
          content: (
            <div className="docs-size">
              {button(A.sizeDown)}
              <FontSizeBox editor={editor} size={s.size} />
              {button(A.sizeUp)}
            </div>
          ),
        },
        {
          key: "text",
          sep: true,
          menus: ["text-color", "highlight-color"],
          content: (
            <>
              {button(A.bold, s.bold)}
              {button(A.italic, s.italic)}
              {button(A.underline, s.underline)}
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
              {button(A.link)}
              {button(A.comment)}
              <ImageMenu onInsert={onInsertImage} onDone={focusPage} />
            </>
          ),
        },
        {
          key: "paragraph",
          sep: true,
          menus: ["align", "line-spacing", "checklist", "bulleted-list", "numbered-list"],
          content: (
            <>
              <DropBtn id="align" label={t("docs.align")} track="align" className="docs-tb-align" menuClassName="docs-menu-align" face={<AlignGlyph />}>
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
              <SpacingMenu editor={editor} para={s.para} pageless={pageless} />
              {split(A.checklist, s.lists.taskList !== undefined, "docs.checklistMenu", (close) => (
                <ChecklistPalette editor={editor} current={s.lists.taskList} close={close} />
              ))}
              {split(A.bulleted, s.lists.bulletList !== undefined, "docs.bulletedListMenu", (close) => (
                <>
                  <PresetGrid editor={editor} presets={BULLET_PRESETS} current={s.lists.bulletList} close={close} />
                  <MenuSeparator />
                  <MenuItem
                    submenuClassName="docs-menu-lists"
                    submenu={<ChecklistPalette editor={editor} current={s.lists.taskList} close={close} />}
                  >
                    {t("docs.checklistMenu")}
                  </MenuItem>
                </>
              ))}
              {split(A.numbered, s.lists.orderedList !== undefined, "docs.numberedListMenu", (close) => (
                <PresetGrid editor={editor} presets={NUMBER_PRESETS} current={s.lists.orderedList} close={close} />
              ))}
            </>
          ),
        },
        {
          key: "indent",
          // Docs keeps a separator here that it never draws; the table's
          // buttons join this group, as in Docs.
          sep: false,
          content: (
            <>
              {button(A.outdent)}
              {button(A.indent)}
              {button(A.clear)}
              {s.table && (
                <>
                  <ColorButton
                    label={t("docsInsert.backgroundColor")}
                    track="table-background"
                    face={<FillIcon />}
                    current={s.table.background}
                    onPick={(hex) => run((c) => c.setCellsAttrs({ backgroundColor: hex }))}
                    onNone={() => run((c) => c.setCellsAttrs({ backgroundColor: null }))}
                  />
                  <BorderButtons track="table" border={s.table.border} onChange={(spec) => run((c) => c.setTableBorders(borderTarget(editor), spec))} />
                  <Btn label={t("docsInsert.tableOptions")} track="table-options" className="docs-tb-text-btn" onClick={() => emitInsert(editor, { type: "table-options" })}>
                    {t("docsInsert.tableOptions")}
                  </Btn>
                </>
              )}
            </>
          ),
        },
      ];

  const hideLabel = t(headerHidden ? "docs.showMenus" : "docs.hideMenus");
  return (
    <>
      <ToolbarRow
        groups={groups}
        label={t("docs.toolbar")}
        moreLabel={t("docs.more")}
        pageless={pageless}
        onEscape={focusPage}
        right={
          <>
            {aiControls && <div className="docs-tb-unitos">{aiControls}</div>}
            {canEdit && (
              <>
                <Sep className="docs-tb-mode-sep" />
                <ModeSwitcher mode={mode} onMode={onMode} />
              </>
            )}
            <Btn label={hideLabel} tip={withKeys(hideLabel, "Ctrl+Shift+F")} track="hide-menus" onClick={onToggleHeader}>
              {headerHidden ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </Btn>
          </>
        }
      />
      {dialog === "indent" && <IndentDialog editor={editor} onClose={closeDialog} />}
      {dialog === "numbering" && <RestartNumberingDialog editor={editor} onClose={closeDialog} />}
      {customFor && (
        <CustomColorDialog
          initial={(customFor === "text" ? s.color : s.highlight) ?? "#000000"}
          onClose={() => {
            setCustomFor(null);
            focusPage();
          }}
          onApply={(hex) => {
            addCustomColor(hex);
            setCustomFor(null);
            applyColor(customFor, hex);
          }}
        />
      )}
    </>
  );
}
