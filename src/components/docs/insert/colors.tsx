"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { MenuItem } from "@/components/docs/menu";
import { addCustomColor, ColorMenu } from "@/components/docs/palette";
import { DropBtn } from "@/components/docs/toolbar/controls";
import { CustomColorDialog } from "@/components/docs/toolbar/custom-color";
import { BorderColorIcon, BorderDashIcon, BorderWeightIcon } from "@/components/docs/insert/icons";
import type { Dash } from "@/components/docs/insert/image";
import type { TKey } from "@/lib/i18n/dictionaries";

// The insert area's color and border buttons — a table's borders and cell
// background, an image's border: the toolbar's color menu with its custom
// colors, and Google Docs' border weight and dash menus.

const WEIGHTS = [0, 0.5, 1, 1.5, 2, 3, 4, 6];
const DASHES: [Dash, TKey][] = [
  ["solid", "docsInsert.dashSolid"],
  ["dotted", "docsInsert.dashDotted"],
  ["dashed", "docsInsert.dashDashed"],
];

/** A button that opens the color menu; `onNone` adds None. */
export function ColorButton({
  label,
  track,
  face,
  current,
  onPick,
  onNone,
}: {
  label: string;
  track: string;
  face: ReactNode;
  current: string | null;
  onPick: (hex: string) => void;
  onNone?: () => void;
}) {
  const [custom, setCustom] = useState(false);
  return (
    <>
      <DropBtn label={label} track={track} face={face}>
        {(close) => (
          <ColorMenu
            kind="highlight"
            current={current}
            onPick={(hex) => {
              close();
              onPick(hex);
            }}
            onNone={
              onNone &&
              (() => {
                close();
                onNone();
              })
            }
            onCustom={() => {
              close();
              setCustom(true);
            }}
          />
        )}
      </DropBtn>
      {custom && (
        <CustomColorDialog
          initial={current ?? "#000000"}
          onClose={() => setCustom(false)}
          onApply={(hex) => {
            addCustomColor(hex);
            setCustom(false);
            onPick(hex);
          }}
        />
      )}
    </>
  );
}

function LineRow({ style, label }: { style: CSSProperties; label: string }) {
  return (
    <span className="docs-line-row">
      <span style={style} />
      {label}
    </span>
  );
}

/** Border color, Border weight, and Border dash. */
export function BorderButtons({
  track,
  border,
  onChange,
  onNone,
}: {
  track: string;
  /** The border as drawn now: color null for none. */
  border: { color: string | null; width: number; dash: Dash };
  onChange: (spec: { color?: string; width?: number; dash?: Dash }) => void;
  /** The color menu's None. */
  onNone?: () => void;
}) {
  const t = useT();
  return (
    <>
      <ColorButton
        label={t("docsInsert.borderColor")}
        track={`${track}-border-color`}
        face={<BorderColorIcon />}
        current={border.color}
        onPick={(color) => onChange({ color })}
        onNone={onNone}
      />
      <DropBtn label={t("docsInsert.borderWeight")} track={`${track}-border-width`} face={<BorderWeightIcon />}>
        {(close) =>
          WEIGHTS.map((w) => (
            <MenuItem
              key={w}
              checked={border.width === w}
              onSelect={() => {
                close();
                onChange({ width: w });
              }}
            >
              <LineRow style={{ borderTopWidth: `${Math.max(w, 0.5)}pt`, opacity: w ? 1 : 0.3 }} label={`${w} pt`} />
            </MenuItem>
          ))
        }
      </DropBtn>
      <DropBtn label={t("docsInsert.borderDash")} track={`${track}-border-dash`} face={<BorderDashIcon />}>
        {(close) =>
          DASHES.map(([dash, label]) => (
            <MenuItem
              key={dash}
              checked={border.dash === dash}
              onSelect={() => {
                close();
                onChange({ dash });
              }}
            >
              <LineRow style={{ borderTopStyle: dash, borderTopWidth: 2 }} label={t(label)} />
            </MenuItem>
          ))
        }
      </DropBtn>
    </>
  );
}
