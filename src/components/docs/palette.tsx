"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { AddCircleIcon, CheckIcon, ColorResetIcon, EyedropperIcon } from "@/components/docs/icons";
import { MenuHeader, MenuItem, keepFocus } from "@/components/docs/menu";
import type { TFunc } from "@/lib/i18n/dictionaries";

// The color menu Google Docs opens from Text color and Highlight color
// (SPEC.md §29): Highlight color's None, then the palette — a row of grays,
// a row of bright hues, and six rows of their tints and shades — and the
// CUSTOM row: add a color, the eyedropper where the browser has one, and
// the reader's own colors (kept in this browser). A swatch applies its
// color and closes the menu.

export const PALETTE: string[][] = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

const GRAYS = [
  "docs.colorBlack",
  "docs.colorDarkGray4",
  "docs.colorDarkGray3",
  "docs.colorDarkGray2",
  "docs.colorDarkGray1",
  "docs.colorGray",
  "docs.colorLightGray1",
  "docs.colorLightGray2",
  "docs.colorLightGray3",
  "docs.colorWhite",
] as const;
const HUES = [
  "docs.colorRedBerry",
  "docs.colorRed",
  "docs.colorOrange",
  "docs.colorYellow",
  "docs.colorGreen",
  "docs.colorCyan",
  "docs.colorCornflowerBlue",
  "docs.colorBlue",
  "docs.colorPurple",
  "docs.colorMagenta",
] as const;
/** Rows 3–8: light 3, 2, 1, then dark 1, 2, 3 of the row-2 hue. */
const SHADES: { key: "docs.colorLight" | "docs.colorDark"; n: number }[] = [
  { key: "docs.colorLight", n: 3 },
  { key: "docs.colorLight", n: 2 },
  { key: "docs.colorLight", n: 1 },
  { key: "docs.colorDark", n: 1 },
  { key: "docs.colorDark", n: 2 },
  { key: "docs.colorDark", n: 3 },
];

function paletteName(t: TFunc, row: number, col: number): string {
  if (row === 0) return t(GRAYS[col]);
  const hue = t(HUES[col]);
  if (row === 1) return hue;
  const shade = SHADES[row - 2];
  return t(shade.key, { name: hue, n: shade.n });
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** A color's name: the palette's, or "#rrggbb, close to <the nearest>". */
export function colorName(t: TFunc, hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  let best = { d: Infinity, row: 0, col: 0 };
  PALETTE.forEach((row, i) =>
    row.forEach((c, j) => {
      const [cr, cg, cb] = hexToRgb(c);
      const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
      if (d < best.d) best = { d, row: i, col: j };
    }),
  );
  const name = paletteName(t, best.row, best.col);
  return best.d === 0 ? name : t("docs.colorNear", { hex, name });
}

/** Light swatches get a hairline border and a black check. */
function isLight(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 200;
}

const CUSTOM_KEY = "unitos-docs-custom-colors";
const CUSTOM_MAX = 10;
const HEX = /^#[0-9a-f]{6}$/;

export function readCustomColors(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, CUSTOM_MAX)
      : [];
  } catch {
    return [];
  }
}

/** A new custom color goes first in the CUSTOM row. */
export function addCustomColor(hex: string): string[] {
  const next = [hex.toLowerCase(), ...readCustomColors().filter((c) => c !== hex.toLowerCase())].slice(0, CUSTOM_MAX);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the color still applies, it is just not kept.
  }
  return next;
}

type EyeDropperResult = { sRGBHex: string };
type EyeDropperCtor = new () => { open: () => Promise<EyeDropperResult> };

function eyeDropper(): EyeDropperCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof ctor === "function" ? ctor : null;
}

/** The browser's eyedropper (Chrome and Edge): the color under the next
    click anywhere on the screen, as #rrggbb, or null when cancelled. */
export async function pickFromScreen(): Promise<string | null> {
  const Ctor = eyeDropper();
  if (!Ctor) return null;
  try {
    const { sRGBHex } = await new Ctor().open();
    if (HEX.test(sRGBHex.toLowerCase())) return sRGBHex.toLowerCase();
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(sRGBHex);
    return m ? rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  } catch {
    return null;
  }
}

export function hasEyeDropper(): boolean {
  return eyeDropper() !== null;
}

export function ColorMenu({
  kind,
  current,
  onPick,
  onNone,
  onCustom,
}: {
  kind: "text" | "highlight";
  /** The selection's color (#rrggbb), or null for the default. */
  current: string | null;
  onPick: (hex: string) => void;
  /** Highlight color's None. */
  onNone?: () => void;
  /** The add button: the custom color picker. */
  onCustom: () => void;
}) {
  const t = useT();
  const [custom, setCustom] = useState<string[]>(() => (typeof window === "undefined" ? [] : readCustomColors()));
  const norm = current?.toLowerCase() ?? (kind === "text" ? "#000000" : null);
  const swatch = (hex: string, name: string, small = false) => {
    const on = norm === hex;
    return (
      <button
        key={hex}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        aria-label={name}
        data-tip={name}
        data-menu-item
        tabIndex={-1}
        onMouseDown={keepFocus}
        onClick={() => onPick(hex)}
        className={`docs-swatch${small ? " docs-swatch-custom" : ""}${isLight(hex) ? " docs-swatch-light" : ""}${on ? " docs-swatch-on" : ""}`}
        style={{ background: hex }}
      >
        {on && !small && <CheckIcon size={16} />}
      </button>
    );
  };
  return (
    <div className="docs-palette">
      {kind === "highlight" && onNone && (
        <MenuItem onSelect={onNone} icon={<ColorResetIcon size={18} />} className="docs-palette-none" track="docs:highlight-none">
          {t("docs.noHighlight")}
        </MenuItem>
      )}
      <div className="docs-palette-grid" data-grid-cols={10} role="group">
        {PALETTE.map((row, i) => (
          <div key={i} className={`docs-palette-row${i < 2 ? " docs-palette-row-gap" : ""}`}>
            {row.map((hex, j) => swatch(hex, paletteName(t, i, j)))}
          </div>
        ))}
      </div>
      <MenuHeader>{t("docs.customColors")}</MenuHeader>
      <div className="docs-palette-custom" data-grid-cols={12}>
        <button
          type="button"
          data-menu-item
          tabIndex={-1}
          aria-label={t("docs.addCustomColor")}
          data-tip={t("docs.addCustomColor")}
          onMouseDown={keepFocus}
          onClick={onCustom}
          className="docs-palette-tool"
        >
          <AddCircleIcon size={20} />
        </button>
        {hasEyeDropper() && (
          <button
            type="button"
            data-menu-item
            tabIndex={-1}
            aria-label={t("docs.eyedropper")}
            data-tip={t("docs.eyedropper")}
            onMouseDown={keepFocus}
            onClick={() => {
              void pickFromScreen().then((hex) => {
                if (!hex) return;
                setCustom(addCustomColor(hex));
                onPick(hex);
              });
            }}
            className="docs-palette-tool"
          >
            <EyedropperIcon size={20} />
          </button>
        )}
        {custom.map((hex) => swatch(hex, colorName(t, hex), true))}
      </div>
    </div>
  );
}
