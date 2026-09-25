"use client";

import { useT } from "@/components/lang-provider";
import { colorName, PALETTE } from "@/components/docs/palette";

// Google Docs' palette as the insert area's color buttons use it — a table
// border, a cell's background, an image's border: the eight rows of
// swatches, and None where a color can be taken away.

export function Swatches({
  current,
  onPick,
  onNone,
  noneLabel,
}: {
  current: string | null;
  onPick: (hex: string) => void;
  onNone?: () => void;
  noneLabel?: string;
}) {
  const t = useT();
  const on = current?.toLowerCase() ?? null;
  return (
    <div className="docs-swatch-box">
      {onNone && (
        <button type="button" className="docs-swatch-none-row" onClick={onNone}>
          <span className="docs-swatch-none" aria-hidden />
          {noneLabel ?? t("docsInsert.none")}
        </button>
      )}
      <div className="docs-swatches" role="listbox">
        {PALETTE.flat().map((hex) => {
          const name = colorName(t, hex);
          return (
            <button
              key={hex}
              type="button"
              role="option"
              aria-selected={on === hex}
              aria-label={name}
              data-tip={name}
              className={on === hex ? "is-on" : ""}
              style={{ backgroundColor: hex }}
              onClick={() => onPick(hex)}
            />
          );
        })}
      </div>
    </div>
  );
}
