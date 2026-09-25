"use client";

import type { Editor } from "@tiptap/react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useT } from "@/components/lang-provider";
import {
  DOCS_FONTS,
  firstFamily,
  fontStack,
  fontWeights,
  loadFontInUse,
  loadGoogleFont,
  pushRecentFont,
  recentFonts,
  userFonts,
  WEIGHT_NAMES,
} from "@/components/docs/fonts";
import { AddFontsIcon } from "@/components/docs/icons";
import { MenuHeader, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { DropBtn } from "@/components/docs/toolbar/controls";
import type { TKey } from "@/lib/i18n/dictionaries";

// Font (SPEC.md §29): the face of the selection (blank when it mixes faces)
// and Google Docs' font menu — More fonts, the RECENT faces, then every
// face A–Z, each drawn in itself: Docs' list, the reader's own (More
// fonts), and the faces the document uses. A face with more than two
// weights opens its weights, each drawn in its weight.

const FontsDialog = dynamic(() => import("@/components/docs/toolbar/fonts-dialog").then((m) => m.FontsDialog), {
  ssr: false,
});

const WEIGHT_KEYS: Record<number, TKey> = {
  100: "docs.weightThin",
  200: "docs.weightExtraLight",
  300: "docs.weightLight",
  400: "docs.weightNormal",
  500: "docs.weightMedium",
  600: "docs.weightSemiBold",
  700: "docs.weightBold",
  800: "docs.weightExtraBold",
  900: "docs.weightBlack",
};

/** Every face the document's runs use. */
function documentFonts(editor: Editor): string[] {
  const faces = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== "textStyle") continue;
      const face = firstFamily(mark.attrs.fontFamily as string | undefined);
      if (face) faces.add(face);
    }
    return false;
  });
  return [...faces];
}

/** The weight at the caret: its own, Bold's 700, or 400. */
function currentWeight(editor: Editor): number {
  const w = editor.getAttributes("textStyle").fontWeight;
  if (typeof w === "number") return w;
  return editor.isActive("bold") ? 700 : 400;
}

export function FontSelect({ editor, font, disabled }: { editor: Editor; font: string | null; disabled: boolean }) {
  const t = useT();
  const [dialog, setDialog] = useState(false);

  const pick = (name: string, weight?: number) => {
    pushRecentFont(name);
    loadFontInUse(name, weight);
    const chain = editor.chain().focus().setFontFamily(name);
    if (weight !== undefined) {
      chain.setMark("textStyle", { fontWeight: weight === 400 || weight === 700 ? null : weight });
      if (weight === 700) chain.setBold();
      else chain.unsetBold();
    }
    chain.run();
  };

  return (
    <>
      <DropBtn
        id="font"
        label={t("docs.font")}
        track="font"
        disabled={disabled}
        className="docs-tb-select docs-tb-font"
        menuClassName="docs-menu-fonts"
        face={<span className="docs-tb-caption">{font ?? ""}</span>}
        onOpenChange={(open) => {
          // The faces the menu draws names in, as far as the stylesheets
          // leave them out.
          if (open) for (const f of userFonts()) loadGoogleFont(f.name, [400], true);
        }}
      >
        {(close) => {
          const recent = recentFonts();
          const names = new Map<string, string>();
          for (const f of DOCS_FONTS) names.set(f.name.toLowerCase(), f.name);
          for (const f of userFonts()) names.set(f.name.toLowerCase(), f.name);
          for (const f of documentFonts(editor)) if (!names.has(f.toLowerCase())) names.set(f.toLowerCase(), f);
          const all = [...names.values()].sort((a, b) => a.localeCompare(b));
          const weight = currentWeight(editor);
          const item = (name: string, key: string) => {
            const weights = fontWeights(name);
            const on = font !== null && font.toLowerCase() === name.toLowerCase();
            return (
              <MenuItem
                key={key}
                checked={on}
                label={name}
                track="docs:font-pick"
                onSelect={() => {
                  close();
                  pick(name);
                }}
                submenuClassName="docs-menu-weights"
                submenu={
                  weights.length > 2
                    ? weights.map((w) => (
                        <MenuItem
                          key={w}
                          checked={on && weight === w}
                          label={`${name} ${WEIGHT_NAMES[w] ?? w}`}
                          onSelect={() => {
                            close();
                            pick(name, w);
                          }}
                        >
                          <span style={{ fontFamily: fontStack(name), fontWeight: w }}>{t(WEIGHT_KEYS[w] ?? "docs.weightNormal")}</span>
                        </MenuItem>
                      ))
                    : undefined
                }
              >
                <span style={{ fontFamily: fontStack(name) }}>{name}</span>
              </MenuItem>
            );
          };
          return (
            <>
              <MenuItem
                icon={<AddFontsIcon size={16} />}
                className="docs-more-fonts"
                onSelect={() => {
                  close();
                  setDialog(true);
                }}
                track="docs:more-fonts"
              >
                {t("docs.moreFonts")}
              </MenuItem>
              <MenuSeparator />
              {recent.length > 0 && (
                <>
                  <MenuHeader>{t("docs.recentFonts")}</MenuHeader>
                  {recent.map((name) => item(name, `recent-${name}`))}
                  <MenuSeparator />
                </>
              )}
              <div className="docs-fontmenu-fonts">{all.map((name) => item(name, name))}</div>
            </>
          );
        }}
      </DropBtn>
      {dialog && (
        <FontsDialog
          onClose={() => {
            setDialog(false);
            editor.commands.focus();
          }}
        />
      )}
    </>
  );
}
