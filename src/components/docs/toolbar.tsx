"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { currentFontSize, DOCS_EVENT, FONT_SIZES, stepFontSize, type DocStyle } from "@/components/docs/extensions";
import { DOCS_FONTS, firstFamily, fontStack } from "@/components/docs/fonts";
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
  DropDownIcon,
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
  MoreVertIcon,
  NumberedListIcon,
  PaintFormatIcon,
  PrintIcon,
  RedoIcon,
  RemoveIcon,
  SpellcheckIcon,
  TextColorGlyph,
  UnderlineIcon,
  UndoIcon,
  ViewIcon,
} from "@/components/docs/icons";
import { keys, withKeys } from "@/components/docs/keys";
import { DropdownPanel, keepFocus, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { ColorPalette } from "@/components/docs/palette";
import type { TKey } from "@/lib/i18n/dictionaries";

// The page editor's toolbar (SPEC.md §29): Google Docs' toolbar, left to
// right — undo, redo, print, spelling, paint format, zoom; the paragraph
// style, the font, the size; bold, italic, underline, text color, highlight;
// link, comment, image; align, line spacing, checklist, bullets, numbers,
// indent, clear formatting — and at the right the Unitos tools, the mode,
// and the button that hides the title row. Every button keeps the page's
// selection (menu.tsx keepFocus).

export type DocsMode = "editing" | "viewing";

export const ZOOMS = [50, 75, 90, 100, 125, 150, 200] as const;
/** "fit" fits the page to the window's width. */
export type Zoom = number | "fit";

const STYLE_KEYS: { style: DocStyle; key: TKey }[] = [
  { style: "normal", key: "docs.styleNormal" },
  { style: "title", key: "docs.styleTitle" },
  { style: "subtitle", key: "docs.styleSubtitle" },
  { style: "h1", key: "docs.styleHeading1" },
  { style: "h2", key: "docs.styleHeading2" },
  { style: "h3", key: "docs.styleHeading3" },
  { style: "h4", key: "docs.styleHeading4" },
  { style: "h5", key: "docs.styleHeading5" },
  { style: "h6", key: "docs.styleHeading6" },
];

/** Each style's size in points when no run sets one (Google Docs' defaults). */
export const STYLE_SIZE: Record<DocStyle, number> = {
  normal: 11,
  title: 26,
  subtitle: 15,
  h1: 20,
  h2: 16,
  h3: 14,
  h4: 12,
  h5: 11,
  h6: 11,
};

export function currentStyle(editor: Editor): DocStyle {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  const docStyle = editor.getAttributes("paragraph").docStyle as string | null;
  return docStyle === "title" || docStyle === "subtitle" ? docStyle : "normal";
}

function currentAlign(editor: Editor): "left" | "center" | "right" | "justify" {
  for (const a of ["center", "right", "justify"] as const) if (editor.isActive({ textAlign: a })) return a;
  return "left";
}

function paragraphAttr(editor: Editor, name: string): unknown {
  const para = editor.getAttributes("paragraph")[name];
  if (para !== undefined && para !== null) return para;
  return editor.getAttributes("heading")[name] ?? null;
}

function Btn({
  label,
  onClick,
  onDoubleClick,
  pressed,
  disabled,
  children,
  track,
  wide,
}: {
  label: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  track: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      data-track={`docs:${track}`}
      className={`docs-tb-btn${wide ? " docs-tb-wide" : ""}`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden className="docs-tb-sep" />;
}

/** A button whose press opens a panel under it. */
function DropBtn({
  label,
  face,
  track,
  children,
  wide,
  pressed,
  panelClass,
  disabled,
}: {
  label: string;
  face: ReactNode;
  track: string;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
  pressed?: boolean;
  panelClass?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        data-tip={open ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={pressed === undefined ? undefined : pressed}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
        data-track={`docs:${track}`}
        className={`docs-tb-btn docs-tb-drop${wide ? " docs-tb-wide" : ""}${open ? " docs-tb-open" : ""}`}
      >
        {face}
        <DropDownIcon size={18} className="docs-tb-caret" />
      </button>
      <DropdownPanel open={open} anchorRef={anchorRef} onClose={close} className={panelClass}>
        {children(close)}
      </DropdownPanel>
    </>
  );
}

/** The size box: −, the size, +; the list of sizes opens from the box. */
function FontSizeControl({ editor, size, disabled }: { editor: Editor; size: number | null; disabled: boolean }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const apply = (n: number) => {
    const clamped = Math.max(1, Math.min(400, Math.round(n * 2) / 2));
    editor.chain().focus().setFontSize(`${clamped}pt`).run();
  };
  const shown = draft ?? (size === null ? "" : String(size));
  return (
    <div className="docs-size">
      <Btn
        label={withKeys(t("docs.decreaseFontSize"), "Mod+Shift+,")}
        track="font-size-down"
        disabled={disabled}
        onClick={() => apply(stepFontSize(size ?? 11, -1))}
      >
        <RemoveIcon size={18} />
      </Btn>
      <input
        ref={inputRef}
        value={shown}
        disabled={disabled}
        aria-label={t("docs.fontSize")}
        data-tip={t("docs.fontSize")}
        inputMode="decimal"
        onFocus={(e) => {
          e.currentTarget.select();
          setListOpen(true);
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const n = Number(draft);
            if (Number.isFinite(n) && n > 0) apply(n);
            setDraft(null);
            setListOpen(false);
          } else if (e.key === "Escape") {
            setDraft(null);
            setListOpen(false);
            editor.commands.focus();
          }
        }}
        onBlur={() => {
          const n = Number(draft);
          if (draft !== null && Number.isFinite(n) && n > 0) apply(n);
          setDraft(null);
        }}
        className="docs-size-input"
      />
      <DropdownPanel open={listOpen} anchorRef={inputRef} onClose={() => setListOpen(false)} className="docs-menu-narrow">
        {FONT_SIZES.map((s) => (
          <MenuItem
            key={s}
            checked={s === size}
            onSelect={() => {
              apply(s);
              setDraft(null);
              setListOpen(false);
            }}
          >
            {s}
          </MenuItem>
        ))}
      </DropdownPanel>
      <Btn
        label={withKeys(t("docs.increaseFontSize"), "Mod+Shift+.")}
        track="font-size-up"
        disabled={disabled}
        onClick={() => apply(stepFontSize(size ?? 11, 1))}
      >
        <AddIcon size={18} />
      </Btn>
    </div>
  );
}

/** Paint format: a press copies the formatting under the caret and the
    next selection takes it; a double press keeps it on until Escape or a
    third press. */
function usePaintFormat(editor: Editor) {
  const [paint, setPaint] = useState<{ marks: { type: string; attrs: Record<string, unknown> }[]; locked: boolean } | null>(
    null,
  );
  useEffect(() => {
    const dom = editor.view.dom;
    if (!paint) {
      dom.classList.remove("docs-painting");
      return;
    }
    dom.classList.add("docs-painting");
    const onUp = () => {
      setTimeout(() => {
        if (editor.state.selection.empty) return;
        const chain = editor.chain().focus().unsetAllMarks();
        for (const m of paint.marks) chain.setMark(m.type, m.attrs);
        chain.run();
        if (!paint.locked) setPaint(null);
      }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaint(null);
    };
    dom.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [editor, paint]);
  const capture = (locked: boolean) => {
    const marks = editor.state.selection.$from.marks().map((m) => ({ type: m.type.name, attrs: { ...m.attrs } }));
    setPaint({ marks, locked });
  };
  return {
    active: paint !== null,
    press: () => (paint ? setPaint(null) : capture(false)),
    lock: () => capture(true),
  };
}

/** The toolbar's groups in one row. When the row is too narrow, the groups
    at its right end fold into More (⋮), which opens them in a row below —
    Google Docs' overflow. */
function ToolbarRow({ children, moreLabel }: { children: ReactNode[]; moreLabel: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(children.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const fit = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    groupRefs.current.forEach((el, i) => {
      if (el) widths.current[i] = el.offsetWidth;
    });
    const available = row.clientWidth;
    const MORE = 36;
    let total = 0;
    let count = 0;
    for (let i = 0; i < children.length; i++) {
      const w = widths.current[i];
      if (w === undefined) {
        count = children.length;
        break;
      }
      const room = i < children.length - 1 ? MORE : 0;
      if (total + w + room > available) break;
      total += w;
      count = i + 1;
    }
    setShown(count);
  }, [children.length]);
  useLayoutEffect(() => {
    fit();
  });
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(row);
    return () => observer.disconnect();
  }, [fit]);
  const hidden = children.slice(shown);
  return (
    <div ref={rowRef} className="docs-toolbar-scroll">
      {children.slice(0, shown).map((group, i) => (
        <div
          key={i}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
          className="docs-tb-group"
        >
          {i > 0 && <Sep />}
          {group}
        </div>
      ))}
      {hidden.length > 0 && (
        <>
          <button
            ref={moreRef}
            type="button"
            aria-label={moreLabel}
            data-tip={moreOpen ? undefined : moreLabel}
            aria-expanded={moreOpen}
            onMouseDown={keepFocus}
            onClick={() => setMoreOpen((o) => !o)}
            data-track="docs:more"
            className={`docs-tb-btn${moreOpen ? " docs-tb-open" : ""}`}
          >
            <MoreVertIcon />
          </button>
          <DropdownPanel
            open={moreOpen}
            anchorRef={moreRef}
            onClose={() => setMoreOpen(false)}
            placement="below-right"
            className="docs-menu-more"
          >
            <div className="docs-more-row">
              {hidden.map((group, i) => (
                <div key={i} className="docs-tb-group">
                  {i > 0 && <Sep />}
                  {group}
                </div>
              ))}
            </div>
          </DropdownPanel>
        </>
      )}
    </div>
  );
}

export function DocsToolbar({
  editor,
  mode,
  onMode,
  canEdit,
  zoom,
  onZoom,
  spellcheck,
  onSpellcheck,
  aiControls,
  headerHidden,
  onToggleHeader,
  onInsertImage,
}: {
  editor: Editor;
  mode: DocsMode;
  onMode: (mode: DocsMode) => void;
  canEdit: boolean;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  spellcheck: boolean;
  onSpellcheck: (on: boolean) => void;
  aiControls?: ReactNode;
  headerHidden: boolean;
  onToggleHeader: () => void;
  onInsertImage: (source: { file: File } | { url: string }) => void;
}) {
  const t = useT();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = currentStyle(e);
      const marked = e.getAttributes("textStyle").fontSize as string | undefined;
      return {
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        style,
        font: firstFamily(e.getAttributes("textStyle").fontFamily as string | undefined) ?? "Arial",
        size: marked ? currentFontSize(e) : STYLE_SIZE[style],
        color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
        highlight: (e.getAttributes("textStyle").backgroundColor as string | undefined) ?? null,
        align: currentAlign(e),
        lineSpacing: (paragraphAttr(e, "lineSpacing") as number | null) ?? 1.15,
        spaceBefore: (paragraphAttr(e, "spaceBefore") as number | null) ?? 0,
        spaceAfter: (paragraphAttr(e, "spaceAfter") as number | null) ?? 0,
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        task: e.isActive("taskList"),
      };
    },
  });
  const paint = usePaintFormat(editor);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const editing = mode === "editing" && canEdit;
  const off = !editing;
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();
  const styleLabel = t(STYLE_KEYS.find((k) => k.style === s.style)?.key ?? "docs.styleNormal");
  const AlignGlyph = { left: AlignLeftIcon, center: AlignCenterIcon, right: AlignRightIcon, justify: AlignJustifyIcon }[s.align];
  const zoomLabel = zoom === "fit" ? t("docs.zoomFit") : `${zoom}%`;
  const modeIcon = mode === "editing" ? <EditIcon size={18} /> : <ViewIcon size={18} />;

  return (
    <div className="docs-toolbar" role="toolbar" aria-label={t("docs.toolbar")} data-edit-control>
      <ToolbarRow moreLabel={t("docs.more")}>
        {[
        <Fragment key="g0">
        <Btn label={withKeys(t("docs.undo"), "Mod+Z")} track="undo" disabled={off || !s.canUndo} onClick={() => run((c) => c.undo())}>
          <UndoIcon />
        </Btn>
        <Btn label={withKeys(t("docs.redo"), "Mod+Y")} track="redo" disabled={off || !s.canRedo} onClick={() => run((c) => c.redo())}>
          <RedoIcon />
        </Btn>
        <Btn label={withKeys(t("docs.print"), "Mod+P")} track="print" onClick={() => window.print()}>
          <PrintIcon />
        </Btn>
        <Btn
          label={t("docs.spellcheck")}
          track="spellcheck"
          pressed={spellcheck}
          onClick={() => onSpellcheck(!spellcheck)}
        >
          <SpellcheckIcon />
        </Btn>
        <Btn
          label={t("docs.paintFormat")}
          track="paint-format"
          pressed={paint.active}
          disabled={off}
          onClick={paint.press}
          onDoubleClick={paint.lock}
        >
          <PaintFormatIcon />
        </Btn>
        <DropBtn label={t("docs.zoom")} track="zoom" face={<span className="docs-tb-text docs-tb-zoom">{zoomLabel}</span>} wide>
          {(close) => (
            <>
              <MenuItem checked={zoom === "fit"} onSelect={() => { onZoom("fit"); close(); }}>
                {t("docs.zoomFit")}
              </MenuItem>
              <MenuSeparator />
              {ZOOMS.map((z) => (
                <MenuItem key={z} checked={zoom === z} onSelect={() => { onZoom(z); close(); }}>
                  {z}%
                </MenuItem>
              ))}
            </>
          )}
        </DropBtn>
        </Fragment>,
        <Fragment key="g1">
        <DropBtn
          label={t("docs.styles")}
          track="styles"
          disabled={off}
          face={<span className="docs-tb-text docs-tb-style">{styleLabel}</span>}
          wide
          panelClass="docs-menu-styles"
        >
          {(close) =>
            STYLE_KEYS.filter((k) => !["h4", "h5", "h6"].includes(k.style) || k.style === s.style).map((k) => (
              <MenuItem
                key={k.style}
                checked={s.style === k.style}
                shortcut={
                  k.style === "normal"
                    ? keys("Mod+Alt+0")
                    : k.style.startsWith("h")
                      ? keys(`Mod+Alt+${k.style.slice(1)}`)
                      : undefined
                }
                onSelect={() => {
                  editor.chain().focus().setDocStyle(k.style).run();
                  close();
                }}
                track={`docs:style:${k.style}`}
              >
                <span className={`docs-style-preview docs-style-${k.style}`}>{t(k.key)}</span>
              </MenuItem>
            ))
          }
        </DropBtn>
        </Fragment>,
        <Fragment key="g2">
        <DropBtn
          label={t("docs.font")}
          track="font"
          disabled={off}
          face={<span className="docs-tb-text docs-tb-font">{s.font}</span>}
          wide
          panelClass="docs-menu-fonts"
        >
          {(close) =>
            DOCS_FONTS.map((f) => (
              <MenuItem
                key={f.name}
                checked={s.font.toLowerCase() === f.name.toLowerCase()}
                onSelect={() => {
                  if (f.name === "Arial") editor.chain().focus().unsetFontFamily().run();
                  else editor.chain().focus().setFontFamily(f.name).run();
                  close();
                }}
              >
                <span style={{ fontFamily: fontStack(f.name) }}>{f.name}</span>
              </MenuItem>
            ))
          }
        </DropBtn>
        </Fragment>,
        <Fragment key="g3">
        <FontSizeControl editor={editor} size={s.size} disabled={off} />
        </Fragment>,
        <Fragment key="g4">
        <Btn label={withKeys(t("docs.bold"), "Mod+B")} track="bold" pressed={s.bold} disabled={off} onClick={() => run((c) => c.toggleBold())}>
          <BoldIcon />
        </Btn>
        <Btn label={withKeys(t("docs.italic"), "Mod+I")} track="italic" pressed={s.italic} disabled={off} onClick={() => run((c) => c.toggleItalic())}>
          <ItalicIcon />
        </Btn>
        <Btn
          label={withKeys(t("docs.underline"), "Mod+U")}
          track="underline"
          pressed={s.underline}
          disabled={off}
          onClick={() => run((c) => c.toggleUnderline())}
        >
          <UnderlineIcon />
        </Btn>
        <DropBtn
          label={t("docs.textColor")}
          track="text-color"
          disabled={off}
          face={
            <span className="docs-color-face">
              <TextColorGlyph size={18} />
              <span className="docs-color-bar" style={{ background: s.color ?? "#000000" }} />
            </span>
          }
        >
          {(close) => (
            <ColorPalette
              current={s.color}
              resetLabel={t("docs.resetColor")}
              onReset={() => {
                editor.chain().focus().unsetColor().run();
                close();
              }}
              onPick={(hex) => {
                editor.chain().focus().setColor(hex).run();
                close();
              }}
            />
          )}
        </DropBtn>
        <DropBtn
          label={t("docs.highlightColor")}
          track="highlight-color"
          disabled={off}
          face={
            <span className="docs-color-face">
              <HighlightGlyph size={18} />
              <span className="docs-color-bar" style={{ background: s.highlight ?? "transparent" }} />
            </span>
          }
        >
          {(close) => (
            <ColorPalette
              current={s.highlight}
              resetLabel={t("docs.noHighlight")}
              onReset={() => {
                editor.chain().focus().unsetBackgroundColor().run();
                close();
              }}
              onPick={(hex) => {
                editor.chain().focus().setBackgroundColor(hex).run();
                close();
              }}
            />
          )}
        </DropBtn>
        </Fragment>,
        <Fragment key="g5">
        <Btn
          label={withKeys(t("docs.insertLink"), "Mod+K")}
          track="link"
          disabled={off}
          onClick={() => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link))}
        >
          <LinkIcon />
        </Btn>
        <Btn
          label={withKeys(t("docs.addComment"), "Mod+Alt+M")}
          track="comment"
          disabled={!canEdit}
          onClick={() => window.dispatchEvent(new CustomEvent(DOCS_EVENT.comment))}
        >
          <AddCommentIcon />
        </Btn>
        <DropBtn label={t("docs.insertImage")} track="image" disabled={off} face={<ImageIcon />}>
          {(close) => (
            <div className="docs-image-menu">
              <MenuItem
                onSelect={() => {
                  close();
                  fileRef.current?.click();
                }}
              >
                {t("docs.uploadFromComputer")}
              </MenuItem>
              <MenuSeparator />
              <form
                className="docs-image-url"
                onSubmit={(e) => {
                  e.preventDefault();
                  const url = imageUrl.trim();
                  if (!/^https?:\/\//.test(url)) return;
                  onInsertImage({ url });
                  setImageUrl("");
                  close();
                }}
              >
                <label className="docs-field-label" htmlFor="docs-image-url">
                  {t("docs.imageByUrl")}
                </label>
                <input
                  id="docs-image-url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://"
                  className="docs-field"
                />
                <button type="submit" className="docs-button-primary">
                  {t("docs.insertImageAction")}
                </button>
              </form>
            </div>
          )}
        </DropBtn>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onInsertImage({ file });
          }}
        />
        </Fragment>,
        <Fragment key="g6">
        <DropBtn label={t("docs.align")} track="align" disabled={off} face={<AlignGlyph />}>
          {(close) => (
            <div className="docs-align-row">
              {(
                [
                  ["left", AlignLeftIcon, "docs.alignLeft", "Mod+Shift+L"],
                  ["center", AlignCenterIcon, "docs.alignCenter", "Mod+Shift+E"],
                  ["right", AlignRightIcon, "docs.alignRight", "Mod+Shift+R"],
                  ["justify", AlignJustifyIcon, "docs.alignJustify", "Mod+Shift+J"],
                ] as const
              ).map(([a, Glyph, key, combo]) => (
                <Btn
                  key={a}
                  label={withKeys(t(key), combo)}
                  track={`align-${a}`}
                  pressed={s.align === a}
                  onClick={() => {
                    run((c) => c.setTextAlign(a));
                    close();
                  }}
                >
                  <Glyph />
                </Btn>
              ))}
            </div>
          )}
        </DropBtn>
        <DropBtn label={t("docs.lineSpacing")} track="line-spacing" disabled={off} face={<LineSpacingIcon />}>
          {(close) => (
            <>
              {(
                [
                  [1, "docs.spacingSingle"],
                  [1.15, "docs.spacing115"],
                  [1.5, "docs.spacing15"],
                  [2, "docs.spacingDouble"],
                ] as const
              ).map(([value, key]) => (
                <MenuItem
                  key={value}
                  checked={Math.abs(s.lineSpacing - value) < 0.001}
                  onSelect={() => {
                    editor.chain().focus().setLineSpacing(value === 1.15 ? null : value).run();
                    close();
                  }}
                >
                  {t(key)}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  editor.chain().focus().setParagraphSpace("before", s.spaceBefore > 0 ? null : 10).run();
                  close();
                }}
              >
                {t(s.spaceBefore > 0 ? "docs.removeSpaceBefore" : "docs.addSpaceBefore")}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  editor.chain().focus().setParagraphSpace("after", s.spaceAfter > 0 ? null : 10).run();
                  close();
                }}
              >
                {t(s.spaceAfter > 0 ? "docs.removeSpaceAfter" : "docs.addSpaceAfter")}
              </MenuItem>
            </>
          )}
        </DropBtn>
        <Btn
          label={withKeys(t("docs.checklist"), "Mod+Shift+9")}
          track="checklist"
          pressed={s.task}
          disabled={off}
          onClick={() => run((c) => c.toggleTaskList())}
        >
          <ChecklistIcon />
        </Btn>
        <Btn
          label={withKeys(t("docs.bulletedList"), "Mod+Shift+8")}
          track="bulleted-list"
          pressed={s.bullet}
          disabled={off}
          onClick={() => run((c) => c.toggleBulletList())}
        >
          <BulletListIcon />
        </Btn>
        <Btn
          label={withKeys(t("docs.numberedList"), "Mod+Shift+7")}
          track="numbered-list"
          pressed={s.ordered}
          disabled={off}
          onClick={() => run((c) => c.toggleOrderedList())}
        >
          <NumberedListIcon />
        </Btn>
        <Btn
          label={withKeys(t("docs.decreaseIndent"), "Mod+[")}
          track="indent-decrease"
          disabled={off}
          onClick={() => run((c) => c.indentStep(-1))}
        >
          <IndentDecreaseIcon />
        </Btn>
        <Btn
          label={withKeys(t("docs.increaseIndent"), "Mod+]")}
          track="indent-increase"
          disabled={off}
          onClick={() => run((c) => c.indentStep(1))}
        >
          <IndentIncreaseIcon />
        </Btn>
        <Btn
          label={withKeys(t("docs.clearFormatting"), "Mod+\\")}
          track="clear-formatting"
          disabled={off}
          onClick={() => run((c) => c.unsetAllMarks())}
        >
          <ClearFormattingIcon />
        </Btn>
        </Fragment>,
        ]}
      </ToolbarRow>
      <div className="docs-toolbar-end">
        {aiControls}
        {canEdit && (
          <DropBtn
            label={t("docs.mode")}
            track="mode"
            face={
              <span className="docs-mode-face">
                {modeIcon}
                <span className="docs-tb-text">{t(mode === "editing" ? "docs.modeEditing" : "docs.modeViewing")}</span>
              </span>
            }
            wide
            panelClass="docs-menu-modes"
          >
            {(close) => (
              <>
                <MenuItem
                  checked={mode === "editing"}
                  icon={<EditIcon size={18} />}
                  onSelect={() => {
                    onMode("editing");
                    close();
                  }}
                >
                  <span className="docs-mode-item">
                    <span>{t("docs.modeEditing")}</span>
                    <span className="docs-mode-hint">{t("docs.modeEditingHint")}</span>
                  </span>
                </MenuItem>
                <MenuItem
                  checked={mode === "viewing"}
                  icon={<ViewIcon size={18} />}
                  onSelect={() => {
                    onMode("viewing");
                    close();
                  }}
                >
                  <span className="docs-mode-item">
                    <span>{t("docs.modeViewing")}</span>
                    <span className="docs-mode-hint">{t("docs.modeViewingHint")}</span>
                  </span>
                </MenuItem>
              </>
            )}
          </DropBtn>
        )}
        <Btn
          label={withKeys(t(headerHidden ? "docs.showTitle" : "docs.hideTitle"), "Mod+Shift+F")}
          track="hide-title"
          onClick={onToggleHeader}
        >
          {headerHidden ? <ExpandMoreIcon /> : <ExpandLessIcon />}
        </Btn>
      </div>
    </div>
  );
}
