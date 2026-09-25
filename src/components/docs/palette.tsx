"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { AddIcon } from "@/components/docs/icons";
import { keepFocus } from "@/components/docs/menu";

// The color grid Google Docs shows under Text color and Highlight color: a
// row of grays, a row of bright hues, and six rows of their tints and
// shades, then the reader's own custom colors (kept in this browser).

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

const CUSTOM_KEY = "unitos-docs-custom-colors";

function readCustom(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/.test(c)).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function writeCustom(list: string[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    // Private mode: the color still applies, it is just not kept.
  }
}

export function ColorPalette({
  current,
  onPick,
  onReset,
  resetLabel,
}: {
  current: string | null;
  onPick: (hex: string) => void;
  onReset: () => void;
  resetLabel: string;
}) {
  const t = useT();
  const [custom, setCustom] = useState<string[]>(() => (typeof window === "undefined" ? [] : readCustom()));
  const inputRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef(onPick);
  const customRef = useRef(custom);
  useEffect(() => {
    pickRef.current = onPick;
    customRef.current = custom;
  });
  // The browser's picker: the color applies once, when the picker closes
  // ("change"), not on every move inside it ("input").
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onChange = () => {
      const hex = input.value.toLowerCase();
      const next = [hex, ...customRef.current.filter((c) => c !== hex)].slice(0, 10);
      setCustom(next);
      writeCustom(next);
      pickRef.current(hex);
    };
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);
  const norm = current?.toLowerCase() ?? null;
  const swatch = (hex: string) => (
    <button
      key={hex}
      type="button"
      onMouseDown={keepFocus}
      onClick={() => onPick(hex)}
      aria-label={hex}
      data-tip={hex}
      className={`docs-swatch${norm === hex ? " docs-swatch-on" : ""}${hex === "#ffffff" ? " docs-swatch-white" : ""}`}
      style={{ background: hex }}
    />
  );
  return (
    <div className="docs-palette">
      <button type="button" onMouseDown={keepFocus} onClick={onReset} className="docs-palette-reset">
        <span className="docs-palette-none" aria-hidden />
        {resetLabel}
      </button>
      <div className="docs-palette-grid">
        {PALETTE[0].map(swatch)}
      </div>
      <div className="docs-palette-grid docs-palette-gap">{PALETTE[1].map(swatch)}</div>
      <div className="docs-palette-grid docs-palette-gap">{PALETTE.slice(2).flat().map(swatch)}</div>
      <div className="docs-palette-custom-label">{t("docs.customColors")}</div>
      <div className="docs-palette-grid">
        {custom.map(swatch)}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            const input = inputRef.current;
            if (!input) return;
            try {
              input.showPicker();
            } catch {
              input.click();
            }
          }}
          aria-label={t("docs.addCustomColor")}
          data-tip={t("docs.addCustomColor")}
          className="docs-swatch docs-swatch-add"
        >
          <AddIcon size={14} />
        </button>
        <input
          ref={inputRef}
          type="color"
          tabIndex={-1}
          className="pointer-events-none absolute size-0 opacity-0"
        />
      </div>
    </div>
  );
}
