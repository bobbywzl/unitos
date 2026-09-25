"use client";

import type { Editor } from "@tiptap/react";
import type { CSSProperties } from "react";
import { useT } from "@/components/lang-provider";
import type { DocStyle } from "@/components/docs/extensions";
import { fontStack } from "@/components/docs/fonts";
import { toast } from "@/components/docs/insert/context";
import { keys } from "@/components/docs/keys";
import { MenuItem, MenuSeparator } from "@/components/docs/menu";
import { DropBtn } from "@/components/docs/toolbar/controls";
import {
  DEFAULT_STYLES,
  replaceAllChanges,
  saveDefaultStyles,
  savedDefaultStyles,
  styleFont,
  updateStyleToMatch,
  type NamedStyle,
} from "@/components/docs/toolbar/styles";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

// Styles (SPEC.md §29): the named style of the selection, and Google Docs'
// menu of styles — Normal text, Title, Subtitle, Heading 1–3, and Heading
// 4–6 once the level above is in use — each drawn in its style, each with
// Apply 'Name' and Update 'Name' to match; then Options.

export const STYLE_LABEL: Record<DocStyle, TKey> = {
  normal: "docs.styleNormal",
  title: "docs.styleTitle",
  subtitle: "docs.styleSubtitle",
  h1: "docs.styleHeading1",
  h2: "docs.styleHeading2",
  h3: "docs.styleHeading3",
  h4: "docs.styleHeading4",
  h5: "docs.styleHeading5",
  h6: "docs.styleHeading6",
};

/** Normal text and the headings have shortcuts; Title and Subtitle none. */
export const STYLE_KEYS: Partial<Record<DocStyle, string>> = {
  normal: "Mod+Alt+0",
  h1: "Mod+Alt+1",
  h2: "Mod+Alt+2",
  h3: "Mod+Alt+3",
  h4: "Mod+Alt+4",
  h5: "Mod+Alt+5",
  h6: "Mod+Alt+6",
};

/** The styles the menu lists: Heading 4 once a Heading 3 or deeper is in
    the text, Heading 5 once a Heading 4, Heading 6 once a Heading 5. */
export function menuStyles(deepest: number): DocStyle[] {
  const list: DocStyle[] = ["normal", "title", "subtitle", "h1", "h2", "h3"];
  if (deepest >= 3) list.push("h4");
  if (deepest >= 4) list.push("h5");
  if (deepest >= 5) list.push("h6");
  return list;
}

/** Options: Save as my default styles, Use my default styles, Reset styles
    (the menu and Search the menus). */
export function styleOptions(editor: Editor, t: TFunc): { key: TKey; run: () => void }[] {
  return [
    {
      key: "docs.saveDefaultStyles",
      run: () => {
        saveDefaultStyles(editor.state.doc);
        toast(t("docs.defaultStylesSaved"));
      },
    },
    {
      key: "docs.useDefaultStyles",
      run: () => {
        replaceAllChanges(editor, savedDefaultStyles());
        toast(t("docs.usingDefaultStyles"));
      },
    },
    { key: "docs.resetStyles", run: () => replaceAllChanges(editor, {}) },
  ];
}

/** A style's item drawn in the style, its size capped at 24 pt. */
function preview(styles: Record<DocStyle, NamedStyle>, style: DocStyle): { style: CSSProperties; plain: boolean } {
  const s = styles[style];
  const plainColor = s.color === DEFAULT_STYLES[style].color;
  return {
    style: {
      fontFamily: fontStack(styleFont(styles, style)),
      fontSize: `${Math.min(24, s.size)}pt`,
      fontWeight: s.bold ? 700 : 400,
      fontStyle: s.italic ? "italic" : "normal",
      textDecoration: s.underline ? "underline" : "none",
      ["--docs-preview-color" as string]: s.color,
    },
    plain: plainColor,
  };
}

export function StylesSelect({
  editor,
  style,
  styles,
  deepest,
}: {
  editor: Editor;
  /** The selection's style; null when it spans styles. */
  style: DocStyle | null;
  styles: Record<DocStyle, NamedStyle>;
  deepest: number;
}) {
  const t = useT();
  const apply = (s: DocStyle) => editor.chain().focus().setDocStyle(s).run();
  return (
    <DropBtn
      id="styles"
      label={t("docs.styles")}
      track="styles"
      className="docs-tb-select docs-tb-styles"
      menuClassName="docs-menu-styles"
      face={<span className="docs-tb-caption">{style ? t(STYLE_LABEL[style]) : ""}</span>}
    >
      {(close) => (
        <>
          {menuStyles(deepest).map((s) => {
            const name = t(STYLE_LABEL[s]);
            const look = preview(styles, s);
            const combo = STYLE_KEYS[s];
            return (
              <MenuItem
                key={s}
                checked={style === s}
                label={name}
                track={`docs:style:${s}`}
                onSelect={() => {
                  close();
                  apply(s);
                }}
                submenuClassName="docs-menu-plain"
                submenu={
                  <>
                    <MenuItem
                      shortcut={combo ? keys(combo) : undefined}
                      onSelect={() => {
                        close();
                        apply(s);
                      }}
                    >
                      {t("docs.applyStyle", { name })}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      onSelect={() => {
                        close();
                        updateStyleToMatch(editor, s);
                        editor.commands.focus();
                      }}
                      track={`docs:update-style:${s}`}
                    >
                      {t("docs.updateStyle", { name })}
                    </MenuItem>
                  </>
                }
              >
                <span className="docs-style-preview" data-plain={look.plain ? "" : undefined} style={look.style}>
                  {name}
                </span>
              </MenuItem>
            );
          })}
          <MenuItem
            className="docs-style-options"
            submenuClassName="docs-menu-plain"
            submenu={styleOptions(editor, t).map((o) => (
              <MenuItem
                key={o.key}
                onSelect={() => {
                  close();
                  o.run();
                  editor.commands.focus();
                }}
              >
                {t(o.key)}
              </MenuItem>
            ))}
          >
            {t("docs.styleOptions")}
          </MenuItem>
        </>
      )}
    </DropBtn>
  );
}
